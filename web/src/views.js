import { deadlockProgram, deadlockStatus, deadlockStateId } from './core/deadlock.js';
import { raceProgram, raceStatus } from './core/race.js';
import { casProgram, casStatus } from './core/cas.js';
import { compareTraces } from './core/replay.js';

/** Used for both text nodes and quoted attribute values. No source HTML is trusted. */
export function escapeHTML(text) {
  return String(text ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
}

const sceneId = scene => typeof scene === 'string' ? scene : scene?.id;
const actorName = actor => actor === null || actor === undefined ? 'свободен' : `T${actor}`;
const statusText = status => ({ running:'Исполнение продолжается', deadlock:'Тупик: нет разрешённых шагов', complete:'Оба потока завершены' }[status] ?? status);

function lane(thread, instructions, pc) {
  return `<section class="score-lane lane t${thread}" aria-label="Инструкции T${thread}"><strong>T${thread}</strong>${instructions.map((instruction, index) => `<span class="score-step step${index === pc ? ' current' : index < pc ? ' done' : ''}"${index === pc ? ' aria-current="step"' : ''}><span class="sr-only">Шаг ${index + 1}: </span>${escapeHTML(instruction)}</span>`).join('')}${pc >= instructions.length ? '<span class="pill">завершён</span>' : ''}</section>`;
}

function eventList(events = []) {
  if (!events.length) return '<p class="score-state">Событий ещё нет. Выберите следующий поток.</p>';
  const recent = events.slice(-8);
  return `<details><summary>Последние события (${recent.length} из ${events.length})</summary><ol start="${events.length - recent.length + 1}">${recent.map(event => `<li>${escapeHTML(event.label ?? `${actorName(event.thread)}: ${event.op}`)}</li>`).join('')}</ol></details>`;
}

function queueIds(state) {
  const result = [], seen = new Set();
  let id = state.head;
  while (id !== null && id !== undefined && state.nodes[id] && !seen.has(id)) {
    seen.add(id); result.push(id); id = state.nodes[id].next;
  }
  return result;
}

function brief(state) {
  if (!state) return 'Нет состояния';
  if (state.kind === 'deadlock') return `${statusText(deadlockStatus(state))}; A: ${actorName(state.owners[0])}; B: ${actorName(state.owners[1])}`;
  if (state.kind === 'race') return `Общий счётчик: ${state.value}; локальные: ${state.locals.map(value => value ?? '—').join(', ')}`;
  if (state.kind === 'cache') return `${escapeHTML(state.memory.bytes)} байт; инвалидаций: ${escapeHTML(state.metrics.invalidations)}; false sharing: ${escapeHTML(state.metrics.falseSharing)}`;
  if (state.kind === 'cas') return `${queueIds(state).join(' → ')}; хвост: ${state.tail}; ${statusText(casStatus(state))}`;
  return 'Состояние эксперимента';
}

export function renderScore(scene, state) {
  const id = sceneId(scene);
  let body;
  if (id === 'deadlock') {
    body = [0, 1].map(thread => lane(thread, deadlockProgram(state, thread), state.pcs[thread])).join('');
    body += `<div class="score-state"><strong>${escapeHTML(statusText(deadlockStatus(state)))}</strong><br>A: ${escapeHTML(actorName(state.owners[0]))} · B: ${escapeHTML(actorName(state.owners[1]))}<br>Следующие инструкции: T0=${escapeHTML(state.pcs[0])} · T1=${escapeHTML(state.pcs[1])}</div>`;
  } else if (id === 'race') {
    body = [0, 1].map(thread => lane(thread, raceProgram(state, thread), state.pcs[thread])).join('');
    body += `<div class="score-state"><strong>Общий счётчик: ${escapeHTML(state.value)}</strong><br>T0.local: ${escapeHTML(state.locals[0] ?? '—')} · T1.local: ${escapeHTML(state.locals[1] ?? '—')}<br>${escapeHTML(statusText(raceStatus(state)))}</div><p class="score-state">${escapeHTML(state.contract)}</p>`;
  } else if (id === 'memory' || id === 'cache') {
    body = [0, 1].map(thread => {
      const events = state.events.filter(event => event.thread === thread);
      const recent = events.slice(-3).map(event => `${event.op === 'write' ? 'write' : 'read'} ${event.field}[${event.index}]`);
      return lane(thread, recent.length ? recent : ['ожидает обращения'], recent.length ? recent.length - 1 : -1);
    }).join('');
    const shown = state.memory.objects.slice(0, 64);
    body += `<div class="memory-table" role="list" aria-label="Адреса полей памяти">${shown.map(object => {
      const owner = state.owners[object.line];
      return `<div class="memory-cell${owner === 0 || owner === 1 ? ` owned${owner}` : ''}" role="listitem">${escapeHTML(object.field)}[${escapeHTML(object.index)}]<small>адрес ${escapeHTML(object.address)} · L${escapeHTML(object.line)}</small><span class="sr-only">${escapeHTML(actorName(owner))}</span></div>`;
    }).join('')}</div>${state.memory.objects.length > 64 ? `<p class="chart-note">Показаны 64 из ${state.memory.objects.length} полей.</p>` : ''}`;
    body += `<div class="score-state">Размещение: ${escapeHTML(state.layout)} · ${escapeHTML(state.memory.bytes)} байт<br>Обращений: ${escapeHTML(state.metrics.accesses)} · инвалидаций: ${escapeHTML(state.metrics.invalidations)} · передач: ${escapeHTML(state.metrics.transfers)}<br>True sharing: ${escapeHTML(state.metrics.trueSharing)} · false sharing: ${escapeHTML(state.metrics.falseSharing)}</div><p class="chart-note">События модели когерентности; это не аппаратные измерения.</p>`;
  } else if (id === 'cas') {
    body = [0, 1].map(thread => lane(thread, casProgram(state, thread), state.threads[thread].pc)).join('');
    body += `<div class="score-state"><strong>Очередь: ${escapeHTML(queueIds(state).join(' → '))} → null</strong><br>head=${escapeHTML(state.head)} · tail=${escapeHTML(state.tail)}<br>${state.threads.map(thread => `T${escapeHTML(thread.id)}: t=${escapeHTML(thread.t ?? 'null')}, expected=${escapeHTML(thread.expected ?? 'null')}`).join('<br>')}<br>${escapeHTML(statusText(casStatus(state)))}</div><p class="chart-note">Два добавления; удаление и reclamation не моделируются.</p>`;
  } else {
    body = '<p class="score-state">Для этого эксперимента доступны результаты измерения.</p>';
  }
  return `<div class="score-grid">${body}${eventList(state?.events)}</div>`;
}

function svgText(x, y, text, { size = 12, fill = 'var(--muted)', anchor = 'start', weight = 400, family = 'var(--mono)' } = {}) {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}" font-family="${family}">${escapeHTML(text)}</text>`;
}

