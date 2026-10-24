import test from 'node:test';
import assert from 'node:assert/strict';
import {createCache,cacheAccess} from '../src/core/cache.js';
import {inspectMemory,inspectInvocation,renderInspection} from '../src/inspection.js';

test('memory inspection explains exact address, line range and shared neighbours without changing the model',()=>{
  const initial=createCache();
  const state=cacheAccess(initial,{thread:0,index:0,field:'a',write:true});
  const before=JSON.stringify(state);
  const item=inspectMemory(state,1);
  assert.equal(item.field,'b');assert.equal(item.index,0);
  assert.equal(item.address,1);assert.equal(item.line,0);assert.equal(item.owner,0);
  assert.deepEqual(item.range,[0,63]);assert.equal(item.neighbours.length,15);
  assert.equal(item.provenance,'model');assert.equal(JSON.stringify(state),before);
  assert.equal(inspectMemory(state,-1),null);
  assert.equal(inspectMemory(state,'1'),null);
  const html=renderInspection(item);
  assert.match(html,/МОДЕЛЬ/);assert.match(html,/0–63/);
  assert.match(html,/не аппаратный/);
});

test('invocation inspection preserves imported provenance and never invents subgroup values or pre-dispatch results',()=>{
  const values=[{globalId:0,localId:0,workgroupId:0},{globalId:1,localId:1,workgroupId:0,subgroupSize:4,subgroupInvocationId:1}];
  const data={status:'ok',kind:'imported-gpu',values,workgroupSize:64};
  const first=inspectInvocation(data,0);
  assert.equal(first.provenance,'imported');
  assert.equal(first.subgroupSize,undefined);
  assert.equal(inspectInvocation(data,1).subgroupInvocationId,1);
  assert.equal(inspectInvocation(data,2),null);
  assert.equal(inspectInvocation({status:'error',values:[]},0),null);
  assert.equal(inspectInvocation(null,0),null);
  const html=renderInspection(first);
  assert.match(html,/ИМПОРТ/);assert.match(html,/не подтверждает/);
  assert.match(html,/не сообщён/);assert.doesNotMatch(html,/ИЗМЕРЕНО/);
});

test('inspection values are escaped and schematic cells cannot masquerade as measured invocations',()=>{
  const html=renderInspection({type:'gpu',provenance:'schematic',globalId:123,workgroupId:2});
  assert.match(html,/СХЕМА/);assert.doesNotMatch(html,/123/);
  const hostile=renderInspection({type:'memory',provenance:'model',field:'<img src=x onerror=alert(1)>',index:0,address:0,line:0,range:[0,63],owner:null,neighbours:[]});
  assert.doesNotMatch(hostile,/<img/);assert.match(hostile,/&lt;img/);
});
