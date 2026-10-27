/** Display adapter for a freshly authorized engine result. No inference engine,
 * effect formula, condition evaluator, random draw or counterfactual runs here. */
import type { Race, Runner, Frame } from '../data/types';
import type { RaceAnalysis, RunnerAnalysis, SkillRow, SkillActivation, StatusInterval } from '../data/analytics';
import type { ReferenceData } from '../data/reference';
import type { PreparedRace, PreparedRunner } from '../analysis/prepared';
import type { RunnerMotion, MotionSample, MotionBand } from '../data/race-motion';
import type { ContributionTotal, RunnerStatBreakdown, SlowdownAnalysis } from '../data/effect-types';
import type { SpurtComparison, SpurtDecision } from '../data/spurt-comparison';
import type { SkillMetric } from '../data/skill-metrics';
import type { AnalysisGateReport, JsonObject } from './contracts';
import { decisionTrace, motionIndex as m, motionAt, blockingSummary, type DecisionEvent } from './trace';
import { rankSamples, runnerGap } from '../view-model';
import { statusLabel } from '../data/status-presentation';
import { trafficIntervals } from './traffic';
import {powerSummary} from './power';
import {simulationConditions,simulationRestriction} from './conditions';
import {explainTraceSpeed} from './speed-explanations';
import {traceLaneBonus,laneBonusStatuses} from './lane-bonus';

const unavailable='Requires a separate counterfactual simulation; not measured by this execution trace.';
const exact=(value:number):MotionBand=>({min:value,mid:value,max:value});
const num=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
const objects=(value:unknown):JsonObject[]=>Array.isArray(value)?value.filter((v):v is JsonObject=>!!v&&typeof v==='object'&&!Array.isArray(v)):[];
const total=():ContributionTotal=>({intervals:0,duration:0,assessedDuration:0,observedDistance:null,observedHpConsumed:null,observedHpRecovered:null,modeledDistanceDelta:null,modeledTimeDelta:null,modeledHpDelta:null,detail:unavailable});
const loss=(duration=0)=>({duration,assessedDuration:0,coverage:null,distanceLoss:null,timeLoss:null,episodes:[],detail:unavailable});
const slowdown=():SlowdownAnalysis=>({duration:0,assessedDuration:0,coverageRate:null,distanceLoss:null,distanceLossMin:null,distanceLossMax:null,assessedDistanceLossMin:null,assessedDistanceLossMax:null,timeLossMin:null,timeLossMax:null,intervals:[],unavailableReasons:[unavailable],detail:unavailable});
const keys=['speed','stamina','power','guts','wisdom'] as const;

function intervals(rows:number[][],stop:number):StatusInterval[] {
  const conditions:[string,(r:number[])=>boolean][]=[
    ['rushed',r=>r[m.rushing]>0],['rushed-boost',r=>r[m.rushing]===4],['downhill-mode',r=>r[m.downhill]===1],
    ['hp-empty',r=>r[m.hp]<=0],
    ['last-spurt',r=>r[m.spurt]===1],['spot-struggle',r=>r[m.spotStruggle]===1],
    ['dueling',r=>r[m.duel]===1],
    ['speed-up',r=>r[m.paceMode]===1],['overtake',r=>r[m.paceMode]===2],
    ['pace-up',r=>r[m.paceMode]===3],['pace-down',r=>r[m.paceMode]===4],
    ['extra-pace-up',r=>r[m.paceMode]===5],['force-in',r=>r[m.forceIn]===1],
  ];
  return [...trafficIntervals(rows,stop),...conditions.flatMap(([kind,active])=>{
    const result:StatusInterval[]=[];let start:number|null=null;
    for(const row of rows){if(row[m.time]>=stop)break;
      if(active(row)&&start===null)start=row[m.time];
      if(!active(row)&&start!==null){result.push({kind,label:statusLabel(kind),start,end:row[m.time],evidence:'simulated',detail:'State from the matched engine execution at each simulation tick.'});start=null;}
    }
    if(start!==null)result.push({kind,label:statusLabel(kind),start,end:stop,evidence:'simulated',detail:'Engine state remains active through the finish.'});
    return result;
  })].sort((a,b)=>a.start-b.start);
}