function metalPlate(x, y, width, height, prefix, accent = 'var(--line)') {
  return `<path d="M${x},${y + height - 8} L${x + 10},${y + height + 12} L${x + width + 10},${y + height + 12} L${x + width},${y + height - 8} Z" fill="var(--bg)" opacity=".8"/><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="url(#${prefix}-metal)" stroke="${accent}" stroke-width="1.2"/><path d="M${x + 14},${y + 2} H${x + width - 14}" stroke="var(--text)" opacity=".12"/>`;
}

function svgActor(thread, x, y, prefix, line, detail = '', width = 216) {
  const color = thread === 0 ? 'var(--cyan)' : 'var(--amber)';
  return `<g>${metalPlate(x, y, width, detail ? 89 : 76, prefix)}<rect x="${x}" y="${y + 18}" width="3" height="35" rx="1.5" fill="${color}"/>${svgText(x + 18, y + 25, `T${thread}`, {size:16,fill:color})}${svgText(x + 18,y + 50,line,{size:12,fill:'var(--text)'})}${detail ? svgText(x + 18,y + 71,detail,{size:10}) : ''}</g>`;
}

function diagramArrow(path, prefix, color, kind, extra = '') {
  return `<path data-edge="${kind}" d="${path}" fill="none" stroke="${color === 'wait' ? 'var(--red)' : color === 't0' ? 'var(--cyan)' : color === 't1' ? 'var(--amber)' : 'var(--muted)'}" stroke-width="2" marker-end="url(#${prefix}-${color})" ${extra}/>`;
}

