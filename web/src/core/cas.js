export const CAS_MODEL_SCOPE = 'Ограниченная модель append-only очереди: два производителя, по одному уникальному узлу. Нет dequeue, повторного использования адресов или reclamation; модель не доказывает отсутствие ABA и lock-free прогресс произвольной C++ реализации. Ложный отказ разрешён только для weak CAS помощи хвосту.';
const PHASES = ['load-tail', 'load-next', 'help-tail', 'link', 'finish-tail', 'done'];
const checkThread = thread => {
  if (thread !== 0 && thread !== 1) throw new RangeError('thread must be 0 or 1');
};

export function compareExchange(actual, expected, desired, { weak = false, spurious = false } = {}) {
  const success = Object.is(actual, expected) && !(weak && spurious);
  return { success, value: success ? desired : actual, expected: success ? expected : actual };
}

export function createCAS({ weak = false } = {}) {
  if (typeof weak !== 'boolean') throw new TypeError('weak must be boolean');
  return {
    kind: 'cas', weak, head: 'dummy', tail: 'dummy',
    nodes: {
      dummy: { id: 'dummy', value: null, next: null, published: true },
      n0: { id: 'n0', value: 'A', next: null, published: false },
      n1: { id: 'n1', value: 'B', next: null, published: false },
    },
    threads: [0, 1].map(id => ({ id, pc: 0, phase: 'load-tail', t: null, pNext: null, expected: null, node: `n${id}`, done: false })),
    events: [], scope: CAS_MODEL_SCOPE,
  };
}

export function casProgram(state, thread) {
  checkThread(thread);
  return [
    't = tail.load()',
    'next = t.next.load()',
    `if (next) tail.CAS_${state.weak ? 'weak' : 'strong'}(t, next); retry`,
    `t.next.CAS_strong(null, ${state.threads[thread].node})`,
    `tail.CAS_strong(t, ${state.threads[thread].node}); done`,
  ];
}

export function enabledCAS(state) {
  return state.threads.filter(thread => !thread.done).map(thread => thread.id);
}

export function casStatus(state) {
  return enabledCAS(state).length ? 'running' : 'complete';
}

export function stepCAS(state, thread, { spurious = false } = {}) {
  checkThread(thread);
  if (typeof spurious !== 'boolean') throw new TypeError('spurious must be boolean');
  if (state.threads[thread].done) return state;
  if (state.events.length >= 10000) throw new RangeError('CAS action limit reached');
  const threads = state.threads.map(item => ({ ...item }));
  const actor = threads[thread];
  const nodes = { ...state.nodes };
  let tail = state.tail;
  const event = { thread, op: actor.phase, label: '', tailBefore: tail };
  if (actor.phase === 'load-tail') {
    actor.t = tail;
    actor.phase = 'load-next';
    event.label = `T${thread}: t ← ${tail}`;
  } else if (actor.phase === 'load-next') {
    actor.pNext = nodes[actor.t].next;
    actor.phase = actor.pNext === null ? 'link' : 'help-tail';
    actor.expected = null;
    event.node = actor.t;
    event.value = actor.pNext;
    event.label = `T${thread}: ${actor.t}.next = ${actor.pNext ?? 'null'}`;
  } else if (actor.phase === 'help-tail') {
    const expected = actor.t;
    const result = compareExchange(tail, expected, actor.pNext, { weak: state.weak, spurious });
    Object.assign(event, { actual: tail, expectedBefore: expected, expectedAfter: result.expected, desired: actor.pNext, success: result.success, spurious: state.weak && spurious && Object.is(tail, expected) });
    tail = result.value;
    actor.t = result.expected;
    actor.expected = result.expected;
    actor.phase = 'load-next';
    event.label = `T${thread}: помощь хвосту ${result.success ? 'успешна' : 'отказ'}; t = ${actor.t}`;
  } else if (actor.phase === 'link') {
    const target = nodes[actor.t];
    const result = compareExchange(target.next, null, actor.node);
    Object.assign(event, { node: actor.t, actual: target.next, expectedBefore: null, expectedAfter: result.expected, desired: actor.node, success: result.success, linearization: result.success });
    actor.expected = result.expected;
    if (result.success) {
      nodes[actor.t] = { ...target, next: actor.node };
      nodes[actor.node] = { ...nodes[actor.node], published: true };
      actor.phase = 'finish-tail';
    } else {
      actor.phase = 'load-next';
    }
    event.label = `T${thread}: вставка ${actor.node} ${result.success ? 'успешна · точка линеаризации' : 'проиграла CAS; повтор'}; expected = ${result.expected ?? 'null'}`;
  } else if (actor.phase === 'finish-tail') {
    const expected = actor.t;
    const result = compareExchange(tail, expected, actor.node);
    Object.assign(event, { actual: tail, expectedBefore: expected, expectedAfter: result.expected, desired: actor.node, success: result.success });
    tail = result.value;
    actor.t = result.expected;
    actor.expected = result.expected;
    actor.done = true;
    actor.phase = 'done';
    event.label = `T${thread}: ${result.success ? 'хвост продвинут' : 'хвост уже продвинут другим'}; вставка завершена`;
  } else {
    throw new RangeError('unknown CAS phase');
  }
  actor.pc = PHASES.indexOf(actor.phase);
  event.tailAfter = tail;
  return { ...state, nodes, threads, tail, events: [...state.events, event] };
}
