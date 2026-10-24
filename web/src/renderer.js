import * as THREE from 'three/webgpu';
import {uniform, color} from 'three/tsl';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const COLORS={cyan:0x6ed7ef,amber:0xffc17a,mint:0xa7efc5,red:0xff8e91,slate:0x526f80,white:0xe8f4ef};
const THREADS=[COLORS.cyan,COLORS.amber];
const V=(x,y,z)=>new THREE.Vector3(x,y,z);

/** Rendering reads snapshots. Neither camera nor animation owns semantic time. */
export class TheatreRenderer {
 constructor({canvas,labels,onAction,onNode,onBackend}){
  this.canvas=canvas;this.labelsEl=labels;this.onAction=onAction;this.onNode=onNode;this.onBackend=onBackend;
  this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x122029);this.scene.fog=new THREE.FogExp2(0x122029,.045);
  this.camera=new THREE.PerspectiveCamera(38,1,.1,80);this.camera.position.set(7,7,10);
  this.group=new THREE.Group();this.scene.add(this.group);this.labelPoints=[];this.picks=[];this.flows=[];this.paused=false;this.ready=false;
  this.pulse=uniform(.6);this.motion=!matchMedia('(prefers-reduced-motion: reduce)').matches;
  this.scene.add(new THREE.HemisphereLight(0xb8e6ef,0x233332,2.6));
  const key=new THREE.DirectionalLight(0xcce9f3,3.7);key.position.set(-3,8,5);this.scene.add(key);
  const rim=new THREE.DirectionalLight(0x83dfba,2);rim.position.set(5,3,-6);this.scene.add(rim);
  const warm=new THREE.PointLight(0xffc17a,18,20,2);warm.position.set(4,4,3);this.scene.add(warm);
  const grid=new THREE.GridHelper(28,28,0x324a52,0x233740);grid.position.y=-.48;grid.material.transparent=true;grid.material.opacity=.42;this.scene.add(grid);
  const disk=new THREE.Mesh(new THREE.CylinderGeometry(4.6,4.8,.14,80),new THREE.MeshStandardMaterial({color:0x1c3039,metalness:.3,roughness:.8}));disk.position.y=-.57;this.scene.add(disk);
  this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();
 }
 async init(){
  try{
   const forceWebGL=new URL(location.href).searchParams.get('renderer')==='webgl';
   this.renderer=new THREE.WebGPURenderer({canvas:this.canvas,antialias:true,alpha:false,forceWebGL});
   this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));
   this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.15;
   await this.renderer.init();
   this.controls=new OrbitControls(this.camera,this.canvas);this.controls.target.set(0,.1,0);this.controls.enableDamping=false;this.controls.enablePan=false;
   this.controls.minDistance=6;this.controls.maxDistance=21;this.controls.maxPolarAngle=Math.PI*.48;this.controls.minPolarAngle=.25;
   this.controls.addEventListener('change',()=>this.requestRender());
   this.controls.update();this.ready=true;
   this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(this.canvas.parentElement);
   this.resize();this.installPicking();
   this.onBackend(this.renderer.backend.isWebGPUBackend?'WebGPU · TSL':'WebGL 2 · TSL');
   this.requestRender();return true;
  }catch(error){
   this.ready=false;try{this.renderer?.dispose();}catch{}
   this.onBackend('2D / текст');this.failure=String(error?.message||error);return false;
  }
 }
 resize(){if(!this.ready)return;const r=this.canvas.parentElement.getBoundingClientRect();if(!r.width||!r.height)return;this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix();this.requestRender();}
 installPicking(){
  let start=null;
  this.canvas.addEventListener('pointerdown',e=>start={x:e.clientX,y:e.clientY});
  this.canvas.addEventListener('pointerup',e=>{
   if(!start||Math.hypot(e.clientX-start.x,e.clientY-start.y)>6||this.paused)return;start=null;
   const rect=this.canvas.getBoundingClientRect();this.pointer.set(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
   this.raycaster.setFromCamera(this.pointer,this.camera);const hit=this.raycaster.intersectObjects(this.picks,true)[0];
   if(hit){let o=hit.object;while(o&&!o.userData.action&&o.userData.thread===undefined&&!o.userData.node)o=o.parent;
    if(o?.userData.node)this.onNode?.(o.userData.node);else if(o?.userData.thread!==undefined)this.onAction?.(o.userData.thread);}
  });
 }
 resetCamera(){this.camera.position.set(7,7,10);this.controls?.target.set(0,.1,0);this.controls?.update();this.requestRender();}
 setPaused(value){this.paused=value;if(value&&this.raf){cancelAnimationFrame(this.raf);this.raf=null;}if(!value)this.requestRender();}
 setVisible(value){this.visible=value;if(value)this.requestRender();}
 requestRender(){if(!this.ready||this.paused||this.visible===false||this.raf)return;this.raf=requestAnimationFrame(()=>{this.raf=null;this.draw();});}
 draw(){
  if(!this.ready||this.paused||this.visible===false)return;
  try{
   const now=performance.now();let animating=false;
   for(const flow of this.flows){const t=Math.min(1,(now-flow.start)/650);flow.mesh.position.copy(flow.curve.getPoint(t));flow.mesh.visible=t<1;animating||=t<1;}
   this.renderer.render(this.scene,this.camera);this.positionLabels();if(animating)this.requestRender();
  }catch(error){this.ready=false;this.failure=String(error?.message||error);this.onBackend('Ошибка GPU · доступна партитура');}
 }
 positionLabels(){
  const r=this.canvas.getBoundingClientRect();
  for(const item of this.labelPoints){const p=item.position.clone().project(this.camera);item.el.style.left=`${(p.x*.5+.5)*r.width}px`;item.el.style.top=`${(-p.y*.5+.5)*r.height}px`;item.el.style.display=p.z>1?'none':'';}
 }
 clear(){
  const geometries=new Set(),materials=new Set();this.group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});
  this.group.clear();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();this.labelsEl.replaceChildren();this.labelPoints=[];this.picks=[];this.flows=[];
 }
 material(tint,glow=.08){const m=new THREE.MeshStandardNodeMaterial({color:tint,roughness:.32,metalness:.4});m.emissiveNode=color(tint).mul(this.pulse.mul(glow));return m;}
 mesh(geometry,tint,position,glow=.08){const m=new THREE.Mesh(geometry,this.material(tint,glow));m.position.copy(position);this.group.add(m);return m;}
 label(text,position,cls=''){const el=document.createElement('span');el.className=`world-label ${cls}`;el.textContent=text;this.labelsEl.append(el);this.labelPoints.push({el,position});}
 line(points,tint,radius=.016,dashed=false){
  const curve=new THREE.CatmullRomCurve3(points);
  if(dashed){const geometry=new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));const line=new THREE.Line(geometry,new THREE.LineDashedMaterial({color:tint,dashSize:.13,gapSize:.1,transparent:true,opacity:.8}));line.computeLineDistances();this.group.add(line);return;}
  this.mesh(new THREE.TubeGeometry(curve,32,radius,6,false),tint,V(0,0,0),.25);
 }
 arrow(from,to,tint,dashed=false,flow=false){const midpoint=from.clone().lerp(to,.5);midpoint.y+=.5;this.line([from,midpoint,to],tint,.025,dashed);const direction=to.clone().sub(midpoint).normalize();const cone=this.mesh(new THREE.ConeGeometry(.08,.19,12),tint,to.clone().addScaledVector(direction,-.07),.2);cone.quaternion.setFromUnitVectors(V(0,1,0),direction);if(flow&&this.motion&&!dashed){const particle=this.mesh(new THREE.SphereGeometry(.075,12,8),COLORS.white,from,.8);this.flows.push({mesh:particle,curve:new THREE.CatmullRomCurve3([from,midpoint,to]),start:performance.now()});}}
 actor(thread,position,subtitle){
  const tint=THREADS[thread];const actor=new THREE.Group();actor.position.copy(position);actor.userData.thread=thread;
  const base=new THREE.Mesh(new THREE.CylinderGeometry(.46,.51,.16,48),this.material(0x263f49));base.position.y=-.27;actor.add(base);
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.32,.38,.5,40),this.material(tint,.13));actor.add(body);
  const cap=new THREE.Mesh(new THREE.TorusGeometry(.39,.025,12,48),this.material(tint,.4));cap.rotation.x=Math.PI/2;cap.position.y=.28;actor.add(cap);
  this.group.add(actor);this.picks.push(actor);
  this.label(`ПОТОК T${thread}`,position.clone().add(V(0,.75,0)),`strong ${thread?'amber':'cyan'}`);
  if(subtitle)this.label(subtitle,position.clone().add(V(0,-.45,.3)),thread?'amber':'cyan');return position;
 }
 lock(index,owner,position){
  const tint=owner===null?COLORS.mint:THREADS[owner];
  this.mesh(new THREE.BoxGeometry(.58,.48,.28),tint,position,.13);
  const loop=this.mesh(new THREE.TorusGeometry(.2,.055,12,28,Math.PI),tint,position.clone().add(V(0,.29,0)),.15);
  loop.rotation.z=owner===null?-.2:0;
  this.mesh(new THREE.SphereGeometry(.035,12,8),0x173039,position.clone().add(V(0,0,.16)));
  this.label(`LOCK ${index?'B':'A'}`,position.clone().add(V(0,-.45,0)),'strong mint');
  this.label(owner===null?'свободен':`владелец T${owner}`,position.clone().add(V(0,-.7,0)));
 }
 update(scene,state,{graph=null,graphMode=false,gpuResult=null}={}){
  this.clear();this.currentScene=scene;
  if(graphMode&&graph)this.graph(graph,state);
  else if(scene==='deadlock')this.deadlock(state);
  else if(scene==='race')this.race(state);
  else if(scene==='memory')this.memory(state);
  else if(scene==='cas')this.cas(state);
  else if(scene==='gpu')this.gpu(gpuResult);
  else this.gpu(null);
  this.requestRender();
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
  this.mesh(new THREE.BoxGeometry(1.05,1.05,1.05),s.mode==='unsafe'?COLORS.red:COLORS.mint,V(0,.5,-.8),.16);
  this.label(`shared = ${s.value}`,V(0,1.55,-.8),'strong mint');
  this.label(s.mode==='atomic'?'АТОМАРНАЯ ОПЕРАЦИЯ':s.mode==='snapshot'?'НЕИЗМЕННЫЙ СНИМОК':'READ → LOCAL + 1 → WRITE',V(0,-.3,-.1));
 }
 memory(s){
  this.actor(0,V(-2.8,.55,-1.8),'cache 0');this.actor(1,V(2.8,.55,-1.8),'cache 1');
  const objects=[...s.memory.objects].sort((a,b)=>a.address-b.address);const cols=8;const rows=Math.ceil(objects.length/cols);const width=.57;
  const locations=objects.map((o,i)=>V((i%cols-(cols-1)/2)*width,.05,(Math.floor(i/cols)-(rows-1)/2)*.95+.85));
  for(const line of s.memory.lines){
   const points=objects.map((o,i)=>o.line===line.line?locations[i]:null).filter(Boolean);
   const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minZ=Math.min(...points.map(p=>p.z)),maxZ=Math.max(...points.map(p=>p.z));
   this.mesh(new THREE.BoxGeometry(maxX-minX+.56,.06,maxZ-minZ+.76),s.owners[line.line]===0?0x264956:s.owners[line.line]===1?0x514333:0x29404b,V((minX+maxX)/2,-.17,(minZ+maxZ)/2));
   if(points.length>1)this.label(`CACHE LINE ${line.line}`,V(maxX+.9,-.15,(minZ+maxZ)/2));
  }
  objects.forEach((object,i)=>{
   const position=locations[i];
   const owner=s.owners[object.line];const tint=owner===0?COLORS.cyan:owner===1?COLORS.amber:object.field==='a'?0x527d86:0x657a68;
   const cube=this.mesh(new THREE.BoxGeometry(.48,.32,.55),tint,position,.12);
   cube.userData.line=object.line;
   this.label(`${object.field}${object.index}`,position.clone().add(V(0,.38,0)),object.field==='a'?'cyan':'amber');
   this.label(`+${object.address} · L${object.line}`,position.clone().add(V(0,-.22,.13)));
  });
  const last=s.events.at(-1);if(last){const i=objects.findIndex(o=>o.index===last.index&&o.field===last.field);const p=locations[i].clone().add(V(0,.4,0)),actor=V(last.thread?2.8:-2.8,.65,-1.8);this.arrow(last.op==='read'?p:actor,last.op==='read'?actor:p,THREADS[last.thread],false,true);}
  this.label(`${s.config.layout.toUpperCase()} · ${s.memory.bytes} БАЙТ · ЛИНИЯ ${s.config.lineSize} Б`,V(0,1.6,.1),'strong mint');
 }
 cas(s){
  this.actor(0,V(-2.6,.55,-1.65),s.threads[0].phase);this.actor(1,V(2.6,.55,-1.65),s.threads[1].phase);
  const order=[];let id=s.head;while(id&&order.length<4){order.push(id);id=s.nodes[id]?.next;}
  for(const name of Object.keys(s.nodes))if(!order.includes(name))order.push(name);
  const positions=new Map();order.forEach((name,i)=>{const node=s.nodes[name];const p=V((i-1)*1.7,.35,1);positions.set(name,p);this.mesh(new THREE.BoxGeometry(.8,.65,.65),node.published?(name==='dummy'?COLORS.mint:name==='n0'?COLORS.cyan:COLORS.amber):COLORS.slate,p,.15);this.label(name==='dummy'?'DUMMY':`NODE ${node.value}`,p.clone().add(V(0,.68,0)),'strong');this.label(node.published?'в очереди':'локальный',p.clone().add(V(0,-.55,.15)));if(name===s.tail)this.label('TAIL ↓',p.clone().add(V(0,1.1,0)),'mint');});
  for(const node of Object.values(s.nodes))if(node.next)this.arrow(positions.get(node.id).clone().add(V(.45,0,0)),positions.get(node.next).clone().add(V(-.45,0,0)),COLORS.mint);
 }
 gpu(result){
  const data=result?.status==='ok'?result.values:null;const count=Math.min(data?.length??256,4096);const cols=Math.ceil(Math.sqrt(count));
  const geometry=new THREE.BoxGeometry(.82,.5,.82);const material=this.material(COLORS.mint,.2);const mesh=new THREE.InstancedMesh(geometry,material,count);const dummy=new THREE.Object3D();const palette=[COLORS.cyan,COLORS.amber,COLORS.mint,0xb2a2ef,0xe1a6c2,0x85cbd0];const scale=7/cols;
  for(let i=0;i<count;i++){dummy.position.set((i%cols-(cols-1)/2)*scale,-.05+(data?((data[i].workgroupId%3)*.08):0),(Math.floor(i/cols)-(cols-1)/2)*scale);dummy.scale.set(scale,scale,scale);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);mesh.setColorAt(i,new THREE.Color(data?palette[data[i].workgroupId%palette.length]:0x41606b));}
  mesh.instanceMatrix.needsUpdate=true;this.group.add(mesh);
  this.label(data?`${count}${count<data.length?' / '+data.length:''} ВЫЗОВОВ · ${result.workgroups.length} ГРУПП ВСЕГО`:'ПРОСТРАНСТВО GPU-ВЫЗОВОВ',V(0,1.9,0),'strong mint');
  this.label(data?(result.kind==='imported-gpu'?'ИМПОРТ · СТРУКТУРА ПРОВЕРЕНА':'ДАННЫЕ ПРОЧИТАНЫ С GPU'):'РАСКЛАДКА ДО ЗАПУСКА · ЕЩЁ НЕ РЕЗУЛЬТАТ',V(0,-.3,4));
  if(data){const seen=new Set();for(let i=0;i<count;i++){const g=data[i].workgroupId;if(!seen.has(g)&&seen.size<64){seen.add(g);this.label(`WG ${g}`,V((i%cols-(cols-1)/2)*scale,.42,(Math.floor(i/cols)-(cols-1)/2)*scale));}}}
 }
 graph(graph,s){
  const byDepth=new Map();for(const node of graph.nodes){if(!byDepth.has(node.depth))byDepth.set(node.depth,[]);byDepth.get(node.depth).push(node);}
  const positions=new Map();for(const [depth,nodes]of byDepth)nodes.forEach((node,i)=>positions.set(node.id,V((depth-5)*.68,.2,(i-(nodes.length-1)/2)*1.15)));
  for(const edge of graph.edges){this.line([positions.get(edge.from),positions.get(edge.from).clone().lerp(positions.get(edge.to),.5).add(V(0,.05,0)),positions.get(edge.to)],THREADS[edge.thread],.012);}
  const active=`d${Number(s.ordered)}:${s.pcs.join(',')}:${s.owners.map(x=>x===null?'-':x).join(',')}`;
  for(const node of graph.nodes){const p=positions.get(node.id);const tint=node.status==='deadlock'?COLORS.red:node.status==='complete'?COLORS.mint:node.id===active?COLORS.white:COLORS.slate;const ball=this.mesh(new THREE.SphereGeometry(node.id===active ? .22 : .14,18,14),tint,p,.5);ball.userData.node=node.id;this.picks.push(ball);if(node.status==='deadlock'||node.status==='complete')this.label(node.status==='deadlock'?'DEADLOCK':'ФИНИШ',p.clone().add(V(0,.55,0)),node.status==='deadlock'?'amber':'mint');}
  this.label(`${graph.nodes.length} СОСТОЯНИЙ · ${graph.deadlocks.length} ТУПИКОВ`,V(0,1.8,-1),'strong mint');
 }
 dispose(){this.paused=true;if(this.raf)cancelAnimationFrame(this.raf);this.observer?.disconnect();this.controls?.dispose();this.clear();this.renderer?.dispose();}
}
