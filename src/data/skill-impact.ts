import type { RunnerAnalysis, RaceAnalysis, SkillActivation, StatusInterval } from './analytics';
import type { Race, Runner } from './types';
import type { CourseReference, ReferenceData, SkillReference } from './reference';
import type { ContributionTotal, DebuffActivation, SkillImpact, SkillImpactSummary, EffectUtilization } from './effect-types';
import { effectValue } from './effect-value';
import { atTime, observedWindow, stopTime, trace } from './effect-sampling';
import { baseAcceleration, baselineTarget, hpReference, mechanicsContext, referenceDeceleration } from './mechanics-model';
import { effectiveStrategyCode } from './skill-details';
import { frontBlockCapAt, advanceSelf, referenceMotionAt } from './movement-context';
import { recoveryTimingFor } from './recovery-timing';
import { carryoverFor, unavailableCarryover } from './skill-carryover';
import { selfSpeedAt, statusHpFactor, startDashStateAt } from './mechanics-effects';

type Effect=SkillReference['branches'][number]['effects'][number];
interface Proc {source:Runner;activation:SkillActivation;recipientsKnown:boolean;}
const moves=new Set([1,2,3,4,5,21,22,27,28,31]);
const harmful=(e:Effect)=>(e.targetType??1)!==1&&(e.rawValue<0||[13,14,15,16].includes(e.type));
function applies(proc:Proc,target:Runner,e:Effect){return (e.targetType??1)===1?proc.source.id===target.id:proc.activation.simulatedRecipients!==undefined?!!proc.activation.simulatedRecipients[target.id]?.some(hit=>hit.type===e.type&&hit.evaluatedValue===e.evaluatedValue):!(proc.source.teamGroup!=null&&target.teamGroup!=null&&proc.source.teamGroup===target.teamGroup)&&proc.activation.targetRunnerIds.includes(target.id);}
function active(proc:Proc,time:number){return time>=proc.activation.start&&(proc.activation.effectiveEnd===null?time===proc.activation.start:time<proc.activation.effectiveEnd);}
const procCache=new WeakMap<Pick<RaceAnalysis,'runners'>,Proc[]>();
function procsFor(race:Race,analysis:Pick<RaceAnalysis,'runners'>):Proc[]{const cached=procCache.get(analysis);if(cached)return cached;const result=race.runners.flatMap(source=>analysis.runners[source.id].skillActivations.map(activation=>{
  const event=race.events.find(e=>(e.type===3||e.type==='skill')&&e.skillId===activation.skillId&&e.time===activation.start&&(e.runnerId===source.id||e.runnerId===null&&e.params[0]===source.index));
  return {source,activation,recipientsKnown:activation.simulatedRecipients!==undefined||Number.isInteger(event?.params[4])&&race.runners.length<=32};
}));procCache.set(analysis,result);return result;}
function windowOverlaps(a:SkillActivation,b:SkillActivation){const ae=a.end??a.start,be=b.end??b.start;return ae===a.start||be===b.start?Math.abs(a.start-b.start)<1e-5:a.start<be&&b.start<ae;}
function statusTarget(intervals:StatusInterval[],time:number,base:number):number|null {
  const values=new Map<string,number>();let multiplier=1;
  for(const i of intervals){if(time<i.start||time>=(i.end??i.observedUntil??i.start))continue;
    if(i.kind==='rushed-boost')multiplier=1.04;
    else if(i.kind.endsWith('-model')&&i.model?.speedDelta!=null){const kind=i.kind.replace(/-model$/,'');const prior=values.get(kind);if(prior!==undefined&&Math.abs(prior-i.model.speedDelta)>1e-5)return null;values.set(kind,i.model.speedDelta);}}
  return base*(multiplier-1)+[...values.values()].reduce((n,v)=>n+v,0);
}
function directTransitionInBracket(race:Race,target:Runner,time:number,all:Proc[]):boolean {
  const rows=trace(race,target.id),index=rows.findIndex(p=>p.time>time);if(index<1)return false;
  const start=rows[index-1].time,end=rows[index].time;
  return all.some(o=>o.activation.effects.some(e=>[21,22].includes(e.type)&&applies(o,target,e))&&[o.activation.start,o.activation.effectiveEnd].some(t=>t!==null&&t>start+1e-7&&t<=end+1e-7));
}
/** Allocate supported portions of the user's 0/half/full target-speed score.
 * Unreported target ranges leave boundary strips unknown, not averaged away. */
