import test from 'node:test';
import assert from 'node:assert/strict';
import { createCache, cacheAccess, cacheLayout, CACHE_MODEL_SCOPE } from '../src/core/cache.js';

test('one-byte AoS fields have exact addresses, SoA starts on separate lines, padding costs memory', () => {
  const aos = cacheLayout({ layout: 'aos', lineSize: 4, count: 3 });
  assert.equal(aos.bytes, 6);
  assert.deepEqual(aos.objects.map(o => [o.index, o.field, o.address, o.line]), [[0,'a',0,0],[0,'b',1,0],[1,'a',2,0],[1,'b',3,0],[2,'a',4,1],[2,'b',5,1]]);
  const soa = cacheLayout({ layout: 'soa', lineSize: 4, count: 3 });
  assert.equal(soa.objects.find(o => o.index === 0 && o.field === 'b').address, 4);
  assert.equal(soa.bytes, 7);
  const padded = cacheLayout({ layout: 'padded', lineSize: 4, count: 3 });
  assert.equal(new Set(padded.objects.map(o => o.line)).size, 6);
  assert.equal(padded.bytes, 24);
  assert.match(CACHE_MODEL_SCOPE, /модел|model/i);
});

test('independent AoS fields cause false sharing, same scalar causes true sharing', () => {
  let s = createCache({ layout: 'aos', count: 2 });
  const start = structuredClone(s);
  s = cacheAccess(s, { thread: 0, index: 0, field: 'a' });
  s = cacheAccess(s, { thread: 1, index: 0, field: 'b' });
  assert.equal(s.metrics.invalidations, 1);
  assert.equal(s.metrics.transfers, 1);
  assert.equal(s.metrics.falseSharing, 1);
  assert.equal(s.metrics.trueSharing, 0);
  s = cacheAccess(s, { thread: 0, index: 0, field: 'b' });
  assert.equal(s.metrics.trueSharing, 1);
  assert.deepEqual(start.metrics, { accesses:0, invalidations:0, transfers:0, trueSharing:0, falseSharing:0 });
});

test('aligned SoA and padded layouts avoid the tested inter-field invalidation', () => {
  for (const layout of ['soa', 'padded']) {
    let s = createCache({ layout, count: 8 });
    for (let index = 0; index < 8; index++) {
      s = cacheAccess(s, { thread: 0, index, field: 'a' });
      s = cacheAccess(s, { thread: 1, index, field: 'b' });
    }
    assert.equal(s.metrics.invalidations, 0);
    assert.equal(s.metrics.falseSharing, 0);
  }
});

test('read-only sharing is harmless; reading a foreign modified line causes a modeled handoff', () => {
  let s = createCache();
  s = cacheAccess(s, { thread: 0, index: 0, field: 'a', write: false });
  s = cacheAccess(s, { thread: 1, index: 0, field: 'b', write: false });
  assert.equal(s.metrics.falseSharing, 0);
  assert.equal(s.metrics.invalidations, 0);
  s = cacheAccess(s, { thread: 0, index: 0, field: 'a', write: true });
  const written = structuredClone(s);
  const read = cacheAccess(s, { thread: 1, index: 0, field: 'b', write: false });
  assert.ok(read.metrics.transfers > s.metrics.transfers);
  assert.ok(read.metrics.falseSharing > s.metrics.falseSharing);
  assert.deepEqual(s, written);
});

test('cache configuration and accesses are bounded and validated', () => {
  assert.throws(() => createCache({ count: -1 }), /count/i);
  assert.throws(() => createCache({ lineSize: 3 }), /lineSize/i);
  assert.throws(() => createCache({ layout: 'fake' }), /layout/i);
  assert.throws(() => cacheAccess(createCache(), { thread: 0, index: 99, field: 'a' }), /index/i);
});
