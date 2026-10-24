import {Controller} from './controller.js';
import {SCENES,SOURCES,PROVENANCE,DATA_KINDS,CAPABILITY_NOTES} from './content/curriculum.js';
import {exploreDeadlock} from './core/deadlock.js';
import {exploreRace} from './core/race.js';
import {renderScore,renderGraph,renderMeasurements,renderComparison,renderSpatialFallback,escapeHTML as h} from './views.js';
import {encodeSession,decodeSession,validateMeasuredImport,loadProgress,recordAnswer} from './session.js';
import {runBenchmark} from './compute/benchmark.js';
import {probeGPU,runGPULoom,validateLoomDocument} from './compute/gpu.js';
import {validateBenchmarkDocument,summarize} from './compute/stats.js';
import {inspectMemory,inspectInvocation,renderInspection} from './inspection.js';

const $=id=>document.getElementById(id);
const MODEL_IDS=['deadlock','race','memory','cas'];
const SHORT_TITLES=['Развилка времени','Контракт гонки','Микроскоп памяти','Эстафета CAS','Ткацкий станок GPU','Обсерватория'];
let scene=SCENES[0],controller=null,graph=null,view='space',graphMode=false,world=null,backendLabel='Инициализация…';
let timer=null,busy=false,job=null,report=null,gpuResult=null,gpuInfo=null,memoryMode='separate';
let gpuConfig={count:256,workgroupSize:64,subgroupSize:'auto'};
let benchConfig={sizes:'quick',repetitions:7,workers:2};
let progress;try{progress=loadProgress(localStorage);}catch{progress=loadProgress({getItem:()=>null});}
const branches=new Map(),quizStage=new Map(),quizFeedback=new Map();
let toastTimeout;
let selection=null,renderState='initializing',focusMode=false;

/** Read-only diagnostics for support and functional browser checks; no performance claims. */
export function getRuntimeDiagnostics(){
 return {scene:scene.id,cursor:controller?.cursor??null,renderer:world?.getDiagnostics?.()??null};
}

function syncRendererControls(info=world?.getDiagnostics?.()??{status:renderState}){
 const spatial=view==='space'&&scene.id!=='benchmark';
 $('scene-tools').hidden=!spatial;
 for(const id of ['camera-preset','render-quality'])$(id).disabled=!world?.ready||busy;
 if(info?.quality)$('render-quality').value=info.quality;
 const unavailable=!!info&&!world?.ready;
 $('render-status').hidden=!spatial||!unavailable;
 const waiting=['initializing','recovering'].includes(info?.status);
 $('render-status-text').textContent=waiting?'Готовим 3D. Пока можно продолжить в доступном представлении.':info?.status==='lost'?'Графический контекст потерян. Исполнение сохранено; можно продолжать здесь.':'3D сейчас недоступно. Учебные модели и управление работают.';
 $('retry-renderer').hidden=!unavailable||waiting;
 $('retry-renderer').disabled=busy;
}

function updateRenderState(info){
 const changed=renderState!==info.status;renderState=info.status;
 syncRendererControls(info);
 if(changed)queueMicrotask(()=>render());
}

function selectObject(item){
 if(item.type==='memory'&&scene.id==='memory')selection={type:'memory',address:item.address};
 else if(item.type==='gpu'&&scene.id==='gpu')selection={type:'gpu',globalId:item.globalId,provenance:item.provenance};
 else return;
 if(selection.type==='memory'&&$('inspect-address'))$('inspect-address').value=String(selection.address);
 if(selection.type==='gpu'&&$('inspect-invocation')&&Number.isInteger(selection.globalId))$('inspect-invocation').value=String(selection.globalId);
 renderSelection();
}

function renderSelection(){
 let item=null;
 if(selection?.type==='memory'&&scene.id==='memory')item=inspectMemory(controller.state,selection.address);
 if(selection?.type==='gpu'&&scene.id==='gpu')item=gpuResult?.status==='ok'?inspectInvocation(gpuResult,selection.globalId):{type:'gpu',provenance:'schematic'};
 $('selection-card').hidden=!item;
 $('selection-content').innerHTML=renderInspection(item);
}

function toggleFocus(value=!focusMode){
 focusMode=value;document.body.classList.toggle('focus-mode',value);
 document.querySelector('.experiment').classList.toggle('is-focused',value);
 $('focus-stage').setAttribute('aria-pressed',String(value));
 $('focus-stage').setAttribute('aria-label',value?'Свернуть лабораторию':'Развернуть лабораторию');
 $('focus-stage').title=value?'Свернуть лабораторию · Esc':'Развернуть лабораторию';
 $('focus-stage').textContent=value?'↙':'⛶';
 $('focus-stage').focus({preventScroll:true});
}

function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').hidden=true,4500);}
function openDialog(title,html){$('dialog-title').textContent=title;$('dialog-content').innerHTML=html;if(!$('detail-dialog').open)$('detail-dialog').showModal();}
function closeDialog(){$('detail-dialog').close();}
function stop(){clearInterval(timer);timer=null;$('play').textContent='▶';$('play').setAttribute('aria-label','Запустить автоматическое расписание');}
function defaultConfig(id){return id==='deadlock'?{ordered:false}:id==='race'?{mode:'unsafe'}:id==='memory'?{layout:'aos',lineSize:64,count:8,padding:0}:{weak:false};}

