import type { Race, Runner } from './types';
import type { ReferenceData } from './reference';
import type { RaceAnalysis } from './analytics';
import type { MotionBand, RunnerMotion } from './race-motion';
import { aptitudeRank, distanceAptitude } from './race-stats';
import { effectiveStrategyCode } from './skill-details';
import { crossing, atTime, trace, stopTime } from './effect-sampling';
import { hpAt, hpSampledBridges } from './hp-timeline';
import { proximityPressure } from './movement-context';

export interface SpurtCandidate {speed:number;delay:number;time:number;probability:number}
export interface SpurtChoice {
  rolls?: { roll:number; threshold:number; passed:boolean; speed:number; start:number }[];
  candidates:SpurtCandidate[];matched:number|null;betterChance:number|null;
  decisionDistance:number|null;hp:number|null;checkChance:number|null;
  reason:string;deterministic:boolean;
}
export interface SpurtDecision extends SpurtChoice {
  time:number;end:number;trigger:'late-entry'|'recovery';skillIds:number[];
  observedTarget:number|null;observedDelay:number|null;
  observedTargetTime:number|null;targetEvidence:'plateau'|'maximum-reached'|null;
}
export interface SpurtComparison extends SpurtChoice {
  source?: 'simulation';
  target:MotionBand|null;maximum:MotionBand|null;shortfall:MotionBand|null;
  initialTarget:number|null;initialTargetTime:number|null;
  targetTime:number|null;
  waitingPlateau:{start:number;end:number;speed:number}|null;
  startTime:number|null;delaySeconds:number|null;
  decisions:SpurtDecision[];
}
const channels=['min','mid','max'] as const;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const exact=(v:MotionBand|null|undefined)=>v&&v.max-v.min<.001?v.mid:null;
// Display tolerance for the small recorded offset at late entry, not an
// assertion about the game's internal update cadence. Raw timing is retained.
export const NORMAL_SPURT_START_DELAY=.15;
export interface SpurtLuck {failedMin:number;failedMax:number;probability:number;betterChance:number}
/** A candidate's index counts rejected faster-finish choices at one decision,
 * not retries over elapsed race time. The last candidate can also be a fallback. */
export function spurtLuck(choice:SpurtChoice):SpurtLuck|null {
  const index=choice.matched,candidates=choice.candidates;
  if(choice.deterministic||index==null||index<0||index>=candidates.length||candidates[index].probability<=0)return null;
  return {failedMin:index,failedMax:index===candidates.length-1?index+1:index,probability:candidates[index].probability,
    betterChance:candidates.filter(c=>c.time<candidates[index].time-.0001).reduce((sum,c)=>sum+c.probability,0)};
}
export interface SpurtDistributionPoint {value:number;probability:number;indices:number[]}
export function spurtDistribution(choice:SpurtChoice,axis:'speed'|'delay'):SpurtDistributionPoint[]{
  const values=new Map<number,SpurtDistributionPoint>();
  choice.candidates.forEach((candidate,index)=>{const value=Math.round(candidate[axis]*1e6)/1e6,point=values.get(value);
    if(point){point.probability+=candidate.probability;point.indices.push(index);}else values.set(value,{value,probability:candidate.probability,indices:[index]});});
  return [...values.values()].sort((a,b)=>a.value-b.value);
}
export interface SpurtDisplayGroup {indices:number[];target:number|null;targetTime:number|null;full:boolean}
/** Collapse unchanged full-spurt checks for the summary only. Keep the raw
 * windows and their evidence separate so later speed never proves an early roll. */
export function spurtDisplayGroups(value:SpurtComparison):SpurtDisplayGroup[]{
  const groups:SpurtDisplayGroup[]=[],maximum=exact(value.maximum);
  for(const [index,decision]of value.decisions.entries()){
    const candidate=decision.candidates.length===1?decision.candidates[0]:null;
    const normalStart=decision.observedDelay==null||value.startTime!=null&&value.startTime-decision.time<=NORMAL_SPURT_START_DELAY;
    const full=maximum!=null&&candidate!=null&&Math.abs(candidate.speed-maximum)<.001&&candidate.delay===0&&normalStart&&(decision.observedTarget==null||Math.abs(decision.observedTarget-maximum)<.055);
    const target=decision.observedTarget==null?null:maximum!=null&&Math.abs(decision.observedTarget-maximum)<.025?maximum:decision.observedTarget;
    const prior=groups.at(-1);
    if(full&&prior?.full){prior.indices.push(index);if(target!=null){prior.target=target;prior.targetTime=decision.observedTargetTime;}}
    else groups.push({indices:[index],target,targetTime:decision.observedTargetTime,full});
  }
  return groups;
}

