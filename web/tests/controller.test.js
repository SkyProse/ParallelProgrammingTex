import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Controller} from '../src/controller.js';
import {exploreDeadlock} from '../src/core/deadlock.js';
test('rewind, manual fork and saved comparison keep the common past intact',()=>{
 const c=new Controller('deadlock',{ordered:false});
 c.step(0);c.step(1);const saved=c.snapshot();
 assert.equal(c.status,'deadlock');
 c.seek(1);assert.equal(c.step(0),true);
 assert.deepEqual(c.actions,[0,0]);
 assert.deepEqual(saved.actions,[0,1]);
 assert.equal(saved.state.owners[1],1);
 assert.equal(c.state.owners[1],0);
});
test('blocked acquire neither advances logical time nor corrupts the trace',()=>{
 const c=new Controller('deadlock',{ordered:false});c.step(0);c.step(1);
 assert.equal(c.step(0),false);assert.equal(c.cursor,2);
 assert.deepEqual(c.actions,[0,1]);
});
test('automatic scheduler completes corrected locks and CAS; model modes remain deterministic',()=>{
 for(const [scene,config] of [['deadlock',{ordered:true}],['cas',{}],['race',{mode:'atomic'}]]){
  const c=new Controller(scene,config);for(let i=0;i<100&&c.status!=='complete';i++)c.autoStep();
  assert.equal(c.status,'complete');
  const snapshot=c.snapshot();const loaded=new Controller(scene,config);loaded.load(snapshot);
  assert.deepEqual(loaded.state,snapshot.state);
 }
});
test('memory presets obey configured count and render state can be reconstructed at any event',()=>{
 const c=new Controller('memory',{layout:'soa',count:4,lineSize:64,padding:0});
 for(let i=0;i<8;i++)c.autoStep();assert.equal(c.state.metrics.invalidations,0);
 const last=c.snapshot().state;c.seek(0);assert.equal(c.state.metrics.accesses,0);c.seek(8);assert.deepEqual(c.state,last);
});
test('automatic memory steps respect the selected read-only, same-field and write/read modes',()=>{
 for(const memoryMode of ['readonly','true','write-read']){
  const c=new Controller('memory',{layout:'aos',count:4,lineSize:64,padding:0});
  c.autoStep({memoryMode});c.autoStep({memoryMode});
  assert.deepEqual(c.state.events.map(e=>e.field),['a','a']);
  assert.deepEqual(c.state.events.map(e=>e.op),memoryMode==='readonly'?['read','read']:memoryMode==='write-read'?['write','read']:['write','write']);
  if(memoryMode==='readonly')assert.equal(c.state.metrics.invalidations,0);
  else assert.equal(c.state.metrics.trueSharing,1);
 }
});
test('automatic memory index follows each actor after uneven manual steps',()=>{
 const c=new Controller('memory',{layout:'aos',count:4,lineSize:64,padding:0});
 c.step({thread:0,index:0,field:'a',write:true});
 c.step({thread:0,index:1,field:'a',write:true});
 const before=c.snapshot().state.events;
 c.autoStep();
 const next=c.state.events.at(-1);
 assert.equal(next.index,before.filter(e=>e.thread===next.thread).length%4);
});
test('memory intervention forks explicitly while ordinary forward playback preserves the recorded future',()=>{
 const c=new Controller('memory',{layout:'aos',count:4,lineSize:64,padding:0});
 for(let i=0;i<4;i++)c.autoStep();
 const saved=c.snapshot();
 c.seek(0);
 c.autoStep({memoryMode:'readonly'});
 assert.equal(c.state.events.at(-1).op,'write','ordinary playback must replay the recorded action');
 c.seek(0);
 const current=c.state;
 assert.equal(c.discardFuture(),true);
 assert.equal(c.state,current,'an intervention changes the future, not the current state');
 assert.deepEqual(c.actions,[]);
 assert.equal(c.states.length,1);
 assert.equal(c.discardFuture(),false);
 c.autoStep({memoryMode:'readonly'});
 assert.equal(c.state.events.at(-1).op,'read');
 assert.equal(c.state.metrics.invalidations,0);
 assert.equal(c.actions.length,1);
 assert.equal(saved.actions.length,4);
 assert.ok(saved.state.events.every(event=>event.op==='write'));
});
test('failed replay import is atomic and every graph selection reconstructs its displayed state',()=>{
 const c=new Controller('deadlock',{ordered:false});c.step(0);
 const before=c.snapshot();
 assert.throws(()=>c.load({scene:'deadlock',config:{ordered:false},actions:[0,1,0],cursor:3}),/blocked/);
 assert.deepEqual(c.snapshot(),before);
 for(const ordered of [false,true])for(const node of exploreDeadlock({ordered}).nodes){
  const selected=new Controller('deadlock',{ordered});
  for(const event of node.state.events)assert.equal(selected.step(event.thread),true);
  assert.deepEqual(selected.state,node.state);
 }
});
