export const CACHE_MODEL_SCOPE = 'Учебная MSI-подобная модель когерентности, не измерение процессора. a и b — отдельные однобайтовые объекты. Считаются обращения, инвалидированные копии и условные передачи. True/false sharing классифицируют затронутые копии по использованным полям; наносекунд, реальной топологии и data race эта модель не выводит.';

const align = (value, size) => Math.ceil(value / size) * size;
function configOf({ layout = 'aos', lineSize = 64, count = 8, padding = 0 } = {}) {
  if (!['aos', 'soa', 'padded'].includes(layout)) throw new RangeError('unknown cache layout');
  if (!Number.isInteger(lineSize) || lineSize < 2 || lineSize > 4096 || (lineSize & (lineSize - 1))) throw new RangeError('lineSize must be a power of two from 2 to 4096');
  if (!Number.isInteger(count) || count < 1 || count > 4096) throw new RangeError('count must be an integer from 1 to 4096');
  if (!Number.isInteger(padding) || padding < 0 || padding > 4096) throw new RangeError('padding must be an integer from 0 to 4096');
  return { layout, lineSize, count, padding };
}

export function cacheLayout(options = {}) {
  const config = configOf(options);
  const { layout, lineSize, count, padding } = config;
  const slot = align(Math.max(lineSize, padding + 1), lineSize);
  const secondArray = align(count, lineSize);
  const objects = [];
  for (let index = 0; index < count; index++) {
    for (const [offset, field] of ['a', 'b'].entries()) {
      const address = layout === 'aos' ? index * 2 + offset
        : layout === 'soa' ? index + (offset ? secondArray : 0)
          : (index * 2 + offset) * slot;
      objects.push({ index, field, address, line: Math.floor(address / lineSize) });
    }
  }
  const bytes = layout === 'aos' ? count * 2 : layout === 'soa' ? secondArray + count : count * 2 * slot;
  const grouped = new Map();
  for (const object of objects) {
    if (!grouped.has(object.line)) grouped.set(object.line, { line: object.line, start: object.line * lineSize, end: (object.line + 1) * lineSize - 1, objects: [] });
    grouped.get(object.line).objects.push(object);
  }
  return { bytes, objects, lines: [...grouped.values()].sort((a, b) => a.line - b.line) };
}

export function createCache(options = {}) {
  const config = configOf(options);
  return {
    kind: 'cache', config, layout: config.layout, memory: cacheLayout(config), owners: {}, lines: {}, events: [],
    metrics: { accesses: 0, invalidations: 0, transfers: 0, trueSharing: 0, falseSharing: 0 },
    scope: CACHE_MODEL_SCOPE,
  };
}

/**
 * Copies remember fields touched since acquisition. A write invalidating a copy
 * is 'true' when that copy accessed the written scalar, otherwise 'false'. A
 * read of a foreign M copy is classified against its latest written scalar.
 * This is explicit model attribution, not inference of hardware counters.
 */
export function cacheAccess(state, { thread, index, field, write = true } = {}) {
  if (!Number.isInteger(thread) || thread < 0 || thread > 31) throw new RangeError('thread must be from 0 to 31');
  if (!Number.isInteger(index) || index < 0 || index >= state.config.count) throw new RangeError('index outside the modeled array');
  if (field !== 'a' && field !== 'b') throw new RangeError('field must be a or b');
  if (typeof write !== 'boolean') throw new TypeError('write must be boolean');
  if (state.events.length >= 10000) throw new RangeError('cache action limit reached');
  const object = state.memory.objects.find(item => item.index === index && item.field === field);
  const key = `${index}.${field}`;
  const previous = state.lines[object.line] ?? { copies: {}, owner: null, lastWrite: null };
  const copies = Object.fromEntries(Object.entries(previous.copies).map(([id, copy]) => [id, { ...copy, fields: [...copy.fields] }]));
  const metrics = { ...state.metrics, accesses: state.metrics.accesses + 1 };
  const ownCopy = copies[thread];
  const remote = Object.keys(copies).map(Number).filter(id => id !== thread);
  const invalidated = [];
  let trueCount = 0, falseCount = 0, transferred = false;
  let owner = previous.owner, lastWrite = previous.lastWrite;
  let coherence = ownCopy ? 'hit' : 'miss';
  if (write) {
    for (const id of remote) {
      if (copies[id].fields.includes(key)) trueCount++;
      else falseCount++;
      delete copies[id];
      invalidated.push(id);
    }
    if (remote.length) { transferred = true; coherence = 'upgrade'; }
    copies[thread] = { mode: 'M', fields: [...new Set([...(ownCopy?.fields ?? []), key])] };
    owner = thread;
    lastWrite = { thread, key };
  } else if (!ownCopy) {
    if (previous.owner !== null && previous.owner !== thread) {
      copies[previous.owner].mode = 'S';
      owner = null;
      transferred = true;
      coherence = 'transfer';
      if (previous.lastWrite?.key === key) trueCount++;
      else falseCount++;
    }
    copies[thread] = { mode: 'S', fields: [key] };
  } else if (!ownCopy.fields.includes(key)) {
    ownCopy.fields.push(key);
  }
  metrics.invalidations += invalidated.length;
  metrics.transfers += Number(transferred);
  metrics.trueSharing += trueCount;
  metrics.falseSharing += falseCount;
  const sharing = trueCount && falseCount ? 'mixed' : trueCount ? 'true' : falseCount ? 'false' : null;
  const label = `T${thread}: ${write ? 'запись' : 'чтение'} ${field}[${index}], линия ${object.line}${sharing ? ` · ${sharing} sharing` : ''}`;
  const event = { thread, op: write ? 'write' : 'read', index, field, address: object.address, line: object.line, label, invalidated, coherence, sharing, from: previous.owner, to: owner };
  return {
    ...state,
    lines: { ...state.lines, [object.line]: { copies, owner, lastWrite } },
    owners: { ...state.owners, [object.line]: owner },
    metrics,
    events: [...state.events, event],
  };
}
