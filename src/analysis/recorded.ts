/** Observations-only dashboard: no version-dependent formulas or skill checks. */
import type {Race} from '../data/types';
import type {RaceAnalysis,RunnerAnalysis,SkillRow} from '../data/analytics';
import type {PreparedRace,PreparedRunner} from './prepared';
import type {RunnerStatBreakdown,ContributionTotal,SlowdownAnalysis} from '../data/effect-types';
import type {RunnerMotion} from '../data/race-motion';
import {rankSamples,runnerGap} from '../view-model';
import {attachPrepared} from './prepared';

const unavailable='No compatible analysis is available for this value.';
const keys=['speed','stamina','power','guts','wisdom'] as const;
const total=():ContributionTotal=>({intervals:0,duration:0,assessedDuration:0,observedDistance:null,observedHpConsumed:null,observedHpRecovered:null,modeledDistanceDelta:null,modeledTimeDelta:null,modeledHpDelta:null,detail:unavailable});
const slowdown=():SlowdownAnalysis=>({duration:0,assessedDuration:0,coverageRate:null,distanceLoss:null,distanceLossMin:null,distanceLossMax:null,assessedDistanceLossMin:null,assessedDistanceLossMax:null,timeLossMin:null,timeLossMax:null,intervals:[],unavailableReasons:[unavailable],detail:unavailable});
const loss=()=>({duration:0,assessedDuration:0,coverage:null,distanceLoss:null,timeLoss:null,episodes:[],detail:unavailable});
export function recordedDashboard(input:Race):PreparedRace{
  const race:Race={...input,analysisSource:'recorded'};
  const analysis:RaceAnalysis={source:'recorded',runners:{},debuffs:[],warnings:[]};
  const result:PreparedRace={race,analysis,runners:{}};
  const ranks=race.frames.map(f=>rankSamples(race,f.runners,f.time));
  for(const runner of race.runners){
    const stop=runner.finishTimeRaw??runner.finishTime??race.duration;
    const samples=race.frames.flatMap((frame,i)=>{
      const s=frame.runners.find(s=>s.runnerId===runner.id);
      if(!s||frame.time>stop)return [];
      const before=race.frames[i-1]?.runners.find(s=>s.runnerId===runner.id),dt=i?frame.time-race.frames[i-1].time:0;
      const hpDelta=s.hp==null||before?.hp==null?null:s.hp-before.hp;
      return [{...s,time:frame.time,leadGap:runnerGap(race,frame.runners,runner.id),rank:ranks[i].get(runner.id)??null,
        acceleration:dt&&s.speed!=null&&before?.speed!=null?(s.speed-before.speed)/dt:null,hpDelta,hpRate:dt&&hpDelta!==null?hpDelta/dt:null}];
    });
    const first=samples[0],last=samples.at(-1),ids=[...new Set([...(runner.skills??[]).map(s=>s.id),...race.events.filter(e=>e.runnerId===runner.id&&e.skillId).map(e=>e.skillId!)])];
    const skillRows:SkillRow[]=ids.map(skillId=>{
      const activations=race.events.filter(e=>e.runnerId===runner.id&&e.skillId===skillId).map(e=>{
        const duration=e.params[2]>=0?e.params[2]:null;
        return {skillId,start:e.time,end:duration===null?null:e.time+duration,duration,activationEvidence:'recorded' as const,durationEvidence:duration===null?'unknown' as const:'recorded' as const,effectBranch:null,effects:[],detail:'Recorded activation.',targetRunnerIds:[],effectiveDuration:duration,effectiveEnd:duration===null?null:e.time+duration,timingKind:duration===null?'unknown' as const:'reported' as const,timingReason:'Recorded activation; unreported effects remain unavailable.'};
      });
      return {skillId,equipped:runner.skills?.some(s=>s.id===skillId)??false,activationCount:activations.length,activations,nonProcReason:activations.length?'Recorded activation.':unavailable,evidence:'recorded',activationStatus:activations.length?'recorded':'unknown',effectiveActive:activations.length>0,conditionEvaluation:null,inferredBranches:[]};
    });
    const stats=Object.fromEntries(keys.map(key=>[key,{raw:runner.stats?.[key]??null,overcap:null,base:null,moodMultiplier:null,moodGain:null,baseCapGain:null,capGain:null,courseMultiplier:null,courseGain:null,strategyMultiplier:null,strategyGain:null,groundGain:null,careerGain:null,passiveGain:null,final:null,detail:unavailable}])) as RunnerStatBreakdown['stats'];
    const knownHp=samples.filter(s=>s.hp!==null),knownSpeed=samples.filter(s=>s.speed!==null);
    const detail:RunnerAnalysis={samples,intervals:[],skillRows,skillActivations:skillRows.flatMap(s=>s.activations),statusImpacts:[],skillImpacts:[],receivedDebuffImpacts:[],receivedDebuffTotals:total(),hillImpacts:[],hillTotals:{uphill:total(),downhill:total()},slowdown:{blocking:slowdown(),exhaustion:slowdown()},
      cornerPath:{extraDistance:null,equivalentTime:null,assessedExtraDistance:null,assessedEquivalentTime:null,cornerDistance:null,assessedCornerDistance:0,timedCornerDistance:0,coverage:null,timeCoverage:null,evidence:'unknown',detail:unavailable},
      statBreakdown:{stats,startingHp:{observed:first?.hp??null,modeled:null,difference:null,staminaContribution:null,distanceContribution:null,strategyCoefficient:null,detail:unavailable},evidence:'recorded',detail:unavailable},
      summary:{startDelay:runner.startDelay??null,finishTime:runner.finishTime,rawTime:runner.finishTimeRaw??null,gap:null,spurtDistance:runner.lastSpurtDistance??null,spurtTime:null,spurtDelayDistance:null,spurtSpeed:null,finishGapDistance:null,rushedDuration:null,blockedDuration:null,hpStart:first?.hp??null,hpFinish:last?.hp??null,hpUsed:null,hpRecovered:null,maxSpeed:knownSpeed.length?Math.max(...knownSpeed.map(s=>s.speed!)):null,meanSpeed:null,leadTime:null,finishOrder:runner.finishOrder,minimumHp:knownHp.length?Math.min(...knownHp.map(s=>s.hp!)):null,maximumLeadGap:null,distanceTravelled:last?.distance??null,hpZeroTime:knownHp.find(s=>s.hp===0)?.time??null,sampleCount:samples.length}};
    const motion:RunnerMotion={samples:[],sections:[],coverage:{target:0,free:0,constrained:0,calibrated:0,assessedDuration:0,duration:stop},distanceLoss:null,timeLoss:null,assessedDistanceLoss:null,assessedTimeLoss:null,observedTrafficDeficit:null,observedTrafficTime:null,observedTrafficDuration:0,observedTrafficAssessedDuration:0,observedTrafficCoverage:null,trafficLoss:loss(),exhaustionLoss:loss(),initialStats:{speed:null,stamina:null,power:null,guts:null,wisdom:null},paceStarts:[],detail:unavailable};
    const prepared:PreparedRunner={motion,inferredMotion:motion,modes:[],impacts:{},metrics:{},speedChanges:[],totals:{skills:ids.map(skillId=>({skillId,motion:null,score:null,coverage:0,active:0,assessed:0})),benefit:null,score:null,coverage:0,active:0,assessed:0},
      spurt:{candidates:[],matched:null,betterChance:null,decisionDistance:null,hp:null,checkChance:null,reason:unavailable,deterministic:false,target:null,maximum:null,shortfall:null,initialTarget:null,initialTargetTime:null,targetTime:null,waitingPlateau:null,startTime:null,delaySeconds:null,decisions:[]}};
    analysis.runners[runner.id]=detail;result.runners[runner.id]=prepared;
  }
  attachPrepared(result);return result;
}