/** Spatial semantics without a GPU context: every mark is derived from the model. */
export function renderSpatialFallback(scene, state, options = {}) {
  const id = sceneId(scene);
  if (id === 'deadlock' && options.graphMode && options.graph) return renderGraph(options.graph, state);
  if (!['deadlock','race','memory','cache','cas'].includes(id)) return renderScore(scene,state);
  const prefix = `ct-svg-${id}`;
  let drawing = '', height = 390;
  if (id === 'deadlock') {
    const lockX = [245,413], actorX = [72,472];
    drawing += svgText(380,42,statusText(deadlockStatus(state)),{anchor:'middle',size:17,fill:deadlockStatus(state)==='deadlock'?'var(--red)':'var(--text)',family:'var(--serif)'});
    for (let resource = 0; resource < 2; resource++) {
      const owner = state.owners[resource];
      if (owner !== null) drawing += diagramArrow(`M${lockX[resource]+51},181 Q${actorX[owner]+108},213 ${actorX[owner]+108},250`,prefix,owner===0?'t0':'t1','ownership');
    }
    for (let thread = 0; thread < 2; thread++) {
      const first = state.ordered || thread===0 ? 0 : 1;
      const requested = state.pcs[thread]===0 ? first : state.pcs[thread]===1 ? 1-first : null;
      if(requested!==null && state.owners[requested]!==null && state.owners[requested]!==thread){
        drawing += diagramArrow(`M${actorX[thread]+108},246 C${actorX[thread]+108},207 ${lockX[requested]+51},222 ${lockX[requested]+51},181`,prefix,'wait','wait','stroke-dasharray="6 6"');
      }
    }
    for(let resource=0;resource<2;resource++){
      const x=lockX[resource],owner=state.owners[resource],color=owner===0?'var(--cyan)':owner===1?'var(--amber)':'var(--muted)';
      drawing += `<g>${metalPlate(x,105,102,69,prefix,color)}<path d="M${x+17},131 V123 a7,7 0 0 1 14,0 v8" fill="none" stroke="${color}" stroke-width="2"/><rect x="${x+14}" y="129" width="20" height="16" rx="3" fill="${color}" opacity=".6"/>${svgText(x+68,139,['A','B'][resource],{size:26,fill:'var(--text)',anchor:'middle',family:'var(--serif)'})}${svgText(x+51,161,actorName(owner),{size:10,anchor:'middle',fill:color})}</g>`;
    }
    for(let thread=0;thread<2;thread++){
      const held=['A','B'].filter((_,resource)=>state.owners[resource]===thread).join(', ')||'—';
      drawing += svgActor(thread,actorX[thread],250,prefix,deadlockProgram(state,thread)[state.pcs[thread]]??'завершён',`держит ${held}`);
    }
    drawing += svgText(380,220,'владение ━   ожидание ┄',{anchor:'middle',size:10});
  } else if(id==='race'){
    const mode=state.mode,positions=[50,500];
    if(mode==='snapshot'){
      drawing += metalPlate(318,42,124,62,prefix,'var(--mint)')+svgText(380,67,'снимок',{anchor:'middle',size:11})+svgText(380,91,state.snapshot,{anchor:'middle',size:22,fill:'var(--mint)'});
      for(let thread=0;thread<2;thread++)drawing += diagramArrow(`M380,116 C380,133 ${positions[thread]+105},100 ${positions[thread]+105},128`,prefix,thread?'t1':'t0','read','stroke-dasharray="5 4"');
    }else{
      drawing += svgText(380,65,mode==='atomic'?'Две неделимые операции':'Один счётчик, два локальных мира',{anchor:'middle',size:18,fill:'var(--text)',family:'var(--serif)'});
      for(let thread=0;thread<2;thread++){
        const last=state.events.filter(event=>event.thread===thread).at(-1),write=last?.op==='write'||mode==='atomic';
        const outer=thread?500:260,inner=thread?442:318;
        drawing += diagramArrow(write?`M${outer},187 H${inner}`:`M${inner},187 H${outer}`,prefix,thread?'t1':'t0',write?'write':'read');
        drawing += svgText((outer+inner)/2,172,mode==='atomic'?'+1':write?'запись':'чтение',{anchor:'middle',size:9});
      }
    }
    drawing += metalPlate(318,145,124,99,prefix,'var(--mint)')+svgText(380,167,'общий',{anchor:'middle',size:10})+svgText(380,215,state.value,{anchor:'middle',size:42,fill:'var(--mint)',family:'var(--serif)'});
    for(let thread=0;thread<2;thread++){
      drawing += svgActor(thread,positions[thread],130,prefix,`local = ${state.locals[thread]??'—'}`,raceProgram(state,thread)[state.pcs[thread]]??'вычисление завершено',210);
    }
    drawing += svgText(380,294,mode==='snapshot'?'Локальные результаты; общий счётчик не изменяется':mode==='atomic'?'Каждый завершённый fetch_add сохраняет одно увеличение':'Чтение и запись разделены: расписание меняет итог',{anchor:'middle',size:12,fill:'var(--text)'});
    drawing += svgText(380,319,mode==='unsafe'?'SC-модель; это не перечень исходов C++ undefined behavior':'Контракт режима показан в пояснении',{anchor:'middle',size:10});
  } else if(id==='memory'||id==='cache'){
    const lines=state.memory.lines;
    drawing += svgActor(0,28,30,prefix,'CORE 0',state.events.filter(e=>e.thread===0).at(-1)?.op==='read'?'последнее: чтение':'отдельная кеш-копия',210);
    drawing += svgActor(1,522,30,prefix,'CORE 1',state.events.filter(e=>e.thread===1).at(-1)?.op==='read'?'последнее: чтение':'отдельная кеш-копия',210);
    drawing += svgText(380,58,String(state.layout).toUpperCase(),{anchor:'middle',size:19,fill:'var(--text)',family:'var(--serif)'})+svgText(380,82,`${state.memory.bytes} Б`,{anchor:'middle',size:16,fill:'var(--mint)'})+svgText(380,103,`линия ${state.config.lineSize} Б`,{anchor:'middle',size:10});
    const columns=lines.length===1?1:lines.length===2?2:4,gap=14,panelWidth=(704-gap*(columns-1))/columns;
    let y=147;
    for(let rowStart=0;rowStart<lines.length;rowStart+=columns){
      const row=lines.slice(rowStart,rowStart+columns),cellColumns=Math.min(8,Math.max(1,Math.floor((panelWidth-28)/50)));
      const panelHeight=62+Math.max(...row.map(line=>Math.ceil(line.objects.length/cellColumns)))*42;
      row.forEach((line,column)=>{
        const x=28+column*(panelWidth+gap),owner=state.owners[line.line],copies=Object.keys(state.lines[line.line]?.copies??{});
        const color=owner===0?'var(--cyan)':owner===1?'var(--amber)':'var(--line)';
        const copyLabel=owner===0||owner===1?`M: T${owner}`:copies.length?`S: ${copies.map(t=>`T${t}`).join(',')}`:'нет копии';
        drawing += `<g data-line="${escapeHTML(line.line)}">${metalPlate(x,y,panelWidth,panelHeight,prefix,color)}${svgText(x+13,y+23,`L${line.line}`,{size:13,fill:'var(--text)'})}${svgText(x+panelWidth-13,y+22,copyLabel,{anchor:'end',size:9})}${svgText(x+13,y+42,`байты ${line.start}–${line.end}`,{size:9})}`;
        const cellWidth=(panelWidth-28)/cellColumns;
        line.objects.forEach((object,index)=>{
          const cx=x+14+(index%cellColumns)*cellWidth,cy=y+53+Math.floor(index/cellColumns)*42;
          drawing += `<g data-address="${escapeHTML(object.address)}"><rect x="${cx}" y="${cy}" width="${cellWidth-5}" height="34" rx="4" fill="${owner===0?'var(--cyan)':owner===1?'var(--amber)':'var(--muted)'}" opacity=".12"/>${svgText(cx+(cellWidth-5)/2,cy+14,`${object.field}[${object.index}]`,{anchor:'middle',size:11,fill:'var(--text)'})}${svgText(cx+(cellWidth-5)/2,cy+28,`@${object.address}`,{anchor:'middle',size:9})}</g>`;
        });
        drawing+='</g>';
      });
      y+=panelHeight+gap+12;
    }
    height=Math.max(390,y+48);
    drawing += svgText(380,height-47,'Показаны занятые байты; общая рамка — одна кеш-линия',{anchor:'middle',size:10});
  }else if(id==='cas'){
    for(let thread=0;thread<2;thread++){
      const t=state.threads[thread];
      drawing += svgActor(thread,thread?450:60,42,prefix,t.phase,`t=${t.t??'null'} · expected=${t.expected??'null'}`,250);
    }
    const ids=queueIds(state);
    ids.forEach((nodeId,index)=>{
      const x=80+index*220,node=state.nodes[nodeId];
      if(index<ids.length-1)drawing += diagramArrow(`M${x+140},227 H${x+216}`,prefix,'neutral','next');
      drawing += `<g>${metalPlate(x,190,140,77,prefix,nodeId==='dummy'?'var(--line)':nodeId==='n0'?'var(--cyan)':'var(--amber)')}${svgText(x+70,219,nodeId,{anchor:'middle',size:18,fill:'var(--text)'})}${svgText(x+70,246,node.next===null?'next = null':`next = ${node.next}`,{anchor:'middle',size:10})}</g>`;
      if(nodeId===state.head)drawing += svgText(x+28,167,'head',{anchor:'middle',size:10})+diagramArrow(`M${x+28},172 V186`,prefix,'neutral','head');
      if(nodeId===state.tail)drawing += svgText(x+108,167,'tail',{anchor:'middle',size:10,fill:'var(--mint)'})+diagramArrow(`M${x+108},172 V186`,prefix,'neutral','tail');
    });
    const pending=Object.values(state.nodes).filter(node=>!node.published);
    pending.forEach((node,index)=>{
      const x=285+index*210;
      drawing += `<rect x="${x}" y="288" width="180" height="48" rx="8" fill="none" stroke="var(--line)" stroke-dasharray="5 5"/>${svgText(x+90,308,`${node.id}: локальный узел`,{anchor:'middle',size:11})}${svgText(x+90,325,'ещё не связан с очередью',{anchor:'middle',size:9})}`;
    });
    if(!pending.length)drawing += svgText(380,316,'Оба узла опубликованы; продвижение хвоста не отменяет вставку',{anchor:'middle',size:11,fill:'var(--mint)'});
  }
  const markers=[['t0','var(--cyan)'],['t1','var(--amber)'],['wait','var(--red)'],['neutral','var(--muted)']].map(([name,color])=>`<marker id="${prefix}-${name}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="${color}"/></marker>`).join('');
  return `<div class="spatial-fallback-shell" style="width:100%;min-width:260px"><svg class="spatial-fallback" viewBox="0 0 760 ${height}" style="width:100%;height:auto;display:block" role="img" aria-label="${escapeHTML(`Модель. ${brief(state)}`)}"><defs><linearGradient id="${prefix}-metal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="var(--panel2)"/><stop offset="1" stop-color="var(--panel)"/></linearGradient><radialGradient id="${prefix}-glow"><stop stop-color="var(--mint)" stop-opacity=".08"/><stop offset="1" stop-color="var(--bg)" stop-opacity="0"/></radialGradient><pattern id="${prefix}-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="var(--muted)" opacity=".12"/></pattern>${markers}</defs><rect width="760" height="${height}" fill="var(--bg)"/><rect width="760" height="${height}" fill="url(#${prefix}-grid)"/><ellipse cx="380" cy="220" rx="350" ry="185" fill="url(#${prefix}-glow)"/>${drawing}${svgText(28,height-18,'МОДЕЛЬ · ЛОГИЧЕСКИЕ СОБЫТИЯ',{size:9})}${svgText(732,height-18,`${state.events.length} событий`,{anchor:'end',size:9})}</svg></div>`;
}

