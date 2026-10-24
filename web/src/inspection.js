import {escapeHTML as h} from './views.js';

/** Inspection reads the current snapshot; it cannot advance the teaching model. */
export function inspectMemory(state,address){
  if(!Number.isInteger(address)||state?.kind!=='cache')return null;
  const cell=state.memory.objects.find(item=>item.address===address);
  if(!cell)return null;
  const lineSize=state.config.lineSize;
  return {type:'memory',provenance:'model',...cell,lineSize,
    range:[cell.line*lineSize,(cell.line+1)*lineSize-1],owner:state.owners[cell.line]??null,
    neighbours:state.memory.objects.filter(item=>item.line===cell.line&&item.address!==cell.address).map(item=>`${item.field}[${item.index}]`)};
}

export function inspectInvocation(result,globalId){
  if(result?.status!=='ok'||!Number.isInteger(globalId))return null;
  const value=result.values.find(item=>item.globalId===globalId);
  if(!value)return null;
  return {type:'gpu',...value,workgroupSize:result.workgroupSize,provenance:result.kind==='imported-gpu'?'imported':'measured'};
}

function facts(entries){
  return `<dl class="inspection-facts">${entries.map(([label,value])=>`<div><dt>${h(label)}</dt><dd>${h(value)}</dd></div>`).join('')}</dl>`;
}

export function renderInspection(item){
  if(!item)return '';
  if(item.type==='memory')return `<div class="inspection-heading"><span class="data-tag">МОДЕЛЬ</span><h3>${h(item.field)}[${h(item.index)}]</h3></div>${facts([['Адрес',`+${item.address} Б`],['Кеш-линия',`L${item.line} · ${item.range?.[0]}–${item.range?.[1]} Б`],['Владелец записи',item.owner===null?'нет':`T${item.owner}`]])}<p>В той же линии: ${h(item.neighbours?.join(', ')||'других полей нет')}. Это адреса учебной раскладки, не аппаратный замер. Запись соседнего поля может инвалидировать общую копию линии.</p>`;
  if(item.provenance==='schematic')return '<div class="inspection-heading"><span class="data-tag">СХЕМА</span><h3>Место для GPU-вызова</h3></div><p>Пока показана раскладка. Выполните dispatch, чтобы исследовать global, local и workgroup ID, считанные из настоящего GPU-буфера.</p>';
  const imported=item.provenance==='imported';
  return `<div class="inspection-heading"><span class="data-tag ${imported?'imported':'measured'}">${imported?'ИМПОРТ':'ИЗМЕРЕНО'}</span><h3>GPU-вызов ${h(item.globalId)}</h3></div>${facts([['global ID',item.globalId],['workgroup ID',item.workgroupId],['local ID',item.localId],['subgroup size',item.subgroupSize??'не сообщён'],['subgroup lane',item.subgroupInvocationId??'не сообщён'],['subgroup ID',item.subgroupId??'не сообщён']])}<p>${imported?'Проверена структура внешнего отчёта; импорт не подтверждает запуск на этом устройстве.':'Значения записаны самим GPU и проверены после чтения буфера.'} Расположение ячейки на сцене схематично и не показывает физическое размещение на видеокарте.</p>`;
}
