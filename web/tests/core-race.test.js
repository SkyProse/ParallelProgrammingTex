import test from 'node:test';
import assert from 'node:assert/strict';
import { createRace, stepRace, enabledRace, raceStatus, exploreRace, raceProgram } from '../src/core/race.js';

const run = (mode, actors) => actors.reduce(stepRace, createRace({ mode }));

test('SC read/increment/write demonstrates a lost update and a serial result', () => {
  const lost = run('unsafe', [0, 1, 0, 1, 0, 1]);
  assert.equal(lost.value, 1);
  assert.deepEqual(lost.locals, [1, 1]);
  assert.equal(raceStatus(lost), 'complete');
  assert.deepEqual(enabledRace(lost), []);
  assert.equal(run('unsafe', [0, 0, 0, 1, 1, 1]).value, 2);
  const explored = exploreRace('unsafe');
  assert.deepEqual(explored.finalValues, [1, 2]);
  assert.equal(run('unsafe', explored.witness).value, 1);
  assert.match(lost.contract, /C\+\+|undefined|неопредел/i);
});

test('atomic preserves two shared increments for every schedule', () => {
  assert.deepEqual(exploreRace('atomic').finalValues, [2]);
  assert.equal(run('atomic', [1, 0]).value, 2);
  assert.equal(raceProgram(createRace({ mode: 'atomic' }), 0).length, 1);
});

test('snapshot intentionally changes contract to two local calculations and no shared writes', () => {
  const initial = createRace({ mode: 'snapshot' });
  const final = run('snapshot', [0, 1, 1, 0]);
  assert.equal(final.value, 0);
  assert.deepEqual(final.locals, [1, 1]);
  assert.equal(raceStatus(final), 'complete');
  assert.deepEqual(exploreRace('snapshot').finalValues, [0]);
  assert.match(initial.contract, /локаль|local/i);
});

test('race model inputs and immutable snapshots are checked', () => {
  const s = createRace();
  const old = structuredClone(s);
  stepRace(s, 0);
  assert.deepEqual(s, old);
  assert.throws(() => createRace({ mode: 'magic' }), /mode/i);
  assert.throws(() => stepRace(s, -1), /thread/i);
});
