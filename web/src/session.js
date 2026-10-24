const IDS = ['deadlock','race','memory','cas','gpu','benchmark'];
const MODEL_IDS = IDS.slice(0,4);
const MAX_ACTIONS = 2000;
const invalid = (message) => { throw new Error(message); };
const integer = (x,min,max) => Number.isInteger(x) && x >= min && x <= max;
const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function normalizeSession(input) {
  if (!plain(input) || !MODEL_IDS.includes(input.scene)) invalid('Неизвестная сцена записи.');
  const {scene} = input;
  const cfg = plain(input.config) ? input.config : {};
  let config;
  if (scene === 'deadlock') {
    if (cfg.ordered !== undefined && typeof cfg.ordered !== 'boolean') invalid('Некорректный порядок замков.');
    config = { ordered: cfg.ordered ?? false };
  } else if (scene === 'race') {
    if (!['unsafe','atomic','snapshot'].includes(cfg.mode ?? 'unsafe')) invalid('Некорректный режим гонки.');
    config = { mode: cfg.mode ?? 'unsafe' };
  } else if (scene === 'memory') {
    config = {layout:cfg.layout ?? 'aos',lineSize:cfg.lineSize ?? 64,count:cfg.count ?? 8,padding:cfg.padding ?? 0};
    if (!['aos','soa','padded'].includes(config.layout) || ![16,32,64,128,256].includes(config.lineSize) || !integer(config.count,1,64) || !integer(config.padding,0,256)) invalid('Параметры памяти за допустимыми пределами.');
  } else {
    if (cfg.weak !== undefined && typeof cfg.weak !== 'boolean') invalid('Некорректный режим CAS.');
    config = {weak:cfg.weak ?? false};
  }
  if (!Array.isArray(input.actions) || input.actions.length > MAX_ACTIONS) invalid('Слишком длинная запись: максимум 2000 действий.');
  const actions = input.actions.map(a => {
    if (scene === 'memory') {
      if (!plain(a) || !integer(a.thread,0,1) || !integer(a.index,0,config.count-1) || !['a','b'].includes(a.field) || typeof (a.write ?? true) !== 'boolean') invalid('Некорректное обращение к памяти.');
      return {thread:a.thread,index:a.index,field:a.field,write:a.write ?? true};
    }
    if (scene === 'cas' && plain(a)) {
      if (!integer(a.thread,0,1) || typeof (a.spurious ?? false) !== 'boolean') invalid('Некорректное действие CAS.');
      return {thread:a.thread,spurious:a.spurious ?? false};
    }
    if (!integer(a,0,1)) invalid('Неизвестный поток.');
    return a;
  });
  if (!integer(input.cursor,0,actions.length)) invalid('Курсор вне записи.');
  return {schemaVersion:1,kind:'model-trace',scene,config,actions,cursor:input.cursor};
}
export function encodeSession(input) { return JSON.stringify(normalizeSession(input),null,2); }
export function decodeSession(json) {
  if (typeof json !== 'string' || json.length > 500000) invalid('Файл записи слишком велик.');
  const data = JSON.parse(json);
  if (data.schemaVersion !== 1 || data.kind !== 'model-trace') invalid('Ожидалась запись модели версии 1.');
  return normalizeSession(data);
}
export function validateMeasuredImport(data) {
  if (!plain(data) || data.schemaVersion !== 1 || !['measured','imported'].includes(data.kind) || !Array.isArray(data.rows) || data.rows.length > 100 || !data.rows.length || !plain(data.environment)) invalid('Нужен отчёт измерений версии 1.');
  const rows = data.rows.map(row => {
    if (!plain(row) || !integer(row.size,1,2**30) || typeof row.backend !== 'string' || row.backend.length > 80 || !Array.isArray(row.samples) || row.samples.length > 200 || row.samples.some(x=>!Number.isFinite(x)||x<0||x>3600000)) invalid('Отчёт содержит недопустимые измерения.');
    const skipped = ['unsupported','error'].includes(row.status);
    if (!skipped && (!(row.correctness === true || row.correctness?.verified === true) || !row.samples.length)) invalid('Отчёт содержит непроверенные результаты.');
    if (row.correctness?.expectedSum !== undefined && row.correctness.sum !== row.correctness.expectedSum) invalid('Контрольная сумма результата не совпадает.');
    if (row.correctness?.expectedChecksum !== undefined && row.correctness.checksum !== row.correctness.expectedChecksum) invalid('Контрольная сумма массива не совпадает.');
    if (typeof row.timingScope !== 'string' || row.timingScope.length > 500) invalid('Не указан интервал измерения.');
    return structuredClone(row);
  });
  return {...structuredClone(data),kind:'imported',importedAt:new Date().toISOString(),rows};
}
export function makeProgress() { return Object.fromEntries(IDS.map(id=>[id,{attempts:0,challenge:false,transfer:false,mastered:false}])); }
export function recordAnswer(progress,scene,stage,correct) {
  if (!IDS.includes(scene) || !['challenge','transfer'].includes(stage)) invalid('Неизвестное задание.');
  const next = structuredClone(progress);
  const prev = next[scene] ?? makeProgress()[scene];
  next[scene] = {...prev,attempts:prev.attempts+1,[stage]:prev[stage] || Boolean(correct)};
  next[scene].mastered = next[scene].challenge && next[scene].transfer;
  return next;
}

export function loadProgress(storage) {
  const initial = makeProgress();
  try {
    const saved = JSON.parse(storage.getItem('ct-progress-v1') || '{}');
    for (const id of IDS) {
      if (saved[id] && integer(saved[id].attempts,0,1e7)) initial[id] = {
        attempts:saved[id].attempts,challenge:saved[id].challenge===true,
        transfer:saved[id].transfer===true,mastered:saved[id].challenge===true && saved[id].transfer===true
      };
    }
  } catch { /* Storage is optional, including private browsing. */ }
  return initial;
}
