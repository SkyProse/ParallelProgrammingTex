/** Presentation policies contain no simulation state or physical timing claims. */
export class QualityPolicy {
  constructor({dpr=1,width=1,height=1,mode='auto'}={}) {
    this.mode=mode;
    this.scale=1;
    this.slow=0;
    this.fast=0;
    this.resize({dpr,width,height});
    this.setMode(mode);
  }

  resize({dpr=this.dpr,width=this.width,height=this.height}={}) {
    this.dpr=Number.isFinite(dpr)&&dpr>0?dpr:1;
    this.width=Math.max(1,width||1);
    this.height=Math.max(1,height||1);
    return this.pixelRatio;
  }

  get pixelRatio() {
    if(this.mode==='high')return Math.min(this.dpr,2);
    if(this.mode==='low')return Math.min(this.dpr,1);
    const budget=Math.sqrt(2_500_000/(this.width*this.height));
    return Math.min(this.dpr,1.75,budget)*this.scale;
  }

  setMode(mode) {
    if(!['auto','high','low'].includes(mode))throw new RangeError('Unknown rendering quality');
    this.mode=mode;this.scale=1;this.slow=0;this.fast=0;
    return this.pixelRatio;
  }

  /** RAF intervals of a continuous visual transition, never idle wall time. */
  observeFrame(milliseconds) {
    if(this.mode!=='auto'||!Number.isFinite(milliseconds)||milliseconds<=0||milliseconds>100)return false;
    this.slow=milliseconds>30?this.slow+1:0;
    this.fast=milliseconds<19?this.fast+1:0;
    const before=this.scale;
    if(this.slow>=24){this.scale=Math.max(.55,this.scale-.15);this.slow=0;this.fast=0;}
    if(this.fast>=120){this.scale=Math.min(1,this.scale+.1);this.fast=0;this.slow=0;}
    return before!==this.scale;
  }
}

/** Reuse resources across snapshots. Only inactive entries can be evicted. */
export class ResourcePool {
  constructor(maxCached=160){this.entries=new Map();this.generation=0;this.maxCached=maxCached;}
  get size(){return this.entries.size;}
  begin(){this.generation++;}
  get(key,create){
    let entry=this.entries.get(key);
    if(!entry){entry={resource:create(),generation:this.generation};this.entries.set(key,entry);}
    entry.generation=this.generation;
    return entry.resource;
  }
  end(){
    if(this.entries.size<=this.maxCached)return;
    for(const [key,entry] of this.entries){
      if(this.entries.size<=this.maxCached)break;
      if(entry.generation===this.generation)continue;
      entry.resource.dispose?.();this.entries.delete(key);
    }
  }
  dispose(){for(const {resource} of this.entries.values())resource.dispose?.();this.entries.clear();}
}

export function inspectGPUCell(result,index){
  if(!Number.isInteger(index)||index<0)return null;
  if(result?.status!=='ok')return index<256?{type:'gpu',provenance:'schematic',cell:index}:null;
  const value=result.values?.[index];
  if(!value)return null;
  return {type:'gpu',provenance:result.kind==='imported-gpu'?'imported':'measured',...value};
}

/** Screen-space label layout. Strong labels may move slightly; details yield. */
export function layoutLabels(labels,{width,height,margin=12,gap=4}={}){
  const placed=[],result=labels.map(({id})=>({id,visible:false}));
  const ordered=labels.map((label,index)=>({...label,index})).sort((a,b)=>(b.priority??0)-(a.priority??0)||a.index-b.index);
  for(const label of ordered){
    if(![label.x,label.y,label.width,label.height].every(Number.isFinite)||label.width<=0||label.height<=0)continue;
    if(label.width>width-2*margin||label.height>height-2*margin)continue;
    const offsets=(label.priority??0)>0?[0,-14,14,-28,28]:[0];
    for(const offset of offsets){
      const x=Math.min(width-margin-label.width/2,Math.max(margin+label.width/2,label.x));
      const y=Math.min(height-margin-label.height/2,Math.max(margin+label.height/2,label.y+offset));
      const rectangle={id:label.id,visible:true,x,y,left:x-label.width/2,right:x+label.width/2,top:y-label.height/2,bottom:y+label.height/2};
      if(placed.some(other=>!(rectangle.right+gap<=other.left||other.right+gap<=rectangle.left||rectangle.bottom+gap<=other.top||other.bottom+gap<=rectangle.top)))continue;
      placed.push(rectangle);result[label.index]=rectangle;break;
    }
  }
  return result;
}
