import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, seededInput, transformValue, referenceKernel, checksum, validateBenchmarkDocument, MAX_ELEMENTS } from '../src/compute/stats.js';

test('statistics use sample SD and a Student-t interval, retaining the original observations', () => {
  const samples = [1, 2, 3, 4, 5];
  const result = summarize(samples);
  assert.equal(result.n, 5);
  assert.equal(result.mean, 3);
  assert.equal(result.median, 3);
  assert.equal(result.min, 1);
  assert.equal(result.max, 5);
  assert.ok(Math.abs(result.stddev - Math.sqrt(2.5)) < 1e-10);
  assert.ok(Math.abs(result.ci95[0] - 1.03675684) < 1e-5);
  assert.ok(Math.abs(result.ci95[1] - 4.96324316) < 1e-5);
  assert.deepEqual(samples, [1, 2, 3, 4, 5]);
});

test('invalid timing samples are rejected, not silently discarded', () => {
  for (const samples of [[], [1], [1, NaN], [1, Infinity], [1, -1], ['1', 2]]) {
    assert.throws(() => summarize(samples));
  }
  assert.deepEqual(summarize([0, 0, 0]).ci95, [0, 0]);
});

test('uint32 transform and modular reduction match independent golden vectors', () => {
  const input = new Uint32Array([0, 1, 0xffffffff, 0x12345678]);
  const expected = [2462723854, 314344336, 3834300474, 3034127627];
  const result = referenceKernel(input);
  assert.deepEqual(Array.from(result.values), expected);
  assert.equal(result.sum, 1055561699);
  assert.equal(checksum(result.values), 2424287744);
  expected.forEach((value, index) => assert.equal(transformValue(input[index], index), value));
  assert.deepEqual(Array.from(input), [0, 1, 0xffffffff, 0x12345678]);
});

test('partitioned workers preserve global indices and deterministic seeded input', () => {
  const input = seededInput(257, 7);
  assert.deepEqual(input, seededInput(257, 7));
  assert.notDeepEqual(input, seededInput(257, 8));
  const whole = referenceKernel(input);
  const first = referenceKernel(input.slice(0, 123));
  const second = referenceKernel(input.slice(123), { offset: 123 });
  assert.deepEqual([...first.values, ...second.values], [...whole.values]);
  assert.equal((first.sum + second.sum) >>> 0, whole.sum);
  assert.throws(() => seededInput(MAX_ELEMENTS + 1));
  assert.throws(() => seededInput(-2));
});

test('measurement import rejects inconsistent samples and preserves measured provenance', () => {
  const samples = [1, 2, 3];
  const document = { schemaVersion: 1, kind: 'measured', createdAt: '2026-10-24T00:00:00.000Z', environment: { execution: 'browser' }, rows: [{ size: 4, backend: 'js', status: 'ok', samples, summary: summarize(samples), coldMs: 4, timingScope: 'end-to-end', correctness: { verified: true } }] };
  assert.equal(validateBenchmarkDocument(document), document);
  assert.throws(() => validateBenchmarkDocument({ ...document, schemaVersion: 2 }));
  assert.throws(() => validateBenchmarkDocument({ ...document, rows: [{ ...document.rows[0], samples: [1, 2, Infinity] }] }));
  assert.throws(() => validateBenchmarkDocument({ ...document, rows: [{ ...document.rows[0], summary: { ...document.rows[0].summary, mean: 100 } }] }));
  assert.throws(() => validateBenchmarkDocument({ ...document, rows: [{ ...document.rows[0], correctness: { verified: false } }] }));
  assert.throws(() => validateBenchmarkDocument({ ...document, rows: [{ ...document.rows[0], correctness: { verified: true, checksum: 100, expectedChecksum: 101 } }] }));
});

test('imported optional GPU pass statistics must agree with their own observations', () => {
  const samples = [1, 2, 3], gpuSamples = [0.1, 0.2, 0.3];
  const row = { size: 4, backend: 'webgpu', status: 'ok', samples, summary: summarize(samples), coldMs: 4, timingScope: 'end-to-end', correctness: { verified: true }, gpuSamples, gpuSummary: summarize(gpuSamples), gpuTimingScope: 'compute pass only' };
  const document = { schemaVersion: 1, kind: 'measured', createdAt: '2026-10-24T00:00:00.000Z', environment: { execution: 'browser' }, rows: [row] };
  validateBenchmarkDocument(document);
  assert.throws(() => validateBenchmarkDocument({ ...document, rows: [{ ...row, gpuSummary: { ...row.gpuSummary, median: 999 } }] }));
  assert.throws(() => validateBenchmarkDocument({ ...document, rows: [{ ...row, gpuSamples: [0.1, NaN, 0.3] }] }));
  assert.throws(() => validateBenchmarkDocument({ ...document, rows: [{ ...row, backend: 'js' }] }));
});

test('native false-sharing imports validate each counter, layout, and iteration unit', () => {
  const samples = [1, 2, 3];
  const row = { size: 100, backend: 'native-false-sharing', status: 'ok', samples, summary: summarize(samples), coldMs: 4, timingScope: 'native wall time', workerCount: 2, correctness: { verified: true, counters: [100, 100], expectedPerCounter: 100 }, layout: { name: 'padded', strideBytes: 64, assumedLineBytes: 64, baseAlignmentBytes: 256, offsetBytes: [0, 64] } };
  const document = { schemaVersion: 1, kind: 'measured', experiment: 'native-false-sharing', createdAt: '2026-10-24T00:00:00.000Z', environment: { execution: 'native' }, rows: [row] };
  validateBenchmarkDocument(document);
  assert.throws(() => validateBenchmarkDocument({ ...document, rows: [{ ...row, correctness: { ...row.correctness, counters: [100, 99] } }] }));
  assert.throws(() => validateBenchmarkDocument({ ...document, rows: [{ ...row, layout: { ...row.layout, strideBytes: 8 } }] }));
  assert.throws(() => validateBenchmarkDocument({ ...document, rows: [{ ...row, size: 101 }] }));
});
