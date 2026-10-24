import {test,expect} from '@playwright/test';
import {summarize} from '../src/compute/stats.js';

async function disableGPU(page){
 // Deliberately exercise the documented unavailable-GPU path. These tests do
 // not claim any WebGL or WebGPU execution.
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true});
  const original=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(type,...args){
   if(type==='webgl2'||type==='webgpu')return null;
   return original.call(this,type,...args);
  };
 });
}

test('memory objects remain inspectable by keyboard when 3D is unavailable',async({page})=>{
 await disableGPU(page);
 await page.goto('/#memory');
 await expect(page.locator('#alternative-view')).toBeVisible();
 await page.locator('#inspect-address').selectOption('1');
 await page.locator('#inspect-object').focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('#selection-card')).toContainText('b[0]');
 await expect(page.locator('#selection-card .inspection-facts > div').filter({hasText:'Адрес'}).locator('dd')).toHaveText('+1 Б');
 await expect(page.locator('#selection-card .inspection-facts > div').filter({hasText:'Кеш-линия'}).locator('dd')).toHaveText('L0 · 0–63 Б');
 await expect(page.locator('#retry-renderer')).toBeVisible();
 await page.locator('#retry-renderer').click();
 await expect(page.locator('#alternative-view')).toBeVisible();
 await expect(page.locator('#render-status')).toContainText(/недоступ|не удалось|2D/i);
});

test('mobile focused mode keeps its exit, timeline and readable layout',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await disableGPU(page);
 await page.goto('/#deadlock');
 await expect(page.locator('#alternative-view')).toBeVisible();
 await page.locator('#focus-stage').click();
 await expect(page.locator('.experiment')).toHaveClass(/is-focused/);
 await expect(page.locator('#focus-stage')).toBeVisible();
 await expect(page.locator('#transport')).toBeVisible();
 await page.locator('#back').click();
 await page.getByRole('button',{name:'Шаг T0 →',exact:true}).click();
 await expect(page.locator('#event-caption')).toContainText('T0 захватил B');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('mobile-focused-fallback.png'),fullPage:true});
 await page.keyboard.press('Escape');
 await expect(page.locator('.experiment')).not.toHaveClass(/is-focused/);
 await expect(page.locator('#scene-title')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('changing memory access after rewind replaces the old future with reads',async({page})=>{
 await page.goto('/#memory');
 await expect(page.locator('#step-count')).toHaveText('4 / 4');
 await expect(page.locator('#metrics .metric-value').first()).toHaveText('3');
 await page.locator('#rewind').click();
 await page.locator('#access-mode').selectOption('readonly');
 await expect(page.locator('#step-count')).toHaveText('0 / 0');
 await page.locator('#next').click();
 await expect(page.locator('#event-caption')).toContainText('чтение');
 await expect(page.locator('#metrics .metric-value').first()).toHaveText('0');
 await page.locator('#next').click();
 await expect(page.locator('#event-caption')).toContainText('чтение');
 await expect(page.locator('#metrics .metric-value').first()).toHaveText('0');
});

test('returning to memory honours the retained readonly mode in its initial schedule',async({page})=>{
 await page.goto('/#memory');
 await page.locator('#access-mode').selectOption('readonly');
 await page.locator('[data-scene="deadlock"]').click();
 await page.locator('[data-scene="memory"]').click();
 await expect(page.locator('#access-mode')).toHaveValue('readonly');
 await expect(page.locator('#step-count')).toHaveText('4 / 4');
 await expect(page.locator('#event-caption')).toContainText('чтение');
 await expect(page.locator('#metrics .metric-value').first()).toHaveText('0');
});

test('native false-sharing import retains its own protocol and external provenance',async({page})=>{
 const samples=[1,2,3];
 // Valid synthetic external report tests the import UI, not native timing.
 const document={schemaVersion:1,kind:'measured',experiment:'native-false-sharing',createdAt:'2026-10-24T00:00:00.000Z',environment:{execution:'native'},rows:[{
  size:100,backend:'native-false-sharing',status:'ok',samples,summary:summarize(samples),coldMs:4,
  timingScope:'synthetic fixture of native wall time',workerCount:2,
  correctness:{verified:true,counters:[100,100],expectedPerCounter:100},
  layout:{name:'padded',strideBytes:64,assumedLineBytes:64,baseAlignmentBytes:256,offsetBytes:[0,64]}
 }]};
 await page.goto('/#benchmark');
 await page.locator('#import-file').setInputFiles({name:'synthetic-native-memory.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});
 await expect(page.locator('#data-kind')).toHaveText('ИМПОРТ');
 await expect(page.locator('#alternative-view')).toContainText('padded · stride 64 Б');
 await expect(page.locator('#alternative-view')).toContainText('Инкрементов / поток');
 await expect(page.locator('#configuration')).toContainText(/packed.*padded/i);
 await page.locator('#show-protocol').click();
 await expect(page.locator('#detail-dialog')).toBeVisible();
 await expect(page.locator('#dialog-content')).toContainText(/false.sharing|ложн.*совмест/i);
 await expect(page.locator('#dialog-content')).toContainText(/padded|64/);
 await expect(page.locator('#dialog-content')).not.toContainText('u32-mix-reduce-v1');
});
