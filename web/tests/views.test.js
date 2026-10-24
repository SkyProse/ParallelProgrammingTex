import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHTML, renderScore, renderGraph, renderMeasurements, renderComparison } from '../src/views.js';
import * as viewFunctions from '../src/views.js';
import { createDeadlock, stepDeadlock, exploreDeadlock } from '../src/core/deadlock.js';
import { createRace, stepRace } from '../src/core/race.js';
import { createCache, cacheAccess } from '../src/core/cache.js';
import { createCAS, stepCAS } from '../src/core/cas.js';

const xss = '<img src=x onerror="alert(1)">';
const row = overrides => ({
  size: 1024, backend: 'js', status: 'ok', samples: [1,2,3], coldMs: 8,
  summary: { median: 2, mean: 2, ci95: [-0.48,4.48], n: 3, min: 1, max: 3, stddev: 1 },
  correctness: { verified: true, checks: 4, sum: 12, expectedSum: 12, checksum: 34, expectedChecksum: 34 },
  timingScope: 'whole task', ...overrides,
});

test('HTML renderer escapes text and attribute delimiters without trusting source labels', () => {
  assert.equal(escapeHTML('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  const state = stepDeadlock(createDeadlock(), 0);
  state.events[0].label = xss;
  const html = renderScore('deadlock', state);
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('T0'));
});

test('score renders both actors, instructions and exact shared state without mutation', () => {
  const models = [
    ['deadlock', stepDeadlock(createDeadlock(), 0)],
    ['race', stepRace(createRace(), 0)],
    ['memory', cacheAccess(createCache(), {thread:0,index:0,field:'a'})],
    ['cas', stepCAS(createCAS(), 0)],
  ];
  for (const [scene, state] of models) {
    const before = structuredClone(state);
    const html = renderScore(scene, state);
    assert.match(html, /score-grid/);
    assert.match(html, /T0/);
    assert.match(html, /T1/);
    assert.match(html, /score-state/);
    assert.deepEqual(state, before);
  }
  assert.match(renderScore('race', createRace({mode:'snapshot'})), /сним|локаль/i);
  assert.match(renderScore('cas', createCAS()), /dummy/);
});

test('even malformed imported display fields cannot become score or SVG markup', () => {
  const memory = createCache();
  memory.memory.bytes = xss;
  memory.memory.objects[0].address = xss;
  memory.metrics.accesses = xss;
  assert.ok(!renderScore('memory', memory).includes('<img'));
  const graph = exploreDeadlock();
  graph.nodes[0].state.pcs[0] = xss;
  assert.ok(!renderGraph(graph, createDeadlock()).includes('<img'));
});

test('graphs expose exactly 23 or 20 keyboard reachable state buttons and directed edges', () => {
  for (const ordered of [false, true]) {
    const graph = exploreDeadlock({ordered});
    const html = renderGraph(graph, createDeadlock({ordered}));
    assert.equal((html.match(/class="graph-node/g) ?? []).length, ordered ? 20 : 23);
    assert.equal((html.match(/role="button"/g) ?? []).length, ordered ? 20 : 23);
    assert.equal((html.match(/tabindex="0"/g) ?? []).length, ordered ? 20 : 23);
    assert.match(html, /marker-end=/);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /Тупик/);
  }
});

test('measurement views preserve median versus confidence interval of mean, sample count and scope', () => {
  const report = {kind:'measured',environment:{execution:'browser'},rows:[row()]};
  const before = structuredClone(report);
  const html = renderMeasurements(report);
  assert.match(html, /2\.000/);
  assert.match(html, /-0\.480/);
  assert.match(html, /4\.480/);
  assert.match(html, /ДИ среднего/);
  assert.match(html, /n=3/);
  assert.match(html, /whole task/);
  assert.match(html, /Проверено/);
  assert.match(html, /checksum/);
  assert.deepEqual(report,before);
});

test('unsupported and erroneous measurements never become zero-duration bars', () => {
  const absent = row({ backend:'webgpu',status:'unsupported',samples:[],summary:null,coldMs:null,correctness:{verified:false},reason:xss });
  const html = renderMeasurements({rows:[absent]});
  assert.match(html,/Недоступно/);
  assert.ok(!html.includes('class="bar-fill'));
  assert.ok(!html.includes('0.000'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  const error = renderMeasurements({rows:[{...absent,status:'error',reason:'device lost'}]});
  assert.match(error,/Ошибка/);
  assert.match(error,/device lost/);
  const unverified = renderMeasurements({rows:[row({correctness:{verified:false}})]});
  assert.ok(!unverified.includes('class="bar-fill'));
});

test('comparison finds shared event prefix and distinguishes configuration changes', () => {
  const first = stepDeadlock(createDeadlock(),0);
  const a = {scene:'deadlock',config:{ordered:false},actions:[0,1],cursor:2,state:stepDeadlock(first,1)};
  const b = {scene:'deadlock',config:{ordered:false},actions:[0,0],cursor:2,state:stepDeadlock(first,0)};
  const html = renderComparison(a,b);
  assert.match(html,/Общий префикс: 1/);
  assert.match(html,/порядок действий/i);
  assert.match(renderComparison(a,{...b,config:{ordered:true}}),/Изменена конфигурация/);
  const before = structuredClone(a);
  renderComparison(a,b);
  assert.deepEqual(a,before);
});

test('spatial SVG fallback preserves meaningful model diagrams for all four scenes', () => {
  const cases = [['deadlock',createDeadlock()],['race',createRace()],['memory',createCache()],['cas',createCAS()]];
  for(const [scene,state] of cases){
    const before=structuredClone(state);
    const html=viewFunctions.renderSpatialFallback(scene,state);
    assert.match(html,/<svg/);
    assert.match(html,/aria-label=/);
    assert.match(html,/T0/);
    assert.match(html,/T1/);
    assert.match(html,/МОДЕЛЬ/);
    assert.deepEqual(state,before);
  }
  const hostile=stepRace(createRace(),0);hostile.events[0].label=xss;
  assert.ok(!viewFunctions.renderSpatialFallback('race',hostile).includes('<img'));
});

test('SVG fallback draws exactly the actual ownership/wait edges and occupied cache lines', () => {
  const blocked=stepDeadlock(stepDeadlock(createDeadlock(),0),1);
  const svg=viewFunctions.renderSpatialFallback('deadlock',blocked);
  assert.equal((svg.match(/data-edge="ownership"/g)??[]).length,2);
  assert.equal((svg.match(/data-edge="wait"/g)??[]).length,2);
  for(const [layout,lines] of [['aos',1],['soa',2],['padded',16]]){
    const html=viewFunctions.renderSpatialFallback('memory',createCache({layout,count:8,lineSize:64}));
    assert.equal((html.match(/data-line="/g)??[]).length,lines);
    assert.equal((html.match(/data-address="/g)??[]).length,16);
  }
});

test('ownership arrows run from resources to holders while waiting arrows run from threads to resources',()=>{
  const state=stepDeadlock(stepDeadlock(createDeadlock(),0),1);
  const svg=viewFunctions.renderSpatialFallback('deadlock',state);
  const edges=[...svg.matchAll(/data-edge="(ownership|wait)" d="([^"]+)"/g)];
  for(const [,kind,path] of edges){
    const points=[...path.matchAll(/(-?\d+),(-?\d+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
    const start=points[0][1],end=points.at(-1)[1];
    assert.ok(kind==='ownership'?start<end:start>end,`${kind} must use the same direction in SVG and WebGL`);
  }
});

test('native false-sharing rows retain layout, stride, per-thread units and imported provenance', () => {
  const native = layout => row({backend:'native-false-sharing',size:1000,layout:{name:layout,strideBytes:layout==='packed'?8:64},correctness:{verified:true,checks:4,counters:[1000,1000],expectedPerCounter:1000}});
  const html=renderMeasurements({kind:'imported',experiment:'native-false-sharing',environment:{execution:'native'},rows:[native('packed'),native('padded')]});
  assert.match(html,/packed/);
  assert.match(html,/padded/);
  assert.match(html,/stride 64/);
  assert.match(html,/инкрементов.*поток/i);
  assert.match(html,/ИМПОРТ/);
  assert.match(html,/counters/);
});
