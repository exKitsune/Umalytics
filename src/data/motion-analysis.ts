import type { Race } from './types';
import type { ReferenceData } from './reference';
import type { RaceAnalysis, SkillActivation } from './analytics';
import { activationMotionKey, createRaceMotionEngine, type RunnerMotion } from './race-motion';
import { measureMotionBenefit } from './motion-benefit';
import { preparedFor } from '../analysis/prepared';

const cache=new WeakMap<RaceAnalysis,Map<number,{engine:ReturnType<typeof createRaceMotionEngine>;paths:Map<string,RunnerMotion>}>>();
function motionEntry(race:Race,reference:ReferenceData|null,analysis:RaceAnalysis,courseId?:number|null){
  let courses=cache.get(analysis);if(!courses)cache.set(analysis,courses=new Map());
  const course=courseId??race.courseId??-1;let entry=courses.get(course);
  if(!entry){entry={engine:createRaceMotionEngine(race,reference,courseId,analysis),paths:new Map()};courses.set(course,entry);}
  return entry;
}
/** Lazy, immutable replay-context scenarios shared by charts and skill cards. */
export function motionFor(race:Race,reference:ReferenceData|null,analysis:RaceAnalysis,runnerId:string,courseId?:number|null,excludeActivationKey?:string|readonly string[],applyInferredModes=false,excludeEffectTypes?:readonly number[]):RunnerMotion {
  const ready=preparedFor(analysis)?.runners[runnerId];
  if((analysis.source==='simulation'||analysis.source==='recorded')){
    if(!ready||excludeActivationKey||excludeEffectTypes)throw new Error('A simulator counterfactual must be supplied by the simulator.');
    return ready.motion;
  }
  if(ready&&!excludeActivationKey&&!excludeEffectTypes&&(courseId==null||courseId===race.courseId))return applyInferredModes?ready.inferredMotion:ready.motion;
  const entry=motionEntry(race,reference,analysis,courseId);
  const excluded=typeof excludeActivationKey==='string'?[excludeActivationKey]:[...new Set(excludeActivationKey??[])].sort();
  const types=excludeEffectTypes?[...new Set(excludeEffectTypes)].sort((a,b)=>a-b):undefined;
  const key=JSON.stringify([runnerId,excluded,applyInferredModes,types]);let path=entry.paths.get(key);
  if(!path){path=entry.engine.build({runnerId,excludeActivationKeys:excluded,applyInferredModes,excludeEffectTypes:types}).runners[runnerId];entry.paths.set(key,path);}
  return path;
}

/** Acceleration's head start is direct gain, including after its timer ends.
 * Isolate speed-effect carryover with acceleration kept on in both paths. */
export function motionBenefitFor(race:Race,reference:ReferenceData|null,analysis:RaceAnalysis,runnerId:string,activations:SkillActivation[],courseId?:number|null){
  const keys=activations.map(a=>activationMotionKey(runnerId,a)),speedTypes=race.analysisSource==='simulation'?[21,22,27,28]:[21,22,27];
  const full=motionFor(race,reference,analysis,runnerId,courseId,undefined,true);
  const without=motionFor(race,reference,analysis,runnerId,courseId,keys,true);
  const effects=activations.flatMap(a=>a.effects).filter(e=>(e.targetType??1)===1);
  const hasSpeed=effects.some(e=>speedTypes.includes(e.type));
  const hasOther=effects.some(e=>!speedTypes.includes(e.type));
  const speedWithout=hasSpeed?hasOther?motionFor(race,reference,analysis,runnerId,courseId,keys,true,speedTypes):without:null;
  const laneWithoutOrdinarySpeed=effects.some(e=>e.type===28)&&!effects.some(e=>[21,22,27].includes(e.type));
  const potential=laneWithoutOrdinarySpeed?null:motionEntry(race,reference,analysis,courseId).engine.speedPotential(runnerId,keys);
  const windows=activations.filter(a=>a.effectiveEnd!==null&&a.effectiveEnd>a.start).map(a=>({start:a.start,end:a.effectiveEnd!}));
  const benefit=measureMotionBenefit(full,without,windows,speedWithout,potential);
  if(race.analysisSource==='simulation'&&effects.some(e=>e.type===28)){
    const withoutLane=motionFor(race,reference,analysis,runnerId,courseId,keys,true,[28]);
    const other=measureMotionBenefit(withoutLane,without,windows,null);
    // One additive allocation: other effects first, then the lane bonus with
    // those effects enabled. Both use the same no-skill time denominator.
    // Lane/acceleration interactions belong to the lane part, counted once.
    const complete=benefit.coverage>=.999&&other.coverage>=.999&&benefit.carryoverComplete&&other.carryoverComplete;
    const difference=(total:typeof benefit.distance,part:typeof benefit.distance)=>complete&&total&&part?{
      min:total.min-part.min,mid:total.mid-part.mid,max:total.max-part.max,
    }:null;
    const otherTypes=effects.filter(e=>e.type!==28).map(e=>e.type);
    benefit.laneMovement={distance:difference(benefit.distance,other.distance),time:difference(benefit.time,other.time),
      otherDistance:complete?other.distance:null,otherTime:complete?other.time:null,
      otherLabel:!otherTypes.length?null:otherTypes.every(t=>t===31)?'Acceleration':otherTypes.every(t=>[21,22,27].includes(t))?'Speed effects':'Other effects'};
  }
  return benefit;
}
