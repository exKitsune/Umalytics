import type {PreparedRace} from '../analysis/prepared';
import type {ReferenceData} from '../data/reference';
import type {RaceAnalysis,StatusInterval} from '../data/analytics';
import {cornerPathFor} from '../data/corner-path';
import {statBreakdownFor} from '../data/race-stats';
import {hillImpactsFor,hillTotals} from '../data/hill-impact';
import {populateStatusImpacts,statusImpactTotals} from '../data/status-impact';
import {populateSkillImpacts,contributionTotals} from '../data/skill-impact';
import {modeImpactsFor} from '../data/status-mode-impact';
import {motionSkillImpact,activationImpact} from '../data/motion-skill-impact';
import {metricsForSkill,mergeSkillMetrics} from '../data/skill-metrics';
import {skillTotals,movementUse} from '../data/skill-totals';
import {atTime} from '../data/effect-sampling';
import {registerReplayMotion,activationMotionKey} from '../data/race-motion';
import {measureMotionBenefit} from '../data/motion-benefit';
import type {MotionLossSummary} from '../data/traffic-loss';
import type {SlowdownAnalysis} from '../data/effect-types';
import {createTraceMotionEngine} from './replay-motion';
import {motionAt,motionIndex as m,type DecisionTrace} from './trace';

function slowdown(loss:MotionLossSummary):SlowdownAnalysis{
  return {duration:loss.duration,assessedDuration:loss.assessedDuration,coverageRate:loss.coverage,
    distanceLoss:loss.distanceLoss?.mid??null,distanceLossMin:loss.distanceLoss?.min??null,distanceLossMax:loss.distanceLoss?.max??null,
    assessedDistanceLossMin:loss.distanceLoss?.min??null,assessedDistanceLossMax:loss.distanceLoss?.max??null,
    timeLossMin:loss.timeLoss?.min??null,timeLossMax:loss.timeLoss?.max??null,unavailableReasons:loss.coverage===1?[]:['Incomplete local comparison.'],detail:loss.detail,
    intervals:loss.episodes.map(e=>({...e,distanceLossMin:e.distanceLoss?.min??null,distanceLossMax:e.distanceLoss?.max??null,timeLossMin:e.timeLoss?.min??null,timeLossMax:e.timeLoss?.max??null}))};
}

/** Feed the established analysis cards from exact trace states plus explicitly
 * local mathematical comparisons. No whole-race rerun and no state inference. */