/** One depth per row keeps state targets usable in the scrollable mobile view. */
export function renderGraph(graph, state) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  if (!nodes.length) return '<p class="graph-caption">Граф состояний пуст.</p>';
  const groups = new Map();
  for (const node of nodes) {
    if (!groups.has(node.depth)) groups.set(node.depth, []);
    groups.get(node.depth).push(node);
  }
  const positions = new Map();
  const width = 420, top = 30, rowHeight = 48;
  const maximumDepth = Math.max(...groups.keys());
  for (const [depth, level] of groups) level.forEach((node, index) => positions.set(node.id, { x: 40 + (width - 60) * (index + 1) / (level.length + 1), y: top + depth * rowHeight }));
  const height = top + maximumDepth * rowHeight + 38;
  const active = state?.kind === 'deadlock' ? deadlockStateId(state) : '';
  const arrowId = `state-arrow-${state?.ordered ? 'ordered' : 'opposite'}`;
  const paths = (graph.edges ?? []).map(edge => {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    if (!from || !to) return '';
    return `<path d="M${from.x},${from.y + 13} C${from.x},${from.y + 27} ${to.x},${to.y - 27} ${to.x},${to.y - 15}" fill="none" stroke="var(--line)" stroke-width="1.5" marker-end="url(#${arrowId})"><title>${escapeHTML(`T${edge.thread}: ${edge.from} → ${edge.to}`)}</title></path>`;
  }).join('');
  const labels = [...groups.keys()].map(depth => `<text x="7" y="${top + depth * rowHeight + 3}" fill="var(--dim)" font-size="10">${escapeHTML(depth)}</text>`).join('');
  const marks = nodes.map(node => {
    const position = positions.get(node.id);
    const selected = node.id === active;
    const fill = node.status === 'deadlock' ? 'var(--red)' : node.status === 'complete' ? 'var(--mint)' : 'var(--muted)';
    const description = `Глубина ${node.depth}. T0 шаг ${escapeHTML(node.state.pcs[0])}, T1 шаг ${escapeHTML(node.state.pcs[1])}. A: ${actorName(node.state.owners[0])}, B: ${actorName(node.state.owners[1])}. ${statusText(node.status)}`;
    return `<g class="graph-node${selected ? ' active' : ''}" role="button" tabindex="0" data-node="${escapeHTML(node.id)}" aria-label="${escapeHTML(description)}" aria-pressed="${selected}" transform="translate(${position.x} ${position.y})"><rect x="-22" y="-22" width="44" height="44" fill="transparent"/><circle r="${selected ? 14 : 11}" fill="${fill}" stroke="${selected ? 'var(--cyan)' : 'var(--bg)'}" stroke-width="${selected ? 3 : 1}"/><text x="0" y="3" text-anchor="middle" fill="var(--bg)" font-size="9" pointer-events="none">${escapeHTML(node.state.pcs[0])}·${escapeHTML(node.state.pcs[1])}</text></g>`;
  }).join('');
  return `<p class="graph-caption">Каждый узел — достижимое состояние. Строка обозначает число выполненных действий. Выберите узел мышью или клавишами Tab и Enter.</p><figure class="graph-container" style="height:auto;margin:0"><svg viewBox="0 0 ${width} ${height}" style="height:auto;display:block" role="group" aria-label="Граф достижимых состояний замков"><desc>Направленные рёбра обозначают разрешённый шаг T0 или T1. Узлы доступны с клавиатуры.</desc><defs><marker id="${arrowId}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="var(--dim)"/></marker></defs>${labels}${paths}${marks}</svg></figure><div class="graph-summary"><span>${nodes.length} состояний</span><span>${(graph.deadlocks ?? []).length} тупиков</span><span style="color:var(--red)">● Тупик</span><span style="color:var(--mint)">● Завершение</span><span>Контур — текущее состояние</span></div>`;
}

