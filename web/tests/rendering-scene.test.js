import test from 'node:test';
import assert from 'node:assert/strict';
import {TheatreRenderer} from '../src/renderer.js';
import {createCache,cacheAccess} from '../src/core/cache.js';
import {createDeadlock,stepDeadlock,exploreDeadlock} from '../src/core/deadlock.js';

function renderer(){
 const oldDocument=globalThis.document,oldMatch=globalThis.matchMedia;
 globalThis.document={createElement:()=>({style:{},textContent:'',className:''})};
 globalThis.matchMedia=()=>Object.assign(new EventTarget(),{matches:false});
 const labels={children:[],append(el){this.children.push(el);},replaceChildren(){this.children=[];}};
 const world=new TheatreRenderer({canvas:new EventTarget(),labels});
 return {world,labels,restore:()=>{globalThis.document=oldDocument;globalThis.matchMedia=oldMatch;}};
}

test('repainting the same immutable snapshot keeps meshes and resources intact',async()=>{
 const {world,restore}=renderer();
 try{
  const state=createDeadlock();world.update('deadlock',state);
  const meshes=[...world.group.children],resources=world.resources.size;
  for(let i=0;i<30;i++)world.update('deadlock',state);
  assert.deepEqual(world.group.children,meshes);assert.equal(world.resources.size,resources);
  const body=meshes[0].children[1],geometry=body.geometry,material=body.material;
  world.update('deadlock',stepDeadlock(state,0));
  assert.equal(world.group.children[0].children[1].geometry,geometry);
  assert.equal(world.group.children[0].children[1].material,material);
 }finally{await world.dispose();restore();}
});

test('large imported memory layouts show a bounded truthful window containing the latest access',async()=>{
 const {world,labels,restore}=renderer();
 try{
  const state=cacheAccess(createCache({layout:'padded',count:4096}),{thread:1,index:4095,field:'b'});
  world.update('memory',state);
  const cells=world.picks.filter(o=>o.userData.inspect);
  assert.ok(cells.length<=32);
  assert.ok(cells.some(o=>o.userData.inspect.index===4095&&o.userData.inspect.field==='b'));
  assert.ok(labels.children.some(el=>/ИЗ 8192/.test(el.textContent)));
  assert.equal(cells.at(-1).userData.inspect.provenance,'model');
 }finally{await world.dispose();restore();}
});

test('graph rendering marks the actual schedule path without advancing the snapshot',async()=>{
 const {world,labels,restore}=renderer();
 try{
  const graph=exploreDeadlock();const state=stepDeadlock(stepDeadlock(createDeadlock(),1),0);
  const before=JSON.stringify(state);
  world.update('deadlock',state,{graph,graphMode:true});
  assert.equal(JSON.stringify(state),before);
  assert.ok(labels.children.some(el=>el.textContent==='СЕЙЧАС'));
  assert.equal(world.picks.length,23);
  assert.ok(world.group.children.some(o=>o.userData.schedulePath));
 }finally{await world.dispose();restore();}
});
