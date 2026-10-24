import {test,expect} from '@playwright/test';

const graphicsErrors=new WeakMap();
test.beforeEach(async({page})=>{
 const errors=[];graphicsErrors.set(page,errors);
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{
  if(message.type()==='error'&&/shader|program|compil|THREE|GL_INVALID|validation/i.test(message.text()))errors.push(message.text());
 });
});
test.afterEach(async({page})=>{
 if(test.info().status!==test.info().expectedStatus&&!page.isClosed()){
  const state=await diagnostics(page).catch(error=>({diagnosticsError:error.message}));
  await test.info().attach('runtime-after-failure',{body:JSON.stringify(state,null,2),contentType:'application/json'});
 }
 // A visible canvas alone does not prove that its shader pipeline compiled.
 expect(graphicsErrors.get(page)??[]).toEqual([]);
});

async function diagnostics(page){
 return page.evaluate(async()=>{
  const {getRuntimeDiagnostics}=await import('/src/app.js');
  return getRuntimeDiagnostics();
 });
}

async function readyWebGL(page,hash='deadlock'){
 await page.goto(`/?renderer=webgl#${hash}`);
 await expect(page.locator('#renderer-label')).toHaveText('WebGL 2 · TSL');
 await expect(page.locator('#world')).toBeVisible();
 await expect.poll(async()=>(await diagnostics(page)).renderer?.status).toBe('ready');
}

async function labelCollisions(page){
 return page.evaluate(()=>{
  const viewport=document.querySelector('#viewport').getBoundingClientRect();
  const labels=[...document.querySelectorAll('#world-labels .world-label')].filter(el=>getComputedStyle(el).display!=='none').map(el=>({text:el.textContent,rect:el.getBoundingClientRect()})).filter(x=>x.rect.width>0&&x.rect.height>0);
  const issues=[];
  for(let i=0;i<labels.length;i++){
   const a=labels[i];
   if(a.rect.left<viewport.left||a.rect.right>viewport.right||a.rect.top<viewport.top||a.rect.bottom>viewport.bottom)issues.push(`outside: ${a.text}`);
   for(const b of labels.slice(i+1)){
    const width=Math.min(a.rect.right,b.rect.right)-Math.max(a.rect.left,b.rect.left);
    const height=Math.min(a.rect.bottom,b.rect.bottom)-Math.max(a.rect.top,b.rect.top);
    if(width>1&&height>1)issues.push(`${a.text} overlaps ${b.text}`);
   }
  }
  return {count:labels.length,issues};
 });
}

test('spatial labels remain readable and inside the stage across dense scenes',async({page})=>{
 await readyWebGL(page);
 await expect.poll(async()=>(await labelCollisions(page)).issues).toEqual([]);
 expect((await labelCollisions(page)).count).toBeGreaterThan(2);
 await page.locator('#zoom-graph').click();
 await expect.poll(async()=>(await labelCollisions(page)).issues).toEqual([]);
 await page.locator('[data-scene="memory"]').click();
 await expect.poll(async()=>(await labelCollisions(page)).issues).toEqual([]);
 expect((await labelCollisions(page)).count).toBeGreaterThan(2);
 await page.locator('#inspect-address').selectOption('1');await page.locator('#inspect-object').click();
 await expect(page.locator('#selection-card')).toContainText('b[0]');
 await page.screenshot({path:test.info().outputPath('memory-inspection-readable.png'),fullPage:true});
});

test('real WebGL context loss preserves a live model and restores the latest state',async({page})=>{
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await readyWebGL(page);
 await page.locator('#back').click();
 await expect(page.locator('#step-count')).toHaveText('1 / 2');

 // WEBGL_lose_context is a real browser extension. This test does not replace
 // the renderer, its context, or its loss events with stubs.
 const canLose=await page.evaluate(()=>{
  const gl=document.querySelector('#world').getContext('webgl2');
  window.__theatreContextLoss=gl?.getExtension('WEBGL_lose_context');
  return Boolean(window.__theatreContextLoss);
 });
 test.skip(!canLose,'The actual WebGL driver does not expose WEBGL_lose_context.');
 await page.evaluate(()=>window.__theatreContextLoss.loseContext());
 await expect.poll(async()=>(await diagnostics(page)).renderer?.status).toBe('lost');
 await expect(page.locator('#alternative-view')).toBeVisible();
 await expect(page.locator('#world')).toBeHidden();
 await expect(page.locator('#render-status')).toContainText(/потер|недоступ|восстанов/i);
 await expect(page.locator('#step-count')).toHaveText('1 / 2');

 // Intervene while the drawing buffer is unavailable. Recovery must render
 // this new state, not the state captured at the moment of the GPU failure.
 await page.getByRole('button',{name:'Шаг T0 →',exact:true}).click();
 await expect(page.locator('#event-caption')).toContainText('T0 захватил B');
 const cursor=(await diagnostics(page)).cursor;
 expect(cursor).toBe(2);
 await page.evaluate(()=>window.__theatreContextLoss.restoreContext());
 await expect.poll(async()=>(await diagnostics(page)).renderer?.status,{timeout:20000}).toBe('ready');
 await expect(page.locator('#world')).toBeVisible();
 await expect(page.locator('#alternative-view')).toBeHidden();
 await expect(page.locator('#renderer-label')).toHaveText('WebGL 2 · TSL');
 await expect(page.locator('#world-labels')).toContainText('владелец T0');
 expect((await diagnostics(page)).cursor).toBe(cursor);
 await expect(page.locator('#event-caption')).toContainText('T0 захватил B');
 expect(errors).toEqual([]);
 await page.screenshot({path:test.info().outputPath('restored-webgl.png'),fullPage:true});
});