function navigate(id,{initial=true}={}){
 const chosen=SCENES.find(s=>s.id===id);if(!chosen)return;
 if(busy){job?.abort();job=null;busy=false;world?.setPaused(false);}
 stop();scene=chosen;selection=null;graphMode=false;view=scene.id==='benchmark'?'score':'space';
 if(MODEL_IDS.includes(scene.id)){
  controller=new Controller(scene.id,defaultConfig(scene.id));
  if(initial){
   if(scene.id==='deadlock'){controller.step(0);controller.step(1);}
   if(scene.id==='race'){controller.step(0);controller.step(1);}
   if(scene.id==='memory')for(let i=0;i<4;i++)controller.autoStep({memoryMode});
   if(scene.id==='cas')for(const actor of [0,1,0,1,0])controller.step(actor);
  }
 }else controller=null;
 graph=scene.id==='deadlock'?exploreDeadlock(controller.config):null;
 if(location.hash!==`#${id}`)history.replaceState(null,'',`#${id}`);
 const index=SCENES.indexOf(scene);
 $('scene-title').innerHTML=`${h(scene.title)}<span>.</span>`;
 $('scene-number').textContent=`ЭКСПЕРИМЕНТ ${String(index+1).padStart(2,'0')} · ${scene.eyebrow.toUpperCase()}`;
 $('scene-breadcrumb').textContent=String(index+1).padStart(2,'0');
 $('scene-summary').textContent=scene.summary;
 $('lesson-question').textContent=scene.question;$('lesson-text').textContent=scene.lesson;$('model-scope').textContent=scene.scope;
 $('source-footnote').innerHTML=`↳ ${h(scene.source.section)}<br><a href="${h(scene.source.url)}" target="_blank" rel="noreferrer">${h(scene.source.path)} ↗</a>`;
 renderNav();renderConfiguration();renderChallenge();render();
}
function renderNav(){
 $('scene-nav').innerHTML=SCENES.map((s,i)=>`<button class="nav-scene${s.id===scene.id?' active':''}" data-scene="${s.id}" ${s.id===scene.id?'aria-current="page"':''}><span class="nav-num">${String(i+1).padStart(2,'0')}</span><span class="nav-text">${SHORT_TITLES[i]}</span><span class="nav-complete">${progress[s.id].mastered?'✓':''}</span></button>`).join('');
 const done=Object.values(progress).filter(p=>p.mastered).length;$('progress-count').textContent=`${done} / 6`;$('progress-bar').style.width=`${done/6*100}%`;
}
function segment(items,key,value){return `<div class="segmented" role="group" aria-label="Параметры модели">${items.map(([v,label])=>`<button data-config="${key}" data-value="${v}" class="${String(value)===String(v)?'active':''}" aria-pressed="${String(value)===String(v)}">${label}</button>`).join('')}</div>`;}
function renderConfiguration(){
 const cfg=controller?.config;
 if(scene.id==='deadlock')$('configuration').innerHTML=`<span class="config-label">ПОРЯДОК ЗАМКОВ</span>${segment([['false','A → B / B → A'],['true','A → B / A → B']],'ordered',cfg.ordered)}<button class="preset-button" data-preset="deadlock">Поймать тупик</button><button class="preset-button" data-preset="lucky">Удачный запуск ↗</button>`;
 else if(scene.id==='race')$('configuration').innerHTML=`<span class="config-label">СПОСОБ ИСПРАВЛЕНИЯ</span>${segment([['unsafe','Обычный счётчик'],['atomic','Атомарное +1'],['snapshot','Локальный снимок']],'mode',cfg.mode)}<button class="preset-button" data-preset="race">Потерять обновление ↗</button>`;
 else if(scene.id==='memory')$('configuration').innerHTML=`<label>Раскладка <select id="memory-layout"><option value="aos" ${cfg.layout==='aos'?'selected':''}>AoS · a,b,a,b</option><option value="soa" ${cfg.layout==='soa'?'selected':''}>SoA · a… / b…</option><option value="padded" ${cfg.layout==='padded'?'selected':''}>Padding · разнести поля</option></select></label><label>Линия <select id="line-size">${[...new Set([16,32,64,128,256,cfg.lineSize])].sort((a,b)=>a-b).map(n=>`<option ${n===cfg.lineSize?'selected':''}>${n}</option>`).join('')}</select> Б</label><label>Объектов <select id="memory-count">${[...new Set([4,8,16,cfg.count])].sort((a,b)=>a-b).map(n=>`<option ${n===cfg.count?'selected':''}>${n}</option>`).join('')}</select></label><label>Зазор <input id="memory-padding" type="number" min="0" max="256" step="1" value="${cfg.padding}" ${cfg.layout!=='padded'?'disabled':''}> Б</label>`;
 else if(scene.id==='cas')$('configuration').innerHTML=`<span class="config-label">ПОМОЩЬ ХВОСТУ</span>${segment([['false','Strong CAS'],['true','Weak CAS']],'weak',cfg.weak)}<button class="preset-button" data-preset="cas">Два претендента на next ↗</button><button class="preset-button" data-preset="help">Отставший хвост ↗</button>`;
 else if(scene.id==='gpu')$('configuration').innerHTML='<span class="config-label">WEBGPU COMPUTE</span><span class="pill">global_id → workgroup → subgroup</span><span class="inspector-note" style="margin:0">Каждая ячейка приходит из результата GPU-dispatch.</span>';
 else $('configuration').innerHTML=report?.experiment==='native-false-sharing'?'<span class="config-label">ИМПОРТ · НАТИВНЫЕ СЧЁТЧИКИ</span><span class="pill">packed ↔ padded · независимые атомарные значения</span><button id="show-protocol" class="preset-button">Протокол этого отчёта ↗</button>':'<span class="config-label">ОДИН ВХОД · ОДНА ЗАДАЧА</span><span class="pill">uint32 transform + reduction</span><button id="show-protocol" class="preset-button">Как устроено измерение ↗</button>';
}
function changeConfig(key,value){
 if(!controller||busy)return;stop();
 const before=controller.snapshot();branches.set(scene.id,before);
 const cfg={...controller.config,[key]:value};
 try{const next=new Controller(scene.id,cfg);if(key!=='count')for(const action of before.actions.slice(0,before.cursor))next.step(action);controller=next;if(scene.id==='deadlock')graph=exploreDeadlock(cfg);renderConfiguration();render();toast(key==='count'?'Размер массива изменён: новая запись с начала. Предыдущая ветка сохранена.':'Параметр изменён. Предыдущее исполнение сохранено для сравнения.');}catch(error){renderConfiguration();toast(error.message);}
}
function preset(name){
 stop();if(controller)branches.set(scene.id,controller.snapshot());
 let actions=[];let cfg=controller?.config;
 if(name==='deadlock'){cfg={ordered:false};actions=[0,1];}
 if(name==='lucky')actions=[0,0,0,0,0,1,1,1,1,1];
 if(name==='race'){cfg={mode:'unsafe'};actions=exploreRace('unsafe').witness;}
 if(name==='cas')actions=[0,1,0,1,0,1];
 if(name==='help'){cfg={weak:true};actions=[0,0,0,1,1];}
 controller=new Controller(scene.id,cfg);for(const action of actions)controller.step(action);
 if(scene.id==='deadlock')graph=exploreDeadlock(cfg);
 renderConfiguration();render();
}
function act(thread,spurious=false){
 if(!controller||busy)return;stop();
 let action=thread;
 if(scene.id==='memory'){
  const index=controller.state.events.filter(e=>e.thread===thread).length%controller.config.count;
  action={thread,index,field:memoryMode==='separate'?(thread?'b':'a'):'a',write:memoryMode==='readonly'?false:!(memoryMode==='write-read'&&thread===1)};
 }else if(scene.id==='cas'&&spurious)action={thread,spurious:true};
 if(!controller.step(action))toast('Этот шаг сейчас запрещён. Сначала должен измениться владелец ресурса.');
 render();
}
function nextStep(){if(!controller||busy)return;if(!controller.autoStep({memoryMode}))stop();render();}
function togglePlay(){
 if(timer){stop();return;}if(!controller||busy)return;
 $('play').textContent='Ⅱ';$('play').setAttribute('aria-label','Остановить расписание');
 timer=setInterval(()=>{if(!controller.autoStep({memoryMode})||(scene.id==='memory'&&controller.cursor>=controller.config.count*4))stop();render();},750);
}
function render(){
 const isModel=!!controller,s=controller?.state;
 $('transport').hidden=!isModel;$('branch-bar').hidden=!isModel;
 $('event-caption').hidden=!isModel;
 $('comparison').hidden=true;
 const kind=(scene.id==='benchmark'&&report?.kind==='imported')||(scene.id==='gpu'&&gpuResult?.kind==='imported-gpu')?'imported':isModel?'model':'measured';
 const successful=scene.id==='gpu'?gpuResult?.status==='ok':scene.id==='benchmark'?report?.rows?.some(r=>r.status==='ok'):false;
 const attempted=scene.id==='gpu'?!!gpuResult:scene.id==='benchmark'?!!report:false;
 $('data-kind').textContent=kind==='model'?'МОДЕЛЬ':kind==='imported'?'ИМПОРТ':successful?'ИЗМЕРЕНО':attempted?'НЕТ ДАННЫХ':'ЭКСПЕРИМЕНТ';
 $('data-kind').className=`data-tag ${kind}`;
 $('footer-scope').textContent=isModel?'Логические события · не время процессора':'Данные отдельного запуска · граница таймера указана';
 document.querySelector('[data-view="graph"]').disabled=scene.id!=='deadlock';
 document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});
 $('renderer-label').textContent=view==='space'?backendLabel:view==='graph'?'BFS · точный граф':'DOM · доступно';
 $('reset-camera').hidden=view!=='space';
 const zoom=$('zoom-graph');if(zoom){zoom.hidden=scene.id!=='deadlock'||view!=='space';zoom.setAttribute('aria-pressed',String(graphMode));}
 if(isModel){
  $('timeline').max=String(controller.actions.length);$('timeline').value=String(controller.cursor);$('step-count').textContent=`${controller.cursor} / ${controller.actions.length}`;
  $('back').disabled=$('rewind').disabled=controller.cursor===0;
  $('next').disabled=$('play').disabled=controller.cursor>=controller.actions.length&&controller.status!=='running';
  $('event-caption').textContent=s.events.at(-1)?.label??'Начальное состояние. Выберите следующий поток.';
  $('compare-branch').disabled=!branches.has(scene.id);
  $('branch-description').textContent=branches.has(scene.id)?'Предыдущая ветка сохранена. Сравните причину и результат.':'Запомните исполнение и попробуйте другое решение.';
 }
 $('stage-legend').hidden=['gpu','benchmark'].includes(scene.id)||view!=='space';
 $('stage-caption').hidden=view!=='space';
 $('stage-hint').textContent=graphMode?'Выберите узел: вернёмся к этому состоянию':scene.id==='deadlock'?'Сплошная стрелка — владение · пунктир — ожидание':scene.id==='memory'?'Платформа = кеш-линия · расстояния схематичны':scene.id==='gpu'?(gpuResult?.kind==='imported-gpu'?'Импортированный dispatch · проверена структура':gpuResult?.status==='ok'?'Результат реального GPU-dispatch':'До запуска показана только схема размещения'):'Выберите поток · перетащите сцену для смены ракурса';
 renderInspector();renderMetrics();renderView();renderSelection();syncRendererControls();
}
function renderView(){
 const alternative=$('alternative-view');
 const spatial=view==='space'&&scene.id!=='benchmark'&&world?.ready;
 alternative.classList.toggle('spatial-mode',view==='space'&&!!controller&&!world?.ready&&!graphMode);
 alternative.classList.toggle('spatial-memory',scene.id==='memory');
 $('world').hidden=!spatial;$('world-labels').hidden=!spatial;alternative.hidden=spatial;
 world?.setVisible(spatial);
 if(spatial)world.update(scene.id,controller?.state,{graph,graphMode,gpuResult});
 else if(scene.id==='benchmark')alternative.innerHTML=report?renderMeasurements(report):'<div class="benchmark-empty"><div class="empty-glyph">ƒ(n)</div><h3>Где начинается ускорение?</h3><p>Размер задачи меняет всё. Запустите проверенный эксперимент на этом устройстве: JS, Workers и WebGPU.</p><span class="pill">До запуска цифр нет</span></div>';
 else if(scene.id==='gpu')alternative.innerHTML=renderGPUScore();
 else if(view==='graph'||graphMode)alternative.innerHTML=renderGraph(graph,controller.state);
 else if(view==='space')alternative.innerHTML=renderSpatialFallback(scene.id,controller.state);
 else alternative.innerHTML=renderScore(scene.id,controller.state);
 if(!world?.ready&&view==='space')$('renderer-label').textContent=backendLabel==='Инициализация…'?'Загрузка 3D…':'2D / текст';
}
function renderInspector(){
 if(scene.id==='gpu'){renderGPUInspector();return;}
 if(scene.id==='benchmark'){renderBenchmarkInspector();return;}
 const s=controller.state,status=controller.status;
 let title=status==='deadlock'?'Взаимная блокировка':status==='complete'?'Исполнение завершено':'Следующий ход — ваш';
 let description=status==='deadlock'?'T0 ждёт B. T1 ждёт A. Ни один не может освободить свой замок.':status==='complete'?'Оба потока выполнили конечную программу.':'Выберите, какой поток выполнит одну разрешённую инструкцию.';
 if(scene.id==='race'){description=`Общий счётчик = ${s.value}. ${s.mode==='snapshot'?'Снимок изменяет контракт задачи.':'Цель: два увеличения → итог 2.'}`;if(status==='complete'&&s.mode==='unsafe'&&s.value!==2)title='Одно обновление потеряно';}
 if(scene.id==='cas')description=`head = ${s.head} · tail = ${s.tail}. Успешная вставка next — точка линеаризации.`;
 if(scene.id==='memory'){title='Когерентность в действии';description='Разные поля могут занимать общую линию. Числа ниже — события модели.';}
 let body=`<div class="inspector-title">${scene.id==='memory'?'ДВА ЯДРА · ОБЩАЯ ПАМЯТЬ':'ДВА ПОТОКА · ОДНО ИСПОЛНЕНИЕ'}</div><div class="status-panel ${status==='deadlock'?'waiting':''}"><span class="status-symbol">${status==='deadlock'?'∥':status==='complete'?'✓':'⑂'}</span><div><strong>${title}</strong><p>${description}</p></div></div>`;
 if(scene.id==='memory'){
  body+=`<label class="inspector-note">Тип обращений <select id="access-mode"><option value="separate" ${memoryMode==='separate'?'selected':''}>Разные поля · запись</option><option value="true" ${memoryMode==='true'?'selected':''}>Одно поле · запись</option><option value="write-read" ${memoryMode==='write-read'?'selected':''}>Одно поле · запись/чтение</option><option value="readonly" ${memoryMode==='readonly'?'selected':''}>Только чтение</option></select></label>`;
  for(let t=0;t<2;t++){
   const index=s.events.filter(e=>e.thread===t).length%s.config.count;const field=memoryMode==='separate'?(t?'b':'a'):'a';const write=memoryMode!=='readonly'&&!(memoryMode==='write-read'&&t===1);
   body+=`<section class="thread-card t${t}"><div class="thread-header"><span class="thread-name">T${t} / CORE ${t}</span><span class="thread-status">i = ${index}</span></div><div class="code-block"><div class="code-line current">${write?'write':'read'} ${field}[${index}]</div></div><button class="thread-action" data-actor="${t}">${write?'Записать':'Прочитать'} ${field}[${index}] →</button></section>`;
  }
  body+=`<div class="object-explorer"><label>Исследовать ячейку<select id="inspect-address">${s.memory.objects.map(o=>`<option value="${o.address}" ${selection?.address===o.address?'selected':''}>${h(o.field)}[${o.index}] · +${o.address} Б</option>`).join('')}</select></label><button id="inspect-object" class="secondary-button">Показать адрес и соседей</button></div>`;
 }else for(let t=0;t<2;t++){
  const pc=scene.id==='cas'?s.threads[t].pc:s.pcs[t],program=controller.program(t),enabled=controller.enabled.includes(t),done=pc>=program.length;
  body+=`<section class="thread-card t${t}"><div class="thread-header"><span class="thread-name">ПОТОК T${t}</span><span class="thread-status">${done?'ГОТОВО':enabled?'МОЖЕТ ИДТИ':'ОЖИДАЕТ'}</span></div><div class="code-block">${program.map((line,i)=>`<div class="code-line${i===pc?' current':i<pc?' done':''}" ${i===pc?'aria-current="step"':''}><span class="line-no">${i+1}</span><span>${h(line)}</span></div>`).join('')}</div><button class="thread-action" data-actor="${t}" ${!enabled?'disabled':''}>Шаг T${t} →</button>${scene.id==='cas'&&s.weak&&s.threads[t].phase==='help-tail'?`<button class="thread-action" data-spurious="${t}">Вызвать spurious failure</button>`:''}</section>`;
 }
 body+=`<p class="inspector-note">${scene.id==='race'?h(s.contract):scene.id==='cas'?'expected обновляется при неуспешном сравнении. Завершённая вставка не отменяется неудачей CAS хвоста.':scene.id==='memory'?`Размер линии ${s.config.lineSize} Б — выбранное допущение, а не обнаруженная характеристика CPU.`:'Нажимайте T0 / T1 или клавиши 1 / 2. ← и → перемещают по исполнению.'}</p>`;
 $('inspector').innerHTML=body;
}
function renderMetrics(){
 let values=[];const s=controller?.state;
 if(scene.id==='deadlock')values=[[graph.nodes.length,'достижимых состояний','полный перебор этой модели'],[graph.deadlocks.length,'возможных тупиков',controller.config.ordered?'единый порядок захвата':'есть кратчайший контрпример'],[controller.cursor,'логических событий','никаких миллисекунд']];
 if(scene.id==='race'){const ex=exploreRace(s.mode);values=[[s.value,'общий счётчик',s.mode==='snapshot'?'локальные вычисления, иной контракт':'контракт: увеличить на 2'],[ex.finalValues.join(' / '),'конечных значений','только в этой учебной модели'],[ex.states,'состояний при переборе','SC-модель, не исходы C++ UB']];}
 if(scene.id==='memory')values=[[s.metrics.invalidations,'инвалидированных копий',`false / true sharing: ${s.metrics.falseSharing} / ${s.metrics.trueSharing}`],[s.memory.bytes+' Б','занято раскладкой',`${s.memory.bytes/(s.config.count*2)}× от полезных байтов`],[s.metrics.transfers,'условных передач','не аппаратный счётчик']];
 if(scene.id==='cas')values=[[Object.values(s.nodes).filter(n=>n.published).length-1,'узлов опубликовано','всего два добавления'],[s.events.filter(e=>e.success===false).length,'отказов CAS','включая заданные ложные'],[s.tail,'текущий хвост','может временно отставать']];
 if(scene.id==='gpu')values=[[gpuResult?.status==='ok'?gpuResult.values.length:'—','проверенных вызовов',gpuResult?.kind==='imported-gpu'?'структура импортированного отчёта':'считаны из GPU-буфера'],[gpuResult?.status==='ok'?gpuResult.workgroups.length:'—','рабочих групп','global / local / workgroup ID'],[gpuResult?.subgroupSizes?.join(', ')||'—','наблюдаемые subgroup sizes','размер не фиксируется как 32']];
 if(scene.id==='benchmark'){const ok=report?.rows?.filter(r=>r.status==='ok'||r.correctness===true)||[];values=[[ok.length||'—','проверенных серий','неудачные результаты не сравниваем'],[ok.length?ok[0].samples.length:'—','повторов на серию','первый запуск отдельно'],[report?.kind==='imported'?'ИМПОРТ':report?'ЗАМЕР':'—','происхождение данных',report?.kind==='imported'?(report.environment?.execution==='native'?'внешний C++/OpenMP запуск':'внешняя браузерная сессия'):'текущий браузер и устройство']];}
 $('metrics').innerHTML=values.map(([value,label,note])=>`<div class="metric"><div class="metric-value">${h(value)}</div><div class="metric-label">${h(label)}<small>${h(note)}</small></div></div>`).join('');
}
function renderChallenge(){
 const stage=quizStage.get(scene.id)??(progress[scene.id].challenge?'transfer':'challenge'),task=scene[stage];quizStage.set(scene.id,stage);
 const feedback=quizFeedback.get(scene.id);const activeFeedback=feedback?.stage===stage?feedback:null;
 $('challenge').innerHTML=`<div class="section-kicker">${progress[scene.id].mastered?'✓ МОДУЛЬ ПРОЙДЕН':stage==='challenge'?'ВАША ГИПОТЕЗА':'ПРОВЕРКА ПЕРЕНОСА ЗНАНИЙ'} · ${stage==='challenge'?'01':'02'} / 02</div><h3>${h(task.prompt)}</h3><div class="challenge-options">${task.options.map((o,i)=>`<button class="challenge-option${activeFeedback?.choice===o.id?(activeFeedback.correct?' correct':' wrong'):''}" data-answer="${o.id}"><b>${String.fromCharCode(65+i)}</b><span>${h(o.label)}</span></button>`).join('')}</div>${activeFeedback?`<p class="challenge-feedback">${activeFeedback.correct?'Верно. ':'Попробуйте ещё раз. '}${h(task.explanation)}</p>`:''}${activeFeedback?.correct&&stage==='challenge'?'<button class="primary-button challenge-next" id="next-question">Проверить на другой ситуации →</button>':progress[scene.id].mastered?'<p class="challenge-feedback">Оба задания выполнены. Прогресс сохраняется на этом устройстве.</p>':''}`;
}
function answer(choice){
 const stage=quizStage.get(scene.id),correct=scene[stage].answer===choice;
 progress=recordAnswer(progress,scene.id,stage,correct);quizFeedback.set(scene.id,{choice,correct,stage});
 try{localStorage.setItem('ct-progress-v1',JSON.stringify(progress));}catch{}
 renderNav();renderChallenge();
}
function renderGPUInspector(){
 const known=gpuInfo?.supported;const sizes=gpuInfo?.limits;const possible=[];
 if(gpuInfo?.diagnostics?.subgroupSizeControl?.supported)for(const n of [4,8,16,32,64,128])if(n>=(sizes?.subgroupMinSize??4)&&n<=(sizes?.subgroupMaxSize??128))possible.push(n);
 $('inspector').innerHTML=`<div class="inspector-title">НАСТОЯЩИЙ COMPUTE DISPATCH</div><div class="status-panel ${gpuResult?.status&&gpuResult.status!=='ok'?'waiting':''}"><span class="status-symbol">▦</span><div><strong>${gpuResult?.kind==='imported-gpu'?'Импортированная структура':gpuResult?.status==='ok'?'Буфер прочитан и проверен':gpuResult?'Запуск недоступен':known?'WebGPU доступен':'Проверка возможностей'}</strong><p>${h(gpuResult?.reason??(known?'Выберите размер задачи и рабочей группы.':gpuInfo?.reason??'Проверяем API и адаптер.'))}</p></div></div><div class="gpu-fields"><label>Количество вызовов<select id="gpu-count">${[...new Set([65,256,1024,4096,gpuConfig.count])].sort((a,b)=>a-b).map(n=>`<option ${n===gpuConfig.count?'selected':''}>${n}</option>`).join('')}</select></label><label>Размер workgroup<select id="gpu-workgroup">${[...new Set([32,64,128,256,gpuConfig.workgroupSize])].sort((a,b)=>a-b).map(n=>`<option ${n===gpuConfig.workgroupSize?'selected':''}>${n}</option>`).join('')}</select></label><label>Subgroup size<select id="gpu-subgroup" ${!possible.length?'disabled':''}><option value="auto" ${gpuConfig.subgroupSize==='auto'?'selected':''}>Выбирает драйвер</option>${possible.map(n=>`<option ${Number(gpuConfig.subgroupSize)===n?'selected':''}>${n}</option>`).join('')}</select></label><button class="primary-button" id="run-gpu" ${busy?'disabled':''}>${busy?'Вычисляем…':'Выполнить на GPU →'}</button>${busy?'<button class="secondary-button" id="cancel-gpu">Отменить dispatch</button>':''}<button class="secondary-button" id="gpu-details" ${!gpuResult?'disabled':''}>Таблица вызовов</button></div><p class="inspector-note">Одинаковый цвет может повторяться; точный номер группы — в таблице. Subgroups используются только при поддержке. При отсутствии GPU числовой результат не подменяется моделью.</p>`;
 if(gpuResult?.status==='ok')$('inspector').insertAdjacentHTML('beforeend',`<div class="object-explorer"><label>Исследовать вызов<input id="inspect-invocation" type="number" min="0" max="${gpuResult.values.length-1}" step="1" value="${selection?.globalId??0}"></label><button id="inspect-object" class="secondary-button">Показать GPU-вызов</button></div>`);
}
function renderGPUScore(){
 if(!gpuResult)return '<div class="benchmark-empty"><div class="empty-glyph">▦</div><h3>Загляните внутрь dispatch</h3><p>GPU запишет собственные global, local и workgroup ID. При поддержке добавятся реальные subgroup ID и размеры.</p><span class="pill">Ожидает вашего запуска</span></div>';
 if(gpuResult.status!=='ok')return `<div class="error-panel">${h(gpuResult.reason)}<p>Данные не созданы. Все учебные модели доступны через WebGL 2 или текст.</p></div>`;
 return `<p class="graph-caption">${gpuResult.kind==='imported-gpu'?'Импортированные данные; проверена структура, не выполнение':'Данные реального запуска'}: ${gpuResult.values.length} вызовов. ${h(gpuResult.timingScope??'')}. Размер subgroup не равен автоматически размеру workgroup.</p><div class="table-scroll"><table><thead><tr><th>global</th><th>local</th><th>workgroup</th><th>subgroup size</th><th>subgroup lane</th><th>subgroup ID</th></tr></thead><tbody>${gpuResult.values.slice(0,256).map(v=>`<tr><td>${v.globalId}</td><td>${v.localId}</td><td>${v.workgroupId}</td><td>${v.subgroupSize??'—'}</td><td>${v.subgroupInvocationId??'—'}</td><td>${v.subgroupId??'—'}</td></tr>`).join('')}</tbody></table></div><p class="chart-note">Таблица показывает первые ${Math.min(256,gpuResult.values.length)} вызовов. Полный массив доступен через экспорт.</p>`;
}
async function runGPU(){
 if(busy)return;const count=Number($('gpu-count').value),workgroupSize=Number($('gpu-workgroup').value),subgroup=$('gpu-subgroup').value;
 gpuConfig={count,workgroupSize,subgroupSize:subgroup};
 busy=true;const localJob=new AbortController();job=localJob;world?.setPaused(true);renderInspector();syncRendererControls();
 try{const result=await runGPULoom({count,workgroupSize,subgroupSize:subgroup==='auto'?null:Number(subgroup),signal:localJob.signal});if(job===localJob)gpuResult=result;}
 catch(error){if(job===localJob&&error.name!=='AbortError')gpuResult={kind:'measured',status:'error',reason:error.message,values:[],workgroups:[],subgroupSizes:[],features:[],diagnostics:{}};}
 finally{if(job===localJob){busy=false;world?.setPaused(false);render();}}
}
function renderBenchmarkInspector(){
 $('inspector').innerHTML=`<div class="inspector-title">ОБСЕРВАТОРИЯ УСКОРЕНИЯ</div><div class="benchmark-fields"><label>Размеры входа<select id="bench-sizes" ${busy?'disabled':''}><option value="quick" ${benchConfig.sizes==='quick'?'selected':''}>16K → 64K → 256K</option><option value="large" ${benchConfig.sizes==='large'?'selected':''}>64K → 256K → 1M</option><option value="small" ${benchConfig.sizes==='small'?'selected':''}>257 элементов · проверка краёв</option></select></label><label>Повторов<select id="bench-repetitions" ${busy?'disabled':''}>${[3,7,15].map(n=>`<option ${n===benchConfig.repetitions?'selected':''}>${n}</option>`).join('')}</select></label><label>Web Workers<select id="bench-workers" ${busy?'disabled':''}>${[1,2,4,8].map(n=>`<option ${n===benchConfig.workers?'selected':''}>${n}</option>`).join('')}</select></label></div><div class="benchmark-actions"><button id="run-benchmark" class="primary-button" ${busy?'disabled':''}>${busy?'Измеряем…':'Начать эксперимент →'}</button>${busy?'<button id="cancel-benchmark" class="secondary-button">Остановить измерение</button>':''}<button id="native-instructions" class="text-button">C++ / OpenMP на своём CPU ↗</button></div><div class="benchmark-progress"><i id="benchmark-progress-fill"></i></div><p class="inspector-note" id="benchmark-progress-label">${busy?'Отрисовка приостановлена.':'Вход одинаков для всех способов. Каждый выходной элемент и сумма проверяются.'}</p><p class="inspector-note">Сравнивается полное время операции. Worker включает передачу данных; GPU включает загрузку и чтение. Нативный OpenMP импортируется отдельным отчётом.</p>`;
}
async function startBenchmark(){
 if(busy)return;stop();
 const sizes={quick:[16384,65536,262144],large:[65536,262144,1048576],small:[257]}[$('bench-sizes').value];
 const repetitions=Number($('bench-repetitions').value),workers=Number($('bench-workers').value);
 benchConfig={sizes:$('bench-sizes').value,repetitions,workers};
 busy=true;const localJob=new AbortController();job=localJob;world?.setPaused(true);renderInspector();syncRendererControls();
 try{
  const result=await runBenchmark({sizes,repetitions,workers,signal:localJob.signal,onProgress:p=>{
   if(job!==localJob)return;const fill=$('benchmark-progress-fill');if(fill)fill.style.width=`${p.total?p.completed/p.total*100:0}%`;
   const label=$('benchmark-progress-label');if(label)label.textContent=`${p.backend??'Готовим'} · N=${p.size??'…'}${p.repetition?` · повтор ${p.repetition}/${p.repetitions}`:''}. Отрисовка остановлена.`;
  }});
  if(job===localJob){report=result;renderConfiguration();toast('Измерения завершены. Корректность проверена отдельно от таймера.');}
 }catch(error){if(job===localJob)toast(error.name==='AbortError'?'Измерение остановлено. Незавершённые серии не опубликованы.':error.message);}
 finally{if(job===localJob){busy=false;world?.setPaused(false);render();}}
}
function graphSelect(id){
 if(!graph||busy)return;const node=graph.nodes.find(n=>n.id===id);if(!node)return;stop();
 branches.set(scene.id,controller.snapshot());const next=new Controller('deadlock',controller.config);for(const e of node.state.events)next.step(e.thread);controller=next;render();
}
async function showSource(){
 openDialog(scene.source.label,`<p>${h(PROVENANCE.adaptation)}</p><p><a href="${h(scene.source.url)}" target="_blank" rel="noreferrer">Открыть зафиксированный источник на GitHub ↗</a></p><h3>Что адаптировано</h3><p>${h(scene.scope)}</p><pre class="code-preview" id="archived-source">Читаем листинг…</pre>`);
 try{const response=await fetch(`./sources/${scene.source.path}`);if(!response.ok)throw Error('Источник доступен по ссылке GitHub.');const text=await response.text();if($('archived-source'))$('archived-source').textContent=text;}catch(error){if($('archived-source'))$('archived-source').textContent=error.message;}
}
function showAbout(){openDialog('Учебник, который можно исследовать',`<p>Concurrency Theatre — интерактивный спутник <a href="https://github.com/SkyProse/ParallelProgrammingTex" target="_blank" rel="noreferrer">ParallelProgrammingTex</a>. Теория, OpenMP и лабораторные работы остаются источником; новые сцены позволяют вмешаться в выполнение.</p><h3>Происхождение</h3><p>${h(PROVENANCE.authors.join(', '))}. ${h(PROVENANCE.institution)}. ${h(PROVENANCE.copyright)}.</p><p>Архив: ${h(PROVENANCE.archiveDate)} · аудит: ${h(PROVENANCE.auditDate)}. Исходные листинги сохранены. Сцены — явно ограниченные адаптации.</p><h3>Три вида доказательств</h3>${DATA_KINDS.map(k=>`<div class="source-card"><strong>${h(k.label)}</strong><p>${h(k.description)}</p></div>`).join('')}<h3>Источники и оговорки</h3>${SOURCES.map(s=>`<div class="source-card"><a href="${h(s.url)}" target="_blank" rel="noreferrer">${h(s.label)} ↗</a><small>${h(s.note)}</small></div>`).join('')}<h3>Клавиатура</h3><p>1 / 2 — шаг потока. ← / → — назад и вперёд. Пробел — автоматическое расписание. R — начало записи. Все действия доступны и обычными кнопками. При уменьшении движения графика остаётся статичной.</p>`);}
async function showCapabilities(){
 openDialog('Возможности этого устройства','<p>Проверяем возможности адаптера…</p>');gpuInfo=await probeGPU();
 const diagnostics=gpuInfo.diagnostics||{};
 openDialog('Возможности этого устройства',`<p>Отрисовка: <strong>${h(backendLabel)}</strong>. Compute: <strong>${gpuInfo.supported?'WebGPU доступен':'недоступен'}</strong>.</p>${gpuInfo.reason?`<p>${h(gpuInfo.reason)}</p>`:''}${Object.entries(diagnostics).map(([key,value])=>`<div class="capability-row"><span>${h(key)}<small style="display:block">${h(value.note)}</small></span><strong>${value.supported?'ОБНАРУЖЕНО':'НЕ ОБНАРУЖЕНО'}</strong></div>`).join('')}<h3>Статус новых возможностей</h3>${CAPABILITY_NOTES.map(n=>`<div class="source-card"><strong>${h(n.title)}</strong><small>${h(n.status)}</small><p>${h(n.detail)}</p></div>`).join('')}<p>buffer_view, immediates и HTML-in-Canvas здесь диагностируются. Они не требуются для базового опыта и не заявляются как универсально доступные. Subgroup-size-control доступен в GPU-сцене только при поддержке адаптера.</p>`);
}
function showProtocol(){
 if(report?.environment?.execution==='native'){
  openDialog('Протокол импортированного нативного запуска',`<p>Этот отчёт получен внешней C++/OpenMP-программой. Импорт проверяет структуру, исходные выборки, контроль результата и согласованность статистики; он не повторяет измерение.</p><p>${report.experiment==='native-false-sharing'?'Эксперимент false sharing: потоки увеличивают независимые атомарные счётчики с relaxed-порядком. Сравниваются плотная (packed) и разнесённая (padded) раскладки. Размер задачи — инкременты на поток. Размер кеш-линии является заданным предположением.':'Сравниваются последовательная и OpenMP-реализации uint32 kernel. Массивы предварительно выделены; граница таймера отличается от браузерного end-to-end.'}</p><h3>Граница таймера из отчёта</h3><p>${h(report.rows[0]?.timingScope)}</p><pre class="code-preview">${h(JSON.stringify(report.environment,null,2))}</pre><p>Форма справа запускает новый браузерный эксперимент с собственной задачей и протоколом.</p>`);return;
 }
 openDialog('Что именно измеряет обсерватория',`<p>Все браузерные способы получают один воспроизводимый массив uint32, выполняют одинаковое целочисленное преобразование и сумму по модулю 2³². Проверяются все выходные элементы и сумма.</p><p>Первое измеренное время включает создание backend и первый прогон; оно не гарантирует пустые аппаратные кеши. Каждая тёплая выборка измеряет полную операцию. JS: выделение выхода и вычисления; Workers: разделение, передачу, вычисления и сборку; GPU: загрузку, dispatch, редукцию и чтение.</p><p>Генерация входа и проверка результата находятся вне таймера. Отрисовка остановлена. Интервал Student-t 95% относится к среднему; медиана показывается отдельно. Выборки могут быть зависимыми — это исследовательская оценка данного устройства.</p><p>Если доступен timestamp-query, дополнительный интервал GPU-pass показан отдельно. Он не заменяет полное время.</p><p>Для выводов о масштабировании меняйте размер входа. Ускорение относительно JS не означает ускорение относительно нативной OpenMP-программы.</p>${report?`<div class="table-scroll"><pre class="code-preview">${h(JSON.stringify(report.environment,null,2))}</pre></div>`:''}`);
}
function showNative(){openDialog('Нативный эксперимент C++ / OpenMP',`<p>В репозитории есть отдельный компилируемый стенд. Сначала запускаются проверки корректности, затем собирается собственный JSON-отчёт. Браузер не притворяется OpenMP.</p><pre class="code-preview">git clone https://github.com/SkyProse/ParallelProgrammingTex.git
cd ParallelProgrammingTex
git switch feature/theatre-webgl-finale
bash native/run.sh --size 262144 --threads 4 --repetitions 7 &gt; native-results.json</pre><p>Откройте «Импорт» и выберите JSON. Он получит отметку «ИМПОРТ»: измерения не повторяются и происхождение не удостоверяется автоматически. Полный протокол и отдельный false-sharing эксперимент описаны в <a href="https://github.com/SkyProse/ParallelProgrammingTex/tree/feature/theatre-webgl-finale/native" target="_blank" rel="noreferrer">native/ ↗</a>.</p>`);}
function download(name,text){const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
function exportData(){
 if(controller)download(`concurrency-${scene.id}.json`,encodeSession(controller.snapshot()));
 else if(scene.id==='benchmark'&&report)download('concurrency-measurements.json',JSON.stringify(report,null,2));
 else if(scene.id==='gpu'&&gpuResult)download('concurrency-gpu-dispatch.json',JSON.stringify({schemaVersion:1,kind:'gpu-dispatch',createdAt:new Date().toISOString(),...gpuResult,kind:'gpu-dispatch'},null,2));
 else toast('Сначала выполните эксперимент, чтобы появились данные.');
}
async function importData(file){
 if(!file)return;
 try{
  if(file.size>2_000_000)throw Error('Допустим JSON до 2 МБ.');const text=await file.text();const data=JSON.parse(text);
  if(data.kind==='model-trace'){
   const session=decodeSession(text);const next=new Controller(session.scene,session.config);next.load(session);
   navigate(session.scene,{initial:false});controller=next;if(scene.id==='deadlock')graph=exploreDeadlock(controller.config);renderConfiguration();render();toast('Запись проверена и воспроизведена из начального состояния.');
  }else if(data.kind==='gpu-dispatch'){
   gpuResult=validateLoomDocument(data);gpuConfig={count:gpuResult.count??256,workgroupSize:gpuResult.workgroupSize??64,subgroupSize:gpuResult.requestedSubgroupSize??'auto'};navigate('gpu');toast('Импортирована структура GPU-dispatch. Запуск на этом устройстве не подтверждается.');
  }else{
   const input={...data,kind:data.kind==='imported'?'measured':data.kind};validateBenchmarkDocument(input);report=validateMeasuredImport(input);
   for(const row of report.rows)if(row.samples?.length)row.summary=summarize(row.samples);
   navigate('benchmark');toast('Отчёт импортирован. Интервалы пересчитаны из сырых выборок.');
  }
 }catch(error){toast(`Не удалось импортировать: ${error.message}`);}
 finally{$('import-file').value='';}
}

$('scene-nav').addEventListener('click',e=>{const target=e.target.closest('[data-scene]');if(target)navigate(target.dataset.scene);});
$('configuration').addEventListener('click',e=>{const config=e.target.closest('[data-config]'),pre=e.target.closest('[data-preset]');if(config)changeConfig(config.dataset.config,['ordered','weak'].includes(config.dataset.config)?config.dataset.value==='true':config.dataset.value);if(pre)preset(pre.dataset.preset);if(e.target.id==='show-protocol')showProtocol();});
$('configuration').addEventListener('change',e=>{const keys={'memory-layout':'layout','line-size':'lineSize','memory-count':'count','memory-padding':'padding'};if(keys[e.target.id])changeConfig(keys[e.target.id],e.target.id==='memory-layout'?e.target.value:Number(e.target.value));});
$('inspector').addEventListener('click',e=>{
 const actor=e.target.closest('[data-actor]'),spurious=e.target.closest('[data-spurious]');if(actor)act(Number(actor.dataset.actor));if(spurious)act(Number(spurious.dataset.spurious),true);
 if(e.target.id==='run-gpu')runGPU();if(e.target.id==='run-benchmark')startBenchmark();if(['cancel-benchmark','cancel-gpu'].includes(e.target.id))job?.abort();if(e.target.id==='gpu-details')openDialog('Данные GPU-dispatch',renderGPUScore());if(e.target.id==='native-instructions')showNative();
 if(e.target.id==='inspect-object'){
  if(scene.id==='memory')selectObject({type:'memory',address:Number($('inspect-address').value)});
  else if(scene.id==='gpu'){
   const field=$('inspect-invocation');
   if(!field.reportValidity())return;
   const item=inspectInvocation(gpuResult,Number(field.value));
   if(item)selectObject(item);else toast('Выберите номер из текущего результата dispatch.');
  }
 }
});
$('inspector').addEventListener('change',e=>{if(e.target.id==='access-mode'){stop();branches.set(scene.id,controller.snapshot());controller.discardFuture();memoryMode=e.target.value;render();toast('Тип обращений изменён. Новые шаги образуют отдельную ветку; прежняя запись сохранена для сравнения.');}const key={'gpu-count':'count','gpu-workgroup':'workgroupSize','gpu-subgroup':'subgroupSize'}[e.target.id];if(key)gpuConfig[key]=e.target.value==='auto'?'auto':Number(e.target.value);const benchKey={'bench-sizes':'sizes','bench-repetitions':'repetitions','bench-workers':'workers'}[e.target.id];if(benchKey)benchConfig[benchKey]=benchKey==='sizes'?e.target.value:Number(e.target.value);});
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.view;render();}));
$('reset-camera').addEventListener('click',()=>{$('camera-preset').value='overview';world?.resetCamera();});
$('camera-preset').addEventListener('change',e=>world?.setCameraPreset(e.target.value));
$('render-quality').addEventListener('change',e=>world?.setQuality(e.target.value));
$('retry-renderer').addEventListener('click',async()=>{if(busy)return;$('retry-renderer').disabled=true;await world?.retry();render();});
$('focus-stage').addEventListener('click',()=>toggleFocus());
$('close-selection').addEventListener('click',()=>{selection=null;renderSelection();$('inspect-object')?.focus({preventScroll:true});});
const zoomButton=document.createElement('button');zoomButton.id='zoom-graph';zoomButton.className='icon-button';zoomButton.setAttribute('aria-label','Развернуть исполнение в пространственный граф всех состояний');zoomButton.setAttribute('aria-pressed','false');zoomButton.title='Семантический масштаб: все состояния';zoomButton.textContent='◎';$('reset-camera').before(zoomButton);zoomButton.addEventListener('click',()=>{graphMode=!graphMode;render();});
$('back').addEventListener('click',()=>{stop();if(controller.cursor)controller.seek(controller.cursor-1);render();});
$('rewind').addEventListener('click',()=>{stop();controller.seek(0);render();});
$('next').addEventListener('click',()=>{stop();nextStep();});$('play').addEventListener('click',togglePlay);
$('timeline').addEventListener('input',e=>{stop();controller.seek(Number(e.target.value));render();});
$('save-branch').addEventListener('click',()=>{branches.set(scene.id,controller.snapshot());render();toast('Ветка сохранена. Вернитесь назад и выберите другой поток.');});
$('compare-branch').addEventListener('click',()=>{$('comparison').innerHTML=renderComparison(branches.get(scene.id),controller.snapshot());$('comparison').hidden=false;});
$('reset-scene').addEventListener('click',()=>{stop();controller=new Controller(scene.id,controller.config);render();});
const selectGraphNode=e=>{const node=e.target.closest('[data-node]');if(node){if(e.type==='keydown'&&!['Enter',' '].includes(e.key))return;e.preventDefault();graphSelect(node.dataset.node);}};
$('alternative-view').addEventListener('click',selectGraphNode);$('alternative-view').addEventListener('keydown',selectGraphNode);
$('challenge').addEventListener('click',e=>{const option=e.target.closest('[data-answer]');if(option)answer(option.dataset.answer);if(e.target.id==='next-question'){quizStage.set(scene.id,'transfer');renderChallenge();}});
$('open-source').addEventListener('click',showSource);$('open-about').addEventListener('click',showAbout);$('open-capabilities').addEventListener('click',showCapabilities);$('close-dialog').addEventListener('click',closeDialog);
$('detail-dialog').addEventListener('click',e=>{if(e.target===$('detail-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();}});
$('export-button').addEventListener('click',exportData);$('import-button').addEventListener('click',()=>$('import-file').click());$('import-file').addEventListener('change',e=>importData(e.target.files[0]));
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&focusMode&&!$('detail-dialog').open){e.preventDefault();toggleFocus(false);return;}
 if($('detail-dialog').open||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,select,textarea,button,a,summary,[role="button"]')||!controller||busy)return;
 if(e.key==='1'||e.key==='2'){e.preventDefault();act(Number(e.key)-1);}if(e.key==='ArrowLeft'){e.preventDefault();$('back').click();}if(e.key==='ArrowRight'){e.preventDefault();$('next').click();}if(e.key===' '){e.preventDefault();togglePlay();}if(e.key.toLowerCase()==='r'){e.preventDefault();$('rewind').click();}
});
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();if(busy)job?.abort();world?.setPaused(true);}else if(!busy)world?.setPaused(false);});
window.addEventListener('pagehide',event=>{stop();job?.abort();if(event.persisted)world?.setPaused(true);else world?.dispose();});
window.addEventListener('pageshow',event=>{if(event.persisted&&!document.hidden){world?.setPaused(false);render();}});

navigate(SCENES.some(s=>s.id===location.hash.slice(1))?location.hash.slice(1):'deadlock');
try{
 const {TheatreRenderer}=await import('./renderer.js');
 world=new TheatreRenderer({canvas:$('world'),labels:$('world-labels'),onAction:act,onNode:graphSelect,onInspect:selectObject,onStateChange:updateRenderState,onBackend:label=>{backendLabel=label;$('renderer-label').textContent=label;}});
 world.setPaused(busy||document.hidden);
 await world.init();render();
}catch(error){backendLabel='2D / текст';renderState='unavailable';console.warn('3D renderer unavailable; accessible views remain active.',error);render();}
probeGPU().then(info=>{gpuInfo=info;if(scene.id==='gpu'&&!busy)renderInspector();}).catch(()=>{});
