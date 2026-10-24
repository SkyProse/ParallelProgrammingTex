/** Exact finite model: two actors, one iteration each, two exclusive locks. */
export const DEADLOCK_MODEL_SCOPE = 'Конечная модель: два потока, по одной итерации, два эксклюзивных замка. Перебор не является проверкой исходной OpenMP-программы и справедливости планировщика.';

const checkThread = thread => {
  if (thread !== 0 && thread !== 1) throw new RangeError('thread must be 0 or 1');
};

export function createDeadlock({ ordered = false } = {}) {
  if (typeof ordered !== 'boolean') throw new TypeError('ordered must be boolean');
  return { kind: 'deadlock', ordered, pcs: [0, 0], owners: [null, null], events: [] };
}

function instruction(state, thread) {
  const first = state.ordered || thread === 0 ? 0 : 1;
  const second = 1 - first;
  return [
    { op: 'acquire', resource: first },
    { op: 'acquire', resource: second },
    { op: 'work' },
    { op: 'release', resource: second },
    { op: 'release', resource: first },
  ][state.pcs[thread]] ?? null;
}

export function deadlockProgram(state, thread) {
  checkThread(thread);
  const first = state.ordered || thread === 0 ? 'A' : 'B';
  const second = first === 'A' ? 'B' : 'A';
  return [`lock(${first})`, `lock(${second})`, 'work()', `unlock(${second})`, `unlock(${first})`];
}

function canStep(state, thread) {
  const action = instruction(state, thread);
  if (!action) return false;
  if (action.op === 'acquire') return state.owners[action.resource] === null;
  if (action.op === 'release') return state.owners[action.resource] === thread;
  return true;
}

export function enabledDeadlock(state) {
  return [0, 1].filter(thread => canStep(state, thread));
}

export function deadlockStatus(state) {
  if (state.pcs.every(pc => pc === 5)) return 'complete';
  return enabledDeadlock(state).length ? 'running' : 'deadlock';
}

export function stepDeadlock(state, thread) {
  checkThread(thread);
  if (!canStep(state, thread)) return state;
  const action = instruction(state, thread);
  const owners = [...state.owners];
  const pcs = [...state.pcs];
  if (action.op === 'acquire') owners[action.resource] = thread;
  if (action.op === 'release') owners[action.resource] = null;
  pcs[thread]++;
  const name = action.resource === undefined ? '' : ['A', 'B'][action.resource];
  const label = action.op === 'acquire' ? `T${thread} захватил ${name}`
    : action.op === 'release' ? `T${thread} освободил ${name}`
      : `T${thread} выполнил работу`;
  return { ...state, pcs, owners, events: [...state.events, { thread, ...action, label }] };
}

/** Events are deliberately excluded: different histories can reach one state. */
export function deadlockStateId(state) {
  return `d${Number(state.ordered)}:${state.pcs.join(',')}:${state.owners.map(owner => owner === null ? '-' : owner).join(',')}`;
}

export function exploreDeadlock({ ordered = false } = {}) {
  const start = createDeadlock({ ordered });
  const startId = deadlockStateId(start);
  const nodes = [{ id: startId, state: start, depth: 0, status: deadlockStatus(start) }];
  const seen = new Map([[startId, nodes[0]]]);
  const edges = [], deadlocks = [], completed = [];
  let witness = [];
  for (let cursor = 0; cursor < nodes.length; cursor++) {
    const node = nodes[cursor];
    if (node.status === 'deadlock') {
      deadlocks.push(node.id);
      if (!witness.length) witness = node.state.events.map(event => event.thread);
    }
    if (node.status === 'complete') completed.push(node.id);
    for (const thread of enabledDeadlock(node.state)) {
      const state = stepDeadlock(node.state, thread);
      const id = deadlockStateId(state);
      edges.push({ from: node.id, to: id, thread });
      if (!seen.has(id)) {
        const next = { id, state, depth: node.depth + 1, status: deadlockStatus(state) };
        seen.set(id, next);
        nodes.push(next);
      }
    }
  }
  return { nodes, edges, deadlocks, completed, witness };
}
