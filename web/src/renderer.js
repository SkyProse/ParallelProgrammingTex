import * as THREE from 'three/webgpu';
import {uniform,color,normalView,positionViewDirection} from 'three/tsl';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {QualityPolicy,ResourcePool,inspectGPUCell} from './rendering/policy.js';

const COLORS={cyan:0x6ed7ef,amber:0xffc17a,mint:0xa7efc5,red:0xff8e91,slate:0x526f80,white:0xe8f4ef};
const THREADS=[COLORS.cyan,COLORS.amber];
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const CAMERA_PRESETS={overview:[6,6,8.5],top:[0,12,.01],detail:[3.8,3.8,6.6]};

/** Rendering reads immutable snapshots. Animation never advances logical time. */
export class TheatreRenderer {
  constructor({canvas,labels,onAction,onNode,onBackend,onInspect,onStateChange}) {
    Object.assign(this,{canvas,labelsEl:labels,onAction,onNode,onBackend,onInspect,onStateChange});
    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x122029);
    this.scene.fog=new THREE.FogExp2(0x122029,.032);
    this.camera=new THREE.PerspectiveCamera(38,1,.1,80);
    this.camera.position.fromArray(CAMERA_PRESETS.overview);
    this.cameraPreset='overview';
    this.group=new THREE.Group();this.scene.add(this.group);
    this.resources=new ResourcePool(160);
    this.staticResources=[];
    this.labelPoints=[];this.picks=[];this.flows=[];
    this.paused=false;this.ready=false;this.visible=true;this.disposed=false;
    this.status='initializing';this.backend='2D / текст';
    this.renderCount=0;this.epoch=0;this.raf=null;this.lastAnimationFrame=null;this.autoRecoveryAttempts=0;
    this.lastSnapshot=null;this.activeSnapshot=null;
    this.pulse=uniform(.6);
    this.motionQuery=matchMedia('(prefers-reduced-motion: reduce)');
    this.motion=!this.motionQuery.matches;
    this.quality=new QualityPolicy({dpr:globalThis.devicePixelRatio||1});
    this.pointer=new THREE.Vector2();this.raycaster=new THREE.Raycaster();
    this.listeners=[];this.canvasListeners=[];this.releasedBackends=new WeakSet();
    this.buildStage();
    this.installEvents();
  }

  buildStage() {
    this.scene.add(new THREE.HemisphereLight(0xb8e6ef,0x233332,2.6));
    const key=new THREE.DirectionalLight(0xcce9f3,3.7);key.position.set(-3,8,5);this.scene.add(key);
    const rim=new THREE.DirectionalLight(0x83dfba,2);rim.position.set(5,3,-6);this.scene.add(rim);
    const warm=new THREE.PointLight(0xffc17a,18,20,2);warm.position.set(4,4,3);this.scene.add(warm);
    const grid=new THREE.GridHelper(28,28,0x324a52,0x233740);
    grid.position.y=-.48;grid.material.transparent=true;grid.material.opacity=.32;this.scene.add(grid);
    const disk=new THREE.Mesh(new THREE.CylinderGeometry(4.6,4.8,.14,80),new THREE.MeshStandardMaterial({color:0x1c3039,metalness:.3,roughness:.8}));
    disk.position.y=-.57;this.scene.add(disk);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(4.65,.018,8,128),new THREE.MeshBasicMaterial({color:0x527580,transparent:true,opacity:.7}));
    ring.rotation.x=Math.PI/2;ring.position.y=-.49;this.scene.add(ring);
    for(const object of [grid,disk,ring])this.staticResources.push(object.geometry,object.material);
  }

  listen(target,type,handler,options) {
    target.addEventListener(type,handler,options);
    const collection=target===this.canvas?this.canvasListeners:this.listeners;
    collection.push(()=>target.removeEventListener(type,handler,options));
  }

  installEvents() {
    this.listen(this.motionQuery,'change',event=>{
      this.motion=!event.matches;
      if(!this.motion){this.finishCameraTransition();for(const flow of this.flows)flow.mesh.visible=false;this.flows=[];}
      this.requestRender();this.notify();
    });
    this.installCanvasEvents();
  }

  installCanvasEvents(){
    this.listen(this.canvas,'webglcontextrestored',()=>{
      if(this.disposed||this.status!=='lost')return;
      this.recoveryRequested=true;this.recoveryAutomatic=false;
      if(!this.initializing)void this.retry();
    });
    this.listen(this.canvas,'pointerdown',event=>{this.pointerStart={x:event.clientX,y:event.clientY,id:event.pointerId};});
    this.listen(this.canvas,'pointercancel',()=>{this.pointerStart=null;});
    this.listen(this.canvas,'pointerup',event=>{
      const start=this.pointerStart;this.pointerStart=null;
      if(!start||start.id!==event.pointerId||Math.hypot(event.clientX-start.x,event.clientY-start.y)>6||!this.ready||this.paused)return;
      this.pick(event.clientX,event.clientY);
    });
  }

  replaceCanvas(){
    const old=this.canvas,next=old.cloneNode(false);
    for(const remove of this.canvasListeners)remove();this.canvasListeners=[];
    next.width=old.width;next.height=old.height;old.replaceWith(next);
    this.canvas=next;this.pointerStart=null;this.installCanvasEvents();
  }

  async init() {
    if(this.disposed)return false;
    if(this.initializing)return this.initializing;
    if(this.ready)return true;
    this.initializing=this.initializeBackend();
    try{return await this.initializing;}finally{
      this.initializing=null;
      if(!this.disposed&&this.status==='lost'&&this.recoveryRequested){
        const automatic=this.recoveryAutomatic;
        queueMicrotask(()=>this.retry({automatic}));
      }
    }
  }

  createBackend(options){return new THREE.WebGPURenderer(options);}
  createControls(){return new OrbitControls(this.camera,this.canvas);}
  async releaseBackend(renderer){
    if(!renderer||this.releasedBackends.has(renderer))return;
    this.releasedBackends.add(renderer);renderer.onDeviceLost=()=>{};
    try{await renderer.dispose();}catch{}
  }

  async initializeBackend() {
    const epoch=++this.epoch;
    this.status=this.renderer?'recovering':'initializing';this.notify();
    this.cancelFrame();
    const previous=this.renderer;this.renderer=null;
    this.controls?.dispose();this.controls=null;
    if(previous)await this.releaseBackend(previous);
    if(this.disposed||epoch!==this.epoch)return false;
    // r186 WebGLBackend.dispose() deliberately loses its context. A fresh
    // surface prevents that asynchronous loss from affecting the new backend.
    if(this.canvasUsed)this.replaceCanvas();
    this.canvasUsed=true;this.recoveryRequested=false;this.recoveryAutomatic=false;
    let renderer;
    try {
      // A canvas already bound to WebGL cannot switch context type on recovery.
      const forceWebGL=this.backend.startsWith('WebGL')||new URL(location.href).searchParams.get('renderer')==='webgl';
      renderer=this.createBackend({canvas:this.canvas,antialias:true,alpha:false,forceWebGL});
      this.renderer=renderer;
      renderer.onDeviceLost=info=>{if(!this.disposed&&epoch===this.epoch)this.handleLoss(info);};
      renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
      await renderer.init();
      if(this.disposed||epoch!==this.epoch){await this.releaseBackend(renderer);return false;}
      if(this.status==='lost')return false;
      renderer.info.autoReset=false;
      this.backend=renderer.backend.isWebGPUBackend?'WebGPU · TSL':'WebGL 2 · TSL';
      this.controls=this.createControls();
      this.controls.target.copy(this.cameraTarget??V(0,.1,0));
      this.controls.enableDamping=false;this.controls.enablePan=false;
      this.controls.minDistance=5;this.controls.maxDistance=21;
      this.controls.maxPolarAngle=Math.PI*.48;this.controls.minPolarAngle=.001;
      this.controls.addEventListener('change',()=>this.requestRender());
      this.controls.addEventListener('start',()=>{this.cameraTransition=null;});
      this.controls.update();
      this.ready=true;this.status='ready';this.failure=null;
      if(!this.observer){this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(this.canvas.parentElement);}
      this.resize();
      if(this.lastSnapshot){const {scene,state,options}=this.lastSnapshot;this.activeSnapshot=null;this.update(scene,state,options);}
      this.onBackend?.(this.backend);this.notify();this.requestRender();
      return true;
    }catch(error){
      if(this.disposed||epoch!==this.epoch){await this.releaseBackend(renderer);return false;}
      this.ready=false;this.status='unavailable';this.failure=String(error?.message||error);
      await this.releaseBackend(renderer);
      this.renderer=null;this.onBackend?.('2D / текст');this.notify();
      return false;
    }
  }

  handleLoss(info) {
    this.ready=false;this.status='lost';this.failure=info?.message||'Graphics context lost';
    this.cameraTarget=this.controls?.target.clone();this.cancelFrame();
    this.onBackend?.('Ошибка GPU · доступна партитура');this.notify();
    // WebGL restoration is event driven. A WebGPU device requires a new renderer.
    if(info?.api==='WebGPU'&&this.autoRecoveryAttempts<1){
      this.autoRecoveryAttempts++;this.recoveryRequested=true;this.recoveryAutomatic=true;
      if(!this.initializing)queueMicrotask(()=>{if(!this.disposed&&this.status==='lost')void this.retry({automatic:true});});
    }
  }

  async retry({automatic=false}={}) {
    if(this.disposed)return false;
    if(!automatic)this.autoRecoveryAttempts=0;
    if(this.initializing)return this.initializing;
    this.ready=false;this.status='recovering';this.notify();
    return this.init();
  }

  notify(){this.onStateChange?.(this.getDiagnostics());}
  getDiagnostics(){
    const info=this.renderer?.info;
    return {status:this.status,backend:this.backend,quality:this.quality.mode,pixelRatio:this.quality.pixelRatio,
      drawCalls:info?.render?.drawCalls??0,geometries:info?.memory?.geometries??0,
      renderCount:this.renderCount,pendingFrame:this.raf!==null,paused:this.paused,motion:this.motion,
      scene:this.currentScene??null,cameraPreset:this.cameraPreset,resourceCount:this.resources.size,
      failure:this.failure??null};
  }

  setQuality(mode){this.quality.setMode(mode);this.resize();this.notify();}
  resize(){
    if(!this.ready)return;
    const {width,height}=this.canvas.parentElement.getBoundingClientRect();if(!width||!height)return;
    this.quality.resize({dpr:globalThis.devicePixelRatio||1,width,height});
    this.renderer.setPixelRatio(this.quality.pixelRatio);this.renderer.setSize(width,height,false);
    this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.requestRender();
  }

  setCameraPreset(preset) {
    if(!Object.hasOwn(CAMERA_PRESETS,preset))throw new RangeError('Unknown camera preset');
    this.cameraPreset=preset;
    const target=V(0,.1,0),position=new THREE.Vector3().fromArray(CAMERA_PRESETS[preset]);
    if(preset==='detail'&&this.selectionPosition){target.copy(this.selectionPosition);position.copy(target).add(V(3.8,3.8,6.6));}
    this.cameraTransition={from:this.camera.position.clone(),to:position,targetFrom:this.controls?.target.clone()??V(0,.1,0),targetTo:target,start:performance.now()};
    if(!this.motion||this.paused)this.finishCameraTransition();
    this.requestRender();this.notify();
  }
  resetCamera(){this.setCameraPreset('overview');}
  finishCameraTransition(){
    const transition=this.cameraTransition;if(!transition)return;
    this.camera.position.copy(transition.to);this.controls?.target.copy(transition.targetTo);
    this.controls?.update();this.cameraTarget=transition.targetTo.clone();this.cameraTransition=null;
  }
  cancelFrame(){if(this.raf!==null)cancelAnimationFrame(this.raf);this.raf=null;this.lastAnimationFrame=null;}
  setPaused(value){
    if(value===this.paused)return;this.paused=value;
    if(value){this.cancelFrame();this.finishCameraTransition();}else this.requestRender();
  }
  setVisible(value){this.visible=value;if(!value)this.cancelFrame();else this.requestRender();}
  requestRender(){
    if(!this.ready||this.disposed||this.paused||!this.visible||this.raf!==null)return;
    this.raf=requestAnimationFrame(now=>{this.raf=null;this.draw(now);});
  }
  draw(now=performance.now()) {
    if(!this.ready||this.disposed||this.paused||!this.visible)return;
    try {
      let animating=false;
      if(this.cameraTransition){
        const t=Math.min(1,(now-this.cameraTransition.start)/420),eased=t*t*(3-2*t);
        this.camera.position.lerpVectors(this.cameraTransition.from,this.cameraTransition.to,eased);
        this.controls?.target.lerpVectors(this.cameraTransition.targetFrom,this.cameraTransition.targetTo,eased);
        this.controls?.update();
        if(t>=1)this.finishCameraTransition();else animating=true;
      }
      for(const flow of this.flows){
        const t=Math.min(1,(now-flow.start)/650);flow.mesh.position.copy(flow.curve.getPoint(t));
        flow.mesh.visible=this.motion&&t<1;animating||=this.motion&&t<1;
      }
      if(animating&&this.lastAnimationFrame!==null&&this.quality.observeFrame(now-this.lastAnimationFrame)){
        this.renderer.setPixelRatio(this.quality.pixelRatio);this.notify();
      }
      this.lastAnimationFrame=animating?now:null;
      this.renderer.info.reset();this.renderer.render(this.scene,this.camera);this.renderCount++;
      this.positionLabels();
      if(animating)this.requestRender();
    }catch(error){
      this.ready=false;this.status='unavailable';this.failure=String(error?.message||error);this.cancelFrame();
      this.onBackend?.('Ошибка GPU · доступна партитура');this.notify();
    }
  }

  pick(clientX,clientY) {
    const rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    this.pointer.set(((clientX-rect.left)/rect.width)*2-1,-((clientY-rect.top)/rect.height)*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    const hit=this.raycaster.intersectObjects(this.picks,true)[0];if(!hit)return;
    let object=hit.object;
    while(object&&object.userData.thread===undefined&&!object.userData.node&&!object.userData.inspect&&!object.userData.gpu)object=object.parent;
    if(!object)return;
    if(object.userData.node)this.onNode?.(object.userData.node);
    else if(object.userData.thread!==undefined)this.onAction?.(object.userData.thread);
    else {
      const payload=object.userData.gpu?inspectGPUCell(this.lastSnapshot?.options.gpuResult,hit.instanceId):object.userData.inspect;
      if(payload){this.selectionPosition=hit.point.clone();this.markSelection(hit.point);this.onInspect?.(payload);}
    }
  }
  markSelection(position) {
    if(!this.selection){
      this.selection=new THREE.Mesh(this.geometry('TorusGeometry',.28,.022,8,32),this.material(COLORS.white,.6));
      this.selection.rotation.x=Math.PI/2;this.group.add(this.selection);
    }
    this.selection.position.copy(position);this.selection.position.y+=.07;this.requestRender();
  }

  positionLabels(){
    const {width,height}=this.canvas.getBoundingClientRect();
    for(const item of this.labelPoints){
      const p=item.position.clone().project(this.camera);
      item.el.style.left=`${(p.x*.5+.5)*width}px`;item.el.style.top=`${(-p.y*.5+.5)*height}px`;
      item.el.style.display=p.z>1||p.z< -1||Math.abs(p.x)>1.08||Math.abs(p.y)>1.08?'none':'';
    }
  }
  clear(){
    // InstancedMesh owns instance buffers; shared geometry/materials belong to the pool.
    this.group.traverse(object=>{if(object.isInstancedMesh)object.dispose();});
    this.group.clear();this.labelsEl.replaceChildren();this.labelPoints=[];this.picks=[];this.flows=[];this.selection=null;
  }
  geometry(type,...args){return this.resources.get(`geometry:${type}:${JSON.stringify(args)}`,()=>new THREE[type](...args));}
  material(tint,glow=.08){
    return this.resources.get(`material:${tint}:${glow}`,()=>{
      const material=new THREE.MeshStandardNodeMaterial({color:tint,roughness:.36,metalness:.32});
      const rim=normalView.dot(positionViewDirection).abs().oneMinus().pow(3);
      material.emissiveNode=color(tint).mul(this.pulse.mul(glow).add(rim.mul(.18)));
      return material;
    });
  }
  mesh(geometry,tint,position,glow=.08){const mesh=new THREE.Mesh(geometry,this.material(tint,glow));mesh.position.copy(position);this.group.add(mesh);return mesh;}
  label(text,position,cls=''){const el=document.createElement('span');el.className=`world-label ${cls}`;el.textContent=text;this.labelsEl.append(el);this.labelPoints.push({el,position});}
  line(points,tint,radius=.016,dashed=false){
    const curve=new THREE.CatmullRomCurve3(points);
    const key=points.map(p=>p.toArray().join(',')).join('|');
    if(dashed){
      const geometry=this.resources.get(`dashed:${key}`,()=>new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)));
      const material=this.resources.get(`dash-material:${tint}`,()=>new THREE.LineDashedMaterial({color:tint,dashSize:.13,gapSize:.1,transparent:true,opacity:.85}));
      const line=new THREE.Line(geometry,material);line.computeLineDistances();this.group.add(line);return;
    }
    const geometry=this.resources.get(`tube:${radius}:${key}`,()=>new THREE.TubeGeometry(curve,24,radius,6,false));
    return this.mesh(geometry,tint,V(0,0,0),.25);
  }
  arrow(from,to,tint,dashed=false,flow=false){
    const midpoint=from.clone().lerp(to,.5);midpoint.y+=.5;this.line([from,midpoint,to],tint,.025,dashed);
    const direction=to.clone().sub(midpoint).normalize();
    const cone=this.mesh(this.geometry('ConeGeometry',.08,.19,12),tint,to.clone().addScaledVector(direction,-.07),.2);
    cone.quaternion.setFromUnitVectors(V(0,1,0),direction);
    if(flow&&this.motion&&!dashed){const particle=this.mesh(this.geometry('SphereGeometry',.075,12,8),COLORS.white,from,.8);this.flows.push({mesh:particle,curve:new THREE.CatmullRomCurve3([from,midpoint,to]),start:performance.now()});}
  }
 actor(thread,position,subtitle){
  const tint=THREADS[thread];const actor=new THREE.Group();actor.position.copy(position);actor.userData.thread=thread;
  const base=new THREE.Mesh(this.geometry('CylinderGeometry',.46,.51,.16,48),this.material(0x263f49));base.position.y=-.27;actor.add(base);
  const body=new THREE.Mesh(this.geometry('CylinderGeometry',.32,.38,.5,40),this.material(tint,.13));actor.add(body);
  const cap=new THREE.Mesh(this.geometry('TorusGeometry',.39,.025,12,48),this.material(tint,.4));cap.rotation.x=Math.PI/2;cap.position.y=.28;actor.add(cap);
  this.group.add(actor);this.picks.push(actor);
  this.label(`ПОТОК T${thread}`,position.clone().add(V(0,.75,0)),`strong ${thread?'amber':'cyan'}`);
  if(subtitle)this.label(subtitle,position.clone().add(V(0,-.45,.3)),thread?'amber':'cyan');return position;
 }
 lock(index,owner,position){
  const tint=owner===null?COLORS.mint:THREADS[owner];
  this.mesh(this.geometry('BoxGeometry',.58,.48,.28),tint,position,.13);
  const loop=this.mesh(this.geometry('TorusGeometry',.2,.055,12,28,Math.PI),tint,position.clone().add(V(0,.29,0)),.15);
  loop.rotation.z=owner===null?-.2:0;
  this.mesh(this.geometry('SphereGeometry',.035,12,8),0x173039,position.clone().add(V(0,0,.16)));
  this.label(`LOCK ${index?'B':'A'}`,position.clone().add(V(0,-.45,0)),'strong mint');
  this.label(owner===null?'свободен':`владелец T${owner}`,position.clone().add(V(0,-.7,0)));
 }
 update(scene,state,{graph=null,graphMode=false,gpuResult=null}={}){
  const options={graph,graphMode,gpuResult};
  this.lastSnapshot={scene,state,options};
  const previous=this.activeSnapshot;
  if(previous&&previous.scene===scene&&previous.state===state&&previous.options.graph===graph&&previous.options.graphMode===graphMode&&previous.options.gpuResult===gpuResult){this.requestRender();return;}
  this.resources.begin();this.clear();this.currentScene=scene;this.selectionPosition=null;
  if(graphMode&&graph)this.graph(graph,state);
  else if(scene==='deadlock')this.deadlock(state);
  else if(scene==='race')this.race(state);
  else if(scene==='memory')this.memory(state);
  else if(scene==='cas')this.cas(state);
  else this.gpu(gpuResult);
  this.resources.end();this.activeSnapshot=this.lastSnapshot;this.requestRender();
 }
 deadlock(s){
  const actors=[V(-2.6,.55,1.15),V(2.6,.55,1.15)],locks=[V(-1.05,.6,-1),V(1.05,.6,-1)];
  actors.forEach((p,t)=>this.actor(t,p,s.pcs[t]>=5?'завершён':`инструкция ${s.pcs[t]+1} / 5`));
  locks.forEach((p,i)=>{this.lock(i,s.owners[i],p);if(s.owners[i]!==null)this.arrow(p.clone().add(V(0,.15,0)),actors[s.owners[i]].clone().add(V(0,.15,0)),THREADS[s.owners[i]]);});
  for(let t=0;t<2;t++){const first=s.ordered||t===0?0:1;const next=[first,1-first][s.pcs[t]];if(next!==undefined&&s.owners[next]!==null&&s.owners[next]!==t)this.arrow(actors[t].clone().add(V(0,.3,0)),locks[next].clone().add(V(0,.35,0)),COLORS.red,true);}
  this.label('ОДНА ПРОГРАММА · ВЫ ВЫБИРАЕТЕ ПОРЯДОК',V(0,2,-1.2));
 }
 race(s){
  const actors=[V(-2.6,.55,1.2),V(2.6,.55,1.2)];actors.forEach((p,t)=>this.actor(t,p,`local = ${s.locals[t]??'—'}`));
  const last=s.events.at(-1);if(last&&last.op==='read')this.arrow(V(0,.8,-.5),actors[last.thread],THREADS[last.thread],false,true);else if(last&&['write','atomic'].includes(last.op))this.arrow(actors[last.thread],V(0,.8,-.5),THREADS[last.thread],false,true);
  this.mesh(this.geometry('BoxGeometry',1.05,1.05,1.05),s.mode==='unsafe'?COLORS.red:COLORS.mint,V(0,.5,-.8),.16);
  this.label(`shared = ${s.value}`,V(0,1.55,-.8),'strong mint');
  this.label(s.mode==='atomic'?'АТОМАРНАЯ ОПЕРАЦИЯ':s.mode==='snapshot'?'НЕИЗМЕННЫЙ СНИМОК':'READ → LOCAL + 1 → WRITE',V(0,-.3,-.1));
 }
 memory(s){
  this.actor(0,V(-2.8,.55,-1.8),'cache 0');this.actor(1,V(2.8,.55,-1.8),'cache 1');
  const all=[...s.memory.objects].sort((a,b)=>a.address-b.address),last=s.events.at(-1);
  const latestIndex=last?all.findIndex(o=>o.index===last.index&&o.field===last.field):0;
  const start=Math.floor(Math.max(0,latestIndex)/32)*32,objects=all.slice(start,start+32);
  const cols=8,rows=Math.ceil(objects.length/cols),width=.57;
  if(all.length>objects.length)this.label(`ЯЧЕЙКИ ${start+1}–${start+objects.length} ИЗ ${all.length}`,V(0,2.2,.1));
  const locations=objects.map((o,i)=>V((i%cols-(cols-1)/2)*width,.05,(Math.floor(i/cols)-(rows-1)/2)*.95+.85));
  for(const line of s.memory.lines){
   const points=objects.map((o,i)=>o.line===line.line?locations[i]:null).filter(Boolean);
   if(!points.length)continue;
   const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minZ=Math.min(...points.map(p=>p.z)),maxZ=Math.max(...points.map(p=>p.z));
   this.mesh(this.geometry('BoxGeometry',maxX-minX+.56,.06,maxZ-minZ+.76),s.owners[line.line]===0?0x264956:s.owners[line.line]===1?0x514333:0x29404b,V((minX+maxX)/2,-.17,(minZ+maxZ)/2));
   if(points.length>1)this.label(`CACHE LINE ${line.line}`,V(maxX+.9,-.15,(minZ+maxZ)/2));
  }
  objects.forEach((object,i)=>{
   const position=locations[i];
   const owner=s.owners[object.line];const tint=owner===0?COLORS.cyan:owner===1?COLORS.amber:object.field==='a'?0x527d86:0x657a68;
   const cube=this.mesh(this.geometry('BoxGeometry',.48,.32,.55),tint,position,.12);
   cube.userData.inspect={type:'memory',provenance:'model',index:object.index,field:object.field,address:object.address,line:object.line,lineSize:s.config.lineSize,owner:owner??null};
   this.picks.push(cube);
   this.label(`${object.field}${object.index}`,position.clone().add(V(0,.38,0)),object.field==='a'?'cyan':'amber');
   this.label(`+${object.address} · L${object.line}`,position.clone().add(V(0,-.22,.13)));
  });
  if(last){const i=objects.findIndex(o=>o.index===last.index&&o.field===last.field);const p=locations[i].clone().add(V(0,.4,0)),actor=V(last.thread?2.8:-2.8,.65,-1.8);this.arrow(last.op==='read'?p:actor,last.op==='read'?actor:p,THREADS[last.thread],false,true);}
  this.label(`${s.config.layout.toUpperCase()} · ${s.memory.bytes} БАЙТ · ЛИНИЯ ${s.config.lineSize} Б`,V(0,1.6,.1),'strong mint');
 }
 cas(s){
  this.actor(0,V(-2.6,.55,-1.65),s.threads[0].phase);this.actor(1,V(2.6,.55,-1.65),s.threads[1].phase);
  const order=[];let id=s.head;while(id&&order.length<4){order.push(id);id=s.nodes[id]?.next;}
  for(const name of Object.keys(s.nodes))if(!order.includes(name))order.push(name);
  const positions=new Map();order.forEach((name,i)=>{const node=s.nodes[name];const p=V((i-1)*1.7,.35,1);positions.set(name,p);this.mesh(this.geometry('BoxGeometry',.8,.65,.65),node.published?(name==='dummy'?COLORS.mint:name==='n0'?COLORS.cyan:COLORS.amber):COLORS.slate,p,.15);this.label(name==='dummy'?'DUMMY':`NODE ${node.value}`,p.clone().add(V(0,.68,0)),'strong');this.label(node.published?'в очереди':'локальный',p.clone().add(V(0,-.55,.15)));if(name===s.tail)this.label('TAIL ↓',p.clone().add(V(0,1.1,0)),'mint');});
  for(const node of Object.values(s.nodes))if(node.next)this.arrow(positions.get(node.id).clone().add(V(.45,0,0)),positions.get(node.next).clone().add(V(-.45,0,0)),COLORS.mint);
 }
 gpu(result){
  const data=result?.status==='ok'?result.values:null;const count=Math.min(data?.length??256,4096);const cols=Math.ceil(Math.sqrt(count));
  const geometry=this.geometry('BoxGeometry',.82,.5,.82);const material=this.material(COLORS.mint,.2);const mesh=new THREE.InstancedMesh(geometry,material,count);const dummy=new THREE.Object3D();const palette=[COLORS.cyan,COLORS.amber,COLORS.mint,0xb2a2ef,0xe1a6c2,0x85cbd0];const scale=7/cols;
  for(let i=0;i<count;i++){dummy.position.set((i%cols-(cols-1)/2)*scale,-.05+(data?((data[i].workgroupId%3)*.08):0),(Math.floor(i/cols)-(cols-1)/2)*scale);dummy.scale.set(scale,scale,scale);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);mesh.setColorAt(i,new THREE.Color(data?palette[data[i].workgroupId%palette.length]:0x41606b));}
  mesh.instanceMatrix.needsUpdate=true;mesh.userData.gpu=true;this.group.add(mesh);this.picks.push(mesh);
  this.label(data?`${count}${count<data.length?' / '+data.length:''} ВЫЗОВОВ · ${result.workgroups.length} ГРУПП ВСЕГО`:'ПРОСТРАНСТВО GPU-ВЫЗОВОВ',V(0,1.9,0),'strong mint');
  this.label(data?(result.kind==='imported-gpu'?'ИМПОРТ · СТРУКТУРА ПРОВЕРЕНА':'ДАННЫЕ ПРОЧИТАНЫ С GPU'):'РАСКЛАДКА ДО ЗАПУСКА · ЕЩЁ НЕ РЕЗУЛЬТАТ',V(0,-.3,4));
  if(data){const seen=new Set();for(let i=0;i<count;i++){const g=data[i].workgroupId;if(!seen.has(g)&&seen.size<12){seen.add(g);this.label(`WG ${g}`,V((i%cols-(cols-1)/2)*scale,.42,(Math.floor(i/cols)-(cols-1)/2)*scale));}}}
 }
 graph(graph,s){
  const byDepth=new Map();
  for(const node of graph.nodes){if(!byDepth.has(node.depth))byDepth.set(node.depth,[]);byDepth.get(node.depth).push(node);}
  const positions=new Map();
  for(const [depth,nodes]of byDepth)nodes.forEach((node,i)=>positions.set(node.id,V((depth-5)*.68,.2,(i-(nodes.length-1)/2)*1.15)));
  // Follow this recorded schedule through the exact graph, not an arbitrary BFS witness.
  const path=new Set();let cursor=graph.nodes[0]?.id;
  for(const event of s.events){const edge=graph.edges.find(e=>e.from===cursor&&e.thread===event.thread);if(!edge)break;path.add(`${edge.from}>${edge.to}`);cursor=edge.to;}
  for(const edge of graph.edges){
   const selected=path.has(`${edge.from}>${edge.to}`);
   const line=this.line([positions.get(edge.from),positions.get(edge.from).clone().lerp(positions.get(edge.to),.5).add(V(0,.05,0)),positions.get(edge.to)],selected?THREADS[edge.thread]:0x354d5a,selected?.034:.01);
   line.userData.schedulePath=selected;
  }
  const active=`d${Number(s.ordered)}:${s.pcs.join(',')}:${s.owners.map(x=>x===null?'-':x).join(',')}`;
  for(const node of graph.nodes){
   const p=positions.get(node.id),selected=node.id===active;
   const tint=node.status==='deadlock'?COLORS.red:node.status==='complete'?COLORS.mint:selected?COLORS.white:COLORS.slate;
   const ball=this.mesh(this.geometry('SphereGeometry',selected?.23:.14,18,14),tint,p,.5);ball.userData.node=node.id;this.picks.push(ball);
   if(selected||node.status==='deadlock'){
    const halo=this.mesh(this.geometry('TorusGeometry',selected?.34:.25,.018,8,36),tint,p.clone().add(V(0,-.09,0)),.65);halo.rotation.x=Math.PI/2;
   }
   if(node.status==='deadlock'||node.status==='complete')this.label(node.status==='deadlock'?'DEADLOCK':'ФИНИШ',p.clone().add(V(0,.65,0)),node.status==='deadlock'?'amber':'mint');
   if(selected)this.label('СЕЙЧАС',p.clone().add(V(0,-.3,.15)),'strong');
  }
  this.label(`${graph.nodes.length} СОСТОЯНИЙ · ${graph.deadlocks.length} ТУПИКОВ`,V(0,1.8,-1),'strong mint');
 }
 async dispose(){
  if(this.disposed)return;
  this.disposed=true;this.ready=false;this.status='disposed';this.epoch++;
  this.cancelFrame();this.observer?.disconnect();this.controls?.dispose();
  for(const remove of [...this.listeners,...this.canvasListeners])remove();this.listeners=[];this.canvasListeners=[];
  this.clear();this.resources.dispose();for(const resource of this.staticResources)resource.dispose();
  this.staticResources=[];this.scene.clear();this.lastSnapshot=null;this.activeSnapshot=null;
  if(this.renderer){
   const renderer=this.renderer;this.renderer=null;renderer.onDeviceLost=()=>{};
   // Initialization may still be creating resources. Dispose only after it settles.
   if(this.initializing)void this.initializing.then(()=>this.releaseBackend(renderer),()=>this.releaseBackend(renderer));
   else await this.releaseBackend(renderer);
  }
  this.notify();
 }
}
