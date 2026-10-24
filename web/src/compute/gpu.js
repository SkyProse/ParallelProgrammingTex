import { MAX_ELEMENTS, assertInteger } from './stats.js';

const USAGE = { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, STORAGE: 128, QUERY_RESOLVE: 512 };
const READ = 1;
const LIMIT_KEYS = ['maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupsPerDimension', 'maxComputeWorkgroupSizeX', 'maxComputeInvocationsPerWorkgroup', 'subgroupMinSize', 'subgroupMaxSize'];

export class UnsupportedError extends Error { constructor(message) { super(message); this.name = 'UnsupportedError'; } }
export function throwIfAborted(signal) { if (signal?.aborted) throw new DOMException('The experiment was cancelled', 'AbortError'); }

function observed(promise, { signal, device, timeoutMs = 15000 } = {}) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(new DOMException('The experiment was cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('GPU operation exceeded the 15 second limit')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => finish(null, value), error => finish(error));
    device?.lost?.then(info => finish(new Error(`GPU device lost: ${info.message || info.reason || 'unknown reason'}`)));
  });
}

function diagnostics(adapter, gpu) {
  const features = new Set(adapter?.features ?? []);
  const languages = new Set(gpu?.wgslLanguageFeatures ?? []);
  return {
    subgroups: { supported: features.has('subgroups'), note: 'Actual builtin values, not a fixed hardware warp size' },
    subgroupId: { supported: features.has('subgroups') && languages.has('subgroup_id'), note: 'WGSL language extension, optional' },
    subgroupSizeControl: { supported: features.has('subgroup-size-control'), note: 'Optional adapter feature; requested sizes must satisfy adapter limits' },
    timestamps: { supported: features.has('timestamp-query'), note: 'Optional pass timing, distinct from upload and readback latency' },
    bufferView: { supported: languages.has('buffer_view'), note: 'Capability diagnostic only; baseline does not require this WGSL extension' },
    immediates: { supported: languages.has('immediate_address_space'), note: 'Capability diagnostic only; baseline uses ordinary bindings' },
    htmlInCanvas: { supported: typeof globalThis.GPUQueue?.prototype?.drawElementImageToTexture === 'function', experimental: true, note: 'HTML-in-Canvas origin trial; diagnostic only, ordinary DOM remains available' }
  };
}

function describeAdapter(adapter, gpu) {
  const limits = {};
  for (const key of LIMIT_KEYS) if (Number.isFinite(adapter?.limits?.[key])) limits[key] = adapter.limits[key];
  const info = adapter?.info;
  for (const key of ['subgroupMinSize', 'subgroupMaxSize']) if (Number.isFinite(info?.[key])) limits[key] = info[key];
  return { supported: true, reason: null, features: [...(adapter.features ?? [])].sort(), wgslLanguageFeatures: [...(gpu.wgslLanguageFeatures ?? [])].sort(), limits, adapterInfo: info ? { vendor: info.vendor ?? '', architecture: info.architecture ?? '', description: info.description ?? '' } : null, diagnostics: diagnostics(adapter, gpu) };
}

export async function probeGPU({ gpu = globalThis.navigator?.gpu, signal } = {}) {
  throwIfAborted(signal);
  const unavailable = reason => ({ supported: false, reason, features: [], wgslLanguageFeatures: [], limits: {}, diagnostics: diagnostics(null, gpu) });
  if (!gpu) return unavailable('WebGPU API is not exposed in this browser/context');
  try {
    const adapter = await observed(gpu.requestAdapter(), { signal });
    return adapter ? describeAdapter(adapter, gpu) : unavailable('The browser could not provide a WebGPU adapter');
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return unavailable(error.message);
  }
}

