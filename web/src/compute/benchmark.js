import { MAX_ELEMENTS, MAX_REPETITIONS, KERNEL_ID, assertInteger, executeKernel, seededInput, referenceKernel, checksum, verifyResult, summarize } from './stats.js';
import { createGPUKernel, UnsupportedError, throwIfAborted } from './gpu.js';

const TIMING = {
  js: 'end-to-end wall time: transform, modular reduction and output allocation; input generation and validation excluded',
  workers: 'end-to-end wall time: input partition/copy, transferable messages, worker computation, output merge; input generation and validation excluded',
  webgpu: 'end-to-end wall time: input upload, dispatch, modular reduction, output and timestamp readback; input generation and validation excluded'
};
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));

function createWorkerPool(count, signal) {
  if (typeof Worker === 'undefined') throw new UnsupportedError('Web Workers are unavailable in this environment');
  const pool = [];
  try {
    for (let i = 0; i < count; i++) pool.push(new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: `theatre-compute-${i}` }));
  } catch (error) { for (const worker of pool) worker.terminate(); throw error; }
  let nextId = 0;
  const dispose = () => pool.forEach(worker => worker.terminate());
  const submit = (worker, input, offset) => new Promise((resolve, reject) => {
    const id = nextId++;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('message', message);
      worker.removeEventListener('error', fail);
      worker.removeEventListener('messageerror', fail);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const message = event => {
      if (event.data.id !== id) return;
      if (event.data.error) finish(new Error(event.data.error));
      else finish(null, { offset, values: new Uint32Array(event.data.buffer), sum: event.data.sum });
    };
    const fail = event => finish(new Error(event.message || 'Worker message failed'));
    const abort = () => { dispose(); finish(new DOMException('The experiment was cancelled', 'AbortError')); };
    const timer = setTimeout(() => { dispose(); finish(new Error('Worker operation exceeded the 15 second limit')); }, 15000);
    worker.addEventListener('message', message);
    worker.addEventListener('error', fail);
    worker.addEventListener('messageerror', fail);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage({ id, buffer: input.buffer, offset }, [input.buffer]); }
    catch (error) { finish(error); }
  });
  return {
    dispose,
    async run(input) {
      throwIfAborted(signal);
      const jobs = [];
      const chunk = Math.ceil(input.length / pool.length);
      for (let workerIndex = 0; workerIndex < pool.length; workerIndex++) {
        const offset = workerIndex * chunk;
        if (offset < input.length) jobs.push(submit(pool[workerIndex], input.slice(offset, Math.min(offset + chunk, input.length)), offset));
      }
      const pieces = await Promise.all(jobs);
      const values = new Uint32Array(input.length);
      let sum = 0;
      for (const piece of pieces) { values.set(piece.values, piece.offset); sum = (sum + piece.sum) >>> 0; }
      return { values, sum };
    }
  };
}

