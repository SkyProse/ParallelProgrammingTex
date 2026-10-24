/** The unsafe mode is a teaching SC machine, not an enumeration of C++ UB. */
const CONTRACTS = {
  unsafe: 'Учебная SC-модель двух read/increment/write. Контракт: увеличить общий счётчик на два. Data race в настоящем C++ означает неопределённое поведение; значения этой модели не перечисляют допустимые исходы C++.',
  atomic: 'Два атомарных увеличения общего счётчика: итог должен быть 2. Модель показывает одну неделимую операцию на поток.',
  snapshot: 'Другой контракт: каждый поток вычисляет локальный результат 1 из неизменного снимка 0. Общий счётчик остаётся 0; это не исправление контракта «увеличить общий счётчик на два».',
};
const checkThread = thread => {
  if (thread !== 0 && thread !== 1) throw new RangeError('thread must be 0 or 1');
};

export function createRace({ mode = 'unsafe' } = {}) {
  if (!Object.hasOwn(CONTRACTS, mode)) throw new RangeError('unknown race mode');
  return { kind: 'race', mode, value: 0, snapshot: 0, locals: [null, null], pcs: [0, 0], events: [], contract: CONTRACTS[mode] };
}

export function raceProgram(state, thread) {
  checkThread(thread);
  if (state.mode === 'atomic') return ['counter.fetch_add(1)'];
  if (state.mode === 'snapshot') return ['local = snapshot', 'local = local + 1'];
  return ['local = counter', 'local = local + 1', 'counter = local'];
}

export function enabledRace(state) {
  const length = state.mode === 'atomic' ? 1 : state.mode === 'snapshot' ? 2 : 3;
  return [0, 1].filter(thread => state.pcs[thread] < length);
}

export function raceStatus(state) {
  return enabledRace(state).length ? 'running' : 'complete';
}

export function stepRace(state, thread) {
  checkThread(thread);
  if (!enabledRace(state).includes(thread)) return state;
  const pcs = [...state.pcs], locals = [...state.locals];
  let value = state.value;
  const pc = pcs[thread]++;
  let op, label;
  if (state.mode === 'atomic') {
    locals[thread] = value;
    value++;
    op = 'atomic';
    label = `T${thread}: atomic ${state.value} → ${value}`;
  } else if (pc === 0) {
    locals[thread] = state.mode === 'snapshot' ? state.snapshot : value;
    op = 'read';
    label = `T${thread} прочитал ${locals[thread]}${state.mode === 'snapshot' ? ' из снимка' : ''}`;
  } else if (pc === 1) {
    locals[thread]++;
    op = 'increment';
    label = `T${thread}: локально ${locals[thread] - 1} → ${locals[thread]}`;
  } else {
    value = locals[thread];
    op = 'write';
    label = `T${thread} записал ${value} в общий счётчик`;
  }
  return { ...state, pcs, locals, value, events: [...state.events, { thread, op, value, local: locals[thread], label }] };
}

export function exploreRace(mode = 'unsafe') {
  const nodes = [createRace({ mode })];
  const key = state => JSON.stringify([state.mode, state.value, state.locals, state.pcs]);
  const seen = new Set([key(nodes[0])]);
  const values = new Set();
  let witness = [];
  for (let cursor = 0; cursor < nodes.length; cursor++) {
    const state = nodes[cursor];
    if (raceStatus(state) === 'complete') {
      values.add(state.value);
      if (mode === 'unsafe' && state.value === 1 && !witness.length) witness = state.events.map(event => event.thread);
    }
    for (const thread of enabledRace(state)) {
      const next = stepRace(state, thread);
      const id = key(next);
      if (!seen.has(id)) { seen.add(id); nodes.push(next); }
    }
  }
  return { finalValues: [...values].sort((a, b) => a - b), witness, states: seen.size };
}
