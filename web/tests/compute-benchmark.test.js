import test from 'node:test';
import assert from 'node:assert/strict';
import { runBenchmark } from '../src/compute/benchmark.js';
import { validateBenchmarkDocument } from '../src/compute/stats.js';
import { probeGPU, buildLoomShader, validateLoomOptions, decodeLoomMapping } from '../src/compute/gpu.js';

test('real JS benchmark produces checked observations with cold/warm separation', async () => {
  const progress = [];
  const result = await runBenchmark({ sizes: [64, 257], repetitions: 3, backends: ['js'], onProgress: e => progress.push(e) });
  assert.equal(result.kind, 'measured');
  assert.equal(result.environment.execution, 'browser');
  assert.equal(result.rows.length, 2);
  for (const row of result.rows) {
    assert.equal(row.status, 'ok');
    assert.equal(row.samples.length, 3);
    assert.equal(row.summary.n, 3);
    assert.ok(row.coldMs >= 0);
    assert.equal(row.correctness.verified, true);
    assert.equal(row.correctness.checks, 4);
    assert.match(row.timingScope, /end-to-end/);
  }
  assert.ok(progress.some(e => e.phase === 'sample'));
  assert.equal(validateBenchmarkDocument(result), result);
});

test('benchmark is bounded and a pre-aborted operation never starts', async () => {
  await assert.rejects(runBenchmark({ sizes: [2 ** 28] }), /size|elements|limit/i);
  await assert.rejects(runBenchmark({ sizes: [2], repetitions: 1 }), /repetitions/i);
  await assert.rejects(runBenchmark({ sizes: [2], workers: 0 }), /workers/i);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runBenchmark({ signal: controller.signal }), { name: 'AbortError' });
});

test('cancellation between samples does not return an apparently complete result', async () => {
  const controller = new AbortController();
  await assert.rejects(runBenchmark({ sizes: [32], repetitions: 3, backends: ['js'], signal: controller.signal, onProgress: e => { if (e.phase === 'sample') controller.abort(); } }), { name: 'AbortError' });
});

test('unsupported browser backends have no fabricated samples', async () => {
  const result = await runBenchmark({ sizes: [16], repetitions: 3, backends: ['workers', 'webgpu'] });
  for (const row of result.rows) {
    assert.equal(row.status, 'unsupported');
    assert.deepEqual(row.samples, []);
    assert.equal(row.summary, null);
    assert.equal(row.coldMs, null);
    assert.equal(row.correctness.verified, false);
    assert.ok(row.reason);
  }
  validateBenchmarkDocument(result);
});

test('GPU probe distinguishes absence, unavailable adapter, and optional features', async () => {
  assert.equal((await probeGPU({ gpu: null })).supported, false);
  assert.equal((await probeGPU({ gpu: { requestAdapter: async () => null } })).supported, false);
  const result = await probeGPU({ gpu: { wgslLanguageFeatures: new Set(['buffer_view', 'immediate_address_space', 'subgroup_id']), requestAdapter: async () => ({ features: new Set(['subgroups']), limits: { maxComputeWorkgroupSizeX: 256, maxComputeInvocationsPerWorkgroup: 256 } }) } });
  assert.equal(result.supported, true);
  assert.equal(result.diagnostics.subgroups.supported, true);
  assert.equal(result.diagnostics.subgroupSizeControl.supported, false);
  assert.equal(result.diagnostics.bufferView.supported, true);
  assert.equal(result.diagnostics.immediates.supported, true);
});

test('loom baseline has no optional requirement; subgroup builtins are feature gated', () => {
  const baseline = buildLoomShader({ count: 65, workgroupSize: 64 });
  assert.doesNotMatch(baseline, /enable subgroups|builtin\(subgroup/);
  const subgroup = buildLoomShader({ count: 65, workgroupSize: 64, subgroups: true, subgroupId: true, subgroupSize: 32 });
  assert.match(subgroup, /enable subgroup_size_control/);
  assert.match(subgroup, /requires subgroup_id/);
  assert.match(subgroup, /@subgroup_size\(32\)/);
  assert.throws(() => validateLoomOptions({ count: -1, workgroupSize: 64 }));
  assert.throws(() => validateLoomOptions({ count: 64, workgroupSize: 1024 }));
  assert.throws(() => validateLoomOptions({ count: 64, workgroupSize: 64, subgroupSize: 3 }));
});

test('measured loom decoding validates output and never invents subgroup IDs', () => {
  const raw = new Uint32Array([0, 0, 0, 0, 0xffffffff, 0xffffffff, 1, 0, 1, 0, 0xffffffff, 0xffffffff]);
  const result = decodeLoomMapping(raw, { count: 2, workgroupSize: 1 });
  assert.deepEqual(result.workgroups, [{ id: 0, invocations: [0] }, { id: 1, invocations: [1] }]);
  assert.equal(result.values[0].subgroupId, undefined);
  raw[6] = 0;
  assert.throws(() => decodeLoomMapping(raw, { count: 2, workgroupSize: 1 }), /correctness/);
});