/** cp_acc is a precomputed magnitude, not an active-state flag. These internal
 * effects use their actual activation/expiry callbacks instead. */
function internalIntervals(events:DecisionEvent[],stop:number):StatusInterval[] {
  const names:Record<string,string>={staminasyoubu:'stamina-limit-break'};
  return events.filter(e=>e.kind==='skill-activated'&&e.skillId in names).map(e=>{
    const expiry=events.find(x=>x.sequence>e.sequence&&x.kind==='effect-ended'&&x.skillId===e.skillId);
    return {kind:names[e.skillId],label:statusLabel(names[e.skillId]),start:e.time,end:Math.min(stop,expiry?.time??stop),evidence:'simulated',detail:'Internal engine effect activation and expiry callbacks.'};
  });
}


function skills(runner:Runner,events:DecisionEvent[],modeled:JsonObject,reference:ReferenceData|null,stop:number,runners:Runner[],allEvents:DecisionEvent[],motion:number[][]) {
  const reported=objects(modeled.skillEvents).filter(e=>e.horseIndex===runner.index);
  const ids=[...new Set([...(runner.skills??[]).map(s=>s.id),...events.filter(e=>e.skillId&&['skill-definition','skill-wit','skill-activated'].includes(e.kind)).map(e=>Number(e.skillId)),...reported.map(e=>Number(e.skillId))])].filter(Number.isFinite);
  const metrics:Record<number,SkillMetric[]>={},rows:SkillRow[]=[];
  for(const id of ids){
    const own=events.filter(e=>Number(e.skillId)===id||e.kind==='cooldown-start'&&String(e.data.key)===String(id));
    const wit=own.filter(e=>e.kind==='skill-wit'),activated=own.filter(e=>e.kind==='skill-activated');
    const ownApplied:DecisionEvent[]=[];
    const activations:SkillActivation[]=activated.map((e,index)=>{
      const next=activated[index+1]?.sequence??Infinity;
      const effects=own.filter(x=>x.sequence>e.sequence&&x.sequence<next&&x.tick===e.tick&&x.kind==='effect-evaluated');
      const applied=own.filter(x=>x.sequence>e.sequence&&x.sequence<next&&x.tick===e.tick&&x.kind==='effect-applied');
      ownApplied.push(...applied);
      const queued=own.filter(x=>x.sequence>e.sequence&&x.sequence<next&&x.tick===e.tick&&x.kind==='effect-queued');
      const ref=reference?.metadata.skills[id]?.branches.find((b,i)=>(b.branchIndex??i)===e.detail);
      const event=reported.find(p=>Number(p.skillId)===id&&Math.abs(Number(p.t)-e.time)<.001);
      const passive=effects.some(x=>Number(x.data.duration)<0),reportedDuration=num(event?.duration);
      const duration=reportedDuration??(effects.length?Math.max(0,...effects.map(x=>Number(x.data.duration))):null);
      const effectEnd=(event:DecisionEvent,recipient=runner.index)=>{
        const seconds=Number(event.data.duration);if(seconds<0)return stop;
        const expected=event.time+seconds;
        const ended=allEvents.find(x=>x.kind==='effect-ended'&&x.horseIndex===recipient&&x.skillId===e.skillId&&x.sequence>event.sequence&&x.sequence<next&&x.time>=expected-.001&&x.time<=expected+.2);
        return Math.min(stop,ended?.time??expected);
      };
      // Reference effects supply labels/icons only. Magnitudes below are copied
      // from evaluated engine modifiers, never scaled by the UI formula engine.
      const displayEffects=effects.filter(x=>applied.some(p=>p.data.ability===x.data.ability)||queued.some(p=>p.data.ability===x.data.ability)).map(x=>({type:Number(x.data.type),rawValue:Number(x.data.modifier)*10000,valueUsage:1,levelUsage:0,evaluatedValue:Number(x.data.modifier),
        appliedStart:x.time,appliedEnd:effectEnd(x),
        targetType:ref?.effects[Number(x.data.ability)]?.targetType??(queued.some(p=>p.data.ability===x.data.ability)?2:1)}));
      const simulatedRecipients:NonNullable<SkillActivation['simulatedRecipients']>={};
      for(const queue of queued){
        const evaluated=effects.find(x=>x.data.ability===queue.data.ability);if(!evaluated)continue;
        const previousQueue=queued.filter(q=>q.sequence<queue.sequence).at(-1)?.sequence??e.sequence;
        for(const target of Array.isArray(queue.data.targets)?queue.data.targets:[]){
          const recipient=runners.find(r=>r.index===target);if(!recipient||recipient.id===runner.id)continue;
          const delivered=allEvents.find(x=>x.horseIndex===target&&x.kind==='effect-applied'&&x.skillId===e.skillId&&x.tick===e.tick&&x.sequence>previousQueue&&x.sequence<queue.sequence&&x.data.type===evaluated.data.type);
          if(delivered)(simulatedRecipients[recipient.id]??=[]).push({type:Number(delivered.data.type),rawValue:Number(delivered.data.modifier)*10000,evaluatedValue:Number(delivered.data.modifier),valueUsage:1,levelUsage:0,appliedStart:delivered.time,appliedEnd:effectEnd(delivered,Number(target)),targetType:ref?.effects[Number(queue.data.ability)]?.targetType??2});
        }
      }
      const targetRunnerIds=Object.keys(simulatedRecipients);
      // Expiry callbacks identify the skill on the affected runner, not its
      // caster. A later received copy must not extend this runner's own proc.
      // Use the windows already matched to this activation's applied effects.
      const effectEnds=[...displayEffects,...Object.values(simulatedRecipients).flat()].map(effect=>effect.appliedEnd!);
      const end=passive?stop:duration===0?e.time:effectEnds.length?Math.max(...effectEnds):duration===null?null:Math.min(stop,e.time+duration);
      return {skillId:id,referenceSkillId:id,start:e.time,end,duration,effectiveEnd:end,effectiveDuration:end===null?null:Math.max(0,end-e.time),
        activationEvidence:'simulated',durationEvidence:'simulated',effectBranch:e.detail,effects:displayEffects,targetRunnerIds,simulatedRecipients,
        timingKind:passive?'passive':duration===0?'instant':'reported',timingReason:'Engine activation and effect expiry ticks.',
        detail:`Simulator activation; ${applied.length} self effects applied, ${targetRunnerIds.length} confirmed recipients.`};
    });
    const evaluation=simulationConditions(own,motion,runners.length),restriction=simulationRestriction(own,evaluation),failed=wit.some(e=>e.data.checked===true&&e.data.passed===false);
    const nonProcReason=activations.length?'Activated in the simulation.':restriction.detail;
    rows.push({skillId:id,equipped:!!runner.skills?.some(s=>s.id===id),activationCount:activations.length,activations,nonProcReason,evidence:'simulated',
      activationStatus:activations.length?'simulated':failed?'wit-failure-supported':restriction.failed?'conditions-unmet':'unknown',effectiveActive:!!activations.length,conditionEvaluation:evaluation,inferredBranches:[],simulation:{checks:own.filter(e=>e.kind!=='rng-draw'),wit}});
    const items:SkillMetric[]=[];
    const add=(label:string,value:number|string,unit:string,detail:string)=>items.push({label,value,unit,detail,evidence:'simulated'});
    for(const check of wit)add('Wit check',check.data.checked?(check.data.passed?'Passed':'Failed'):'Not required','',`Actual engine check at ${check.time.toFixed(3)} s.`);
    for(const e of ownApplied){
      const type=Number(e.data.type),names:Record<number,[string,string]>={1:['Speed stat',''],2:['Stamina stat',''],3:['Power stat',''],4:['Guts stat',''],5:['Wit stat',''],8:['Vision distance','m'],9:['HP effect','% max HP'],10:['Gate delay multiplier','×'],14:['Gate delay override','s'],21:['Current speed','m/s'],22:['Current speed','m/s'],27:['Target speed','m/s'],28:['Lane speed','m/s'],31:['Acceleration','m/s²']};
      const [label,unit]=names[type]??[`Effect ${type}`,''];
      add(label,Number(e.data.modifier)*(type===9?100:1),unit,`Applied engine modifier at ${e.time.toFixed(3)} s.`);
    }
    if(activations.length)items.push({label:'Movement / finish-time gain',value:null,unit:'',detail:unavailable,evidence:'unknown',reason:unavailable});
    metrics[id]=items;
  }
  return {rows,metrics};
}

