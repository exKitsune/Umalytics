import type { Race } from './types';
import type { RaceAnalysis } from './analytics';
import type { ReferenceData } from './reference';
import type { EffectUtilization } from './effect-types';
import { motionSkillImpact } from './motion-skill-impact';
import { motionBenefitFor } from './motion-analysis';
import { preparedFor } from '../analysis/prepared';

/** Component seconds have a common denominator. HP capacity, stat coefficients
 * and lane travel do not, and must not be averaged into a movement score. */
export function movementUse(effects:EffectUtilization[]){
  let active=0,assessed=0,credit=0;
  for(const effect of effects){active+=effect.activeDuration??0;assessed+=effect.assessedDuration;credit+=effect.usefulDuration??0;}
  return {score:assessed>0?credit/assessed:null,coverage:active>0?Math.min(1,assessed/active):0,active,assessed};
}

const cache=new WeakMap<RaceAnalysis,Map<string,ReturnType<typeof buildTotals>>>();
export function skillTotals(race:Race,reference:ReferenceData|null,analysis:RaceAnalysis,runnerId:string,courseId?:number|null):ReturnType<typeof buildTotals>{
  const ready=preparedFor(analysis)?.runners[runnerId];if(ready&&(courseId==null||courseId===race.courseId))return ready.totals;
  let saved=cache.get(analysis);if(!saved)cache.set(analysis,saved=new Map());
  const key=`${runnerId}/${courseId??race.courseId}`;
  let result=saved.get(key);if(!result){result=buildTotals(race,reference,analysis,runnerId,courseId);saved.set(key,result);}return result;
}
function buildTotals(race:Race,reference:ReferenceData|null,analysis:RaceAnalysis,runnerId:string,courseId?:number|null){
  const detail=analysis.runners[runnerId];
  const skills=(detail?.skillRows??[]).filter(row=>row.effectiveActive).flatMap(row=>{
    const motion=motionSkillImpact(race,reference,analysis,runnerId,row.skillId,courseId);
    return motion?[{skillId:row.skillId,motion,...movementUse(motion.effects)}]:[];
  });
  const ids=new Set(skills.map(row=>row.skillId));
  const activations=(detail?.skillActivations??[]).filter(a=>ids.has(a.referenceSkillId??a.skillId)&&a.effectiveEnd!==null&&a.effectiveEnd>a.start);
  // Remove the whole set once. Adding individual marginal gains double-counts
  // interactions (especially speed + acceleration and simultaneous expiry).
  const benefit=activations.length?motionBenefitFor(race,reference,analysis,runnerId,activations,courseId):null;
  const use=movementUse(skills.flatMap(row=>row.motion.effects));
  return {skills,benefit,...use};
}