test('quality and camera controls change the presentation without advancing execution',async({page})=>{
 await readyWebGL(page,'race');
 await page.getByRole('button',{name:'Потерять обновление ↗',exact:true}).click();
 await expect(page.locator('#metrics .metric-value').first()).toHaveText('1');
 const before=await diagnostics(page);
 const caption=await page.locator('#event-caption').textContent();

 await page.locator('#render-quality').selectOption('low');
 await expect.poll(async()=>(await diagnostics(page)).renderer?.quality).toBe('low');
 const low=(await diagnostics(page)).renderer.pixelRatio;
 for(const preset of ['top','detail','overview']){
  await page.locator('#camera-preset').selectOption(preset);
  await expect.poll(async()=>(await diagnostics(page)).renderer?.cameraPreset).toBe(preset);
  expect((await diagnostics(page)).cursor).toBe(before.cursor);
 }
 await page.locator('#render-quality').selectOption('high');
 await expect.poll(async()=>(await diagnostics(page)).renderer?.quality).toBe('high');
 expect((await diagnostics(page)).renderer.pixelRatio).toBeGreaterThanOrEqual(low);
 await page.locator('#render-quality').selectOption('auto');
 await expect.poll(async()=>(await diagnostics(page)).renderer?.quality).toBe('auto');
 expect((await diagnostics(page)).cursor).toBe(before.cursor);
 await expect(page.locator('#event-caption')).toHaveText(caption);
 await expect(page.locator('#metrics .metric-value').first()).toHaveText('1');
});

test('reduced motion renders a changed snapshot and then stops requesting frames',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await readyWebGL(page,'race');
 await expect.poll(async()=>(await diagnostics(page)).renderer?.pendingFrame).toBe(false);
 expect((await diagnostics(page)).renderer.motion).toBe(false);
 const first=(await diagnostics(page)).renderer.renderCount;
 await page.getByRole('button',{name:'Шаг T0 →',exact:true}).click();
 await expect.poll(async()=>(await diagnostics(page)).renderer?.renderCount).toBeGreaterThan(first);
 await expect.poll(async()=>(await diagnostics(page)).renderer?.pendingFrame).toBe(false);
 const settled=await diagnostics(page);
 // A bounded quiet window detects a permanent decorative render loop.
 await page.waitForTimeout(180);
 const later=await diagnostics(page);
 expect(later.renderer.renderCount).toBe(settled.renderer.renderCount);
 expect(later.cursor).toBe(settled.cursor);
 expect(later.renderer.pendingFrame).toBe(false);
});

test('an imported GPU mapping stays labelled as imported and supports the last instance',async({page})=>{
 await readyWebGL(page,'gpu');
 const count=4096,workgroupSize=64;
 // Synthetic import fixture: this verifies viewing and inspection, not a GPU
 // computation. The separate real-dispatch test exercises actual WebGPU.
 const document={
  schemaVersion:1,kind:'gpu-dispatch',status:'ok',createdAt:'2026-10-24T00:00:00.000Z',
  count,workgroupSize,requestedSubgroupSize:null,elapsedMs:1,timingScope:'synthetic e2e import fixture',
  values:Array.from({length:count},(_,globalId)=>({globalId,localId:globalId%workgroupSize,workgroupId:Math.floor(globalId/workgroupSize)})),
  workgroups:Array.from({length:count/workgroupSize},(_,id)=>({id,invocations:Array.from({length:workgroupSize},(_,localId)=>id*workgroupSize+localId)})),
  subgroupSizes:[],features:[],diagnostics:{},correctness:{verified:true}
 };
 await page.locator('#import-file').setInputFiles({name:'synthetic-mapping.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});
 await expect(page.locator('#data-kind')).toHaveText('ИМПОРТ');
 await expect(page.locator('#world-labels')).toContainText('4096');
 await page.locator('#inspect-invocation').fill('4095');
 await page.locator('#inspect-object').click();
 await expect(page.locator('#selection-card')).toContainText('GPU-вызов 4095');
 await expect(page.locator('#selection-card .inspection-facts > div').filter({hasText:'global ID'}).locator('dd')).toHaveText('4095');
 await expect(page.locator('#selection-card .inspection-facts > div').filter({hasText:'workgroup ID'}).locator('dd')).toHaveText('63');
 await expect(page.locator('#selection-card .inspection-facts > div').filter({hasText:'local ID'}).locator('dd')).toHaveText('63');
 await expect(page.locator('#selection-card')).toContainText(/ИМПОРТ/i);
 const state=await diagnostics(page);
 expect(state.renderer.scene).toBe('gpu');
 // Thousands of repeated cells must stay instanced instead of thousands of
 // individual draw calls. The generous ceiling allows the theatre set too.
 expect(state.renderer.drawCalls).toBeGreaterThan(0);
 expect(state.renderer.drawCalls).toBeLessThan(100);
 await expect.poll(async()=>(await labelCollisions(page)).issues).toEqual([]);
 await test.info().attach('render-diagnostics',{body:JSON.stringify(state,null,2),contentType:'application/json'});
 await page.screenshot({path:test.info().outputPath('gpu-invocation-inspection.png'),fullPage:true});
});
