import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeadlock, stepDeadlock, enabledDeadlock, deadlockStatus, exploreDeadlock, deadlockProgram } from '../src/core/deadlock.js';

const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };
const run = (state, actors) => actors.reduce(stepDeadlock, state);

test('opposite lock order has exactly 23 reachable states and one genuine deadlock', () => {
  const graph = exploreDeadlock();
  assert.equal(graph.nodes.length, 23);
  assert.equal(graph.deadlocks.length, 1);
  assert.equal(graph.completed.length, 1);
  assert.equal(graph.witness.length, 2);
  const blocked = run(createDeadlock(), graph.witness);
  assert.equal(deadlockStatus(blocked), 'deadlock');
  assert.deepEqual(enabledDeadlock(blocked), []);
  assert.deepEqual(blocked.pcs, [1, 1]);
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, 23);
  const keys = new Set(graph.nodes.map(node => node.id));
  for (const edge of graph.edges) {
    assert.ok(keys.has(edge.from) && keys.has(edge.to));
    const from = graph.nodes.find(node => node.id === edge.from).state;
    const to = graph.nodes.find(node => node.id === edge.to).state;
    const next = stepDeadlock(from, edge.thread);
    assert.deepEqual(next.pcs, to.pcs);
    assert.deepEqual(next.owners, to.owners);
  }
});

test('one shared order explores exactly 20 states with no deadlock', () => {
  const graph = exploreDeadlock({ ordered: true });
  assert.equal(graph.nodes.length, 20);
  assert.deepEqual(graph.deadlocks, []);
  assert.equal(graph.completed.length, 1);
  assert.deepEqual(graph.witness, []);
  const terminal = graph.nodes.find(node => node.id === graph.completed[0]).state;
  assert.deepEqual(terminal.owners, [null, null]);
  assert.deepEqual(terminal.pcs, [5, 5]);
  assert.equal(deadlockStatus(terminal), 'complete');
  assert.deepEqual(graph, exploreDeadlock({ ordered: true }));
});

test('steps preserve earlier snapshots, blocked actions are identity, display matches locks', () => {
  const start = freeze(createDeadlock());
  const a = stepDeadlock(start, 0);
  assert.deepEqual(start.pcs, [0, 0]);
  assert.deepEqual(a.owners, [0, null]);
  assert.match(a.events[0].label, /^T0\b/);
  const blocked = stepDeadlock(a, 1);
  assert.equal(stepDeadlock(blocked, 0), blocked);
  assert.equal(stepDeadlock(blocked, 1), blocked);
  assert.equal(blocked.events.length, 2);
  assert.match(deadlockProgram(start, 0)[0], /A/);
  assert.match(deadlockProgram(start, 1)[0], /B/);
  assert.throws(() => stepDeadlock(start, 2), /thread/i);
});
