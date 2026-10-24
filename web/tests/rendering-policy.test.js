import test from 'node:test';
import assert from 'node:assert/strict';
import {QualityPolicy, ResourcePool, inspectGPUCell} from '../src/rendering/policy.js';

test('quality caps framebuffer pixels on high density screens and never invents device resolution',()=>{
 const q=new QualityPolicy({dpr:3,width:1600,height:1000});
 assert.ok(q.pixelRatio<=Math.sqrt(2_500_000/(1600*1000)));
 q.setMode('high');assert.equal(q.pixelRatio,2);
 q.setMode('low');assert.equal(q.pixelRatio,1);
 q.resize({dpr:.8,width:400,height:800});assert.equal(q.pixelRatio,.8);
 assert.throws(()=>q.setMode('ultra'),/quality/i);
});

test('auto quality responds to sustained frame pressure, ignores idle gaps and uses hysteresis',()=>{
 const q=new QualityPolicy({dpr:2,width:800,height:600});
 const initial=q.pixelRatio;
 for(let i=0;i<10;i++)q.observeFrame(40);
 assert.equal(q.pixelRatio,initial,'a short transient is not a downshift');
 for(let i=0;i<40;i++)q.observeFrame(40);
 assert.ok(q.pixelRatio<initial);
 const lower=q.pixelRatio;
 for(let i=0;i<100;i++)q.observeFrame(5000);
 assert.equal(q.pixelRatio,lower,'time spent idle is not renderer pressure');
 for(let i=0;i<30;i++)q.observeFrame(12);
 assert.equal(q.pixelRatio,lower,'recovery needs a longer stable interval');
 for(let i=0;i<150;i++)q.observeFrame(12);
 assert.ok(q.pixelRatio>lower);
 q.setMode('high');for(let i=0;i<100;i++)q.observeFrame(45);
 assert.equal(q.pixelRatio,2,'explicit quality is not silently changed');
});

test('resource pooling shares active geometry, bounds inactive caches and frees resources exactly once',()=>{
 const pool=new ResourcePool(2);const disposed=[];
 const create=id=>()=>({id,dispose(){disposed.push(id);}});
 pool.begin();const cube=pool.get('cube',create('cube'));assert.equal(pool.get('cube',create('duplicate')),cube);pool.end();
 pool.begin();assert.equal(pool.get('cube',create('duplicate')),cube);pool.get('lineA',create('lineA'));pool.end();
 pool.begin();pool.get('cube',create('duplicate'));pool.get('lineB',create('lineB'));pool.end();
 assert.deepEqual(disposed,['lineA']);assert.equal(pool.size,2);
 pool.dispose();pool.dispose();assert.deepEqual(disposed.sort(),['cube','lineA','lineB']);
});

test('resource pool never evicts a geometry still referenced by the visible frame',()=>{
 const pool=new ResourcePool(1);let disposals=0;
 pool.begin();for(const id of ['one','two','three'])pool.get(id,()=>({dispose(){disposals++;}}));pool.end();
 assert.equal(disposals,0);assert.equal(pool.size,3);
 pool.begin();pool.get('three',()=>assert.fail());pool.end();assert.equal(pool.size,1);assert.equal(disposals,2);
});

test('GPU picking preserves dispatch values and separates a schematic cell from measured data',()=>{
 const values=[{globalId:0,localId:0,workgroupId:0},{globalId:64,localId:0,workgroupId:1,subgroupSize:32}];
 assert.deepEqual(inspectGPUCell({status:'ok',kind:'measured',values},1),{type:'gpu',provenance:'measured',globalId:64,localId:0,workgroupId:1,subgroupSize:32});
 assert.equal(inspectGPUCell({status:'ok',kind:'imported-gpu',values},1).provenance,'imported');
 assert.deepEqual(inspectGPUCell(null,20),{type:'gpu',provenance:'schematic',cell:20});
 assert.equal(inspectGPUCell({status:'ok',values},2),null);
 assert.equal(inspectGPUCell(null,-1),null);
 assert.equal(inspectGPUCell(null,1.2),null);
});
