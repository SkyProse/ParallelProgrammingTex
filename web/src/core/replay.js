export const MAX_REPLAY_ACTIONS = 10000;

function validate(actions, cursor) {
  if (!Array.isArray(actions)) throw new TypeError('actions must be an array');
  if (actions.length > MAX_REPLAY_ACTIONS) throw new RangeError('actions exceed replay limit');
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > actions.length) throw new RangeError('cursor must be an integer within actions');
}

/** Replay deterministic semantic actions. A renderer never changes model time. */
export function replay(create, step, actions, cursor = actions?.length) {
  if (typeof create !== 'function' || typeof step !== 'function') throw new TypeError('create and step must be functions');
  validate(actions, cursor);
  let state = create();
  for (let index = 0; index < cursor; index++) state = step(state, actions[index]);
  return state;
}

/** Keep the shared past, discard the old future, append one new action. */
export function branch(actions, cursor, action) {
  validate(actions, cursor);
  if (cursor >= MAX_REPLAY_ACTIONS) throw new RangeError('actions exceed replay limit');
  return [...actions.slice(0, cursor), action];
}

function equal(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a).sort(), keysB = Object.keys(b).sort();
  return keysA.length === keysB.length && keysA.every((key, index) => key === keysB[index] && equal(a[key], b[key]));
}

export function compareTraces(eventsA, eventsB) {
  validate(eventsA, eventsA?.length);
  validate(eventsB, eventsB?.length);
  let common = 0;
  while (common < Math.min(eventsA.length, eventsB.length) && equal(eventsA[common], eventsB[common])) common++;
  return { common, firstA: eventsA[common] ?? null, firstB: eventsB[common] ?? null };
}
