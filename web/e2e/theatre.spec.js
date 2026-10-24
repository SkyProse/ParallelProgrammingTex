import {test,expect} from '@playwright/test';

test('deadlock: rewind, intervention, compare and exact graph all work together',async({page})=>{
 await page.goto('/');
 await expect(page.locator('#inspector')).toContainText('Взаимная блокировка');
 await expect(page.locator('#metrics')).toContainText('23');
 await page.getByRole('button',{name:'Запомнить ветку',exact:true}).click();
 await page.getByRole('button',{name:'На шаг назад',exact:true}).click();
 await page.getByRole('button',{name:'Шаг T0 →',exact:true}).click();
 await expect(page.locator('#event-caption')).toContainText('T0 захватил B');
 await page.getByRole('button',{name:'Сравнить',exact:true}).click();
 await expect(page.locator('#comparison')).toContainText('Общий префикс: 1');
 await page.getByRole('button',{name:'A → B / A → B',exact:true}).click();
 await expect(page.locator('#metrics .metric-value').nth(0)).toHaveText('20');
 await expect(page.locator('#metrics .metric-value').nth(1)).toHaveText('0');
 await page.getByRole('button',{name:'Все будущие',exact:true}).click();
 await expect(page.locator('[data-node]')).toHaveCount(20);
 await page.locator('[data-node]').last().focus();await page.keyboard.press('Enter');
 await expect(page.locator('#inspector')).toContainText('Исполнение завершено');
});

test('memory intervention changes coherence and automatic readonly obeys the selected mode',async({page})=>{
 await page.goto('/#memory');
 await expect(page.locator('#metrics .metric-value').nth(0)).toHaveText('3');
 await page.locator('#memory-layout').selectOption('soa');
 await expect(page.locator('#metrics .metric-value').nth(0)).toHaveText('0');
 await expect(page.locator('#metrics .metric-value').nth(1)).toHaveText('72 Б');
 await page.getByRole('button',{name:'Сначала ↺',exact:true}).click();
 await page.locator('#access-mode').selectOption('readonly');
 await page.getByRole('button',{name:'Следующий допустимый шаг',exact:true}).click();
 await expect(page.locator('#event-caption')).toContainText('чтение');
 await page.locator('#memory-count').selectOption('4');
 await expect(page.locator('#step-count')).toHaveText('0 / 0');
});

test('race contract, CAS helping and learning progression remain usable',async({page})=>{
 await page.goto('/#race');
 await page.getByRole('button',{name:'Потерять обновление ↗',exact:true}).click();
 await expect(page.locator('#metrics .metric-value').first()).toHaveText('1');
 await page.getByRole('button',{name:'Атомарное +1',exact:true}).click();
 await expect(page.locator('#metrics .metric-value').first()).toHaveText('2');
 await page.getByRole('button',{name:'Локальный снимок',exact:true}).click();
 await expect(page.locator('#metrics .metric-value').first()).toHaveText('0');
 await page.locator('[data-scene="cas"]').click();
 await page.getByRole('button',{name:'Отставший хвост ↗',exact:true}).click();
 await page.getByRole('button',{name:'Вызвать spurious failure',exact:true}).click();
 await expect(page.locator('#event-caption')).toContainText('отказ');
 await page.locator('[data-scene="deadlock"]').click();
 await page.locator('[data-answer="ordered"]').click();
 await page.getByRole('button',{name:'Проверить на другой ситуации →',exact:true}).click();
 await page.locator('[data-answer="waiting"]').click();
 await expect(page.locator('#progress-count')).toHaveText('1 / 6');
 await page.reload();await expect(page.locator('#progress-count')).toHaveText('1 / 6');
});

test('real browser JS/Workers/GPU measurement validates each output and keeps controls',async({page})=>{
 await page.goto('/#benchmark');
 await page.locator('#bench-sizes').selectOption('small');await page.locator('#bench-repetitions').selectOption('3');
 await page.getByRole('button',{name:'Начать эксперимент →',exact:true}).click();
 await expect(page.getByRole('button',{name:'Начать эксперимент →',exact:true})).toBeEnabled({timeout:90000});
 await expect(page.locator('#bench-sizes')).toHaveValue('small');await expect(page.locator('#bench-repetitions')).toHaveValue('3');
 const report=await page.evaluate(async()=>{const {runBenchmark}=await import('/src/compute/benchmark.js');return runBenchmark({sizes:[257],repetitions:3});});
 expect(report.rows.find(r=>r.backend==='js').status).toBe('ok');
 expect(report.rows.find(r=>r.backend==='workers').status).toBe('ok');
 for(const row of report.rows){if(row.status==='ok'){expect(row.correctness.verified).toBe(true);expect(row.samples).toHaveLength(3);}else expect(row.samples).toEqual([]);}
 await test.info().attach('browser-measurements',{body:JSON.stringify(report,null,2),contentType:'application/json'});
});

test('GPU loom actually compiles WGSL and reports mapping when adapter is available',async({page})=>{
 await page.goto('/#gpu');
 const probe=await page.evaluate(async()=>{const {probeGPU}=await import('/src/compute/gpu.js');return probeGPU();});
 await test.info().attach('gpu-capabilities',{body:JSON.stringify(probe,null,2),contentType:'application/json'});
 test.skip(!probe.supported,'This runner has no WebGPU adapter; no GPU result is claimed.');
 await page.locator('#gpu-count').selectOption('65');await page.getByRole('button',{name:'Выполнить на GPU →',exact:true}).click();
 await expect(page.locator('#metrics .metric-value').first()).toHaveText('65',{timeout:30000});
 await expect(page.locator('#gpu-count')).toHaveValue('65');
 const result=await page.evaluate(async()=>{const {runGPULoom}=await import('/src/compute/gpu.js');return runGPULoom({count:65,workgroupSize:64});});
 expect(result.status).toBe('ok');expect(result.values).toHaveLength(65);expect(result.values[64]).toMatchObject({globalId:64,localId:0,workgroupId:1});
 await test.info().attach('gpu-dispatch',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});

test('WebGL fallback renders the real scene without uncaught errors',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?renderer=webgl#deadlock');
 await expect(page.locator('#renderer-label')).toHaveText('WebGL 2 · TSL');
 await expect(page.locator('#world')).toBeVisible();
 await page.getByRole('button',{name:'Развернуть исполнение в пространственный граф всех состояний',exact:true}).click();
 await expect(page.locator('#world-labels')).toContainText('23 СОСТОЯНИЙ');
 expect(errors).toEqual([]);
 await page.screenshot({path:test.info().outputPath('state-space.png')});
});

test('mobile layout, no-GPU fallback and keyboard controls keep the same semantics',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{Object.defineProperty(navigator,'gpu',{value:undefined});const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...rest){if(type==='webgl2'||type==='webgpu')return null;return original.call(this,type,...rest);};});
 await page.goto('/');await expect(page.locator('#alternative-view')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'На шаг назад',exact:true}).click();
 await page.getByRole('button',{name:'Шаг T0 →',exact:true}).click();
 await expect(page.locator('#event-caption')).toContainText('T0 захватил B');
 await page.locator('#scene-title').focus();await page.keyboard.press('ArrowLeft');await expect(page.locator('#step-count')).toHaveText('1 / 2');
 await page.screenshot({path:test.info().outputPath('mobile-fallback.png'),fullPage:true});
});