const finite = value => typeof value === 'number' && Number.isFinite(value);
const milliseconds = value => finite(value) ? value.toFixed(3) : '—';
const BACKENDS = { js:'JavaScript', workers:'Workers', webgpu:'WebGPU', 'native-serial':'C++ serial', openmp:'OpenMP', 'native-false-sharing':'C++ cache' };

function backendName(row) {
  return row.backend === 'native-false-sharing' ? `${row.layout?.name ?? 'раскладка не указана'} · stride ${row.layout?.strideBytes ?? '—'} Б` : BACKENDS[row.backend] ?? row.backend;
}

function usable(row) {
  const summary = row?.summary;
  const verified = row?.correctness?.verified === true;
  const pairMatches = ['sum', 'checksum'].every(key => row?.correctness?.[key] === undefined && row?.correctness?.[`expected${key[0].toUpperCase()}${key.slice(1)}`] === undefined || row.correctness[key] === row.correctness[`expected${key[0].toUpperCase()}${key.slice(1)}`]);
  return row?.status === 'ok' && verified && pairMatches && summary && finite(summary.median) && summary.median >= 0 && finite(summary.mean) && Array.isArray(summary.ci95) && summary.ci95.length === 2 && summary.ci95.every(finite) && Number.isInteger(summary.n) && summary.n >= 2;
}

