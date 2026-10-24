import {createDeadlock,stepDeadlock,enabledDeadlock,deadlockStatus,deadlockProgram} from './core/deadlock.js';
import {createRace,stepRace,enabledRace,raceStatus,raceProgram} from './core/race.js';
import {createCache,cacheAccess} from './core/cache.js';
import {createCAS,stepCAS,enabledCAS,casStatus,casProgram} from './core/cas.js';
const models={
 deadlock:{create:createDeadlock,step:stepDeadlock,enabled:enabledDeadlock,status:deadlockStatus,program:deadlockProgram},
 race:{create:createRace,step:stepRace,enabled:enabledRace,status:raceStatus,program:raceProgram},
 memory:{create:createCache,step:cacheAccess,enabled:()=>[0,1],status:()=> 'running'},
 cas:{create:createCAS,step:(s,a)=>stepCAS(s,typeof a==='number'?a:a.thread,typeof a==='number'?{}:{spurious:a.spurious}),enabled:enabledCAS,status:casStatus,program:casProgram}
};
export class Controller {
 constructor(scene,config={}){
  if(!models[scene])throw new RangeError('Unknown model');
  this.scene=scene;this.config=structuredClone(config);this.model=models[scene];
  this.actions=[];this.cursor=0;this.states=[this.model.create(config)];
 }
 get state(){return this.states[this.cursor];}
 get status(){return this.model.status(this.state);}
 get enabled(){return this.model.enabled(this.state);}
 program(thread){return this.model.program?.(this.state,thread)??[];}
 step(action){
  if(this.cursor>=2000)return false;
  const next=this.model.step(this.state,action);
  if(next===this.state)return false;
  this.actions=this.actions.slice(0,this.cursor);this.states=this.states.slice(0,this.cursor+1);
  this.actions.push(structuredClone(action));this.states.push(next);this.cursor++;
  return true;
 }
 autoStep({memoryMode='separate'}={}){
  if(this.cursor<this.actions.length){this.seek(this.cursor+1);return true;}
  if(this.scene==='memory'){
   if(!['separate','true','write-read','readonly'].includes(memoryMode))throw new RangeError('Unknown memory access mode');
   const thread=this.cursor%2,index=this.state.events.filter(event=>event.thread===thread).length%this.state.config.count;
   return this.step({thread,index,field:memoryMode==='separate'?(thread?'b':'a'):'a',write:memoryMode!=='readonly'&&!(memoryMode==='write-read'&&thread===1)});
  }
  const options=this.enabled;if(!options.length)return false;
  const previous=this.state.events.at(-1)?.thread;
  return this.step(options.find(x=>x!==previous)??options[0]);
 }
 seek(cursor){if(!Number.isInteger(cursor)||cursor<0||cursor>this.actions.length)throw new RangeError('Invalid cursor');this.cursor=cursor;}
 snapshot(){return structuredClone({scene:this.scene,config:this.config,actions:this.actions,cursor:this.cursor,state:this.state});}
 load(data){
  const replacement=new Controller(data.scene,data.config);
  if(!Array.isArray(data.actions)||data.actions.length>2000)throw new RangeError('Invalid trace');
  for(const action of data.actions)if(!replacement.step(action))throw new RangeError('Trace includes a blocked or completed action');
  replacement.seek(data.cursor);
  Object.assign(this,replacement);
 }
}