/** Decision model from the supplied mechanics notes: 0.1 m/s candidates,
 * HP budget to 60 m before the finish, then repeated wit checks in time order.
 * This deliberately ignores acceleration/terrain/skills in candidate cost,
 * matching the decision rule rather than simulating the eventual finish. */
export function spurtCandidates(total:number,position:number,hp:number,late:number,maximum:number,base:number,ground:number,guts:number,wisdom:number):SpurtCandidate[] {
  const remaining=Math.max(0,total-position),budget=Math.max(0,remaining-60);
  const cost=(v:number)=>20*(v-base+12)**2/144*ground*(1+200/Math.sqrt(600*guts))/v;
  const low=cost(late),high=cost(maximum);
  if(hp>=high*budget)return [{speed:maximum,delay:0,time:remaining/maximum,probability:1}];
  if(hp<=low*budget)return [{speed:late,delay:remaining,time:remaining/late,probability:1}];
  const candidates:SpurtCandidate[]=[];
  for(let step=0;step<=Math.ceil((maximum-late)/.1);step++){
    const speed=Math.max(late,maximum-step*.1),difference=cost(speed)-low;
    const distance=difference>1e-10?clamp((hp-low*budget)/difference+60,0,remaining):remaining;
    const delay=remaining-distance;
    candidates.push({speed,delay,time:delay/late+distance/speed,probability:0});
  }
  candidates.sort((a,b)=>a.time-b.time||b.speed-a.speed);
  const p=clamp(.15+.0005*wisdom,0,1);let residual=1;
  for(const [index,candidate]of candidates.entries()){candidate.probability=index===candidates.length-1?residual:residual*p;residual-=candidate.probability;}
  return candidates;
}