async function acquire(requiredFeatures, signal) {
  throwIfAborted(signal);
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) throw new UnsupportedError('WebGPU is unavailable; no GPU measurements were generated');
  const adapter = await observed(gpu.requestAdapter(), { signal });
  if (!adapter) throw new UnsupportedError('No usable GPU adapter was returned');
  const requested = typeof requiredFeatures === 'function' ? requiredFeatures(adapter, gpu) : requiredFeatures;
  for (const name of requested) if (!adapter.features.has(name)) throw new UnsupportedError(`Required GPU feature is unavailable: ${name}`);
  const pending = adapter.requestDevice({ requiredFeatures: requested });
  let device;
  try {
    device = await observed(pending, { signal });
    throwIfAborted(signal);
  } catch (error) {
    // requestDevice cannot be cancelled. A timeout/abort can finish before its
    // promise, so release any late device instead of abandoning its resources.
    pending.then(lateDevice => lateDevice.destroy(), () => {});
    throw error;
  }
  return { device, adapter, gpu, description: describeAdapter(adapter, gpu) };
}

async function pipeline(device, code, signal) {
  const module = device.createShaderModule({ code });
  if (module.getCompilationInfo) {
    const info = await observed(module.getCompilationInfo(), { signal, device });
    const errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(error => `${error.lineNum}:${error.linePos} ${error.message}`).join('\n'));
  }
  return observed(device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } }), { signal, device });
}

/** Exact uint32 arithmetic; no subgroup feature is required by the benchmark. */
export const KERNEL_WGSL = `
@group(0) @binding(0) var<storage, read> sourceData: array<u32>;
@group(0) @binding(1) var<storage, read_write> outputData: array<u32>;
@group(0) @binding(2) var<storage, read_write> total: atomic<u32>;
var<workgroup> partial: array<u32, 64>;
fn mixValue(value: u32, index: u32) -> u32 {
  var mixed = value ^ ((index + 1u) * 0x9e3779b9u);
  mixed = (mixed ^ (mixed >> 16u)) * 0x85ebca6bu;
  mixed = (mixed ^ (mixed >> 13u)) * 0xc2b2ae35u;
  return mixed ^ (mixed >> 16u);
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global: vec3<u32>, @builtin(local_invocation_id) local: vec3<u32>) {
  var value = 0u;
  if (global.x < arrayLength(&sourceData)) {
    value = mixValue(sourceData[global.x], global.x);
    outputData[global.x] = value;
  }
  partial[local.x] = value;
  workgroupBarrier();
  var stride = 32u;
  loop {
    if (local.x < stride) { partial[local.x] += partial[local.x + stride]; }
    workgroupBarrier();
    if (stride == 1u) { break; }
    stride = stride / 2u;
  }
  if (local.x == 0u) { atomicAdd(&total, partial[0]); }
}`;

