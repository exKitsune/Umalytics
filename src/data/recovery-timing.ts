import type { Race, Runner } from './types';
import type { RaceAnalysis, SkillActivation } from './analytics';
import type { RecoveryTiming } from './effect-types';
import { atTime, trace } from './effect-sampling';
import { selfSpeedAt } from './mechanics-effects';
import type { CourseReference } from './reference';
import { mechanicsContext, hpReference } from './mechanics-model';
import { distanceAptitude } from './race-stats';
import { effectiveStrategyCode } from './skill-details';
export function recoveryTimingFor(race:Race,runner:Runner,analysis:Pick<RaceAnalysis,'runners'>,activation:SkillActivation,restored:number|null,nominal:number|null,course:CourseReference|null):RecoveryTiming {
  const detail=analysis.runners[runner.id],eventDistance=atTime(race,runner.id,activation.start)?.distance??null,spurtDistance=runner.lastSpurtDistance??null,spurtTime=detail.summary.spurtTime;
  const lateTime=race.distance===null?null:detail.samples.find(s=>s.distance!==null&&s.distance>=race.distance!*2/3)?.time??null;
  const rows=trace(race,runner.id),beforeIndex=rows.reduce((last,p,i)=>p.time<activation.start?i:last,-1),afterIndex=rows.findIndex(p=>p.time>=activation.start);
  const before=rows[beforeIndex],after=rows[afterIndex],prior=rows[beforeIndex-1],next=rows[afterIndex+1];
  const speed=(p:typeof before|undefined)=>p?.sample.speed!=null?selfSpeedAt(race,analysis,runner.id,p.time,p.sample.speed):null;
  const beforeSpeed=speed(before),afterSpeed=speed(after),priorSpeed=speed(prior),nextSpeed=speed(next);
  const spurtState=eventDistance===null||race.distance===null?'unknown':eventDistance<race.distance*2/3?'before-late':spurtDistance===null?'unknown':spurtDistance<0?'no-recorded-spurt':eventDistance<spurtDistance?'before-recorded-spurt':'during-recorded-spurt';
  let referenceMaxSpurtHpCost:number|null=null,referenceBudgetBefore:number|null=null,referenceBudgetAfter:number|null=null,referenceBudgetOutcome:RecoveryTiming['referenceBudgetOutcome']='unknown',benefitReason='Spurt benefit cannot be isolated.';
  const ctx=mechanicsContext(race,runner,course,detail.statBreakdown,effectiveStrategyCode(runner,detail.skillRows)),stats=detail.statBreakdown.stats;
  if(spurtState==='before-late'){referenceBudgetOutcome='not-late';benefitReason='This heal precedes the late-phase spurt calculation.';}
  else if(ctx&&eventDistance!==null&&restored!==null&&before?.sample.hp!=null&&stats.speed.final!==null&&stats.guts.final!==null&&stats.power.final!==null&&ctx.distanceRank!==null){
    const base=20-(ctx.course.distance-2000)/1000,term=Math.sqrt(500*stats.speed.final)*distanceAptitude[ctx.distanceRank-1]*.002,style=({1:.962,2:.975,3:.994,4:1,5:.95} as Record<number,number>)[ctx.style];
    const maxSpurt=(base*style+term+.01*base)*1.05+term+(450*stats.guts.final)**.597*.0001,minimum=.85*base+Math.sqrt(200*stats.guts.final)*.001;
    let cost=0,known=true;for(let d=eventDistance;d<ctx.course.distance-60;){const next=Math.min(ctx.course.distance-60,d+5),mid=(d+next)/2,slope=ctx.course.slopes.find(s=>mid>=s.start&&mid<s.start+s.length)?.slopePercent??0,speed=Math.min(30,Math.max(minimum,maxSpurt-(slope>0?slope*200/stats.power.final:0))),rate=hpReference(ctx,speed,mid);if(rate===null){known=false;break;}cost+=rate*(next-d)/speed;d=next;}
    if(known){referenceMaxSpurtHpCost=cost;const pre=before.sample.hp,post=Math.min(detail.statBreakdown.startingHp.modeled??Infinity,pre+restored);referenceBudgetBefore=cost>0?Math.min(1,Math.max(0,pre/cost)):1;referenceBudgetAfter=cost>0?Math.min(1,Math.max(0,post/cost)):1;
      referenceBudgetOutcome=pre>=cost?'already-covered':post>=cost?'unlocked':'still-short';benefitReason=referenceBudgetOutcome==='unlocked'?'This heal covers the reference maximum-spurt HP shortfall.':referenceBudgetOutcome==='already-covered'?'The reference maximum-spurt HP budget was already covered.':'The reference maximum-spurt HP budget remains short.';}
  }
  return {referenceMaxSpurtHpCost,referenceBudgetBefore,referenceBudgetAfter,referenceBudgetOutcome,benefitReason,modeledHpRestored:restored,modeledOvercapHp:restored!==null&&nominal!==null?Math.max(0,nominal-restored):null,hpEfficiency:restored!==null&&nominal!==null&&nominal>0?Math.min(1,restored/nominal):null,eventDistance,remainingDistance:eventDistance!==null&&race.distance!==null?Math.max(0,race.distance-eventDistance):null,
    latePhaseStartTime:lateTime,recordedSpurtStartTime:spurtTime,secondsBeforeRecordedSpurt:spurtTime===null?null:spurtTime-activation.start,recordedSpurtDelayDistance:spurtDistance!==null&&spurtDistance>=0&&race.distance!==null?Math.max(0,spurtDistance-race.distance*2/3):null,spurtState,
    recalculationOpportunity:eventDistance!==null&&race.distance!==null?eventDistance>=race.distance*2/3:null,sampleTimeBefore:before?.time??null,sampleTimeAfter:after?.time??null,observedSelfSpeedBefore:beforeSpeed,observedSelfSpeedAfter:afterSpeed,
    observedAccelerationBefore:beforeSpeed!==null&&priorSpeed!==null&&before&&prior?(beforeSpeed-priorSpeed)/(before.time-prior.time):null,observedAccelerationAfter:afterSpeed!==null&&nextSpeed!==null&&after&&next?(nextSpeed-afterSpeed)/(next.time-after.time):null,
    detail:'HP efficiency describes reference recoverable capacity, not overall race usefulness. The reference maximum-spurt budget integrates the HP curve to60m before goal at maximum spurt target, accounting for uphill grades but ignoring acceleration, future skills and random modes. It uses preceding retained HP plus the modeled heal, not an exact pre-event HP field. A covered/unlocked budget is a conditional feasibility scenario, not the selected native spurt or causal finish-time gain. The supplied mechanics describes late recalculation including later recovery; inspected simulators guard recalculation once their spurt flag is set, so their guard does not establish native behavior during an already-started spurt. Late recovery provides a reference recalculation opportunity; selected target and wit acceptance are unreported. Recorded delayed-spurt distance and sampled before/after self-speed/acceleration are context, not proof the recovery caused their change.'};
}
