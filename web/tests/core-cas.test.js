import test from 'node:test';
import assert from 'node:assert/strict';
import { createCAS, stepCAS, enabledCAS, casStatus, casProgram, compareExchange, CAS_MODEL_SCOPE } from '../src/core/cas.js';

const finish = state => {
  for (let n = 0; n < 100 && casStatus(state) !== 'complete'; n++) {
    const enabled = enabledCAS(state);
    state = stepCAS(state, enabled[n % enabled.length]);
  }
  assert.equal(casStatus(state), 'complete');
  return state;
};
const chain = state => {
  const result = [], seen = new Set();
  let id = state.head;
  while (id !== null) {
    assert.ok(!seen.has(id), 'append-only queue must not contain a cycle');
    seen.add(id); result.push(id); id = state.nodes[id].next;
  }
  return result;
};

test('CAS failure updates expected, success keeps it, spurious failure requires weak', () => {
  assert.deepEqual(compareExchange(4,4,9), { success:true, value:9, expected:4 });
  assert.deepEqual(compareExchange(5,4,9), { success:false, value:5, expected:5 });
  assert.deepEqual(compareExchange(4,4,9,{weak:true,spurious:true}), {success:false,value:4,expected:4});
  assert.deepEqual(compareExchange(4,4,9,{spurious:true}), {success:true,value:9,expected:4});
});

test('contending producers retry without losing or duplicating either append', () => {
  let s = createCAS();
  for (const actor of [0,1,0,1,0,1]) s = stepCAS(s, actor);
  assert.ok(s.events.some(e => e.op === 'link' && e.success === false));
  const final = finish(s);
  const ids = chain(final);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
  assert.equal(final.tail, ids.at(-1));
  assert.ok(final.events.some(e => e.op === 'help-tail'));
  assert.match(CAS_MODEL_SCOPE, /ABA/);
});

test('another producer can help an appended node while its owner is suspended', () => {
  let s = createCAS({ weak: true });
  for (const actor of [0,0,0,1,1]) s = stepCAS(s, actor);
  assert.equal(s.threads[1].phase, 'help-tail');
  const before = structuredClone(s);
  const spurious = stepCAS(s, 1, { spurious: true });
  assert.equal(spurious.events.at(-1).success, false);
  assert.equal(spurious.tail, s.tail);
  assert.deepEqual(s, before);
  const done = finish(spurious);
  assert.equal(chain(done).length, 3);
});

test('all bounded non-spurious schedules finish with both producers in queue', () => {
  const queue = [createCAS()];
  const seen = new Set();
  const edges = new Map();
  let completed = 0;
  while (queue.length) {
    const s = queue.pop();
    const key = JSON.stringify({nodes:s.nodes,tail:s.tail,threads:s.threads});
    if (seen.has(key)) continue;
    seen.add(key);
    assert.ok(seen.size < 20000);
    const live = chain(s);
    assert.ok(live.includes(s.tail), 'tail must point into the published chain');
    assert.deepEqual(live.slice().sort(), Object.values(s.nodes).filter(node => node.published).map(node => node.id).sort());
    if (casStatus(s) === 'complete') { assert.equal(chain(s).length, 3); completed++; continue; }
    assert.ok(enabledCAS(s).length > 0);
    const nextKeys = [];
    for (const actor of enabledCAS(s)) {
      const next = stepCAS(s, actor);
      nextKeys.push(JSON.stringify({nodes:next.nodes,tail:next.tail,threads:next.threads}));
      queue.push(next);
    }
    edges.set(key,nextKeys);
  }
  const visiting = new Set(), visited = new Set();
  const visit = key => {
    assert.ok(!visiting.has(key), 'non-spurious finite model must not have a nonterminating cycle');
    if (visited.has(key)) return;
    visiting.add(key);
    for (const next of edges.get(key) ?? []) visit(next);
    visiting.delete(key); visited.add(key);
  };
  for (const key of seen) visit(key);
  assert.ok(completed >= 2);
  assert.equal(casProgram(createCAS(), 0).length, 5);
});