export function spurtComparison(race:Race,reference:ReferenceData,analysis:RaceAnalysis,runner:Runner,motion:RunnerMotion):SpurtComparison {
  const empty=():SpurtChoice=>({candidates:[],matched:null,betterChance:null,decisionDistance:null,hp:null,checkChance:null,reason:'Course or stats are missing.',deterministic:false});
  const result:SpurtComparison={...empty(),target:null,maximum:null,shortfall:null,initialTarget:null,initialTargetTime:null,targetTime:null,waitingPlateau:null,startTime:null,delaySeconds:null,decisions:[]};
  const course=reference.courses[race.courseId??''],detail=analysis.runners[runner.id],stats=motion.initialStats;
  const style=effectiveStrategyCode(runner,detail.skillRows),coefficient=style==null?null:({1:.962,2:.975,3:.994,4:1,5:.95} as Record<number,number>)[style];
  const total=course?.distance,key=total<=1400?'short':total<=1800?'mile':total<=2400?'middle':'long',aptitude=aptitudeRank(runner.aptitudes?.[key]);
  if(!course||total!==race.distance||coefficient==null||aptitude==null||!stats.speed||!stats.guts)return result;
  const base=20-(total-2000)/1000,late={} as MotionBand,maximum={} as MotionBand;
  for(const c of channels){const term=Math.sqrt(500*stats.speed[c])*distanceAptitude[aptitude-1]*.002;late[c]=base*coefficient+term;maximum[c]=Math.min(30,(late[c]+.01*base)*1.05+term+(450*stats.guts[c])**.597*.0001);}
  result.maximum=maximum;
  const entry=crossing(race,runner.id,total*2/3),start=detail.summary.spurtTime;
  result.startTime=start;result.delaySeconds=entry!=null&&start!=null?Math.max(0,start-entry):null;
  if(entry==null){result.reason='Late-race HP is missing.';return result;}
  const finish=stopTime(race,runner.id),rows=trace(race,runner.id);
  const recoveries=detail.skillActivations.filter(a=>a.start>=entry&&a.start<finish&&a.effects.some(e=>e.type===9&&e.rawValue>0&&(e.targetType??1)===1));
  const times=[...new Set([entry,...recoveries.map(a=>a.start)])].sort((a,b)=>a-b);
  const speed=exact(maximum),normal=exact(late),guts=exact(stats.guts),wisdom=exact(stats.wisdom),ground=Number(race.conditions?.ground);
  const groundFactor=ground===4?1.02:ground===3?course.surface===1?1.02:1.01:1;
  const motionAt=(time:number)=>{let lo=0,hi=motion.samples.length-1;while(lo<hi){const m=Math.ceil((lo+hi)/2);if(motion.samples[m].time<=time)lo=m;else hi=m-1;}return motion.samples[lo];};
  // A stable speed before the recorded start is waiting/cruising speed. It is
  // never evidence of a low selected spurt target.
  const waitingRuns:{start:number;end:number;speed:number}[]=[];
  if(start!=null)for(let i=1;i<rows.length;i++){
    const a=rows[i-1],b=rows[i],dt=b.time-a.time;
    if(a.time<entry||b.time>=start||dt<=0||dt>2||a.sample.speed==null||b.sample.speed==null||Math.abs(b.sample.speed-a.sample.speed)/dt>.03)continue;
    const left=motionAt(a.time),right=motionAt(b.time);
    if(!left?.targetBase||!right?.targetBase||!left.targetActive||!right.targetActive||left.constraint.kind!=='none'||right.constraint.kind!=='none'||left.currentSpeedDelta!==0||right.currentSpeedDelta!==0||Math.abs(left.targetActive.mid-left.targetBase.mid)>.01||Math.abs(right.targetActive.mid-right.targetBase.mid)>.01)continue;
    const value=(a.sample.speed+b.sample.speed)/2,previous=waitingRuns.at(-1);
    if(previous&&previous.end===a.time&&Math.abs(previous.speed-value)<.03)previous.end=b.time;
    else waitingRuns.push({start:a.time,end:b.time,speed:value});
  }
  result.waitingPlateau=waitingRuns.filter(r=>r.end-r.start>=.5).sort((a,b)=>(b.end-b.start)-(a.end-a.start))[0]??null;
  for(const [index,time]of times.entries()){
    const end=times[index+1]??finish,sample=atTime(race,runner.id,time);
    const ambiguousHp=hpSampledBridges(race,runner.id,reference,detail.statBreakdown.startingHp.modeled).some(b=>time>b.start&&time<b.end);
    const hp=ambiguousHp?null:hpAt(race,runner.id,time,reference,detail.statBreakdown.startingHp.modeled);
    const bracket=rows.filter(r=>r.time<=time).at(-1),next=rows.find(r=>r.time>=time);
    const decision:SpurtDecision={...empty(),time,end,trigger:index===0?'late-entry':'recovery',skillIds:recoveries.filter(a=>a.start===time).map(a=>a.skillId),observedTarget:null,observedDelay:null,observedTargetTime:null,targetEvidence:null};
    result.decisions.push(decision);
    if(hp==null||sample?.distance==null||!bracket||!next||next.time-bracket.time>2){decision.reason='HP at this decision is missing.';continue;}
    decision.hp=hp;decision.decisionDistance=sample.distance;
    if(speed==null||normal==null||guts==null||wisdom==null||![1,2,3,4].includes(ground)){decision.reason='Unresolved bonuses prevent reliable odds.';continue;}
    decision.checkChance=clamp(.15+.0005*wisdom,0,1);
    decision.candidates=spurtCandidates(total,sample.distance,hp,normal,speed,base,groundFactor,guts,wisdom);
    decision.deterministic=decision.candidates.length===1;
    // Fit this decision only. Later recoveries must never supply its ceiling.
    // Remove known temporary/terrain offsets from clean retained plateaus;
    // never use an assumed model ceiling as evidence of a selected candidate.
    const plateaus:{speed:number;time:number;distance:number}[]=[];let firstPlateauDistance:number|null=null,reachedMaximum:{speed:number;time:number;distance:number}|null=null;
    for(let i=1;i<rows.length;i++){
      const a=rows[i-1],b=rows[i],dt=b.time-a.time;
      if(a.time<time||b.time>=end||dt<=0||dt>2||a.sample.distance==null||b.sample.distance==null||a.sample.distance<Math.max(total*2/3,runner.lastSpurtDistance??Infinity)||a.sample.speed==null||b.sample.speed==null||(a.sample.hp??0)<=0||(b.sample.hp??0)<=0||a.sample.blockFrontRunnerIndex!==-1||b.sample.blockFrontRunnerIndex!==-1||proximityPressure(race,runner.id,a.sample)!==false||proximityPressure(race,runner.id,b.sample)!==false)continue;
      const normalized=(row:typeof a)=>{const s=motionAt(row.time);if(!s?.targetBase||!s.targetActive||!stats.power||s.constraint.kind!=='none')return null;const slope=course.slopes.find(v=>row.sample.distance!>=v.start&&row.sample.distance!<v.start+v.length)?.slopePercent??0;const offsets=channels.map(c=>s.targetActive![c]-s.targetBase![c]-(slope>0?slope*200/stats.power![c]:0)+s.currentSpeedDelta);return Math.max(...offsets)-Math.min(...offsets)>.005?null:row.sample.speed!-offsets[1];};
      const av=normalized(a),bv=normalized(b);if(av==null||bv==null||av<normal-.055||bv>speed+.025)continue;
      // Reaching the theoretical ceiling during clean acceleration also bounds
      // the target. Require unchanged known offsets so an ending boost cannot
      // masquerade as acceleration to this decision's ceiling.
      const offsetsUnchanged=Math.abs((a.sample.speed-av)-(b.sample.speed-bv))<.005;
      const crossesEffect=detail.skillActivations.some(s=>s.start>a.time&&s.start<=b.time||s.effectiveEnd!=null&&s.effectiveEnd>a.time&&s.effectiveEnd<=b.time);
      if(!reachedMaximum&&bv>=speed-.025&&bv>av+.02&&offsetsUnchanged&&!crossesEffect)reachedMaximum={speed:bv,time:b.time,distance:b.sample.distance};
      if(Math.abs(bv-av)/dt>.08)continue;
      plateaus.push({speed:(av+bv)/2,time:a.time,distance:a.sample.distance});
    }
    if(plateaus.length>=2){const ordered=plateaus.map(p=>p.speed).sort((a,b)=>a-b),median=ordered[Math.floor(ordered.length/2)];if(plateaus.every(v=>Math.abs(v.speed-median)<.07)){decision.observedTarget=median;decision.observedTargetTime=plateaus[0].time;decision.targetEvidence='plateau';firstPlateauDistance=plateaus[0].distance;}}
    if(decision.observedTarget===null&&reachedMaximum){decision.observedTarget=reachedMaximum.speed;decision.observedTargetTime=reachedMaximum.time;decision.targetEvidence='maximum-reached';firstPlateauDistance=reachedMaximum.distance;}
    // The recorded start can identify an initial delay only if it happened
    // within this decision. Later decisions may still identify a unique speed.
    if(start!=null&&start>=time&&start<end&&runner.lastSpurtDistance!=null)decision.observedDelay=Math.max(0,runner.lastSpurtDistance-sample.distance);
    const target=decision.observedTarget,delay=decision.observedDelay;
    if(decision.deterministic){
      const only=decision.candidates[0];decision.reason=only.speed===speed?'HP meets the maximum-speed threshold. This budget stops 60 m before the finish.':'HP is too low for a spurt in this model.';
      if(target!=null&&Math.abs(target-only.speed)>.055)decision.reason='HP model and observed speed differ.';
      else if(delay!=null&&Math.abs(delay-only.delay)>3)decision.reason='The HP model predicts an earlier spurt start.';
      continue;
    }
    const matches=decision.candidates.flatMap((c,i)=>target!=null&&Math.abs(c.speed-target)<.045&&(delay==null||Math.abs(c.delay-delay)<3)&&(firstPlateauDistance==null||sample.distance!+c.delay<=firstPlateauDistance+3)?[i]:[]);
    if(matches.length!==1){decision.reason=index<times.length-1?'The next recovery came before this choice could be isolated.':'Clear speed samples do not identify one choice.';continue;}
    decision.matched=matches[0];const chosen=decision.candidates[decision.matched];
    decision.betterChance=decision.candidates.filter(c=>c.time<chosen.time-.0001).reduce((n,c)=>n+c.probability,0);
    decision.reason='Odds at this decision; the random roll is not recorded.';
  }
  const initial=start==null?null:result.decisions.find(d=>start>=d.time&&start<d.end);
  const initialSpeed=initial?.observedTarget??null;
  result.initialTarget=initialSpeed!=null&&speed!=null&&Math.abs(initialSpeed-speed)<.025?speed:initialSpeed;result.initialTargetTime=initial?.observedTargetTime??null;
  const latest=result.decisions.at(-1);if(latest){
    const {candidates,matched,betterChance,decisionDistance,hp,checkChance,reason,deterministic}=latest;Object.assign(result,{candidates,matched,betterChance,decisionDistance,hp,checkChance,reason,deterministic});
    // The final target needs evidence after the final recovery. An assumed
    // motion ceiling or an earlier fit must not fill a missing final reading.
    if(latest.observedTarget!=null){
      const target=speed!=null&&Math.abs(latest.observedTarget-speed)<.025?speed:latest.observedTarget;
      result.target={min:target,mid:target,max:target};result.targetTime=latest.observedTargetTime;
      result.shortfall={min:Math.max(0,maximum.min-target),mid:Math.max(0,maximum.mid-target),max:Math.max(0,maximum.max-target)};
    }
  }
  return result;
}