function absence(row) {
  if (row.status === 'unsupported') return `Недоступно: ${row.reason ?? 'этот способ не поддерживается'}`;
  if (row.status === 'error') return `Ошибка: ${row.reason ?? 'измерение не завершено'}`;
  return 'Ошибка: измерение или правильность результата не подтверждены';
}

function correctness(row) {
  const result = row.correctness;
  const checks = Number.isInteger(result.checks) ? ` (${result.checks} проверок)` : '';
  let pairs = ['sum', 'checksum'].filter(key => result[key] !== undefined).map(key => `${key}: ${escapeHTML(result[key])} = ${escapeHTML(result[`expected${key[0].toUpperCase()}${key.slice(1)}`])}`).join('<br>');
  if (Array.isArray(result.counters)) pairs += `${pairs ? '<br>' : ''}counters: ${result.counters.map(escapeHTML).join(', ')}<br>Ожидается на поток: ${escapeHTML(result.expectedPerCounter)}`;
  return `Проверено${checks}${pairs ? `<details><summary>Контроль результата</summary>${pairs}</details>` : ''}`;
}

export function renderMeasurements(report) {
  const rows = Array.isArray(report?.rows) ? report.rows.filter(row => row && typeof row === 'object') : [];
  if (!rows.length) return '<p class="chart-note">Измерений пока нет. Запустите эксперимент, чтобы получить реальные данные.</p>';
  const valid = rows.filter(usable);
  const sharing = report.experiment === 'native-false-sharing';
  const sizeUnit = sharing ? 'инкрементов / поток' : 'элементов';
  const maximum = Math.max(0, ...valid.map(row => row.summary.median));
  const groups = new Map();
  for (const row of rows) { if (!groups.has(row.size)) groups.set(row.size, []); groups.get(row.size).push(row); }
  const chart = [...groups].map(([size, group]) => `<section class="chart-group"><h3 class="chart-size">${escapeHTML(size)} ${sizeUnit}</h3>${group.map(row => {
    const backend = escapeHTML(backendName(row));
    if (!usable(row)) return `<div class="chart-bar-row" data-status="${row.status === 'unsupported' ? 'unsupported' : 'error'}"><span>${backend}</span><span>${escapeHTML(absence(row))}</span><span class="chart-value">—</span></div>`;
    const width = maximum ? 100 * row.summary.median / maximum : 0;
    const cssBackend = row.backend === 'workers' ? ' workers' : row.backend === 'webgpu' ? ' webgpu' : '';
    return `<div class="chart-bar-row" data-status="ok"><span>${backend}</span><div class="bar-track" aria-label="Медиана ${milliseconds(row.summary.median)} миллисекунды"><div class="bar-fill${cssBackend}" style="width:${width.toFixed(2)}%;${width === 0 ? 'min-width:0' : ''}"></div></div><span class="chart-value">${milliseconds(row.summary.median)} мс<br>n=${row.summary.n}</span></div>`;
  }).join('')}</section>`).join('');
  const table = rows.map(row => {
    const prefix = `<td>${escapeHTML(row.size)}</td><td>${escapeHTML(backendName(row))}${row.backend === 'native-false-sharing' ? `<br>${escapeHTML(row.workerCount ?? '—')} потоков` : ''}</td>`;
    if (!usable(row)) return `<tr>${prefix}<td colspan="6">${escapeHTML(absence(row))}</td></tr>`;
    const summary = row.summary;
    return `<tr>${prefix}<td>${milliseconds(summary.median)}</td><td>${milliseconds(summary.mean)}<br>[${milliseconds(summary.ci95[0])}; ${milliseconds(summary.ci95[1])}]</td><td>${summary.n}</td><td>${milliseconds(row.coldMs)}</td><td>${correctness(row)}</td><td>${escapeHTML(row.timingScope)}</td></tr>`;
  }).join('');
  const raw = valid.map(row => `<details><summary>${escapeHTML(backendName(row))} · ${escapeHTML(row.size)}: исходные прогоны</summary><p>${Array.isArray(row.samples) ? row.samples.map(sample => escapeHTML(sample)).join(', ') : '—'} мс</p>${row.gpuSummary ? `<p>Отдельное GPU-время: медиана ${milliseconds(row.gpuSummary.median)} мс; ${escapeHTML(row.gpuTimingScope)}. Оно не заменяет полное время.</p>` : ''}${row.layout ? `<p>Заданный размер линии: ${escapeHTML(row.layout.assumedLineBytes ?? '—')} Б; выравнивание: ${escapeHTML(row.layout.baseAlignmentBytes ?? '—')} Б; смещения: ${escapeHTML(row.layout.offsetBytes?.join(', ') ?? '—')} Б. Это параметры запуска, не обнаруженная топология CPU.</p>` : ''}</details>`).join('');
  const origin = report?.environment?.execution === 'native' ? 'ИМПОРТ · внешний нативный C++/OpenMP запуск' : report.kind === 'imported' ? 'ИМПОРТ · внешний браузерный отчёт' : 'Браузерный запуск';
  return `<div class="benchmark-chart"><h3 class="chart-size">Медиана полного времени, мс · меньше — быстрее</h3>${chart}<p class="chart-note">Общая шкала для показанных медиан. В таблице 95% ДИ среднего, а не медианы; интервал исследовательский, последовательные прогоны могут зависеть друг от друга. Недоступные результаты не считаются нулём.</p></div><div class="table-scroll"><table><caption class="sr-only">Результаты и условия реальных измерений</caption><thead><tr><th>${sharing ? 'Инкрементов / поток' : 'Элементов'}</th><th>Исполнение</th><th>Медиана, мс</th><th>Среднее и 95% ДИ среднего, мс</th><th>n</th><th>Холодный, мс</th><th>Правильность</th><th>Что измерено</th></tr></thead><tbody>${table}</tbody></table></div><p class="chart-note">${origin}${report.createdAt ? ` · ${escapeHTML(report.createdAt)}` : ''}${report.environment?.userAgent ? `<br>${escapeHTML(report.environment.userAgent)}` : ''}${report.environment?.compiler ? `<br>Компилятор: ${escapeHTML(report.environment.compiler)}` : ''}${report.kind === 'imported' ? '<br>Импорт не повторяет измерение и не удостоверяет происхождение отчёта.' : ''}</p>${raw}`;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function renderComparison(saved, current) {
  if (!saved || !current) return '<section class="comparison"><p>Сохраните исходное исполнение, чтобы сравнить его с новой веткой.</p></section>';
  const sameScene = sceneId(saved.scene) === sceneId(current.scene);
  if (!sameScene) return '<section class="comparison"><h3>Разные сцены</h3><p>Причинное сравнение доступно внутри одной модели.</p></section>';
  const changedConfig = stable(saved.config) !== stable(current.config);
  const changedActions = stable(saved.actions) !== stable(current.actions);
  const mode = changedConfig ? 'Изменена конфигурация' : changedActions ? 'Изменён порядок действий' : saved.cursor !== current.cursor ? 'Разный момент исполнения' : 'Одинаковое исполнение';
  const compared = compareTraces(saved.state?.events ?? [], current.state?.events ?? []);
  const eventText = event => event ? event.label ?? `${actorName(event.thread)}: ${event.op}` : 'Дальнейших событий нет';
  return `<section class="comparison"><h3>${mode}</h3><p>Общий префикс: ${compared.common} событий.${changedConfig ? ' Условия модели изменились; совпавшие события сами по себе не доказывают эффект одного выбора потока.' : ' Показана первая разница в событиях.'}</p><div class="table-scroll"><table><thead><tr><th></th><th>Сохранённое</th><th>Текущее</th></tr></thead><tbody><tr><th>Первое различие</th><td>${escapeHTML(eventText(compared.firstA))}</td><td>${escapeHTML(eventText(compared.firstB))}</td></tr><tr><th>Состояние</th><td>${escapeHTML(brief(saved.state))}</td><td>${escapeHTML(brief(current.state))}</td></tr></tbody></table></div></section>`;
}
