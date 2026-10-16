import type { Race } from './types';
import type { RaceAnalysis, StatusInterval } from './analytics';
import { effectValue } from './effect-value';
import { trace } from './effect-sampling';

const dashCache=new WeakMap<Pick<RaceAnalysis,'runners'>,Map<string,{time:number;state:boolean|null;speed:number|null}[]>>();
/** Start dash is a one-way latch. A current-speed buff cannot clear it.
 * The recorded speed can cross the cap between samples; the exit is that crossing. */
export function startDashStateAt(race:Race,analysis:Pick<RaceAnalysis,'runners'>,runnerId:string,time:number):boolean|null {
  if(race.distance===null)return null;let ids=dashCache.get(analysis);if(!ids)dashCache.set(analysis,ids=new Map());let states=ids.get(runnerId);
  const threshold=.85*(20-(race.distance-2000)/1000);
  if(!states){let state:boolean|null=null;states=trace(race,runnerId).map((p,i)=>{
    const self=p.sample.speed===null?null:selfSpeedAt(race,analysis,runnerId,p.time,p.sample.speed);
    if(i===0&&p.time===0&&self!==null&&self<=3.1)state=true;
    if(state!==false){if(self===null)state=null;else if(self>=threshold)state=false;}
    return {time:p.time,state,speed:self};});ids.set(runnerId,states);}
  let index=0;while(index<states.length&&states[index].time<=time)index++;
  const here=states[index-1];if(!here)return null;
  const next=states[index];
  if(here.state===true&&next?.state===false&&here.speed!=null&&next.speed!=null&&next.speed>here.speed){
    const cross=here.time+(threshold-here.speed)/(next.speed-here.speed)*(next.time-here.time);
    if(time>=cross)return false;
  }
  return here.state;
}

/** Actual recorded velocity contains current-speed skill modifiers. HP uses
 * self velocity. Unknown foreign masks/scaling never silently become zero. */
export function selfSpeedAt(race:Race,analysis:Pick<RaceAnalysis,'runners'>,runnerId:string,time:number,actual:number):number|null {
  const runner=race.runners.find(r=>r.id===runnerId);if(!runner)return null;let modifier=0;
  for(const source of race.runners)for(const activation of analysis.runners[source.id].skillActivations){
    if(time<activation.start||activation.effectiveEnd!==null&&time>=activation.effectiveEnd)continue;
    for(const effect of activation.effects.filter(e=>[21,22].includes(e.type))){
      const foreign=(effect.targetType??1)!==1;
      if(!foreign&&source.id!==runnerId)continue;
      if(foreign){
        const event=race.events.find(e=>e.skillId===activation.skillId&&e.time===activation.start&&(e.runnerId===source.id||e.runnerId===null&&e.params[0]===source.index));
        if(!Number.isInteger(event?.params[4]))return null;
        if(!activation.targetRunnerIds.includes(runnerId))continue;
        if(source.teamGroup!=null&&runner.teamGroup!=null&&source.teamGroup===runner.teamGroup)continue;
      }
      if(activation.effectiveEnd===null)return null;
      const value=effectValue(source,activation.referenceSkillId??activation.skillId,effect);if(value===null)return null;modifier+=value;
    }
  }
  return Math.max(0,actual-modifier);
}
export function statusHpFactor(intervals:StatusInterval[],time:number,style:number|null,excluded:string|null=null):number {
  const active=(kind:string)=>kind!==excluded&&intervals.some(i=>i.kind.replace(/-model$/,'')===kind&&time>=i.start&&time<(i.end??i.estimatedEnd??i.observedUntil??i.start));
  const spot=active('spot-struggle'),rushed=active('rushed');
  let factor=spot&&rushed?style===5?7.7:3.6:spot?style===5?3.5:1.4:rushed?1.6:1;
  if(active('pace-down'))factor*=.6;if(active('downhill-mode'))factor*=.4;return factor;
}
