import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three/webgpu';
import {TheatreRenderer} from '../src/renderer.js';
import {createDeadlock,stepDeadlock} from '../src/core/deadlock.js';

function fixture({pendingInit=false}={}){
 const keys=['document','location','matchMedia','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'];
 const previous=new Map(keys.map(key=>[key,globalThis[key]]));
 Object.assign(globalThis,{
  document:{createElement:()=>({style:{}})},location:{href:'https://example.test/?renderer=webgl'},
  matchMedia:()=>Object.assign(new EventTarget(),{matches:false}),
  ResizeObserver:class{observe(){}disconnect(){}},
  requestAnimationFrame:()=>100,cancelAnimationFrame:()=>{}
 });
 class Canvas extends EventTarget {
  constructor(){super();this.parentElement={getBoundingClientRect:()=>({width:800,height:600})};this.width=800;this.height=600;}
  getBoundingClientRect(){return {width:800,height:600,left:0,top:0};}
  cloneNode(){return new Canvas();}
  replaceWith(next){this.replacedBy=next;}
 }
 const canvas=new Canvas();
 const labels={append(){},replaceChildren(){}};const states=[],backends=[];
 const world=new TheatreRenderer({canvas,labels,onStateChange:state=>states.push(state.status)});
 let release;
 world.createBackend=()=>{
  const backend={backend:{isWebGPUBackend:false},info:{render:{drawCalls:0},memory:{geometries:3},reset(){this.render.drawCalls=0;}},disposeCount:0,
   init:()=>pendingInit?new Promise(resolve=>{release=resolve;}):Promise.resolve(),
   dispose:async function(){this.disposeCount++;},setPixelRatio(){},setSize(){},render(){this.info.render.drawCalls+=7;}};
  backends.push(backend);return backend;
 };
 world.createControls=()=>Object.assign(new EventTarget(),{target:new Vector3(),update(){},dispose(){}});
 return {world,canvas,states,backends,release:()=>release?.(),restore:()=>{for(const [key,value] of previous)globalThis[key]=value;}};
}

test('context recovery reuses the latest semantic snapshot and replaces the lost backend once',async()=>{
 const {world,canvas,states,backends,restore}=fixture();
 try{
  const state=stepDeadlock(createDeadlock(),0);world.update('deadlock',state);
  assert.equal(await world.init(),true);
  backends[0].onDeviceLost({api:'WebGL',message:'test context loss'});
  assert.equal(world.ready,false);assert.equal(world.getDiagnostics().pendingFrame,false);
  const later=stepDeadlock(state,1);world.update('deadlock',later);
  assert.equal(await world.retry(),true);
  assert.equal(world.lastSnapshot.state,later);assert.equal(world.lastSnapshot.state.events.length,2);
  assert.equal(backends.length,2);assert.equal(backends[0].disposeCount,1);
  assert.notEqual(world.canvas,canvas,'Three dispose loses its old WebGL context; recovery needs a new drawing surface');
  assert.equal(canvas.replacedBy,world.canvas);
  assert.deepEqual(states.filter(s=>s==='lost'||s==='ready'),['ready','lost','ready']);
 }finally{await world.dispose();restore();}
});

test('draw call diagnostics describe the last frame rather than accumulating across demand renders',async()=>{
 const {world,restore}=fixture();
 try{
  world.update('deadlock',createDeadlock());await world.init();
  world.draw(10);world.draw(20);
  assert.equal(world.getDiagnostics().drawCalls,7);
  assert.equal(world.getDiagnostics().renderCount,2);
 }finally{await world.dispose();restore();}
});

test('a disposed renderer cannot resurrect after an in-flight backend initialization',async()=>{
 const {world,backends,release,restore}=fixture({pendingInit:true});
 try{
  const starting=world.init();await world.dispose();release();
  assert.equal(await starting,false);assert.equal(world.ready,false);
  assert.equal(world.getDiagnostics().status,'disposed');
  assert.equal(backends[0].disposeCount,1,'the backend must not be disposed twice');
  assert.equal(await world.retry(),false);
 }finally{restore();}
});

test('repeated WebGPU losses exhaust one automatic recovery until the user explicitly retries',async()=>{
 const {world,backends,restore}=fixture();
 const settled=()=>new Promise(resolve=>setImmediate(resolve));
 try{
  await world.init();
  backends[0].onDeviceLost({api:'WebGPU',message:'first driver loss'});
  await settled();
  assert.equal(backends.length,2);assert.equal(world.ready,true);
  backends[1].onDeviceLost({api:'WebGPU',message:'persistent driver failure'});
  await settled();
  assert.equal(backends.length,2,'persistent failure must not churn through new devices');
  assert.equal(world.ready,false);assert.equal(world.status,'lost');
  assert.equal(await world.retry(),true);
  assert.equal(backends.length,3);
  backends[2].onDeviceLost({api:'WebGPU',message:'later loss after user retry'});
  await settled();
  assert.equal(backends.length,4,'explicit retry starts a new one-attempt recovery budget');
 }finally{await world.dispose();restore();}
});