export async function createGPUKernel(size, { signal } = {}) {
  assertInteger(size, 'size in elements', 1, MAX_ELEMENTS);
  const session = await acquire(adapter => adapter.features.has('timestamp-query') ? ['timestamp-query'] : [], signal);
  const { device, description } = session;
  const resources = [];
  const allocate = (bytes, usage) => { const buffer = device.createBuffer({ size: bytes, usage }); resources.push(buffer); return buffer; };
  const dispose = () => { signal?.removeEventListener('abort', onAbort); for (const resource of resources) resource.destroy(); device.destroy(); };
  const onAbort = () => device.destroy();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (size * 4 > device.limits.maxStorageBufferBindingSize || Math.ceil(size / 64) > device.limits.maxComputeWorkgroupsPerDimension) throw new UnsupportedError('Input exceeds the available GPU limits');
    const compute = await pipeline(device, KERNEL_WGSL, signal);
    const source = allocate(size * 4, USAGE.STORAGE | USAGE.COPY_DST);
    const output = allocate(size * 4, USAGE.STORAGE | USAGE.COPY_SRC);
    const sum = allocate(4, USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC);
    const read = allocate(size * 4 + 4, USAGE.MAP_READ | USAGE.COPY_DST);
    const bind = device.createBindGroup({ layout: compute.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: source } }, { binding: 1, resource: { buffer: output } }, { binding: 2, resource: { buffer: sum } }] });
    let query = null, resolved = null, queryRead = null;
    if (device.features.has('timestamp-query')) {
      query = device.createQuerySet({ type: 'timestamp', count: 2 });
      resources.push(query);
      resolved = allocate(16, USAGE.QUERY_RESOLVE | USAGE.COPY_SRC);
      queryRead = allocate(16, USAGE.MAP_READ | USAGE.COPY_DST);
    }
    return {
      description,
      dispose,
      async run(input) {
        throwIfAborted(signal);
        if (!(input instanceof Uint32Array) || input.length !== size) throw new TypeError('GPU input size mismatch');
        device.queue.writeBuffer(source, 0, input);
        device.queue.writeBuffer(sum, 0, new Uint32Array([0]));
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass(query ? { timestampWrites: { querySet: query, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
        pass.setPipeline(compute);
        pass.setBindGroup(0, bind);
        pass.dispatchWorkgroups(Math.ceil(size / 64));
        pass.end();
        encoder.copyBufferToBuffer(output, 0, read, 0, size * 4);
        encoder.copyBufferToBuffer(sum, 0, read, size * 4, 4);
        if (query) { encoder.resolveQuerySet(query, 0, 2, resolved, 0); encoder.copyBufferToBuffer(resolved, 0, queryRead, 0, 16); }
        device.queue.submit([encoder.finish()]);
        await observed(read.mapAsync(READ), { signal, device });
        let values, total;
        try { const data = new Uint32Array(read.getMappedRange()); values = data.slice(0, size); total = data[size]; }
        finally { read.unmap(); }
        let gpuMs = null;
        if (query) {
          await observed(queryRead.mapAsync(READ), { signal, device });
          try { const times = new BigUint64Array(queryRead.getMappedRange()); if (times[1] >= times[0]) gpuMs = Number(times[1] - times[0]) / 1e6; }
          finally { queryRead.unmap(); }
        }
        return { values, sum: total, gpuMs };
      }
    };
  } catch (error) { dispose(); throw error; }
}

export function validateLoomOptions({ count = 256, workgroupSize = 64, subgroupSize = null } = {}) {
  assertInteger(count, 'invocation count', 1, 65_536);
  assertInteger(workgroupSize, 'workgroup size', 1, 256);
  if (subgroupSize !== null) {
    assertInteger(subgroupSize, 'subgroup size', 1, 128);
    if ((subgroupSize & (subgroupSize - 1)) !== 0 || subgroupSize > workgroupSize) throw new RangeError('subgroup size must be a power of two no larger than the workgroup');
  }
  return { count, workgroupSize, subgroupSize };
}

// Feature syntax verified against official Chrome 144 (subgroup_id) and 151–152 (size control) docs.
// https://developer.chrome.com/blog/new-in-webgpu-144
// https://developer.chrome.com/blog/new-in-webgpu-151-152
export function buildLoomShader({ count = 256, workgroupSize = 64, subgroups = false, subgroupId = false, subgroupSize = null } = {}) {
  validateLoomOptions({ count, workgroupSize, subgroupSize });
  if ((subgroupId || subgroupSize !== null) && !subgroups) throw new TypeError('Subgroup options require the subgroups feature');
  return `${subgroups ? 'enable subgroups;' : ''}
${subgroupId ? 'requires subgroup_id;' : ''}
${subgroupSize !== null ? 'enable subgroup_size_control;' : ''}
struct Invocation { globalId: u32, localId: u32, workgroupId: u32, subgroupSize: u32, subgroupInvocationId: u32, subgroupId: u32 }
@group(0) @binding(0) var<storage, read_write> mapping: array<Invocation>;
${subgroupSize !== null ? `@subgroup_size(${subgroupSize})` : ''}
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) global: vec3<u32>, @builtin(local_invocation_index) local: u32, @builtin(workgroup_id) group: vec3<u32>
${subgroups ? ', @builtin(subgroup_size) sgSize: u32, @builtin(subgroup_invocation_id) sgInvocation: u32' : ''}
${subgroupId ? ', @builtin(subgroup_id) sgId: u32' : ''}) {
  if (global.x >= ${count}u) { return; }
  mapping[global.x] = Invocation(global.x, local, group.x, ${subgroups ? 'sgSize, sgInvocation' : '0u, 0xffffffffu'}, ${subgroupId ? 'sgId' : '0xffffffffu'});
}`;
}

export function decodeLoomMapping(data, { count, workgroupSize, subgroups = false, subgroupId = false, requestedSubgroupSize = null }) {
  validateLoomOptions({ count, workgroupSize, subgroupSize: requestedSubgroupSize });
  if (!(data instanceof Uint32Array) || data.length !== count * 6) throw new Error('GPU mapping length failed correctness validation');
  const values = [];
  const workgroups = Array.from({ length: Math.ceil(count / workgroupSize) }, (_, id) => ({ id, invocations: [] }));
  for (let index = 0; index < count; index++) {
    const value = { globalId: data[index * 6], localId: data[index * 6 + 1], workgroupId: data[index * 6 + 2] };
    if (value.globalId !== index || value.localId !== index % workgroupSize || value.workgroupId !== Math.floor(index / workgroupSize)) throw new Error('GPU invocation mapping failed correctness validation');
    if (subgroups) {
      value.subgroupSize = data[index * 6 + 3]; value.subgroupInvocationId = data[index * 6 + 4];
      if (!value.subgroupSize || value.subgroupInvocationId >= value.subgroupSize || (requestedSubgroupSize !== null && value.subgroupSize !== requestedSubgroupSize)) throw new Error('Measured subgroup mapping failed correctness validation');
    }
    if (subgroupId) value.subgroupId = data[index * 6 + 5];
    values.push(value);
    workgroups[value.workgroupId].invocations.push(value.globalId);
  }
  return { values, workgroups, subgroupSizes: [...new Set(values.map(value => value.subgroupSize).filter(Boolean))].sort((a, b) => a - b) };
}

/** Validate a portable report's internal mapping, never attest that an external GPU ran it. */
export function validateLoomDocument(document) {
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = (value, name, maximum = 2000) => {
    if (typeof value !== 'string' || !value.length || value.length > maximum) throw new TypeError(`Invalid ${name}`);
    return value;
  };
  if (!plain(document) || document.schemaVersion !== 1 || document.kind !== 'gpu-dispatch') throw new TypeError('Expected GPU-dispatch report schema version 1');
  const createdAt = text(document.createdAt, 'creation date', 80);
  if (!Number.isFinite(Date.parse(createdAt))) throw new TypeError('Invalid creation date');
  if (!['ok', 'unsupported', 'error'].includes(document.status)) throw new TypeError('Invalid GPU report status');
  const reportedFeatures = document.features ?? [];
  if (!Array.isArray(reportedFeatures) || reportedFeatures.length > 128 || reportedFeatures.some(feature => typeof feature !== 'string' || feature.length < 1 || feature.length > 128)) throw new TypeError('Invalid reported GPU features');
  const importedDiagnostics = {};
  if (document.diagnostics !== undefined) {
    if (!plain(document.diagnostics)) throw new TypeError('Invalid reported GPU diagnostics');
    for (const key of ['subgroups', 'subgroupId', 'subgroupSizeControl', 'timestamps', 'bufferView', 'immediates', 'htmlInCanvas']) {
      if (document.diagnostics[key] === undefined) continue;
      const value = document.diagnostics[key];
      if (!plain(value) || typeof value.supported !== 'boolean') throw new TypeError('Invalid diagnostic capability flag');
      importedDiagnostics[key] = { supported: value.supported, reported: true };
      if (value.note !== undefined) importedDiagnostics[key].note = text(value.note, 'diagnostic note', 1000);
      if (value.experimental !== undefined) {
        if (typeof value.experimental !== 'boolean') throw new TypeError('Invalid diagnostic experimental flag');
        importedDiagnostics[key].experimental = value.experimental;
      }
    }
  }
  const common = { schemaVersion: 1, kind: 'imported-gpu', sourceKind: 'gpu-dispatch', status: document.status, createdAt, importedAt: new Date().toISOString(), features: [...new Set(reportedFeatures)], diagnostics: importedDiagnostics, note: 'Imported report: mapping consistency was checked locally. Actual GPU execution and the reported adapter features are not independently verified.' };
  if (document.status !== 'ok') {
    for (const key of ['values', 'workgroups', 'subgroupSizes']) if (!Array.isArray(document[key]) || document[key].length !== 0) throw new TypeError('Failed GPU reports must not contain measured invocation data');
    return { ...common, reason: text(document.reason, 'GPU failure reason'), values: [], workgroups: [], subgroupSizes: [], correctness: { verified: false, scope: 'no-measurement', executionVerified: false } };
  }
  const count = document.count, workgroupSize = document.workgroupSize;
  const requestedSubgroupSize = document.requestedSubgroupSize ?? null;
  validateLoomOptions({ count, workgroupSize, subgroupSize: requestedSubgroupSize });
  if (!Array.isArray(document.values) || document.values.length !== count || document.values.some(value => !plain(value))) throw new TypeError('GPU invocation count does not match its bounded mapping');
  if (typeof document.elapsedMs !== 'number' || !Number.isFinite(document.elapsedMs) || document.elapsedMs < 0 || document.elapsedMs > 3_600_000) throw new TypeError('Invalid GPU report elapsed duration');
  const timingScope = text(document.timingScope, 'GPU timing scope');
  const has = (value, key) => Object.hasOwn(value, key) && value[key] !== undefined;
  const subgroups = has(document.values[0], 'subgroupSize');
  const subgroupId = has(document.values[0], 'subgroupId');
  if (subgroupId && !subgroups) throw new TypeError('Subgroup IDs require subgroup sizes and lanes');
  if (requestedSubgroupSize !== null && !subgroups) throw new TypeError('Explicit subgroup size lacks subgroup observations');
  const raw = new Uint32Array(count * 6);
  const members = new Map();
  document.values.forEach((value, index) => {
    // Check before typed-array assignment: Uint32Array would otherwise wrap negatives/NaN/fractions.
    for (const key of ['globalId', 'localId', 'workgroupId']) assertInteger(value[key], key, 0, 0xffffffff);
    if (has(value, 'subgroupSize') !== subgroups || has(value, 'subgroupInvocationId') !== subgroups || has(value, 'subgroupId') !== subgroupId) throw new TypeError('Subgroup mapping fields must be present consistently');
    let sgSize = 0, sgLane = 0xffffffff, sgId = 0xffffffff;
    if (subgroups) {
      sgSize = assertInteger(value.subgroupSize, 'observed subgroup size', 1, 128);
      if ((sgSize & (sgSize - 1)) !== 0) throw new TypeError('Observed subgroup size must be a power of two');
      sgLane = assertInteger(value.subgroupInvocationId, 'subgroup invocation ID', 0, sgSize - 1);
    }
    if (subgroupId) {
      sgId = assertInteger(value.subgroupId, 'subgroup ID', 0, workgroupSize - 1);
      const key = `${value.workgroupId}:${sgId}`;
      const group = members.get(key) ?? { size: sgSize, lanes: new Set() };
      if (group.size !== sgSize || group.lanes.has(sgLane)) throw new TypeError('Subgroup membership contains duplicate lanes or inconsistent sizes');
      group.lanes.add(sgLane); members.set(key, group);
    }
    raw.set([value.globalId, value.localId, value.workgroupId, sgSize, sgLane, sgId], index * 6);
  });
  const decoded = decodeLoomMapping(raw, { count, workgroupSize, subgroups, subgroupId, requestedSubgroupSize });
  if (document.workgroups !== undefined) {
    if (!Array.isArray(document.workgroups) || document.workgroups.length !== decoded.workgroups.length) throw new TypeError('Aggregate workgroups contradict the mapping');
    const seen = new Set();
    for (const group of document.workgroups) {
      if (!plain(group)) throw new TypeError('Invalid aggregate workgroup');
      assertInteger(group.id, 'aggregate workgroup ID', 0, decoded.workgroups.length - 1);
      const expected = decoded.workgroups[group.id].invocations;
      if (seen.has(group.id) || !Array.isArray(group.invocations) || group.invocations.length !== expected.length) throw new TypeError('Aggregate workgroup membership is inconsistent');
      seen.add(group.id);
      const actual = new Set(group.invocations);
      if (actual.size !== expected.length || expected.some(id => !actual.has(id))) throw new TypeError('Aggregate workgroup membership contradicts the mapping');
    }
  }
  if (document.subgroupSizes !== undefined) {
    if (!Array.isArray(document.subgroupSizes) || document.subgroupSizes.length !== decoded.subgroupSizes.length || new Set(document.subgroupSizes).size !== document.subgroupSizes.length || decoded.subgroupSizes.some(size => !document.subgroupSizes.includes(size))) throw new TypeError('Aggregate subgroup sizes contradict the mapping');
  }
  return { ...common, ...decoded, count, workgroupSize, requestedSubgroupSize, elapsedMs: document.elapsedMs, timingScope, correctness: { verified: true, scope: 'mapping-consistency-only', executionVerified: false, checkedInvocations: count } };
}

export async function runGPULoom({ count = 256, workgroupSize = 64, subgroupSize = null, signal } = {}) {
  validateLoomOptions({ count, workgroupSize, subgroupSize });
  throwIfAborted(signal);
  let device;
  const started = performance.now();
  try {
    const session = await acquire((adapter) => {
      const features = [];
      if (adapter.features.has('subgroups')) features.push('subgroups');
      if (subgroupSize !== null) {
        if (!adapter.features.has('subgroup-size-control')) throw new UnsupportedError('Explicit subgroup size is unsupported by this adapter');
        if (!adapter.features.has('subgroups')) throw new UnsupportedError('Subgroups are unsupported by this adapter');
        const minimum = adapter.info?.subgroupMinSize ?? adapter.limits.subgroupMinSize;
        const maximum = adapter.info?.subgroupMaxSize ?? adapter.limits.subgroupMaxSize;
        if (!Number.isInteger(minimum) || !Number.isInteger(maximum)) throw new UnsupportedError('The adapter does not expose subgroup size limits');
        if (subgroupSize < minimum || subgroupSize > maximum) throw new RangeError(`Requested subgroup size must be within ${minimum}–${maximum}`);
        features.push('subgroup-size-control');
      }
      return features;
    }, signal);
    device = session.device;
    if (workgroupSize > device.limits.maxComputeInvocationsPerWorkgroup || workgroupSize > device.limits.maxComputeWorkgroupSizeX) throw new UnsupportedError('Requested workgroup exceeds the available GPU limit');
    const hasSubgroups = device.features.has('subgroups');
    const hasSubgroupId = hasSubgroups && session.gpu.wgslLanguageFeatures?.has('subgroup_id');
    const shader = buildLoomShader({ count, workgroupSize, subgroupSize, subgroups: hasSubgroups, subgroupId: !!hasSubgroupId });
    const compute = await pipeline(device, shader, signal);
    const storage = device.createBuffer({ size: count * 24, usage: USAGE.STORAGE | USAGE.COPY_SRC });
    const read = device.createBuffer({ size: count * 24, usage: USAGE.COPY_DST | USAGE.MAP_READ });
    const group = device.createBindGroup({ layout: compute.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: storage } }] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(compute); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(count / workgroupSize)); pass.end();
    encoder.copyBufferToBuffer(storage, 0, read, 0, count * 24);
    device.queue.submit([encoder.finish()]);
    await observed(read.mapAsync(READ), { signal, device });
    const data = new Uint32Array(read.getMappedRange());
    const decoded = decodeLoomMapping(data, { count, workgroupSize, subgroups: hasSubgroups, subgroupId: !!hasSubgroupId, requestedSubgroupSize: subgroupSize });
    read.unmap(); storage.destroy(); read.destroy();
    return { kind: 'measured', status: 'ok', ...decoded, features: session.description.features, diagnostics: session.description.diagnostics, count, workgroupSize, requestedSubgroupSize: subgroupSize, elapsedMs: performance.now() - started, timingScope: 'end-to-end: adapter/device creation, shader compilation, dispatch and readback; not a kernel benchmark', correctness: { verified: true }, note: 'Builtin values observed for this dispatch. They do not reveal physical GPU scheduling or guarantee a permanent subgroup size.' };
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return { kind: 'measured', status: error.name === 'UnsupportedError' ? 'unsupported' : 'error', reason: error.message, values: [], workgroups: [], subgroupSizes: [], features: [], diagnostics: diagnostics(null, globalThis.navigator?.gpu) };
  } finally { device?.destroy(); }
}
