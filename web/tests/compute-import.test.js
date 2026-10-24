import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLoomDocument } from '../src/compute/gpu.js';

function example() {
  // Synthetic test fixture, not a claimed GPU observation.
  const count = 65, workgroupSize = 64;
  return {
    schemaVersion: 1, kind: 'gpu-dispatch', status: 'ok',
    createdAt: '2026-10-24T00:00:00.000Z', count, workgroupSize,
    requestedSubgroupSize: null, elapsedMs: 10, timingScope: 'fixture end-to-end',
    values: Array.from({ length: count }, (_, globalId) => ({ globalId, localId: globalId % workgroupSize, workgroupId: Math.floor(globalId / workgroupSize) })),
    workgroups: [{ id: 0, invocations: Array.from({ length: 64 }, (_, i) => i) }, { id: 1, invocations: [64] }],
    subgroupSizes: [], features: [], diagnostics: {}, correctness: { verified: true }
  };
}

test('GPU import validates mapping independently and marks external provenance', () => {
  const source = example();
  source.correctness.verified = false; // A source flag never substitutes for our own structural check.
  const output = validateLoomDocument(source);
  assert.equal(output.kind, 'imported-gpu');
  assert.equal(output.sourceKind, 'gpu-dispatch');
  assert.equal(output.status, 'ok');
  assert.equal(output.correctness.verified, true);
  assert.equal(output.correctness.executionVerified, false);
  assert.equal(output.correctness.scope, 'mapping-consistency-only');
  assert.deepEqual(output.workgroups, source.workgroups);
  assert.notEqual(output.values, source.values);
  output.values[0].localId = 44;
  assert.equal(source.values[0].localId, 0);
});

test('GPU import rejects unbounded, fractional, wrapped, and mismapped IDs', () => {
  for (const value of [-1, 0.5, NaN, Infinity, 2 ** 32]) {
    const source = example(); source.values[0].globalId = value;
    assert.throws(() => validateLoomDocument(source));
  }
  const badLocal = example(); badLocal.values[64].localId = 64;
  assert.throws(() => validateLoomDocument(badLocal));
  const duplicated = example(); duplicated.values[64].globalId = 63;
  assert.throws(() => validateLoomDocument(duplicated));
  assert.throws(() => validateLoomDocument({ ...example(), count: 65537 }));
  assert.throws(() => validateLoomDocument({ ...example(), values: [] }));
  assert.throws(() => validateLoomDocument({ ...example(), elapsedMs: Infinity }));
  assert.throws(() => validateLoomDocument({ ...example(), kind: 'measured' }));
});

test('imported aggregate groups cannot contradict the actual invocation mapping', () => {
  const wrongGroup = example(); wrongGroup.workgroups[1].invocations = [63];
  assert.throws(() => validateLoomDocument(wrongGroup));
  const duplicateGroup = example(); duplicateGroup.workgroups[1].id = 0;
  assert.throws(() => validateLoomDocument(duplicateGroup));
  const guessedSize = example(); guessedSize.subgroupSizes = [32];
  assert.throws(() => validateLoomDocument(guessedSize));
});

test('subgroup imports validate complete fields, lane uniqueness, and requested size', () => {
  const source = example();
  source.values = source.values.map(value => ({ ...value, subgroupSize: 32, subgroupInvocationId: value.localId % 32, subgroupId: Math.floor(value.localId / 32) }));
  source.subgroupSizes = [32];
  source.requestedSubgroupSize = 32;
  const output = validateLoomDocument(source);
  assert.deepEqual(output.subgroupSizes, [32]);
  assert.equal(output.values[32].subgroupId, 1);
  const incomplete = structuredClone(source); delete incomplete.values[10].subgroupSize;
  assert.throws(() => validateLoomDocument(incomplete));
  const duplicateLane = structuredClone(source); duplicateLane.values[1].subgroupInvocationId = 0;
  assert.throws(() => validateLoomDocument(duplicateLane));
  const wrongRequest = structuredClone(source); wrongRequest.requestedSubgroupSize = 64;
  assert.throws(() => validateLoomDocument(wrongRequest));
  const invalidSize = structuredClone(source); invalidSize.values[0].subgroupSize = 31;
  assert.throws(() => validateLoomDocument(invalidSize));
});

test('failed GPU reports round-trip without fabricating invocation data', () => {
  const source = { schemaVersion: 1, kind: 'gpu-dispatch', createdAt: '2026-10-24T00:00:00.000Z', status: 'unsupported', reason: 'No adapter', values: [], workgroups: [], subgroupSizes: [], features: [], diagnostics: {} };
  const output = validateLoomDocument(source);
  assert.equal(output.kind, 'imported-gpu');
  assert.equal(output.status, 'unsupported');
  assert.equal(output.correctness.verified, false);
  assert.deepEqual(output.values, []);
  assert.throws(() => validateLoomDocument({ ...source, values: [{ globalId: 0 }] }));
});