function targetSpeedCredit(self:number,after:number,dt:number,normalMin:number,normalMax:number,boostMin:number,boostMax:number,accel:number,plateau:boolean){
  const result={assessed:0,credited:0,accelerating:0,full:0,below:0};
  const rate=(after-self)/dt;
  // A supported plateau can identify a conditional selected target within the
  // range. Remove a uniform selected bonus only when no floor/ceiling clipped
  // the shift; subtraction after a clamp would invent a lower normal target.
  const shift=boostMax-normalMax;
  if(plateau&&after>=boostMin-.02&&after<=boostMax+.02&&boostMax<30-1e-7&&Math.abs((boostMin-normalMin)-shift)<1e-7&&after-shift>=normalMin-.02&&after-shift<=normalMax+.02){normalMin=normalMax=after-shift;boostMin=boostMax=after;}
  const reaches=rate>.02&&accel>0&&after>self&&(after-self)/accel<=dt+1e-7&&after>=boostMin-.02&&after<=boostMax+.05&&plateau;
  const ramp=reaches?(after-self)/accel:dt;
  const slope=reaches?accel:rate;
  const speed=(t:number)=>reaches&&t>=ramp?after:self+slope*t;
  const cuts=[0,dt];if(reaches&&ramp>0&&ramp<dt)cuts.push(ramp);
  if(slope!==0)for(const threshold of [normalMin,normalMax,boostMin,boostMax]){const t=(threshold-self)/slope;if(t>0&&t<ramp)cuts.push(t);}
  cuts.sort((a,b)=>a-b);
  for(let i=1;i<cuts.length;i++){
    const length=cuts[i]-cuts[i-1],mid=(cuts[i]+cuts[i-1])/2,value=speed(mid),accelerating=mid<ramp&&slope>.02;
    if(value<normalMin-1e-7){result.assessed+=length;result.below+=length;}
    else if(accelerating&&value>=normalMax-1e-7&&value<boostMin-1e-7){result.assessed+=length;result.accelerating+=length;result.credited+=length*.5;}
    else if(!accelerating&&(reaches&&mid>=ramp||Math.abs(rate)<=.05)&&value>=boostMin-.08&&value<=boostMax+.08&&value>normalMax+.02){result.assessed+=length;result.full+=length;result.credited+=length;}
    else if(rate<-.02&&value>boostMax+.08)result.assessed+=length;
  }
  return result;
}
function componentUtilization(race:Race,analysis:Pick<RaceAnalysis,'runners'>,proc:Proc,target:Runner,effects:Effect[],all:Proc[],ctx:ReturnType<typeof mechanicsContext>,duration:number|null,end:number|null,scheduled:number|null,afterFinish:number):EffectUtilization[] {
  const kinds=[['current-speed',[21,22]],['target-speed',[27]],['acceleration',[31]]] as const;
  return kinds.flatMap(([kind,types])=>{
    const selected=effects.filter(e=>(types as readonly number[]).includes(e.type));if(!selected.length)return [];
    const values=selected.map(e=>effectValue(proc.source,proc.activation.referenceSkillId??proc.activation.skillId,e));
    const positiveTarget=kind==='target-speed'&&values.every(v=>v!==null)&&values.reduce<number>((n,v)=>n+v!,0)>0;
    let assessed=0,useful=0,capped=0,blocked=0,accelerating=0,full=0,below=0;const immune=proc.source.id!==target.id&&proc.source.teamGroup!=null&&target.teamGroup!=null&&proc.source.teamGroup===target.teamGroup;
    if(immune&&duration!==null)assessed=duration;
    if(!immune&&duration!==null&&end!==null&&values.every(v=>v!==null)){
      const modifier=values.reduce<number>((n,v)=>n+v!,0),boundaries=all.flatMap(p=>[p.activation.start,p.activation.effectiveEnd??end]).filter(t=>t>proc.activation.start&&t<end).sort((a,b)=>a-b);
      for(let time=proc.activation.start;time<end-1e-6;){const next=Math.min(end,time+1/15,boundaries.find(t=>t>time+1e-7)??end),dt=next-time,mid=(time+next)/2,p=atTime(race,target.id,time),q=atTime(race,target.id,next);time=next;
        // This score gives all positively recorded blocked time zero, regardless
        // of whether blocker geometry or the target itself can be reconstructed.
        if(positiveTarget&&p?.blockFrontRunnerIndex!=null&&q?.blockFrontRunnerIndex!=null&&p.blockFrontRunnerIndex>=0&&q.blockFrontRunnerIndex>=0){assessed+=dt;blocked+=dt;continue;}
        if(!p||!q||p.speed===null||q.speed===null)continue;
        if(kind==='current-speed'){assessed+=dt;useful+=modifier!==0?dt:0;continue;}
        if(directTransitionInBracket(race,target,mid,all))continue;
        if(!ctx||p.distance===null||q.distance===null||p.hp===null||q.hp===null||p.blockFrontRunnerIndex==null||q.blockFrontRunnerIndex==null)continue;
        if(p.distance<ctx.course.distance*10/24&&startDashStateAt(race,analysis,target.id,next-dt)!==true)continue;
        const self=selfSpeedAt(race,analysis,target.id,next-dt,p.speed),after=selfSpeedAt(race,analysis,target.id,next,q.speed);
        if(self===null||after===null)continue;
        if(p.hp<=0&&q.hp<=0){assessed+=dt;continue;}
        if(p.hp<=0||q.hp<=0)continue;
        let motion=referenceMotionAt(ctx,analysis,mid,p.distance,self);
        // A standalone lane-change effect35 has no forward target term in
        // the inspected simulator. Hold recorded lane/block context fixed.
        if(motion===null){const contextual=all.filter(o=>active(o,mid)).flatMap(o=>o.activation.effects.filter(e=>applies(o,target,e)).map(e=>({o,e})));const unresolvedPossible=all.some(o=>o.activation.start<=mid&&(o.activation.effectiveEnd===null||mid<o.activation.effectiveEnd)&&o.activation.effects.some(e=>moves.has(e.type)&&!(o.activation.start===0&&o.activation.timingKind==='passive'&&[1,2,3,4,5].includes(e.type)&&(e.targetType??1)===1)&&(applies(o,target,e)||!o.recipientsKnown&&(e.targetType??1)!==1)&&(o.activation.effectiveEnd===null||![21,22,27,31,35].includes(e.type)||effectValue(o.source,o.activation.referenceSkillId??o.activation.skillId,e)===null||!o.recipientsKnown&&(e.targetType??1)!==1)));const canSeparate=!unresolvedPossible&&contextual.some(v=>v.e.type===35)&&contextual.every(v=>[9,10,14,21,22,27,31,35].includes(v.e.type)||v.o.activation.start===0&&v.o.activation.timingKind==='passive');
          if(canSeparate){const range=baselineTarget(ctx,p.distance),base=baseAcceleration(ctx,p.distance,self,startDashStateAt(race,analysis,target.id,mid)===true),status=range?statusTarget(analysis.runners[target.id].intervals,mid,range.max):null,targetValues=contextual.filter(v=>v.e.type===27).map(v=>effectValue(v.o.source,v.o.activation.referenceSkillId??v.o.activation.skillId,v.e)),accelValues=contextual.filter(v=>v.e.type===31).map(v=>effectValue(v.o.source,v.o.activation.referenceSkillId??v.o.activation.skillId,v.e));
            if(range&&base!==null&&status!==null&&targetValues.every(v=>v!==null)&&accelValues.every(v=>v!==null)){const targetValue=targetValues.reduce<number>((n,v)=>n+v!,0);motion={min:Math.min(30,range.min+status+targetValue),max:Math.min(30,range.max+status+targetValue),accel:base+accelValues.reduce<number>((n,v)=>n+v!,0),current:0,minimum:range.min};}}}

        const block=frontBlockCapAt(race,target,mid);
        if(block.blocked&&(block.cap===null||self>block.cap+.15||after>block.cap+.15||after<block.cap-.25&&Math.abs(after-self)/dt<=.02))continue;
        const delta=after-self,rate=delta/dt;
        if(kind==='acceleration'){
          if(modifier===0){assessed+=dt;continue;}
          if(!block.blocked&&motion!==null&&self>motion.max+.08&&rate<-.02){assessed+=dt;continue;}
          if(modifier<0&&motion!==null&&self<motion.min-.02){assessed+=dt;useful+=dt;continue;}
          const threshold=block.cap??motion?.max??null;
          const flat=Math.abs(rate)<=.05;
          const later=atTime(race,target.id,next+1/15),laterSelf=later?.speed!=null?selfSpeedAt(race,analysis,target.id,next+1/15,later.speed):null,plateau=laterSelf!==null&&Math.abs(laterSelf-after)<=.05/15+1e-7;

          const confirmedCap=block.blocked&&block.cap!==null&&self>=block.cap-.08&&after>=block.cap-.08||!block.blocked&&motion!==null&&flat&&self>=motion.min-.08&&self<=motion.max+.08;
          if(threshold!==null&&motion!==null&&motion.accel>0&&modifier>0&&rate>0&&self<threshold&&after>=threshold-.02&&after<=threshold+.05&&plateau){const portion=Math.min(dt,Math.max(0,(threshold-self)/motion.accel));assessed+=dt;useful+=portion;if(block.blocked)blocked+=dt-portion;else capped+=dt-portion;continue;}
          if(confirmedCap){assessed+=dt;if(block.blocked)blocked+=dt;else capped+=dt;continue;}
          if(rate>.02&&modifier>0){
            let portion=dt;
            if(threshold!==null&&motion!==null&&motion.accel>0&&after>=threshold-.02&&after<=threshold+.05&&self<threshold&&plateau)portion=Math.min(dt,Math.max(0,(threshold-self)/motion.accel));
            assessed+=dt;useful+=portion;if(portion<dt){if(block.blocked)blocked+=dt-portion;else capped+=dt-portion;}continue;
          }
          // Deceleration and flat speed away from a supported target are not
          // silently called capped or wasted acceleration.
          continue;
        }
        if(!motion)continue;
        const baseRange=baselineTarget(ctx,p.distance),baseStatus=baseRange?statusTarget(analysis.runners[target.id].intervals,mid,baseRange.max):null,others=all.filter(o=>o!==proc&&active(o,mid)).flatMap(o=>o.activation.effects.filter(e=>e.type===27&&applies(o,target,e)).map(e=>effectValue(o.source,o.activation.referenceSkillId??o.activation.skillId,e)));
        if(!baseRange||baseStatus===null||others.some(v=>v===null))continue;const otherTarget=others.reduce<number>((n,v)=>n+v!,0),floor=.85*(20-(ctx.course.distance-2000)/1000)+Math.sqrt(200*ctx.stats.stats.guts.final!)*.001;
        const withoutMin=Math.min(30,Math.max(floor,baseRange.min+baseStatus+otherTarget)),withoutMax=Math.min(30,Math.max(floor,baseRange.max+baseStatus+otherTarget));
        if(Math.abs(motion.min-withoutMin)<1e-5&&Math.abs(motion.max-withoutMax)<1e-5){assessed+=dt;continue;}
        if(positiveTarget){
          const later=atTime(race,target.id,next+1/15),laterSelf=later?.speed!=null?selfSpeedAt(race,analysis,target.id,next+1/15,later.speed):null;
          const plateau=laterSelf!==null&&Math.abs(laterSelf-after)<=.005/15+1e-7;
          const score=targetSpeedCredit(self,after,dt,withoutMin,withoutMax,motion.min,motion.max,motion.accel,plateau);
          assessed+=score.assessed;useful+=score.credited;accelerating+=score.accelerating;full+=score.full;below+=score.below;continue;
        }
        if(block.blocked&&block.cap!==null&&block.cap<=withoutMin){assessed+=dt;blocked+=dt;continue;}
        if(modifier>0&&self>motion.max+.08&&rate<-.02){assessed+=dt;continue;}
        if(modifier>0&&self>withoutMax+.02&&self<=motion.max+.08){assessed+=dt;useful+=dt;continue;}
        if(rate>.02&&after<withoutMin-.02){assessed+=dt;continue;}
        if(modifier<0&&self>=motion.min-.08&&self<=motion.max+.08&&Math.abs(rate)<=.05){assessed+=dt;useful+=dt;continue;}
      }
    }
    assessed+=afterFinish;const complete=scheduled!==null&&Math.abs(assessed-scheduled)<1e-4;
    return [{kind,activeDuration:scheduled,assessedDuration:assessed,afterFinishDuration:afterFinish,usefulDuration:assessed>0?useful:null,cappedDuration:kind==='acceleration'&&assessed>0?capped:null,blockedDuration:assessed>0?blocked:null,
      ...(positiveTarget?{scoringConvention:'target-speed-half-credit' as const,acceleratingDuration:accelerating,fullyEffectiveDuration:full,belowBaselineDuration:below}:{}),
      utilization:complete&&scheduled!>0?Math.min(1,useful/scheduled!):null,coverageRate:scheduled!==null&&scheduled>0?Math.min(1,assessed/scheduled):null,usefulAmongAssessed:assessed>0?Math.min(1,useful/assessed):null}];
  });
}
function evaluateImpact(race:Race,reference:ReferenceData|null,course:CourseReference|null,analysis:Pick<RaceAnalysis,'runners'>,proc:Proc,target:Runner,effects:Effect[],all:Proc[]):SkillImpact {
  const a=proc.activation,stop=stopTime(race,target.id),end=a.effectiveEnd===null?null:Math.min(stop,a.effectiveEnd),scheduledDuration=a.effectiveDuration;
  const duration=scheduledDuration!==null&&target.finishTimeRaw!=null?Math.max(0,Math.min(a.effectiveEnd!,target.finishTimeRaw)-a.start):scheduledDuration,finishClippedDuration=scheduledDuration!==null&&duration!==null?Math.max(0,scheduledDuration-duration):0;
  const immune=a.simulatedRecipients===undefined&&proc.source.id!==target.id&&proc.source.teamGroup!=null&&target.teamGroup!=null&&proc.source.teamGroup===target.teamGroup;
  const detail=analysis.runners[target.id],ctx=mechanicsContext(race,target,course,detail.statBreakdown,effectiveStrategyCode(target,detail.skillRows));
  const resolved=effects.map(e=>({effect:e,value:effectValue(proc.source,a.referenceSkillId??a.skillId,e)}));
  const unknown=resolved.some(e=>e.value===null),laneOnly=effects.length>0&&effects.every(e=>[28,35].includes(e.type)),unsupported=!laneOnly&&effects.some(e=>![9,21,22,27,31].includes(e.type));
  const current=resolved.filter(e=>[21,22].includes(e.effect.type)).reduce((sum,e)=>sum+(e.value??0),0);
  const targetDelta=resolved.filter(e=>e.effect.type===27).reduce((sum,e)=>sum+(e.value??0),0),accelDelta=resolved.filter(e=>e.effect.type===31).reduce((sum,e)=>sum+(e.value??0),0);
  const hpFraction=resolved.filter(e=>e.effect.type===9).reduce((sum,e)=>sum+(e.value??0),0);
  const pureDirect=effects.length>0&&effects.every(e=>[21,22].includes(e.type));
  const otherMovement=all.filter(p=>p!==proc&&p.activation.start<(a.effectiveEnd??a.start)&&((p.activation.effectiveEnd??stop)>a.start)&&p.activation.effects.some(e=>(applies(p,target,e)||!p.recipientsKnown&&(e.targetType??1)!==1)&&moves.has(e.type)))
    .filter(p=>!(p.activation.start===0&&reference?.metadata.skills[p.activation.referenceSkillId??p.activation.skillId]?.branches.find((b,i)=>(b.branchIndex??i)===p.activation.effectBranch)?.rawDuration!<0&&p.activation.effects.every(e=>[1,2,3,4,5,6,8,29].includes(e.type))));
  const overlap=otherMovement.length>0;
  const unresolvedOther=otherMovement.some(p=>p.activation.effectiveEnd===null||p.activation.effects.some(e=>(applies(p,target,e)||!p.recipientsKnown&&(e.targetType??1)!==1)&&moves.has(e.type)&&(![21,22,27,31].includes(e.type)||effectValue(p.source,p.activation.referenceSkillId??p.activation.skillId,e)===null||!p.recipientsKnown&&(e.targetType??1)!==1)));
  const reasons=new Set<string>();
  const overlapsUnresolved=(p:Proc)=>p.activation.effectiveEnd===null||p.activation.effects.some(e=>(applies(p,target,e)||!p.recipientsKnown&&(e.targetType??1)!==1)&&moves.has(e.type)&&(![21,22,27,31].includes(e.type)||effectValue(p.source,p.activation.referenceSkillId??p.activation.skillId,e)===null||!p.recipientsKnown&&(e.targetType??1)!==1));
  const boundaries=otherMovement.flatMap(p=>[p.activation.start,p.activation.effectiveEnd??stop]).filter(t=>t>a.start&&t<(end??a.start)).sort((a,b)=>a-b);
  let observed={observedDistance:null as number|null,observedHpConsumed:null as number|null,observedHpRecovered:null as number|null};
  let observationStart:number|null=null,observationEnd:number|null=null;
  if(end!==null&&end>a.start){observationStart=a.start;observationEnd=end;observed=observedWindow(race,target.id,a.start,end);}
  else {const rows=trace(race,target.id),before=rows.filter(r=>r.time<a.start).at(-1),after=rows.find(r=>r.time>=a.start);if(before&&after){observationStart=before.time;observationEnd=after.time;observed=observedWindow(race,target.id,before.time,after.time);}}
  let assessable=0,useful=0,distanceDelta=0,timeDelta=0,timeAssessed=0,hpDelta=0,hpAssessed=0,noEffectVelocity:number|null=null,lastSelf:number|null=null,freeWith:number|null=null,freeWithout:number|null=null,blockingAssessed=0,blockingLoss=0;
  const movement=effects.some(e=>[21,22,27,31].includes(e.type));
  if(!immune&&!unknown&&!unsupported&&movement&&end!==null)for(let time=a.start;time<end-1e-6;){const finish=Math.min(end,time+1/15,boundaries.find(t=>t>time+1e-7)??end),dt=finish-time,p=atTime(race,target.id,time),q=atTime(race,target.id,finish);time=finish;
    if(!pureDirect&&otherMovement.some(o=>active(o,finish-dt/2)&&overlapsUnresolved(o))){reasons.add('An overlapping movement effect cannot be modeled.');noEffectVelocity=null;freeWith=freeWithout=null;continue;}
    if(!pureDirect&&directTransitionInBracket(race,target,finish-dt/2,all)){reasons.add('A speed-effect transition falls between recorded samples.');noEffectVelocity=null;freeWith=freeWithout=null;continue;}
    if(!p||!q||p.speed===null||q.speed===null||p.distance===null||q.distance===null){reasons.add('Recorded speed or distance is missing.');noEffectVelocity=null;freeWith=freeWithout=null;continue;}
    if(!targetDelta&&!accelDelta){assessable+=dt;useful+=current!==0?dt:0;distanceDelta+=current*dt;const v=(p.speed+q.speed)/2;if(v-current>0){timeDelta+=-current/(v-current)*dt;timeAssessed+=dt;}hpAssessed+=dt;continue;}
    if(!ctx||p.hp===null||q.hp===null||p.hp<=0||q.hp<=0||p.blockFrontRunnerIndex==null||q.blockFrontRunnerIndex==null){reasons.add(!ctx?'Reference course or strategy inputs are missing.':p.hp===null||q.hp===null?'Recorded HP is missing.':p.hp<=0||q.hp<=0?'HP is depleted.':'Front-block state changes between samples.');noEffectVelocity=null;freeWith=freeWithout=null;continue;}
    const others={current:0,target:0,accel:0};for(const other of otherMovement.filter(o=>active(o,finish-dt/2)))for(const e of other.activation.effects.filter(e=>applies(other,target,e))){const value=effectValue(other.source,other.activation.referenceSkillId??other.activation.skillId,e)??0;if([21,22].includes(e.type))others.current+=value;else if(e.type===27)others.target+=value;else if(e.type===31)others.accel+=value;}
    const dash=startDashStateAt(race,analysis,target.id,finish-dt);
    const range=baselineTarget(ctx,p.distance),baseAccel=baseAcceleration(ctx,p.distance,Math.max(0,p.speed-current-others.current),dash===true);
    if(!range||baseAccel===null){reasons.add('Reference stat or aptitude inputs are missing.');noEffectVelocity=null;freeWith=freeWithout=null;continue;}const duel=detail.intervals.some(i=>i.kind==='dueling-model'&&finish-dt/2>=i.start&&finish-dt/2<(i.end??i.start));
    const duelAccel=duel&&ctx.stats.stats.guts.final!==null?(160*ctx.stats.stats.guts.final)**.59*.0001:0;
    const acceleration=Math.max(0,baseAccel+others.accel+duelAccel);
    // Early position-keeping is not directly recorded. The start dash is the
    // exception; its threshold is known, while later mid-race remains assessable.
    if(p.distance<ctx.course.distance*10/24&&dash!==true){reasons.add('Early position keeping is not recorded.');noEffectVelocity=null;freeWith=freeWithout=null;continue;}
    const self=p.speed-current-others.current,nextSelf=q.speed-current-others.current,change=(nextSelf-self)/dt;
    const status=statusTarget(detail.intervals,finish-dt/2,range.max);if(status===null){reasons.add('Overlapping status models disagree.');noEffectVelocity=null;freeWith=freeWithout=null;continue;}
    const normalMax=Math.min(30,range.max+status+others.target),normalMin=Math.min(30,range.min+status+others.target);
    const block=frontBlockCapAt(race,target,finish-dt/2);
    if(block.blocked){
      if(block.cap===null||p.blockFrontRunnerIndex!==q.blockFrontRunnerIndex||nextSelf>block.cap+.15||nextSelf<block.cap-.25&&change<=.02){reasons.add('Blocker speed or geometry is unresolved.');noEffectVelocity=null;freeWith=freeWithout=null;continue;}
      if(targetDelta!==0&&block.cap>normalMin&&block.cap<normalMax+Math.max(0,targetDelta)){reasons.add('The block cap overlaps an unreported target range.');noEffectVelocity=null;freeWith=freeWithout=null;continue;}
      noEffectVelocity??=self;freeWith??=self;freeWithout??=self;
      freeWith=advanceSelf(freeWith,Math.min(30,normalMax+targetDelta),Math.max(0,acceleration+accelDelta),dt,p.distance,ctx.course.distance);
      freeWithout=advanceSelf(freeWithout,normalMax,acceleration,dt,p.distance,ctx.course.distance);
      const without=Math.min(block.cap,advanceSelf(noEffectVelocity,normalMax,acceleration,dt,p.distance,ctx.course.distance));
      const withEffect=Math.min(block.cap,advanceSelf(self,Math.min(30,normalMax+targetDelta),Math.max(0,acceleration+accelDelta),dt,p.distance,ctx.course.distance));
      const delta=withEffect-without,totalDelta=delta+current,potential=freeWith-freeWithout;
      noEffectVelocity=without;lastSelf=nextSelf;assessable+=dt;blockingAssessed+=dt;blockingLoss+=Math.max(0,potential-delta)*dt;
      useful+=Math.abs(totalDelta)>.001?dt:0;distanceDelta+=totalDelta*dt;
      const actualTravel=(p.speed+q.speed)/2,counterTravel=actualTravel-totalDelta;if(counterTravel>0){timeDelta-=totalDelta/counterTravel*dt;timeAssessed+=dt;}
      const fullHp=hpReference(ctx,withEffect,q.distance),withoutHp=hpReference(ctx,without,q.distance);if(fullHp!==null&&withoutHp!==null){hpDelta+=(fullHp-withoutHp)*statusHpFactor(detail.intervals,finish-dt/2,ctx.style)*dt;hpAssessed+=dt;}
      continue;
    }
    freeWith=freeWithout=null;
    const cap=Math.min(30,normalMax+targetDelta),accelerating=change>.02&&self<cap+.05;
    const atCap=change<=.05&&self>=normalMin+targetDelta-.08;
    if(!accelerating&&!atCap){reasons.add(change>.02?'Recorded speed rises above the reference ceiling.':'Speed changes do not match the current model.');noEffectVelocity=null;freeWith=freeWithout=null;continue;}
    if(accelerating&&accelDelta>0&&change<acceleration-.05&&nextSelf<normalMin+targetDelta-.08){reasons.add('Sampled acceleration differs from the reference.');noEffectVelocity=null;freeWith=freeWithout=null;continue;}
    noEffectVelocity??=self;
    if(noEffectVelocity<normalMax)noEffectVelocity=Math.min(normalMax,noEffectVelocity+acceleration*dt);
    else noEffectVelocity=Math.max(normalMax,noEffectVelocity-referenceDeceleration(p.distance??Infinity,ctx.course.distance,detail.intervals.some(i=>i.kind==='pace-down-model'&&finish-dt/2>=i.start&&finish-dt/2<(i.end??i.start)))*dt);
    const limit=Math.abs(targetDelta)+Math.abs(accelDelta)*(finish-a.start);
    let delta=nextSelf-noEffectVelocity;
    delta=targetDelta>=0&&accelDelta>=0?Math.max(0,Math.min(limit,delta)):targetDelta<=0&&accelDelta<=0?Math.min(0,Math.max(-limit,delta)):NaN;
    if(!Number.isFinite(delta)){reasons.add('Opposing mixed effects cannot be separated.');noEffectVelocity=null;freeWith=freeWithout=null;continue;}
    const effective=Math.abs(current)>0||Math.abs(targetDelta)>0&&(targetDelta>0?self>normalMax+.02:atCap)||Math.abs(accelDelta)>0&&accelerating;
    // The ambiguous section-wit target range cannot prove a target-speed effect
    // was binding when speed sits inside that range.
    if(targetDelta!==0&&accelDelta===0&&current===0&&self>=normalMin-.02&&self<=normalMax+.02){reasons.add('Exact target speed is not recorded.');noEffectVelocity=null;freeWith=freeWithout=null;continue;}
    lastSelf=nextSelf;assessable+=dt;useful+=effective?dt:0;const totalDelta=delta+current;distanceDelta+=totalDelta*dt;
    const without=(p.speed+q.speed)/2-totalDelta;if(without>0){timeDelta+=-totalDelta/without*dt;timeAssessed+=dt;}
    const fullHp=hpReference(ctx,nextSelf,q.distance),withoutHp=hpReference(ctx,noEffectVelocity,q.distance);
    if(fullHp!==null&&withoutHp!==null){hpDelta+=(fullHp-withoutHp)*statusHpFactor(detail.intervals,finish-dt/2,ctx.style)*dt;hpAssessed+=dt;}
  }
  if(immune)assessable=duration??0;
  if(laneOnly&&!unknown&&duration!==null){assessable=duration;useful=0;distanceDelta=0;timeDelta=0;timeAssessed=duration;}
  const complete=duration!==null&&Math.abs(assessable-duration)<1e-4,knownHp=detail.statBreakdown.startingHp.modeled;
  let instantHp:number|null=null;
  const hpBefore=trace(race,target.id).filter(p=>p.time<a.start).at(-1)?.time??a.start,hpAfter=trace(race,target.id).find(p=>p.time>=a.start)?.time??a.start;
  const sharedHpBracket=all.some(p=>p!==proc&&p.activation.start>hpBefore&&p.activation.start<=hpAfter&&p.activation.effects.some(e=>e.type===9&&(applies(p,target,e)||!p.recipientsKnown&&(e.targetType??1)!==1)));

  if(!immune&&!unknown&&!unsupported&&!sharedHpBracket&&hpFraction!==0&&knownHp!==null){const before=trace(race,target.id).filter(p=>p.time<a.start).at(-1)?.sample.hp??null;if(before!==null)instantHp=hpFraction<0?Math.min(before,-hpFraction*knownHp):-Math.min(Math.max(0,knownHp-before),hpFraction*knownHp);}
  const instant= a.timingKind==='instant'&&!movement;
  const nominalHp=knownHp===null?null:Math.abs(hpFraction)*knownHp;
  const instantUtilization=instantHp!==null&&nominalHp!==null&&nominalHp>0?Math.min(1,Math.abs(instantHp)/nominalHp):null;
  const utilization=immune?0:instant?instantUtilization:complete&&duration!>0?Math.min(1,Math.max(0,useful/duration!)):null;
  const unavailableReasons:string[]=[];
  if(unknown)unavailableReasons.push(proc.source.skills?.some(s=>s.id===(a.referenceSkillId??a.skillId)&&s.level==null)?'Skill level is missing.':'Skill effect scaling is unresolved.');if(unsupported)unavailableReasons.push(effects.some(e=>e.type===37)?'Randomly activated skills are analyzed separately.':effects.some(e=>[28,35].includes(e.type))?'Lane movement changes are not a forward-speed estimate.':'This effect has no supported movement model.');if(duration===null)unavailableReasons.push(a.timingReason);
  if(!immune&&!instant&&!complete)unavailableReasons.push(...reasons);if(instant&&instantUtilization===null)unavailableReasons.push(sharedHpBracket?'Another HP effect shares this sample window.':'Pre-effect HP or maximum HP unavailable');
  const residual=resolved.filter(e=>e.effect.type===22).reduce((n,e)=>n+(e.value??0),0);
  const entrySample=end===null?null:atTime(race,target.id,end);
  const ownSelf=lastSelf??(entrySample?.speed===null?null:entrySample?.speed!=null?entrySample.speed-current:null);
  const entryWithout=noEffectVelocity??(!targetDelta&&!accelDelta?ownSelf:null);
  const entryWith=ownSelf===null?null:ownSelf+residual;
  const carryover=immune?unavailableCarryover('Reference team immunity',end,0):carryoverFor(race,target,analysis,a,ctx,entryWith,entryWithout,complete&&!unknown&&!unsupported);
  let blockingDuration=0;const samples=trace(race,target.id);for(let i=1;i<samples.length;i++){const p=samples[i-1],q=samples[i];if(p.sample.blockFrontRunnerIndex!=null&&p.sample.blockFrontRunnerIndex>=0&&q.sample.blockFrontRunnerIndex!=null&&q.sample.blockFrontRunnerIndex>=0)blockingDuration+=Math.max(0,Math.min(end??a.start,q.time)-Math.max(a.start,p.time));}
  if(pureDirect&&!unknown&&complete){blockingAssessed=blockingDuration;blockingLoss=0;}
  const recovery=hpFraction>0?recoveryTimingFor(race,target,analysis,a,instantHp===null?null:Math.max(0,-instantHp),nominalHp,course):null;
  const effectKind=immune||movement&&assessable>0||instantHp!==null?'estimated':'unknown';
  const explanation=`Reference effect-removal model anchored to retained samples, not measured causal gain/loss. Useful fraction means the supported mechanic was applicable at assessed/interpolated1/15s samples, not proven gained ground. Direct current-speed21/22 changes distance immediately and does not itself change HP drain while active;22 residual after expiry is assessed separately as carryover. Target-speed effects bind only when the target ceiling matters, including partial usefulness after accelerating to it. A recorded last-spurt start alone does not prove maximum spurt speed; its unreported target is bounded. Same-kind status bonuses are applied once, and start dash cannot restart after its self-speed threshold was crossed. Acceleration can help in any phase while below target; at target it is not used. Time is the equivalent fixed-window travel difference, not a resimulated finish-time gain. Recorded front blocks constrain both effect trajectories using blocker speed/gap; direct current-speed effects remain additive after the cap. Unknown position keeping, blocker geometry, incomplete inputs, conditional scaling or unresolved overlapping movement effects withhold whole-window totals. ${proc.source.id!==target.id?'Recipients come from the recorded mask; modeled effects are conditional on the recipient not being immune. ':''}${overlap?'Resolved overlapping effects are held fixed for this marginal model; overlapping marginal models must not be summed. Direct-speed distance components alone are additive. ':''}${a.timingKind==='reference'?a.timingReason+' ':''}${duration===null?'No supported active duration. ':''}${hpFraction!==0?'Instant HP magnitude and utilization use the preceding retained HP sample for a reference clamp model; unsampled pre-event HP and simultaneous drain are unresolved. Observed HP around instant events is a sample bracket including other drain/recovery. ':''}`;
  return {scheduledDuration,finishClippedDuration,effectUtilization:componentUtilization(race,analysis,proc,target,effects,all,ctx,duration,end,scheduledDuration,finishClippedDuration),skillId:a.referenceSkillId??a.skillId,sourceRunnerId:proc.source.id,targetRunnerId:target.id,start:a.start,end:a.effectiveEnd,activeDuration:duration,durationEvidence:a.timingKind==='reference'?'estimated':a.timingKind==='instant'?'derived':a.durationEvidence,observationStart,observationEnd,
    utilization,utilizationKind:laneOnly?'lane':instant?'hp-capacity':movement?'movement-active-time':'unknown',recovery,blockingDuration,blockingAssessedDuration:blockingAssessed,blockingDistanceLoss:Math.abs(blockingDuration-blockingAssessed)<1e-4?blockingLoss:null,assessedBlockingDistanceLoss:blockingAssessed>0?blockingLoss:blockingDuration===0?0:null,unavailableReasons,carryover,assessableDuration:assessable,usefulDuration:immune?0:assessable>0?useful:null,usefulRate:complete&&duration!>0?useful/duration!:null,
    coverageRate:instant?instantUtilization!==null?1:0:duration!==null&&duration>0?Math.min(1,assessable/duration):null,usefulAmongAssessed:assessable>0?useful/assessable:null,
    effectiveness:immune?'not-useful':instant&&instantUtilization!==null?instantUtilization===0?'not-useful':instantUtilization===1?'useful':'partial':assessable===0?'unresolved':useful===0?'not-useful':complete&&Math.abs(useful-assessable)<1e-4?'useful':'partial',evidence:effectKind,additiveDistance:pureDirect&&!unknown,
    assessedModeledDistanceDelta:immune?0:assessable>0?distanceDelta:null,assessedModeledTimeDelta:immune?0:timeAssessed>0?timeDelta:null,assessedModeledHpDelta:immune?0:hpAssessed>0?hpDelta:instantHp,
    ...observed,modeledDistanceDelta:immune?0:movement&&complete?distanceDelta:null,modeledTimeDelta:immune?0:movement&&complete&&Math.abs(timeAssessed-duration!)<1e-4?timeDelta:null,
    modeledHpDelta:immune?0:instantHp!==null?(movement?complete&&Math.abs(hpAssessed-assessable)<1e-4?instantHp+hpDelta:null:instantHp):movement&&complete&&Math.abs(hpAssessed-assessable)<1e-4?hpDelta:null,
    detail:explanation+(immune?' Explicit race team groups match; reference debuff immunity excludes this selected recipient. This is mask selection, not an applied hit.':proc.source.id!==target.id&&proc.source.teamGroup!=null&&target.teamGroup!=null?' Explicit race team groups differ.':'')};
}
export function contributionTotals(values:SkillImpact[],label:string):ContributionTotal {
  const sorted=values.slice().sort((a,b)=>a.start-b.start),overlap=sorted.some((v,i)=>sorted.slice(0,i).some(p=>windowOverlaps({start:v.start,end:v.end} as SkillActivation,{start:p.start,end:p.end} as SkillActivation)));
  const observationOverlap=values.some((v,i)=>v.observationStart!==null&&v.observationEnd!==null&&values.slice(0,i).some(p=>p.observationStart!==null&&p.observationEnd!==null&&v.observationStart!<p.observationEnd&&p.observationStart<v.observationEnd!));
  const sum=(key:'observedDistance'|'observedHpConsumed'|'observedHpRecovered'|'modeledDistanceDelta'|'modeledTimeDelta'|'modeledHpDelta')=>!(key.startsWith('observed')?observationOverlap:overlap&&!(key==='modeledDistanceDelta'&&values.every(v=>v.additiveDistance)||key==='modeledHpDelta'&&values.every(v=>v.additiveDistance&&v.modeledHpDelta===0)))&&values.every(v=>v[key]!==null)?values.reduce((n,v)=>n+v[key]!,0):null;
  return {intervals:values.length,duration:values.reduce((n,v)=>n+(v.activeDuration??0),0),assessedDuration:values.reduce((n,v)=>n+v.assessableDuration,0),
    observedDistance:sum('observedDistance'),observedHpConsumed:sum('observedHpConsumed'),observedHpRecovered:sum('observedHpRecovered'),modeledDistanceDelta:sum('modeledDistanceDelta'),modeledTimeDelta:sum('modeledTimeDelta'),modeledHpDelta:sum('modeledHpDelta'),
    detail:`${label}. Signed distance helps when positive; signed time/HP is cost when positive. ${overlap?'Active windows overlap; model totals are withheld to avoid double counting. ':''}${observationOverlap?'Observation brackets overlap; sampled totals are withheld. ':''}Unknown contributions make the respective total unknown. Sampled HP/travel include other causes. ${values.map(v=>v.detail).filter((d,i,a)=>a.indexOf(d)===i).join(' ')}`};
}
/** Aggregates this runner's own activations; incoming targets are separate. */
export function skillImpactSummary(detail:RunnerAnalysis,skillId:number):SkillImpactSummary|null {
  const values=detail.skillImpacts.filter(i=>i.skillId===skillId);if(!values.length)return null;const total=contributionTotals(values,'Own recorded skill procs');
  const activeDuration=values.every(v=>v.activeDuration!==null)?values.reduce((n,v)=>n+v.activeDuration!,0):null,assessableDuration=total.assessedDuration;
  const usefulDuration=assessableDuration>0?values.reduce((n,v)=>n+(v.usefulDuration??0),0):null;
  const complete=activeDuration!==null&&Math.abs(assessableDuration-activeDuration)<1e-4;
  const overlap=values.some((v,i)=>values.slice(0,i).some(p=>windowOverlaps({start:v.start,end:v.end} as SkillActivation,{start:p.start,end:p.end} as SkillActivation)));
  const partial=(key:'assessedModeledDistanceDelta'|'assessedModeledTimeDelta'|'assessedModeledHpDelta')=>!(overlap&&!(key==='assessedModeledDistanceDelta'&&values.every(v=>v.additiveDistance)))&&values.some(v=>v[key]!==null)?values.reduce((n,v)=>n+(v[key]??0),0):null;
  const instantOnly=values.every(v=>v.activeDuration===0),utilization=instantOnly&&values.every(v=>v.utilization!==null)?values.reduce((n,v)=>n+v.utilization!,0)/values.length:complete&&activeDuration!>0&&usefulDuration!==null?Math.min(1,usefulDuration/activeDuration!):null;
  const carryover=values.length===1?values[0].carryover:unavailableCarryover('Multiple proc carryovers are not additive');
  const blockingDuration=values.reduce((n,v)=>n+v.blockingDuration,0),blockingAssessedDuration=values.reduce((n,v)=>n+v.blockingAssessedDuration,0);
  const scheduledDuration=values.every(v=>v.scheduledDuration!==null)?values.reduce((n,v)=>n+v.scheduledDuration!,0):null;
  const effectUtilization:EffectUtilization[]=[];for(const kind of ['current-speed','target-speed','acceleration'] as const){const rows=values.flatMap(v=>v.effectUtilization.filter(e=>e.kind===kind));if(!rows.length)continue;const active=rows.every(r=>r.activeDuration!==null)?rows.reduce((n,r)=>n+r.activeDuration!,0):null,assessed=rows.reduce((n,r)=>n+r.assessedDuration,0),useful=rows.some(r=>r.usefulDuration!==null)?rows.reduce((n,r)=>n+(r.usefulDuration??0),0):null;effectUtilization.push({kind,activeDuration:active,assessedDuration:assessed,afterFinishDuration:rows.reduce((n,r)=>n+r.afterFinishDuration,0),usefulDuration:useful,cappedDuration:rows.every(r=>r.cappedDuration!==null)?rows.reduce((n,r)=>n+r.cappedDuration!,0):null,blockedDuration:rows.every(r=>r.blockedDuration!==null)?rows.reduce((n,r)=>n+r.blockedDuration!,0):null,utilization:active!==null&&active>0&&Math.abs(active-assessed)<1e-4&&useful!==null?useful/active:null,coverageRate:active!==null&&active>0?assessed/active:null,usefulAmongAssessed:assessed>0&&useful!==null?useful/assessed:null});}
  for(const summary of effectUtilization){const rows=values.flatMap(v=>v.effectUtilization.filter(e=>e.kind===summary.kind));if(rows.every(r=>r.scoringConvention==='target-speed-half-credit'))Object.assign(summary,{scoringConvention:'target-speed-half-credit',acceleratingDuration:rows.reduce((n,r)=>n+(r.acceleratingDuration??0),0),fullyEffectiveDuration:rows.reduce((n,r)=>n+(r.fullyEffectiveDuration??0),0),belowBaselineDuration:rows.reduce((n,r)=>n+(r.belowBaselineDuration??0),0)});}
  return {scheduledDuration,finishClippedDuration:values.reduce((n,v)=>n+v.finishClippedDuration,0),effectUtilization,skillId,activations:values.length,activeDuration,assessableDuration,usefulDuration,utilization,utilizationKind:values.every(v=>v.utilizationKind===values[0].utilizationKind)?values[0].utilizationKind:'unknown',recovery:values.length===1?values[0].recovery:null,blockingDuration,blockingAssessedDuration,
    blockingDistanceLoss:!overlap&&values.every(v=>v.blockingDistanceLoss!==null)?values.reduce((n,v)=>n+v.blockingDistanceLoss!,0):null,assessedBlockingDistanceLoss:!overlap&&values.some(v=>v.assessedBlockingDistanceLoss!==null)?values.reduce((n,v)=>n+(v.assessedBlockingDistanceLoss??0),0):null,carryover,unavailableReasons:[...new Set(values.flatMap(v=>v.unavailableReasons))],
    usefulRate:complete&&activeDuration!>0&&usefulDuration!==null?usefulDuration/activeDuration!:null,
    coverageRate:instantOnly?values.every(v=>v.coverageRate===1)?1:0:activeDuration!==null&&activeDuration>0?Math.min(1,assessableDuration/activeDuration):null,usefulAmongAssessed:usefulDuration!==null&&assessableDuration>0?usefulDuration/assessableDuration:null,
    assessedModeledDistanceDelta:partial('assessedModeledDistanceDelta'),assessedModeledTimeDelta:partial('assessedModeledTimeDelta'),assessedModeledHpDelta:partial('assessedModeledHpDelta'),
    observedDistance:total.observedDistance,observedHpConsumed:total.observedHpConsumed,observedHpRecovered:total.observedHpRecovered,modeledDistanceDelta:total.modeledDistanceDelta,modeledTimeDelta:total.modeledTimeDelta,modeledHpDelta:total.modeledHpDelta,detail:total.detail};
}
export function populateSkillImpacts(race:Race,reference:ReferenceData|null,course:CourseReference|null,analysis:RaceAnalysis):void {
  const all=procsFor(race,analysis);analysis.debuffs=[];
  for(const proc of all){const a=proc.activation,own=a.effects.filter(e=>(e.targetType??1)===1),foreign=a.effects.filter(harmful);
    if(own.length)analysis.runners[proc.source.id].skillImpacts.push(evaluateImpact(race,reference,course,analysis,proc,proc.source,own,all));
    if(foreign.length){analysis.debuffs.push({sourceRunnerId:proc.source.id,skillId:a.skillId,start:a.start,end:a.end,effectiveEnd:a.effectiveEnd,effectiveDuration:a.effectiveDuration,timingKind:a.timingKind,timingReason:a.timingReason,targetRunnerIds:a.targetRunnerIds,recipientsKnown:proc.recipientsKnown,simulatedRecipients:a.simulatedRecipients,effects:foreign,detail:a.simulatedRecipients?'Confirmed applied effects in the matched execution.':'Recorded skill activation and target-mask selection. A mask does not measure effect magnitude or prove immunity was absent; unknown recipients are never filled from a cone.'});for(const id of a.targetRunnerIds){const target=race.runners.find(r=>r.id===id);if(target)analysis.runners[id].receivedDebuffImpacts.push(evaluateImpact(race,reference,course,analysis,proc,target,a.simulatedRecipients?.[id]?.filter(harmful)??foreign,all));}}
  }
  for(const runner of race.runners){const detail=analysis.runners[runner.id];detail.receivedDebuffTotals=contributionTotals(detail.receivedDebuffImpacts,'Recorded-mask incoming debuffs; model conditional on immunity and known effects');
    if(analysis.debuffs.some(d=>d.sourceRunnerId!==runner.id&&!d.recipientsKnown)){for(const key of ['observedDistance','observedHpConsumed','observedHpRecovered','modeledDistanceDelta','modeledTimeDelta','modeledHpDelta'] as const)detail.receivedDebuffTotals[key]=null;detail.receivedDebuffTotals.detail+=' Unreported recipient masks leave incoming totals unresolved.';}
  }
}
export function visionDistanceAt(race:Race,runnerId:string,time:number,reference:ReferenceData|null,analysis:RaceAnalysis):{metres:number|null;detail:string} {
  if(analysis.source==='simulation'){
    const runner=race.runners.find(r=>r.id===runnerId),detail=analysis.runners[runnerId];if(!runner||!detail)return {metres:null,detail:'Runner unavailable.'};
    const effects:number[]=[];
    for(const source of race.runners)for(const a of analysis.runners[source.id]?.skillActivations??[]){
      const delivered=source.id===runnerId?a.effects.filter(e=>(e.targetType??1)===1):a.simulatedRecipients?.[runnerId]??[];
      for(const e of delivered.filter(e=>e.type===8)){
        const start=e.appliedStart??a.start,end=e.appliedEnd??a.effectiveEnd;
        if(time<start||end!==null&&time>=end)continue;
        if(end===null&&a.timingKind!=='passive')return {metres:null,detail:'Vision effect expiry unavailable.'};
        const value=effectValue(source,a.referenceSkillId??a.skillId,e);
        if(value===null)return {metres:null,detail:'Applied vision modifier unavailable.'};
        effects.push(value);
      }
    }
    return {metres:Math.max(0,20+effects.reduce((n,v)=>n+v,0)),detail:'Reference 20 m vision plus confirmed self and incoming vision modifiers at this time. Geometry is a fixed-position guide.'};
  }
  const runner=race.runners.find(r=>r.id===runnerId),detail=analysis.runners[runnerId];if(!runner||!detail)return {metres:null,detail:'Runner unavailable.'};let metres=20;
  for(const row of detail.skillRows){const def=reference?.metadata.skills[row.skillId];if(!def){if(row.equipped)return {metres:null,detail:'Equipped vision effects unavailable.'};continue;}
    for(const [i,b] of def.branches.entries()){const index=b.branchIndex??i,vision=b.effects.filter(e=>e.type===8&&(e.targetType??1)===1);if(!vision.length||b.rawDuration>=0)continue;
      if(row.conditionEvaluation?.branches.find(b=>b.branchIndex===index)?.state==='unmet')continue;
      if(!row.inferredBranches.includes(index)&&!row.activations.some(a=>a.start===0&&a.effectBranch===index))return {metres:null,detail:'An equipped passive vision modifier is unresolved.'};
      for(const e of vision){const value=effectValue(runner,row.skillId,e);if(value===null)return {metres:null,detail:'Passive vision scaling unresolved.'};metres+=value;}
    }
  }
  for(const proc of procsFor(race,analysis)){
    if(time<proc.activation.start)continue;
    if(!proc.recipientsKnown&&proc.source.id!==runner.id&&proc.activation.effects.some(e=>e.type===8&&(e.targetType??1)!==1)&&(proc.activation.effectiveEnd===null||active(proc,time)))return {metres:null,detail:'Possible incoming vision effect has an unreported recipient mask.'};
    const vision=proc.activation.effects.filter(e=>e.type===8&&applies(proc,runner,e));if(!vision.length)continue;
    const branch=reference?.metadata.skills[proc.activation.referenceSkillId??proc.activation.skillId]?.branches.find((b,i)=>(b.branchIndex??i)===proc.activation.effectBranch);
    if(proc.activation.start===0&&branch&&branch.rawDuration<0)continue;
    if(proc.source.id!==runner.id&&proc.source.teamGroup!=null&&runner.teamGroup!=null&&proc.source.teamGroup===runner.teamGroup)continue;
    if(proc.activation.effectiveEnd===null)return {metres:null,detail:'Vision activation duration unresolved.'};if(!active(proc,time))continue;for(const e of vision){const value=effectValue(proc.source,proc.activation.referenceSkillId??proc.activation.skillId,e);if(value===null)return {metres:null,detail:'Vision scaling unresolved.'};metres+=value;}}
  return {metres:Math.max(0,metres),detail:'Reference vision:20m plus resolved passive and supported reported/reference active vision-distance effects. Geometry is a visibility guide, not recorded skill recipients; team immunity and unreported timing remain separate.'};
}
