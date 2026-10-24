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
