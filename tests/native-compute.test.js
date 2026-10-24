import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { seededInput, referenceKernel, validateBenchmarkDocument } from '../web/src/compute/stats.js';

let folder, binary;
before(() => {
  folder = mkdtempSync(join(tmpdir(), 'theatre-native-test-'));
  binary = join(folder, 'benchmark');
  const compiled = spawnSync('g++', ['-std=c++17', '-O2', '-fopenmp', fileURLToPath(new URL('../native/benchmark.cpp', import.meta.url)), '-o', binary], { encoding: 'utf8', timeout: 30000 });
  assert.equal(compiled.status, 0, compiled.stderr);
});
after(() => { if (folder) rmSync(folder, { recursive: true, force: true }); });

function run(args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('compiled native and OpenMP kernels equal the browser uint32 reference', () => {
  const result = run(['--size', '257', '--repetitions', '3', '--threads', '2', '--seed', '7']);
  const reference = referenceKernel(seededInput(257, 7));
  assert.equal(result.environment.execution, 'native');
  assert.ok(result.environment.openmp > 0);
  assert.deepEqual(result.rows.map(r => r.backend), ['native-serial', 'openmp']);
  for (const row of result.rows) {
    assert.equal(row.correctness.verified, true);
    assert.equal(row.correctness.sum, reference.sum);
    assert.equal(row.correctness.checksum, reference.checksum);
    assert.equal(row.samples.length, 3);
  }
  validateBenchmarkDocument(result);
});

test('native false-sharing experiment validates unique atomic counters and reports assumed line size', () => {
  const result = run(['--false-sharing', '--iterations', '2500', '--repetitions', '3', '--threads', '2', '--line-bytes', '128']);
  assert.equal(result.kind, 'measured');
  assert.equal(result.experiment, 'native-false-sharing');
  assert.equal(result.environment.execution, 'native');
  assert.deepEqual(result.rows.map(r => r.layout.strideBytes), [8, 128]);
  for (const row of result.rows) {
    assert.equal(row.layout.assumedLineBytes, 128);
    assert.equal(row.correctness.verified, true);
    assert.deepEqual(row.correctness.counters, [2500, 2500]);
  }
  validateBenchmarkDocument(result);
});

test('native runner rejects unbounded input before executing', () => {
  const result = spawnSync(binary, ['--size', '1000000000'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /size|limit/i);
});