export async function runBenchmark({ sizes = [16384, 65536, 262144], repetitions = 7, workers = 2, signal, onProgress, backends = ['js', 'workers', 'webgpu'], seed = 0x00c0ffee } = {}) {
  throwIfAborted(signal);
  if (!Array.isArray(sizes) || !sizes.length || sizes.length > 6 || new Set(sizes).size !== sizes.length) throw new RangeError('sizes must contain 1–6 different bounded sizes');
  sizes.forEach(size => assertInteger(size, 'size in elements', 1, MAX_ELEMENTS));
  assertInteger(repetitions, 'repetitions', 3, MAX_REPETITIONS);
  assertInteger(workers, 'workers', 1, 8);
  assertInteger(seed, 'seed', 0, 0xffffffff);
  if (!Array.isArray(backends) || !backends.length || backends.length > 3 || new Set(backends).size !== backends.length || backends.some(name => !Object.hasOwn(TIMING, name))) throw new TypeError('backends must be distinct js, workers, or webgpu entries');
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function');
  const emit = event => { onProgress?.(Object.freeze(event)); throwIfAborted(signal); };
  const started = performance.now();
  const deadline = started + 90000;
  const check = () => { throwIfAborted(signal); if (performance.now() > deadline) throw new Error('Benchmark exceeded the 90 second total budget'); };
  const document = {
    schemaVersion: 1, kind: 'measured', experiment: KERNEL_ID, createdAt: new Date().toISOString(),
    environment: { execution: 'browser', runtime: typeof window === 'undefined' ? 'node-test' : 'browser', userAgent: globalThis.navigator?.userAgent ?? 'unknown', hardwareConcurrency: globalThis.navigator?.hardwareConcurrency ?? null, crossOriginIsolated: globalThis.crossOriginIsolated === true, workersRequested: workers, timer: 'performance.now; effective timer resolution depends on the browser' },
    protocol: { seed, repetitions, maxElements: MAX_ELEMENTS, maxDurationMs: 90000, cold: 'backend creation and first measured run for this size; not a fresh browser or a guarantee of empty hardware caches', warm: 'existing backend; one complete end-to-end run per sample', validation: 'every output element and modular sum, after cold and each warm run, outside timed scope', order: [...backends], notes: ['Renderer must be paused by the caller while measuring.', 'The total budget is checked between bounded operations; an in-flight operation has its own 15 second limit.', 'Sequential samples may be correlated; intervals are exploratory, not a hardware ranking.', 'Native OpenMP imports are a separate experiment with a different timing scope.'] },
    rows: []
  };
  emit({ phase: 'start', total: sizes.length * backends.length, completed: 0 });
  for (const size of sizes) {
    check();
    const input = seededInput(size, seed);
    let reference;
    for (const backend of backends) {
      check();
      let runner;
      let row;
      try {
        emit({ phase: 'backend', backend, size, completed: document.rows.length, total: sizes.length * backends.length });
        await yieldUI();
        check();
        const coldStart = performance.now();
        runner = backend === 'js' ? { run: data => executeKernel(data), dispose() {} } : backend === 'workers' ? createWorkerPool(Math.min(workers, size), signal) : await createGPUKernel(size, { signal });
        const coldResult = await runner.run(input);
        const coldMs = performance.now() - coldStart;
        // Generate the reference after the first measurement, so it does not deliberately warm that first JS run.
        reference ??= referenceKernel(input);
        if (!verifyResult(coldResult, reference)) throw new Error('Cold run failed output equality validation');
        const samples = [], gpuSamples = [];
        let last = coldResult;
        for (let repetition = 0; repetition < repetitions; repetition++) {
          await yieldUI();
          check();
          const start = performance.now();
          last = await runner.run(input);
          const elapsed = performance.now() - start;
          if (!verifyResult(last, reference)) throw new Error(`Warm run ${repetition + 1} failed output equality validation`);
          samples.push(elapsed);
          if (typeof last.gpuMs === 'number' && Number.isFinite(last.gpuMs) && last.gpuMs >= 0) gpuSamples.push(last.gpuMs);
          emit({ phase: 'sample', backend, size, repetition: repetition + 1, repetitions, completed: document.rows.length, total: sizes.length * backends.length });
        }
        row = { size, backend, status: 'ok', samples, summary: summarize(samples), coldMs, timingScope: TIMING[backend], correctness: { verified: true, checks: repetitions + 1, sum: last.sum, checksum: checksum(last.values), expectedSum: reference.sum, expectedChecksum: reference.checksum } };
        if (backend === 'workers') row.workerCount = Math.min(workers, size);
        if (runner.description) row.gpu = runner.description;
        if (gpuSamples.length === repetitions) { row.gpuSamples = gpuSamples; row.gpuSummary = summarize(gpuSamples); row.gpuTimingScope = 'GPU timestamp interval of the compute pass only, excluding upload/readback; timer values may be quantized'; }
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        row = { size, backend, status: error.name === 'UnsupportedError' ? 'unsupported' : 'error', reason: error.message, samples: [], summary: null, coldMs: null, timingScope: TIMING[backend], correctness: { verified: false } };
      } finally { runner?.dispose(); }
      document.rows.push(row);
      emit({ phase: 'row', row, completed: document.rows.length, total: sizes.length * backends.length });
    }
  }
  check();
  document.elapsedMs = performance.now() - started;
  emit({ phase: 'complete', completed: document.rows.length, total: sizes.length * backends.length });
  return document;
}