function spurt(events:DecisionEvent[],rows:number[][],stop:number):SpurtComparison {
  const inputs=events.filter(e=>e.kind==='spurt-input'),start=rows.find(r=>r[m.spurt]===1)?.[m.time]??null;
  const decisions:SpurtDecision[]=inputs.map((input,index)=>{
    const endSequence=inputs[index+1]?.sequence??Infinity,checks=events.filter(e=>e.sequence>input.sequence&&e.sequence<endSequence);
    const accepted=checks.find(e=>e.kind==='spurt-accepted');
    const rolls=checks.filter(e=>e.kind==='spurt-roll').map(e=>({roll:Number(e.data.roll),threshold:Number(e.data.threshold),passed:e.data.passed===true,speed:Number(e.data.speed),start:Number(e.data.start)}));
    const feasible=checks.filter(e=>e.kind==='spurt-search'&&e.data.feasible===true);
    const candidates=[...new Map(feasible.map(e=>[`${e.data.speed}/${e.data.start}`,{speed:Number(e.data.speed),delay:Math.max(0,Number(e.data.start)-Number(input.data.position)),time:Math.fround(Math.fround((Number(e.data.start)-Number(input.data.position))/Number(input.data.base_speed))+Math.fround((Number(input.data.distance)-60-Number(e.data.start))/Number(e.data.speed))),probability:0}])).values()].sort((a,b)=>Math.trunc((a.time-b.time)*10000));
    const chance=Math.max(0,Math.min(1,Math.ceil(rolls[0]?.threshold??Math.fround(15+Math.fround(.05*Number(input.data.wisdom))))/100));let residual=1;
    for(const [i,c] of candidates.entries()){c.probability=i===candidates.length-1?residual:residual*chance;residual-=c.probability;}
    if(!candidates.length&&accepted)candidates.push({speed:Number(accepted.data.speed),delay:Math.max(0,Number(accepted.data.start)-Number(input.data.position)),time:0,probability:1});
    const matched=accepted?candidates.findIndex(c=>Math.abs(c.speed-Number(accepted.data.speed))<.0001&&Math.abs(c.delay-Math.max(0,Number(accepted.data.start)-Number(input.data.position)))<.01):-1;
    return {time:input.time,end:inputs[index+1]?.time??stop,trigger:index?'recovery':'late-entry',skillIds:[],candidates,matched:matched<0?null:matched,betterChance:matched<0?null:candidates.slice(0,matched).reduce((n,c)=>n+c.probability,0),
      decisionDistance:num(input.data.position),hp:num(input.data.hp),checkChance:rolls.length?rolls[0].threshold/100:null,
      reason:rolls.length?`${rolls.length} actual wit ${rolls.length===1?'roll':'rolls'}. The displayed target is the plan retained by the engine.`:'Deterministic budget decision; no wit draw was made.',
      deterministic:!rolls.length,rolls,observedTarget:num(accepted?.data.speed),observedDelay:accepted?Number(accepted.data.start)-Number(input.data.position):null,observedTargetTime:input.time,targetEvidence:null};
  });
  const last=decisions.at(-1),maximum=num(inputs.at(-1)?.data.max_speed),target=last?.observedTarget??null;
  const waiting=rows.filter(r=>inputs.length&&start!==null&&r[m.time]>=inputs[0].time&&r[m.time]<start);
  const waitingPlateau=waiting.length>1&&waiting.every(r=>Math.abs(r[m.base]-waiting[0][m.base])<.001)?{start:waiting[0][m.time],end:start!,speed:waiting[0][m.base]}:null;
  return {source:'simulation',candidates:last?.candidates??[],matched:last?.matched??null,betterChance:last?.betterChance??null,decisionDistance:last?.decisionDistance??null,hp:last?.hp??null,checkChance:last?.checkChance??null,
    reason:last?.reason??'No last-spurt decision occurred.',deterministic:last?.deterministic??true,target:target===null?null:exact(target),maximum:maximum===null?null:exact(maximum),
    shortfall:maximum===null||target===null?null:exact(Math.max(0,maximum-target)),initialTarget:decisions[0]?.observedTarget??null,initialTargetTime:decisions[0]?.time??null,
    targetTime:last?.time??null,waitingPlateau,startTime:start,delaySeconds:start===null||!inputs.length?null:Math.max(0,start-inputs[0].time),decisions};
}

