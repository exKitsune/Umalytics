import type { Race } from './types';
import type { ReferenceData } from './reference';
import type { RaceAnalysis, SkillActivation } from './analytics';
import { activationMotionKey, createRaceMotionEngine, type RunnerMotion } from './race-motion';
import { measureMotionBenefit } from './motion-benefit';

const cache=new WeakMap<RaceAnalysis,Map<number,{engine:ReturnType<typeof createRaceMotionEngine>;paths:Map<string,RunnerMotion>}>>();
function motionEntry(race:Race,reference:ReferenceData|null,analysis:RaceAnalysis,courseId?:number|null){
  let courses=cache.get(analysis);if(!courses)cache.set(analysis,courses=new Map());
  const course=courseId??race.courseId??-1;let entry=courses.get(course);
  if(!entry){entry={engine:createRaceMotionEngine(race,reference,courseId,analysis),paths:new Map()};courses.set(course,entry);}
  return entry;
}
/** Lazy, immutable replay-context scenarios shared by charts and skill cards. */
export function motionFor(race:Race,reference:ReferenceData|null,analysis:RaceAnalysis,runnerId:string,courseId?:number|null,excludeActivationKey?:string|readonly string[],applyInferredModes=false,excludeEffectTypes?:readonly number[]):RunnerMotion {
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
  const keys=activations.map(a=>activationMotionKey(runnerId,a)),speedTypes=[21,22,27];
  const full=motionFor(race,reference,analysis,runnerId,courseId,undefined,true);
  const without=motionFor(race,reference,analysis,runnerId,courseId,keys,true);
  const effects=activations.flatMap(a=>a.effects).filter(e=>(e.targetType??1)===1);
  const hasSpeed=effects.some(e=>speedTypes.includes(e.type));
  const hasOther=effects.some(e=>!speedTypes.includes(e.type));
  const speedWithout=hasSpeed?hasOther?motionFor(race,reference,analysis,runnerId,courseId,keys,true,speedTypes):without:null;
  const potential=motionEntry(race,reference,analysis,courseId).engine.speedPotential(runnerId,keys);
  return measureMotionBenefit(full,without,activations.filter(a=>a.effectiveEnd!==null&&a.effectiveEnd>a.start).map(a=>({start:a.start,end:a.effectiveEnd!})),speedWithout,potential);
}
