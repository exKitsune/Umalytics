import type { Race } from './types';
import { preparedFor } from '../analysis/prepared';
import type { RaceAnalysis,SkillActivation } from './analytics';
import type { ReferenceData } from './reference';
import type { EffectUtilization } from './effect-types';
import { motionFor, motionBenefitFor } from './motion-analysis';
import { activationMotionKey,type MotionBand } from './race-motion';
import { atTime } from './effect-sampling';
import { accelerationUse } from './acceleration-use';
import { effectValue } from './effect-value';
import type { MotionBenefit } from './motion-benefit';

export interface MotionSkillImpact extends MotionBenefit {
  effects:EffectUtilization[];detail:string;
}
const zero=():MotionBand=>({min:0,mid:0,max:0});
const channels=['min','mid','max'] as const;
const envelope=(b:MotionBand):MotionBand=>({min:Math.min(b.min,b.mid,b.max),mid:b.mid,max:Math.max(b.min,b.mid,b.max)});
const cache=new WeakMap<RaceAnalysis,Map<string,MotionSkillImpact|null>>();
/** Split a linearly sampled interval where self speed crosses either target.
 * The targets are conditional reference scenarios, not recovered native draws. */
function targetCredit(self:number,after:number,normal:number,normalAfter:number,boost:number,boostAfter:number,benefit:number,benefitAfter:number,dt:number){
  const cuts=[0,1],cross=(a:number,b:number)=>{if(a*b<0)cuts.push(-a/(b-a));};
  cross(self-normal+.03,after-normalAfter+.03);cross(self-boost+.03,after-boostAfter+.03);cross(benefit-.001,benefitAfter-.001);cuts.sort((a,b)=>a-b);
  const result={credit:0,accelerating:0,decelerating:0,full:0,below:0,capped:0,wasted:0};
  for(let i=1;i<cuts.length;i++){
    const f=(cuts[i-1]+cuts[i])/2,seconds=(cuts[i]-cuts[i-1])*dt,s=self+(after-self)*f,n=normal+(normalAfter-normal)*f,b=boost+(boostAfter-boost)*f,rate=(after-self)/dt;
    if(b<=n+.00001){result.capped+=seconds;continue;}
    // Climbing back to the no-skill speed is not this skill's acceleration.
    if(s<n-.03){result.below+=seconds;result.wasted+=seconds;continue;}
    if(rate<-.02){
      if(benefit+(benefitAfter-benefit)*f>.001){result.full+=seconds;result.decelerating+=seconds;result.credit+=seconds;}
      else result.wasted+=seconds;
      continue;
    }
    if(s>=b-.03){result.full+=seconds;result.credit+=seconds;}
    // Later tiers also get half credit while climbing earlier tiers, starting
    // at the common normal target and ending at their cumulative ceiling.
    else if(rate>.001&&s+0.03>=n){result.accelerating+=seconds;result.credit+=seconds*.5;}
    else result.wasted+=seconds;
  }
  return result;
}
function activationImpact(race:Race,reference:ReferenceData|null,analysis:RaceAnalysis,runnerId:string,a:SkillActivation,courseId?:number|null):MotionSkillImpact|null {
  const effects=a.effects.filter(e=>(e.targetType??1)===1&&[21,22,27,31].includes(e.type));
  if(!effects.length||a.effectiveEnd===null||a.effectiveEnd<=a.start)return null;
  const withSkill=motionFor(race,reference,analysis,runnerId,courseId,undefined,true),without=motionFor(race,reference,analysis,runnerId,courseId,activationMotionKey(runnerId,a),true);
  const capUse=accelerationUse(race,runnerId,withSkill);
  const stop=withSkill.samples.at(-1)?.time??race.duration,end=Math.min(stop,a.effectiveEnd);
  const benefit=motionBenefitFor(race,reference,analysis,runnerId,[a],courseId);
  const activationKey=activationMotionKey(runnerId,a);
  const reasons=new Set<string>(),types=[...new Set(effects.map(e=>e.type===27?'target-speed':e.type===31?'acceleration':'current-speed'))] as EffectUtilization['kind'][];
  const scheduled=a.effectiveDuration??Math.max(0,a.effectiveEnd-a.start),afterFinish=Math.max(0,Math.min(scheduled,a.effectiveEnd-stop));
  const runner=race.runners.find(r=>r.id===runnerId)!;
  const knownAcceleration=effects.filter(e=>e.type===31).reduce((n,e)=>n+(effectValue(runner,a.referenceSkillId??a.skillId,e)??0),0);
  const components:EffectUtilization[]=types.map(kind=>({kind,activeDuration:scheduled,assessedDuration:afterFinish,afterFinishDuration:afterFinish,usefulDuration:0,cappedDuration:0,blockedDuration:0,utilization:null,coverageRate:null,usefulAmongAssessed:null,
    ...(kind==='target-speed'?{scoringConvention:'target-speed-half-credit' as const,acceleratingDuration:0,deceleratingEffectiveDuration:0,fullyEffectiveDuration:0,belowBaselineDuration:0,wastedDuration:0,carryoverEfficiency:null}:{})} satisfies EffectUtilization));
  const credited=new Map(components.map(c=>[c,zero()]));
  const withoutByTime=new Map(without.samples.map(s=>[s.time,s]));
  for(let i=1;i<withSkill.samples.length;i++){
    const p=withSkill.samples[i-1],q=withSkill.samples[i],u=withoutByTime.get(p.time),v=withoutByTime.get(q.time);
    const start=Math.max(a.start,p.time),finish=Math.min(end,q.time),dt=finish-start;
    if(dt<=0)continue;
    // A block flag that changes between samples is held from the sample where it
    // is known. The changing bracket stays readable instead of becoming unknown time.
    const heldBlock=atTime(race,runnerId,p.time)?.blockFrontRunnerIndex??atTime(race,runnerId,q.time)?.blockFrontRunnerIndex;
    const recordedBlocked=heldBlock!=null&&heldBlock>=0;
    const cap=p.constraint.cap;
    const geometryBlocked=p.constraint.kind==='geometry-block'&&cap!==null&&(p.free!==null&&p.free.min>cap+.02||p.selfActual!==null&&p.selfActual<=cap+.02);
    const blocked=recordedBlocked||geometryBlocked;
    for(const component of components){
      // Direct-speed modifiers are added after the front cap; only target and
      // acceleration effects lose use to blocking.
      if(blocked&&component.kind!=='current-speed'){component.assessedDuration+=dt;component.blockedDuration!+=dt;continue;}
      if(p.constraint.kind==='unknown'&&p.selfActual===null)continue;
      if(!u||!v||p.selfActual===null||q.selfActual===null||!p.targetActive||!q.targetActive||!u.targetActive||!v.targetActive)continue;
      if(component.kind==='current-speed'){
        const delta=p.currentSpeedDelta-u.currentSpeedDelta;
        component.assessedDuration+=dt;const useful=Math.abs(delta)>.00001?dt:0;component.usefulDuration!+=useful;for(const c of channels)credited.get(component)![c]+=useful;continue;
      }
      if(component.kind==='acceleration'){
        const rate=(q.selfActual-p.selfActual)/dt;
        component.assessedDuration+=dt;
        if((p.acceleration===null||u.acceleration===null)&&knownAcceleration<=.00001){component.cappedDuration!+=dt;continue;}
        // A zero/negative selected acceleration modifier cannot earn positive
        // acceleration credit merely because the runner's base force is positive.
        for(const c of channels){
          const acceleration=p.accelerationRange?.[c]??p.acceleration??knownAcceleration,selected=acceleration-(u.accelerationRange?.[c]??u.acceleration??0);
          if(selected<=.00001)continue;
          const target=p.targetActive[c],targetAfter=q.time>=a.effectiveEnd-1e-8?v.targetActive[c]+p.targetActive[c]-u.targetActive[c]:q.targetActive[c];let useful=0,capped=0;
          const reconstructed=capUse.get(p.time)?.[c];
          if(reconstructed){useful=reconstructed.useful;capped=reconstructed.capped;}
          else if(p.selfActual<=target+.03&&q.selfActual>=targetAfter-.03&&rate>.001){
            useful=acceleration>0?Math.min(dt,Math.max(0,target-p.selfActual)/acceleration):0;capped=dt-useful;
          }else if(Math.abs(p.selfActual-target)<.03&&Math.abs(q.selfActual-targetAfter)<.03&&Math.abs(rate)<.05)capped=dt;
          else if(p.selfActual<target&&rate>.001)useful=dt;
          credited.get(component)![c]+=useful;
          if(c==='mid'){component.usefulDuration!+=useful;component.cappedDuration!+=capped;}
        }
        continue;
      }
      component.assessedDuration+=dt;
      for(const c of channels){
        if(p.targetActive[c]<u.targetActive[c]-.00001){const useful=p.constrained&&u.constrained&&p.constrained[c]<u.constrained[c]-.001?dt:0;credited.get(component)![c]+=useful;if(c==='mid')component.usefulDuration!+=useful;continue;}
        const stack=p.targetStack,nextStack=q.intervalTargetStack;
        const ceiling=stack?.ceilings[activationKey],nextCeiling=nextStack?.ceilings[activationKey];
        if(ceiling&&stack&&ceiling[c]<=stack.floors[activationKey][c]+.00001){if(c==='mid')component.cappedDuration!+=dt;continue;}
        const normal=ceiling&&stack?stack.baseline[c]:u.targetActive[c];
        const normalAfter=nextCeiling&&nextStack?nextStack.baseline[c]:v.targetActive[c];
        const boosted=ceiling?.[c]??p.targetActive[c];
        const boostedAfter=nextCeiling?.[c]??(q.time>=a.effectiveEnd-1e-8?v.targetActive[c]+p.targetActive[c]-u.targetActive[c]:q.targetActive[c]);
        const benefit=p.constrained&&u.constrained?p.constrained[c]-u.constrained[c]:0,benefitAfter=q.constrained&&v.constrained?q.constrained[c]-v.constrained[c]:0;
        const score=targetCredit(p.selfActual,q.selfActual,normal,normalAfter,boosted,boostedAfter,benefit,benefitAfter,dt);
        credited.get(component)![c]+=score.credit;
        if(c==='mid'){component.usefulDuration!+=score.credit;component.acceleratingDuration!+=score.accelerating;component.deceleratingEffectiveDuration!+=score.decelerating;component.fullyEffectiveDuration!+=score.full;component.belowBaselineDuration!+=score.below;component.wastedDuration!+=score.wasted;component.cappedDuration!+=score.capped;}
      }
    }
  }
  for(const c of components){
    c.assessedDuration=Math.min(scheduled,c.assessedDuration);c.coverageRate=scheduled>0?Math.min(1,c.assessedDuration/scheduled):0;c.usefulAmongAssessed=c.assessedDuration>0?c.usefulDuration!/c.assessedDuration:null;
    const scores=credited.get(c)!;if(c.assessedDuration>0&&scheduled>0){c.scenarioUtilization=envelope({min:scores.min/scheduled,mid:scores.mid/scheduled,max:scores.max/scheduled});}
    c.utilization=c.coverageRate>=.999&&c.scenarioUtilization&&c.scenarioUtilization.max-c.scenarioUtilization.min<.00001?c.usefulAmongAssessed:null;
    if(c.assessedDuration===0){c.usefulDuration=null;c.cappedDuration=null;c.blockedDuration=null;}
  }
  return {...benefit,effects:components,reasons:[...new Set([...benefit.reasons,...reasons])],
    detail:'Gain compares movement with and without this skill in the same replay context. Acceleration’s full head start is direct gain. Carryover is retained speed from speed effects. The two parts are counted once. Time is an equivalent travel saving, not a rerun finish time.'};
}
export function motionSkillImpact(race:Race,reference:ReferenceData|null,analysis:RaceAnalysis,runnerId:string,skillId:number,courseId?:number|null):MotionSkillImpact|null {
  if(analysis.source==='simulation')return preparedFor(analysis)?.runners[runnerId]?.impacts[skillId]??null;
  const ready=preparedFor(analysis)?.runners[runnerId];if(ready&&(courseId==null||courseId===race.courseId)&&skillId in ready.impacts)return ready.impacts[skillId];
  let map=cache.get(analysis);if(!map)cache.set(analysis,map=new Map());const key=`${courseId??race.courseId}/${runnerId}/${skillId}`;
  if(map.has(key))return map.get(key)!;
  const activations=analysis.runners[runnerId]?.skillActivations.filter(a=>(a.referenceSkillId??a.skillId)===skillId)??[];
  const values=activations.map(a=>activationImpact(race,reference,analysis,runnerId,a,courseId)).filter((v):v is MotionSkillImpact=>v!==null);
  const result=values.length===0?null:values.length===1?values[0]:combineImpacts(values,motionBenefitFor(race,reference,analysis,runnerId,activations,courseId));map.set(key,result);return result;
}
function combineImpacts(values:MotionSkillImpact[],benefit:MotionBenefit):MotionSkillImpact {
  const kinds=[...new Set(values.flatMap(v=>v.effects.map(e=>e.kind)))];
  const effects:EffectUtilization[]=kinds.map(kind=>{
    const rows=values.flatMap(v=>v.effects.filter(e=>e.kind===kind));
    const active=rows.reduce((n,r)=>n+(r.activeDuration??0),0),assessed=rows.reduce((n,r)=>n+r.assessedDuration,0);
    const num=(key:keyof EffectUtilization)=>rows.reduce((n,r)=>n+(typeof r[key]==='number'?r[key] as number:0),0);
    const scored=rows.some(r=>r.scoringConvention==='target-speed-half-credit');
    const useful=num('usefulDuration'),full=num('fullyEffectiveDuration'),half=num('acceleratingDuration');
    const scenario=rows.every(r=>r.scenarioUtilization)?envelope({min:rows.reduce((n,r)=>n+r.scenarioUtilization!.min*(r.activeDuration??0),0)/active,mid:useful/active,max:rows.reduce((n,r)=>n+r.scenarioUtilization!.max*(r.activeDuration??0),0)/active}):undefined;
    return {kind,activeDuration:active,assessedDuration:assessed,afterFinishDuration:num('afterFinishDuration'),usefulDuration:useful,cappedDuration:num('cappedDuration'),blockedDuration:num('blockedDuration'),
      coverageRate:active>0?Math.min(1,assessed/active):0,usefulAmongAssessed:assessed>0?useful/assessed:null,
      utilization:active>0&&Math.abs(active-assessed)<1e-3&&scenario&&scenario.max-scenario.min<1e-5?useful/active:null,scenarioUtilization:scenario,
      ...(scored?{scoringConvention:'target-speed-half-credit' as const,acceleratingDuration:half,deceleratingEffectiveDuration:num('deceleratingEffectiveDuration'),fullyEffectiveDuration:full,belowBaselineDuration:num('belowBaselineDuration'),wastedDuration:num('wastedDuration')}:{})};
  });
  return {...benefit,effects,reasons:[...new Set([...benefit.reasons,...values.flatMap(v=>v.reasons)])],detail:values[0].detail};
}
