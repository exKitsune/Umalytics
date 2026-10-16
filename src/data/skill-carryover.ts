import type { Race, Runner } from './types';
import type { RaceAnalysis, SkillActivation } from './analytics';
import type { SkillCarryover } from './effect-types';
import type { MechanicsContext } from './mechanics-model';
import { baselineTarget, baseAcceleration, referenceDeceleration } from './mechanics-model';
import { atTime, stopTime } from './effect-sampling';
export function unavailableCarryover(reason:string,start:number|null=null,entrySpeedDelta:number|null=null):SkillCarryover {
  return {entrySpeedDelta,distanceDelta:null,timeDelta:null,distanceDeltaMin:null,distanceDeltaMax:null,timeDeltaMin:null,timeDeltaMax:null,start,end:null,duration:null,reason,detail:reason};
}
/** Separate post-expiry model. The phase/grade schedule is held at recorded
 * positions; this does not resimulate race ordering or predict finish time. */
export function carryoverFor(race:Race,target:Runner,analysis:Pick<RaceAnalysis,'runners'>,activation:SkillActivation,ctx:MechanicsContext|null,entryWith:number|null,entryWithout:number|null,complete:boolean):SkillCarryover {
  const end=activation.effectiveEnd;
  if(activation.timingKind==='instant')return unavailableCarryover('Instant effect',end);
  if(end===null)return unavailableCarryover('Duration unavailable');
  // This older anchored model cannot split a mixed skill's speed/acceleration
  // origins. The shared movement model accounts for the full direct head start.
  if(activation.effects.some(e=>e.type===31))return unavailableCarryover('Acceleration head starts count as direct gain; use the shared movement model for mixed-effect carryover.',end);
  if(!complete||entryWith===null||entryWithout===null)return unavailableCarryover('Active-window coverage incomplete',end);
  const gap=entryWith-entryWithout;
  if(Math.abs(gap)<1e-5)return {entrySpeedDelta:0,distanceDelta:0,timeDelta:0,distanceDeltaMin:0,distanceDeltaMax:0,timeDeltaMin:0,timeDeltaMax:0,start:end,end,duration:0,reason:'No persistent speed difference',detail:'No modeled self-speed difference survives effect expiry. Direct current-speed21 stops at expiry.'};
  if(!ctx)return unavailableCarryover('Reference inputs unavailable',end,gap);
  const stop=stopTime(race,target.id);if(end>=stop)return unavailableCarryover('Race ended before carryover',end,gap);
  const competing=race.runners.flatMap(source=>analysis.runners[source.id].skillActivations.filter(a=>{
    if(a===activation||a.start>=stop||(a.effectiveEnd??stop)<=end)return false;
    const event=race.events.find(e=>e.skillId===a.skillId&&e.time===a.start&&(e.runnerId===source.id||e.runnerId===null&&e.params[0]===source.index));
    return a.effects.some(e=>[1,3,4,21,22,27,31,35].includes(e.type)&&((e.targetType??1)===1?source.id===target.id:!(source.teamGroup!=null&&target.teamGroup!=null&&source.teamGroup===target.teamGroup)&&(a.targetRunnerIds.includes(target.id)||!Number.isInteger(event?.params[4]))));
  }));
  const scenarios=['min','max'].map(bound=>({bound:bound as 'min'|'max',withSpeed:entryWith,withoutSpeed:entryWithout,distance:0,timeCost:0,until:end,done:false}));
  const advance=(v:number,targetSpeed:number,acceleration:number,dt:number,phaseDistance:number)=>v<targetSpeed?Math.min(targetSpeed,v+acceleration*dt):Math.max(targetSpeed,v-referenceDeceleration(phaseDistance,ctx.course.distance)*dt);
  for(let time=end;time<stop-1e-6;){const next=Math.min(stop,time+1/15),dt=next-time,mid=(time+next)/2,p=atTime(race,target.id,mid);
    if(!p||p.distance===null||p.hp===null||p.hp<=0||p.blockFrontRunnerIndex!==-1)return unavailableCarryover('Post-expiry replay context incomplete',end,gap);
    if(p.distance<ctx.course.distance*10/24)return unavailableCarryover('Position keeping unresolved',end,gap);
    if(competing.some(a=>a.start<next&&(a.effectiveEnd??stop)>time))return unavailableCarryover('Other movement effects overlap',end,gap);
    if(analysis.runners[target.id].intervals.some(i=>['rushed','spot-struggle-model','dueling-model','downhill-mode-model','pace-up-model','pace-down-model','speed-up-model','overtake-model'].includes(i.kind)&&mid>=i.start&&mid<(i.end??i.estimatedEnd??i.observedUntil??i.start)))return unavailableCarryover('Status interactions unresolved',end,gap);
    const range=baselineTarget(ctx,p.distance),acceleration=baseAcceleration(ctx,p.distance,Math.min(...scenarios.map(s=>Math.min(s.withSpeed,s.withoutSpeed))));
    if(!range||acceleration===null||acceleration<=0)return unavailableCarryover('Post-expiry target unavailable',end,gap);
    for(const scenario of scenarios.filter(s=>!s.done)){
      const priorGap=scenario.withSpeed-scenario.withoutSpeed;
      scenario.withSpeed=advance(scenario.withSpeed,range[scenario.bound],acceleration,dt,p.distance);scenario.withoutSpeed=advance(scenario.withoutSpeed,range[scenario.bound],acceleration,dt,p.distance);
      const averageGap=(priorGap+scenario.withSpeed-scenario.withoutSpeed)/2;scenario.distance+=averageGap*dt;
      if(scenario.withoutSpeed<=0)return unavailableCarryover('Post-expiry speed unavailable',end,gap);
      scenario.timeCost-=averageGap/scenario.withoutSpeed*dt;scenario.until=next;scenario.done=Math.abs(scenario.withSpeed-scenario.withoutSpeed)<1e-4;
    }
    time=next;
    if(scenarios.every(s=>s.done)){
      const distanceDeltaMin=Math.min(...scenarios.map(s=>s.distance)),distanceDeltaMax=Math.max(...scenarios.map(s=>s.distance)),timeDeltaMin=Math.min(...scenarios.map(s=>s.timeCost)),timeDeltaMax=Math.max(...scenarios.map(s=>s.timeCost)),until=Math.max(...scenarios.map(s=>s.until));
      return {entrySpeedDelta:gap,distanceDelta:distanceDeltaMax-distanceDeltaMin<1e-4?distanceDeltaMin:null,timeDelta:timeDeltaMax-timeDeltaMin<1e-5?timeDeltaMin:null,distanceDeltaMin,distanceDeltaMax,timeDeltaMin,timeDeltaMax,start:end,end:until,duration:until-end,reason:'Bounded reference carryover',detail:'Separate post-expiry scenarios at lower and upper reference section/spurt targets, until both trajectories converge. The actual target is unreported; endpoint scenarios are not an identified replay-specific gain or guaranteed bounds over arbitrary changing hidden targets. Uses reference acceleration/deceleration and recorded phase/grade schedule. Higher entry speed can reach the later target sooner. This is conditional distance and equivalent travel time, not an exact finish-time reduction; do not add overlapping marginal contributions.'};
    }
  }
  return unavailableCarryover('Replay ended before speeds converged',end,gap);
}