export async function enrichSimulation(value:PreparedRace,trace:DecisionTrace,reference:ReferenceData,checkpoint:()=>Promise<void>=async()=>{},summaryOnly=false){
  const {race,analysis}=value,course=reference.courses[race.courseId??-1]??null;
  const calculation:RaceAnalysis={runners:{},debuffs:[],warnings:[]};
  for(const runner of race.runners){
    const detail=analysis.runners[runner.id],rows=trace.motion.filter(r=>r[m.horse]===runner.index);
    const breakdown=statBreakdownFor(race,runner,course,reference,detail.skillRows);
    for(const key of ['speed','stamina','power','guts','wisdom'] as const){
      const final=detail.statBreakdown.stats[key].final,modeled=breakdown.stats[key].final;
      breakdown.stats[key].final=final;
      breakdown.stats[key].detail=`Mathematical bonus decomposition using applied initial effects. Effective value comes from the matched engine.${modeled!=null&&final!=null&&Math.abs(final-modeled)>.1?` Reference stages total ${modeled.toFixed(2)}; engine total ${final.toFixed(2)}. Additional engine adjustment is unresolved.`:''}`;
    }
    const hp=detail.summary.hpStart,coefficient=breakdown.startingHp.strategyCoefficient,stamina=breakdown.stats.stamina.final;
    const contribution=stamina!=null&&coefficient!=null?.8*coefficient*stamina:null;
    breakdown.startingHp={...breakdown.startingHp,observed:hp,modeled:hp,staminaContribution:contribution,difference:hp!=null&&contribution!=null&&race.distance!=null?hp-contribution-race.distance:null,
      detail:'Starting HP from the matched engine; distance and stamina components use the fixed-context HP formula.'};
    detail.statBreakdown=breakdown;
    breakdown.evidence='simulated';
    breakdown.detail='Effective stats from the matched simulator; individual bonus stages are a mathematical decomposition.';
    detail.cornerPath=cornerPathFor(race,runner,course);
    const winner=race.runners.find(r=>r.finishOrder===1),finish=winner?.finishTimeRaw;
    if(finish!=null){const first=atTime(race,winner!.id,finish)?.distance,own=atTime(race,runner.id,finish)?.distance;detail.summary.finishGapDistance=first!=null&&own!=null?first-own:null;}
    const intervals:StatusInterval[]=detail.intervals.map(interval=>{
      const r=motionAt(rows,interval.start),guts=breakdown.stats.guts.final;
      const slope=course?.slopes.find(s=>r&&r[m.position]>=s.start&&r[m.position]<s.start+s.length)?.slopePercent??0;
      const model=interval.kind==='downhill-mode'?{speedDelta:.3+Math.abs(slope)/10,hpDrainMultiplier:.4}:
        interval.kind==='dueling'&&guts!=null?{speedDelta:(200*guts)**.708*.0001}:
        interval.kind==='spot-struggle'&&guts!=null?{speedDelta:(500*guts)**.6*.0001}:
        /^(pace-up|pace-down|speed-up|overtake|extra-pace-up)$/.test(interval.kind)&&r?{speedMultiplier:r[m.pace],speedDelta:r[m.base]*(r[m.pace]-1)}:
        interval.kind==='rushed'?{speedDelta:0,hpDrainMultiplier:1.6}:interval.kind==='rushed-boost'&&r?{speedMultiplier:1.04,speedDelta:r[m.base]*.04}:undefined;
      if(model)interval.model=model;
      return {...interval,kind:model&&!interval.kind.startsWith('rushed')?`${interval.kind}-model`:interval.kind,model};
    });
    calculation.runners[runner.id]={...detail,intervals,skillImpacts:[],receivedDebuffImpacts:[]};
  }
  const engine=createTraceMotionEngine(race,reference,calculation,trace);registerReplayMotion(calculation,engine);
  for(const runner of race.runners){
    await checkpoint();const detail=calculation.runners[runner.id];
    if(!summaryOnly){
      populateStatusImpacts(race,runner.id,detail.intervals,course,reference,detail.skillRows,calculation);
      detail.statusImpacts=statusImpactTotals(detail.intervals);
    }
    detail.hillImpacts=hillImpactsFor(race,runner,course,detail,calculation);detail.hillTotals=hillTotals(detail.hillImpacts);
  }
  // Summary batches still calculate motion, effectiveness and carryover. The
  // detailed per-activation explanations/HP cards are built only when opened.
  if(!summaryOnly){await checkpoint();populateSkillImpacts(race,reference,course,calculation);}
  for(const runner of race.runners){
    await checkpoint();const detail=calculation.runners[runner.id],ready=value.runners[runner.id],display=analysis.runners[runner.id];
    const motion=engine.build({runnerId:runner.id}).runners[runner.id];
    const releases=ready.power?.releases.filter(r=>r.end>r.start)??[];
    if(releases.length){
      const without=engine.build({runnerId:runner.id,excludePowerRelease:true}).runners[runner.id];
      ready.powerBenefit=measureMotionBenefit(motion,without,releases,null);
    }
    const modes=modeImpactsFor(race,reference,calculation,runner.id);
    for(const mode of modes){const summary=detail.statusImpacts.find(i=>i.kind===mode.kind);
      if(summary){summary.modeledExtraDistance=mode.reachableExtraDistance;summary.modeledExtraTime=mode.reachableExtraTime;summary.modeledExtraHp=mode.reachableExtraHp;
        summary.detail='Local velocity comparison using exact active-state windows. Field positions, HP, other effects and decisions remain fixed; time is equivalent travel time.';}}
    const impacts:typeof ready.impacts={},metrics:typeof ready.metrics={};
    for(const row of detail.skillRows){
      await checkpoint();impacts[row.skillId]=motionSkillImpact(race,reference,calculation,runner.id,row.skillId);
      if(!summaryOnly)for(const activation of row.activations){
        const impact=activationImpact(race,reference,calculation,runner.id,activation),summary=detail.skillImpacts.find(i=>i.skillId===row.skillId&&i.start===activation.start);
        if(impact&&summary){
          summary.modeledDistanceDelta=impact.distance?.mid??null;summary.modeledTimeDelta=impact.time?.mid??null;
          summary.assessedModeledDistanceDelta=summary.modeledDistanceDelta;summary.assessedModeledTimeDelta=summary.modeledTimeDelta;
          summary.effectUtilization=impact.effects;summary.coverageRate=impact.coverage;
          summary.unavailableReasons=impact.reasons;summary.detail=impact.detail;
          const use=movementUse(impact.effects);
          summary.utilization=summary.usefulAmongAssessed=use.score;summary.usefulRate=use.coverage===1?use.score:null;
          summary.assessableDuration=impact.assessedDuration;summary.usefulDuration=use.score===null?null:use.score*impact.assessedDuration;
          summary.effectiveness=use.score===null?'unresolved':use.score===0?'not-useful':use.score>=.999?'useful':'partial';
          summary.evidence='estimated';summary.utilizationKind='movement-active-time';
          summary.blockingDistanceLoss=summary.assessedBlockingDistanceLoss=impact.blockedDistance?.mid??null;
          summary.carryover={...summary.carryover,distanceDelta:impact.carryoverDistance?.mid??null,timeDelta:impact.carryoverTime?.mid??null,
            distanceDeltaMin:impact.carryoverDistance?.min??null,distanceDeltaMax:impact.carryoverDistance?.max??null,
            timeDeltaMin:impact.carryoverTime?.min??null,timeDeltaMax:impact.carryoverTime?.max??null,detail:impact.detail};
        }
      }
      if(!summaryOnly){
        const actual=(ready.metrics[row.skillId]??[]).filter(m=>m.label!=='Movement / finish-time gain');
        metrics[row.skillId]=mergeSkillMetrics(actual,metricsForSkill(race,reference,calculation,runner.id,row.skillId));
      }
    }
    for(const incoming of detail.receivedDebuffImpacts){
      const a=calculation.runners[incoming.sourceRunnerId].skillActivations.find(a=>a.skillId===incoming.skillId&&a.start===incoming.start);
      const applied=a?.simulatedRecipients?.[runner.id]??[];
      if(!a||!applied.some(e=>[21,22,27,31].includes(e.type))||a.effectiveEnd===null)continue;
      const without=engine.build({runnerId:runner.id,excludeActivationKey:activationMotionKey(incoming.sourceRunnerId,a)}).runners[runner.id];
      const benefit=measureMotionBenefit(motion,without,[{start:a.start,end:a.effectiveEnd}]);
      incoming.modeledDistanceDelta=incoming.assessedModeledDistanceDelta=benefit.distance?.mid??null;
      incoming.modeledTimeDelta=incoming.assessedModeledTimeDelta=benefit.time?.mid??null;
      incoming.detail='Confirmed applied debuff; local velocity comparison holding field positions, HP and all other decisions fixed.';
    }
    detail.receivedDebuffTotals=contributionTotals(detail.receivedDebuffImpacts,'Confirmed applied debuffs; local fixed-replay comparisons. Overlapping marginal movement is not added.');
    Object.assign(display,{slowdown:{blocking:slowdown(motion.trafficLoss),exhaustion:slowdown(motion.exhaustionLoss)},statusImpacts:detail.statusImpacts,hillImpacts:detail.hillImpacts,hillTotals:detail.hillTotals,
      skillImpacts:detail.skillImpacts,receivedDebuffImpacts:detail.receivedDebuffImpacts,receivedDebuffTotals:detail.receivedDebuffTotals});
    Object.assign(ready,{motion,inferredMotion:motion,modes,impacts,metrics,totals:skillTotals(race,reference,calculation,runner.id),
    });
  }
  analysis.debuffs=calculation.debuffs;
  return value;
}