export function projectSimulation(recorded:Race,report:AnalysisGateReport,reference:ReferenceData|null):PreparedRace|null {
  const trace=decisionTrace(report),modeled=report.simulation?.modeled;
  if(!trace||!modeled)return null;
  return projectModeledRace(recorded,modeled,trace,reference);
}

/** Called only with a service-validated execution trace. This projection does
 * not compare a capture or grant recorded-race compatibility authorization. */
export function projectModeledRace(recorded:Race,modeled:JsonObject,trace:NonNullable<ReturnType<typeof decisionTrace>>,reference:ReferenceData|null,summaryOnly=false,decodedFrames?:Frame[]):PreparedRace {
  const results=objects(modeled.results);
  if(results.length!==recorded.runners.length)throw new Error('Simulator runner results are incomplete.');
  const runners=recorded.runners.map(r=>{const result=results[r.index];if(!result)throw new Error('Simulator runner mapping is incomplete.');return {...r,
    finishTimeRaw:num(result.finishTimeRaw),finishTime:num(result.finishTime),finishOrder:num(result.finishOrder)===null?null:Number(result.finishOrder)+1,
    startDelay:num(result.startDelayTime),lastSpurtDistance:num(result.actualLastSpurtStartDistance),strategyCode:num(result.runningStyle)??r.strategyCode};});
  const frames:Frame[]=decodedFrames??objects(modeled.frames).map(f=>({time:Number(f.t),runners:runners.map(r=>{const row=objects(f.horses)[r.index];if(!row)throw new Error('Simulator frame is incomplete.');return {runnerId:r.id,distance:num(row.pos),speed:num(row.speed),hp:num(row.hp),lane:num(row.lane),temptationMode:num(row.temptationMode),blockFrontRunnerIndex:num(row.blockFrontHorseIndex)};})}));
  const race:Race={...recorded,analysisSource:'simulation',runners,frames,events:[],raw:undefined,duration:frames.at(-1)?.time??recorded.duration};
  const analysis:RaceAnalysis={source:'simulation',runners:{},debuffs:[],warnings:[]},prepared:PreparedRace={race,analysis,runners:{}};
  const sampleRanks=new Map(frames.map(f=>[f,rankSamples(race,f.runners,f.time)]));
  for(const runner of runners){
    const events=trace.events.filter(e=>e.horseIndex===runner.index),rows=trace.motion.filter(r=>r[m.horse]===runner.index),stop=runner.finishTimeRaw??race.duration;
    if(!rows.length)throw new Error('Simulator motion is incomplete.');
    const power=powerSummary(events,objects(modeled.conservePowerDiagnostics).find(d=>d.horseIndex===runner.index),stop);
    const {rows:skillRows,metrics}=skills(runner,events,modeled,reference,stop,runners,trace.events,rows),activations=skillRows.flatMap(s=>s.activations);
    const initial=events.find(e=>e.kind==='initial-stats'),laneBonus=traceLaneBonus(race,runner,rows,activations,num(initial?.data.power));
    const states=[...intervals(rows,stop),...internalIntervals(events,stop),...power.intervals,...laneBonusStatuses(laneBonus,reference)].sort((a,b)=>a.start-b.start);
    const samples=frames.filter(f=>f.time<=stop+.067).map((f,index)=>{const s=f.runners.find(s=>s.runnerId===runner.id)!,before=frames[index-1]?.runners.find(s=>s.runnerId===runner.id),dt=index?f.time-frames[index-1].time:0;
      const hpDelta=before?.hp==null||s.hp===null?null:s.hp-before.hp;
      return {time:f.time,distance:s.distance,speed:s.speed,hp:s.hp,lane:s.lane,leadGap:runnerGap(race,f.runners,runner.id),rank:sampleRanks.get(f)!.get(runner.id)??null,
        acceleration:motionAt(rows,f.time)?.[m.acceleration]??null,hpDelta,hpRate:dt&&hpDelta!==null?hpDelta/dt:null};});
    const first=samples[0],last=samples.at(-1),spurtValue=spurt(events,rows,stop),blocking=blockingSummary(rows.filter(r=>r[m.time]<stop));
    const stats=Object.fromEntries(keys.map(key=>[key,{raw:runner.stats?.[key]??null,overcap:null,base:null,moodMultiplier:null,moodGain:null,baseCapGain:null,capGain:null,courseMultiplier:null,courseGain:null,strategyMultiplier:null,strategyGain:null,groundGain:null,careerGain:null,passiveGain:null,final:num(initial?.data[key]),detail:'Final adjusted stat copied from the engine after initial skills. Individual bonus stages are not traced.'}])) as RunnerStatBreakdown['stats'];
    const motionSamples:MotionSample[]=rows.filter(r=>r[m.time]<stop).map(r=>({time:r[m.time],distance:r[m.position],actual:r[m.speed],currentSpeedDelta:r[m.skillSpeed]-r[m.selfSpeed],selfActual:r[m.selfSpeed],targetBase:exact(r[m.base]),targetActive:exact(r[m.target]),healthyTargetActive:null,healthyAccelerationRange:null,hpEmpty:r[m.hp]<=0,
      free:exact(r[m.target]),constrained:exact(r[m.speed]),acceleration:r[m.acceleration],accelerationRange:exact(r[m.acceleration]),blockCap:r[m.blocker]>=0?r[m.cap]:null,
      constraint:{kind:r[m.blocker]>=0?'recorded-block':'none',cap:r[m.blocker]>=0?r[m.cap]:null,runnerId:runners.find(x=>x.index===r[m.blocker])?.id??null,detail:'Actual simulator collision cap.'},nearbySlowdown:false,downhillTargetDelta:exact(0),pace:['normal','speed-up','overtake','pace-up','pace-down','extra-pace-up'][r[m.paceMode]],startDash:null,cumulativeDistance:exact(0),cumulativeTime:exact(0),evidence:'simulated',reasons:[],assumptions:[],blockingClamps:{self:r[m.selfLoss],final:r[m.finalLoss]}}));
    const motion:RunnerMotion={samples:motionSamples,sections:[],coverage:{target:1,free:0,constrained:1,calibrated:0,assessedDuration:stop,duration:stop},distanceLoss:null,timeLoss:null,assessedDistanceLoss:null,assessedTimeLoss:null,observedTrafficDeficit:null,observedTrafficTime:null,observedTrafficDuration:blocking.blockedSeconds,observedTrafficAssessedDuration:0,observedTrafficCoverage:null,trafficLoss:loss(blocking.blockedSeconds),exhaustionLoss:loss(),initialStats:Object.fromEntries(keys.map(k=>[k,stats[k].final===null?null:exact(stats[k].final!)])) as unknown as RunnerMotion['initialStats'],paceStarts:[],detail:'Target, acceleration and collision clamps copied from the matched simulator. No counterfactual path.'};
    const winner=Math.min(...runners.map(r=>r.finishTimeRaw??Infinity));
    const detail:RunnerAnalysis={cornerPath:{extraDistance:null,equivalentTime:null,assessedExtraDistance:null,assessedEquivalentTime:null,cornerDistance:null,assessedCornerDistance:0,timedCornerDistance:0,coverage:null,timeCoverage:null,evidence:'unknown',detail:unavailable},slowdown:{blocking:slowdown(),exhaustion:slowdown()},
      summary:{startDelay:runner.startDelay??null,finishTime:runner.finishTime,rawTime:runner.finishTimeRaw??null,gap:stop-winner,spurtDistance:runner.lastSpurtDistance??null,spurtTime:spurtValue.startTime,spurtDelayDistance:runner.lastSpurtDistance==null||race.distance==null?null:Math.max(0,runner.lastSpurtDistance-race.distance*2/3),spurtSpeed:spurtValue.target?.mid??null,finishGapDistance:null,
        rushedDuration:states.filter(s=>s.kind==='rushed').reduce((n,s)=>n+s.end!-s.start,0),blockedDuration:blocking.blockedSeconds,hpStart:first?.hp??null,hpFinish:last?.hp??null,hpUsed:samples.reduce((n,s)=>n+Math.max(0,-(s.hpDelta??0)),0),hpRecovered:samples.reduce((n,s)=>n+Math.max(0,s.hpDelta??0),0),maxSpeed:Math.max(...samples.map(s=>s.speed??0)),meanSpeed:race.distance===null?null:race.distance/stop,leadTime:samples.reduce((n,s,index)=>n+(s.rank===1&&index?s.time-samples[index-1].time:0),0),finishOrder:runner.finishOrder,minimumHp:Math.min(...samples.map(s=>s.hp??Infinity)),maximumLeadGap:Math.max(0,...samples.map(s=>-(s.leadGap??0))),distanceTravelled:last?.distance??null,hpZeroTime:rows.find(r=>r[m.hp]<=0)?.[m.time]??null,sampleCount:samples.length},
      intervals:states,skillActivations:activations,skillRows,samples,statusImpacts:[],statBreakdown:{stats,startingHp:{observed:first?.hp??null,modeled:first?.hp??null,difference:0,staminaContribution:null,distanceContribution:null,strategyCoefficient:null,detail:'Initial HP emitted by the simulator.'},evidence:'simulated',detail:'Engine initial stats.'},hillImpacts:[],hillTotals:{uphill:total(),downhill:total()},skillImpacts:[],receivedDebuffImpacts:[],receivedDebuffTotals:total()};
    analysis.runners[runner.id]=detail;
    const modes:PreparedRunner['modes']=[...new Set(states.map(s=>s.kind))].map(kind=>({source:'simulation',kind,intervals:states.filter(s=>s.kind===kind).length,duration:states.filter(s=>s.kind===kind).reduce((n,s)=>n+s.end!-s.start,0),reachableExtraDistance:null,reachableExtraTime:null,reachableExtraHp:null,assessedReachableExtraDistance:null,assessedReachableExtraTime:null,assessedReachableExtraHp:null,assessedDuration:0,coverage:0,carryoverDuration:0,complete:false,reachableRange:null,detail:unavailable}));
    const sections=race.distance?Array.from({length:24},(_,i)=>{const start=race.distance!*i/24,end=race.distance!*(i+1)/24,row=rows.find(r=>r[m.position]>=start&&r[m.position]<end&&!r[m.spurt]);return row?{section:i+1,start,end,modifier:row[m.section],base:row[m.base]}:null;}).filter((s):s is NonNullable<typeof s>=>s!==null):[];
    prepared.runners[runner.id]={power,sections,motion,inferredMotion:motion,modes,spurt:spurtValue,blocking,speedChanges:summaryOnly?[]:explainTraceSpeed(race,runner,reference,rows,events,laneBonus),metrics,impacts:Object.fromEntries(skillRows.map(s=>[s.skillId,null])),
      totals:{skills:skillRows.map(s=>({skillId:s.skillId,motion:null,score:null,coverage:0,active:0,assessed:0})),benefit:null,score:null,coverage:0,active:0,assessed:0}} satisfies PreparedRunner;
    for(const a of activations){
      race.events.push({time:a.start,type:'skill',runnerId:runner.id,skillId:a.skillId,label:'Simulated skill activation',params:[runner.index,a.skillId,a.duration??-1,a.effectBranch??0]});
      if(a.targetRunnerIds.length)analysis.debuffs.push({sourceRunnerId:runner.id,skillId:a.skillId,start:a.start,end:a.end,targetRunnerIds:a.targetRunnerIds,recipientsKnown:true,simulatedRecipients:a.simulatedRecipients,effects:a.effects,detail:'Confirmed applied effects in the matched execution.',effectiveEnd:a.effectiveEnd,effectiveDuration:a.effectiveDuration,timingKind:a.timingKind,timingReason:a.timingReason});
    }
  }
  race.events.sort((a,b)=>a.time-b.time);
  return prepared;
}
