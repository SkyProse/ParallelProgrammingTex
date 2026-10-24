import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, branch, compareTraces, MAX_REPLAY_ACTIONS } from '../src/core/replay.js';
import { createDeadlock, stepDeadlock, deadlockStatus } from '../src/core/deadlock.js';

test('rewind and fork preserve the original schedule and snapshots', () => {
  const actions = Object.freeze([0,1]);
  const dead = replay(createDeadlock, stepDeadlock, actions);
  assert.equal(deadlockStatus(dead), 'deadlock');
  const fork = branch(actions, 1, 0);
  assert.deepEqual(fork, [0,0]);
  assert.deepEqual(actions, [0,1]);
  const other = replay(createDeadlock, stepDeadlock, fork);
  assert.equal(deadlockStatus(other), 'running');
  const comparison = compareTraces(dead.events, other.events);
  assert.equal(comparison.common, 1);
  assert.equal(comparison.firstA.thread, 1);
  assert.equal(comparison.firstB.thread, 0);
  assert.deepEqual(replay(createDeadlock, stepDeadlock, actions, 0), createDeadlock());
});

test('trace comparison is structural and handles prefix endings', () => {
  const a = [{thread:0,op:'read'}, {op:'write',thread:0}];
  const b = [{op:'read',thread:0}];
  assert.deepEqual(compareTraces(a,b), {common:1,firstA:a[1],firstB:null});
  assert.deepEqual(compareTraces([],[]), {common:0,firstA:null,firstB:null});
});

test('imports cannot request invalid cursors or unbounded action replay', () => {
  for (const cursor of [-1,1.5,3,NaN]) assert.throws(() => replay(createDeadlock,stepDeadlock,[0,1],cursor), /cursor/i);
  assert.throws(() => replay(createDeadlock,stepDeadlock,new Array(MAX_REPLAY_ACTIONS+1).fill(0)), /limit|many|actions/i);
  assert.throws(() => branch([0],2,1), /cursor/i);
  assert.throws(() => replay(null,stepDeadlock,[]), /function/i);
});
