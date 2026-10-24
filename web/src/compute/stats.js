/** The same explicitly unsigned kernel is implemented in the worker, WGSL and native companion. */
export const MAX_ELEMENTS = 1_048_576;
export const MAX_REPETITIONS = 31;
export const KERNEL_ID = 'u32-mix-reduce-v1';
const T95 = [0, 12.7062047364, 4.3026527297, 3.1824463053, 2.7764451052, 2.5705818356, 2.4469118511, 2.3646242516, 2.3060041352, 2.2621571629, 2.2281388520, 2.2009851601, 2.1788128297, 2.1603686565, 2.1447866879, 2.1314495456, 2.1199052992, 2.1098155778, 2.1009220402, 2.0930240544, 2.0859634473, 2.0796138447, 2.0738730679, 2.0686576104, 2.0638985616, 2.0595385528, 2.0555294386, 2.0518305165, 2.0484071418, 2.0452296421, 2.0422724563];

export function assertInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${label} must be an integer in [${min}, ${max}]`);
  return value;
}

export function summarize(samples) {
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > MAX_REPETITIONS) throw new RangeError(`samples must contain 2–${MAX_REPETITIONS} observations`);
  if (samples.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 3_600_000)) throw new TypeError('samples must be finite nonnegative durations in milliseconds');
  const sorted = [...samples].sort((a, b) => a - b);
  let mean = 0, m2 = 0;
  samples.forEach((value, index) => { const delta = value - mean; mean += delta / (index + 1); m2 += delta * (value - mean); });
  const n = samples.length;
  const stddev = Math.sqrt(Math.max(0, m2 / (n - 1)));
  const half = T95[n - 1] * stddev / Math.sqrt(n);
  return { n, mean, median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2, stddev, min: sorted[0], max: sorted[n - 1], ci95: [mean - half, mean + half], ciMethod: 'Student-t interval for the sample mean; exploratory, assumes independent observations' };
}

export function seededInput(size, seed = 0x00c0ffee) {
  assertInteger(size, 'size in elements', 1, MAX_ELEMENTS);
  assertInteger(seed, 'seed', 0, 0xffffffff);
  const values = new Uint32Array(size);
  let state = seed >>> 0;
  for (let i = 0; i < size; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; values[i] = state >>> 0; }
  return values;
}

export function transformValue(value, globalIndex) {
  let mixed = (value ^ Math.imul(globalIndex + 1, 0x9e3779b9)) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35) >>> 0;
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

export function checksum(values) {
  let hash = 0x811c9dc5;
  for (const value of values) hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
  return hash >>> 0;
}

export function executeKernel(input, { offset = 0 } = {}) {
  if (!(input instanceof Uint32Array)) throw new TypeError('input must be Uint32Array');
  assertInteger(offset, 'offset', 0, MAX_ELEMENTS);
  if (input.length < 1 || input.length + offset > MAX_ELEMENTS) throw new RangeError('input exceeds the bounded kernel size');
  const values = new Uint32Array(input.length);
  let sum = 0;
  for (let i = 0; i < input.length; i++) { values[i] = transformValue(input[i], i + offset); sum = (sum + values[i]) >>> 0; }
  return { values, sum };
}

export function referenceKernel(input, options) {
  const result = executeKernel(input, options);
  return { ...result, checksum: checksum(result.values) };
}

export function verifyResult(result, expected) {
  if (!(result?.values instanceof Uint32Array) || result.values.length !== expected.values.length || result.sum !== expected.sum) return false;
  for (let i = 0; i < result.values.length; i++) if (result.values[i] !== expected.values[i]) return false;
  return true;
}

function validateSummary(summary, samples) {
  const recalculated = summarize(samples);
  const close = (a, b) => typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  if (!summary || ['n', 'mean', 'median', 'stddev', 'min', 'max'].some(key => !close(summary[key], recalculated[key])) || !Array.isArray(summary.ci95) || summary.ci95.length !== 2 || summary.ci95.some((v, i) => !close(v, recalculated.ci95[i]))) throw new TypeError('Summary does not match the raw samples');
}

/** Validate structure and internal consistency; imported measurements are still user-supplied evidence. */
export function validateBenchmarkDocument(document) {
  if (!document || document.schemaVersion !== 1 || document.kind !== 'measured') throw new TypeError('Unsupported measurement schema');
  if (![KERNEL_ID, 'native-false-sharing'].includes(document.experiment)) throw new TypeError('Unknown measurement experiment; expected u32-mix-reduce-v1 or native-false-sharing');
  if (!['browser', 'native'].includes(document.environment?.execution)) throw new TypeError('Measurement execution origin is required');
  if (typeof document.createdAt !== 'string' || !Number.isFinite(Date.parse(document.createdAt))) throw new TypeError('Measurement creation date is invalid');
  if (!Array.isArray(document.rows) || document.rows.length < 1 || document.rows.length > 64) throw new RangeError('Measurement rows must contain 1–64 entries');
  const allowed = document.environment.execution === 'native' ? ['native-serial', 'openmp', 'native-false-sharing'] : ['js', 'workers', 'webgpu'];
  for (const row of document.rows) {
    assertInteger(row.size, 'row size', 1, document.experiment === 'native-false-sharing' ? 20_000_000 : MAX_ELEMENTS);
    if (!allowed.includes(row.backend)) throw new TypeError('Backend contradicts the execution origin');
    if ((row.backend === 'native-false-sharing') !== (document.experiment === 'native-false-sharing')) throw new TypeError('False-sharing backend and experiment type must agree');
    if (!['ok', 'unsupported', 'error'].includes(row.status)) throw new TypeError('Invalid measurement status');
    if (typeof row.timingScope !== 'string' || row.timingScope.length > 2000) throw new TypeError('Measurement timing scope is required');
    if (row.status === 'ok') {
      if (row.correctness?.verified !== true) throw new TypeError('Successful measurement must pass correctness validation');
      for (const [actual, expected] of [['sum', 'expectedSum'], ['checksum', 'expectedChecksum']]) {
        if (row.correctness[actual] !== undefined || row.correctness[expected] !== undefined) {
          assertInteger(row.correctness[actual], actual, 0, 0xffffffff);
          assertInteger(row.correctness[expected], expected, 0, 0xffffffff);
          if (row.correctness[actual] !== row.correctness[expected]) throw new TypeError(`Measured ${actual} does not match its reference`);
        }
      }
      if (typeof row.coldMs !== 'number' || !Number.isFinite(row.coldMs) || row.coldMs < 0 || row.coldMs > 3_600_000) throw new TypeError('Invalid cold duration');
      validateSummary(row.summary, row.samples);
      if (row.correctness.checks !== undefined && row.correctness.checks !== row.samples.length + 1) throw new TypeError('Correctness check count must include the first run and every warm sample');
      if (row.gpuSamples !== undefined || row.gpuSummary !== undefined) {
        if (row.backend !== 'webgpu' || !Array.isArray(row.gpuSamples) || row.gpuSamples.length !== row.samples.length || typeof row.gpuTimingScope !== 'string' || !row.gpuTimingScope.length || row.gpuTimingScope.length > 2000) throw new TypeError('Invalid separate GPU-pass timing metadata');
        validateSummary(row.gpuSummary, row.gpuSamples);
      }
      if (row.backend === 'native-false-sharing') {
        assertInteger(row.workerCount, 'native worker count', 1, 8);
        if (row.correctness.expectedPerCounter !== row.size || !Array.isArray(row.correctness.counters) || row.correctness.counters.length !== row.workerCount || row.correctness.counters.some(value => !Number.isSafeInteger(value) || value !== row.size)) throw new TypeError('Native counter values do not match the requested iterations');
        const layout = row.layout;
        if (!layout || !['packed', 'padded'].includes(layout.name) || ![32, 64, 128, 256].includes(layout.assumedLineBytes) || layout.strideBytes !== (layout.name === 'packed' ? 8 : layout.assumedLineBytes) || layout.baseAlignmentBytes !== 256 || !Array.isArray(layout.offsetBytes) || layout.offsetBytes.length !== row.workerCount || layout.offsetBytes.some((offset, index) => offset !== index * layout.strideBytes)) throw new TypeError('Native counter layout is inconsistent');
      }
    } else if (!Array.isArray(row.samples) || row.samples.length || row.summary !== null || row.coldMs !== null || row.correctness?.verified !== false || typeof row.reason !== 'string') {
      throw new TypeError('Unavailable measurements must not contain fabricated results');
    }
    if (row.status !== 'ok' && (row.gpuSamples !== undefined || row.gpuSummary !== undefined)) throw new TypeError('Unavailable measurements cannot contain GPU timing results');
  }
  return document;
}
