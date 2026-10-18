import {gzip,ungzip} from 'pako';
import type {PreparedRace} from '../analysis/prepared';

const analysisFields=['cornerPath','statusImpacts','hillImpacts','hillTotals','skillImpacts','receivedDebuffImpacts','receivedDebuffTotals','slowdown'] as const;
const preparedFields=['modes','totals','impacts'] as const;
const motionFields=['trafficLoss','exhaustionLoss','distanceLoss','timeLoss','assessedDistanceLoss','assessedTimeLoss','observedTrafficDeficit','observedTrafficTime','observedTrafficDuration','observedTrafficAssessedDuration','observedTrafficCoverage'] as const;
const pick=(value:object,keys:readonly string[])=>Object.fromEntries(keys.map(k=>[k,(value as Record<string,unknown>)[k]]));

/** Disposable mathematical results only. Never restore a cached replay, hidden
 * state, decision, activation, target, roll or effective stat as verified data. */
export function packDerived(value:PreparedRace,key:string){
  return gzip(JSON.stringify({schema:1,key,runners:Object.fromEntries(value.race.runners.map(r=>{
    const a=value.analysis.runners[r.id],p=value.runners[r.id];
    return [r.id,{analysis:pick(a,analysisFields),prepared:pick(p,preparedFields),motion:pick(p.motion,motionFields),
      breakdown:a.statBreakdown,gap:a.summary.finishGapDistance,models:a.intervals.map(i=>({kind:i.kind,start:i.start,model:i.model})),
      metrics:Object.fromEntries(Object.entries(p.metrics).map(([id,metrics])=>[id,metrics.filter(m=>m.evidence!=='simulated')]))}];
  }))}));
}
export function restoreDerived(value:PreparedRace,key:string,packed:Uint8Array):boolean{
  try{
    const saved=JSON.parse(ungzip(packed,{to:'string'}));
    if(saved.schema!==1||saved.key!==key||!saved.runners)return false;
    for(const r of value.race.runners){const s=saved.runners[r.id];
      if(!s?.analysis||!s.prepared?.totals||!s.prepared.impacts||!Array.isArray(s.prepared.modes)||!s.motion?.trafficLoss||!s.breakdown?.stats||!s.breakdown.startingHp||!Array.isArray(s.models))return false;
      if(['speed','stamina','power','guts','wisdom'].some(k=>!s.breakdown.stats[k]))return false;
      if(Object.values(s.metrics??{}).some(m=>!Array.isArray(m)))return false;
    }
    for(const r of value.race.runners){const s=saved.runners[r.id],a=value.analysis.runners[r.id],p=value.runners[r.id];
      Object.assign(a,pick(s.analysis,analysisFields));Object.assign(p,pick(s.prepared,preparedFields));
      Object.assign(p.motion,pick(s.motion,motionFields));p.inferredMotion=p.motion;
      for(const stat of ['speed','stamina','power','guts','wisdom'] as const){
        const final=a.statBreakdown.stats[stat].final;a.statBreakdown.stats[stat]={...s.breakdown.stats[stat],final};
      }
      a.statBreakdown.startingHp={...s.breakdown.startingHp,observed:a.summary.hpStart,modeled:a.summary.hpStart};
      a.summary.finishGapDistance=s.gap;
      for(const interval of a.intervals){const model=s.models.find((i:{kind:string;start:number})=>i.kind===interval.kind&&i.start===interval.start)?.model;if(model)interval.model=model;}
      for(const [id,metrics]of Object.entries(s.metrics??{}))p.metrics[Number(id)]=[...(p.metrics[Number(id)]??[]).filter(m=>m.evidence==='simulated'),...(metrics as typeof p.metrics[number]).filter(m=>m.evidence!=='simulated')];
    }
    return true;
  }catch{return false;}
}
