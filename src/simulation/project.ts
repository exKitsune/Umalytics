/** Display adapter for a freshly authorized engine result. No inference engine,
 * effect formula, condition evaluator, random draw or counterfactual runs here. */
import type { Race, Runner, Frame } from '../data/types';
import type { RaceAnalysis, RunnerAnalysis, SkillRow, SkillActivation, StatusInterval } from '../data/analytics';
import type { ReferenceData } from '../data/reference';
import type { PreparedRace, PreparedRunner } from '../analysis/prepared';
import type { RunnerMotion, MotionSample, MotionBand } from '../data/race-motion';
import type { ContributionTotal, RunnerStatBreakdown, SlowdownAnalysis } from '../data/effect-types';
import type { SpurtComparison, SpurtDecision } from '../data/spurt-comparison';
import type { BranchConditionEvaluation, SkillConditionEvaluation } from '../data/skill-conditions';
import type { SkillMetric } from '../data/skill-metrics';
import type { AnalysisGateReport, JsonObject } from './contracts';
import { decisionTrace, motionIndex as m, motionAt, blockingSummary, type DecisionEvent } from './trace';
import { rankSamples, runnerGap } from '../view-model';
import { statusLabel } from '../data/status-presentation';

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
    ['front-block',r=>r[m.blocker]>=0],['hp-empty',r=>r[m.hp]<=0],
    ['last-spurt',r=>r[m.spurt]===1],['spot-struggle',r=>r[m.spotStruggle]===1],
    ['dueling',r=>r[m.duel]===1],
    ['speed-up',r=>r[m.paceMode]===1],['overtake',r=>r[m.paceMode]===2],
    ['pace-up',r=>r[m.paceMode]===3],['pace-down',r=>r[m.paceMode]===4],
    ['extra-pace-up',r=>r[m.paceMode]===5],['force-in',r=>r[m.forceIn]===1],
  ];
  return conditions.flatMap(([kind,active])=>{
    const result:StatusInterval[]=[];let start:number|null=null;
    for(const row of rows){if(row[m.time]>=stop)break;
      if(active(row)&&start===null)start=row[m.time];
      if(!active(row)&&start!==null){result.push({kind,label:statusLabel(kind),start,end:row[m.time],evidence:'simulated',detail:'State from the matched engine execution at each simulation tick.'});start=null;}
    }
    if(start!==null)result.push({kind,label:statusLabel(kind),start,end:stop,evidence:'simulated',detail:'Engine state remains active through the finish.'});
    return result;
  }).sort((a,b)=>a.start-b.start);
}

/** cp_acc is a precomputed magnitude, not an active-state flag. These internal
 * effects use their actual activation/expiry callbacks instead. */
function internalIntervals(events:DecisionEvent[],stop:number):StatusInterval[] {
  const names:Record<string,string>={asitame:'release-conserve-power',staminasyoubu:'stamina-limit-break'};
  return events.filter(e=>e.kind==='skill-activated'&&e.skillId in names).map(e=>{
    const expiry=events.find(x=>x.sequence>e.sequence&&x.kind==='effect-ended'&&x.skillId===e.skillId);
    return {kind:names[e.skillId],label:statusLabel(names[e.skillId]),start:e.time,end:Math.min(stop,expiry?.time??stop),evidence:'simulated',detail:'Internal engine effect activation and expiry callbacks.'};
  });
}

function conditions(events:DecisionEvent[]):SkillConditionEvaluation|null {
  const definitions=events.filter(e=>e.kind==='skill-definition');
  if(!definitions.length)return null;
  const branches:BranchConditionEvaluation[]=definitions.map(def=>{
    const checks=events.filter(e=>e.detail===def.detail),ready=checks.filter(e=>e.kind==='activation-ready');
    const conditionChecks=checks.filter(e=>e.kind==='condition'),met=conditionChecks.find(e=>e.data.passed===true);
    const eligible=ready.some(e=>e.data.passed===true),state=met?'met':conditionChecks.length?'unmet':'unknown';
    // Predicate checks stay tied to the same successful tick. An earlier true
    // predicate alone cannot prove the branch conjunction or a latched prereq.
    const predicates=checks.filter(e=>/[<>=!]/.test(e.kind)&&e.kind!=='static-condition');
    const names=[...new Set(predicates.map(e=>`${e.stage}:${e.kind}`))];
    return {branchIndex:def.detail,state,inferredState:state,staticOnly:false,firstOpportunity:met?.time??null,
      opportunities:conditionChecks.filter(e=>e.data.passed===true).reduce((n,e)=>n+e.count,0),unresolved:[],detail:'Actual evaluated condition checks. Activation readiness separately includes targets and cooldown; short-circuited predicates stay unknown.',
      mechanicsState:'understood',eligibilityState:eligible?'eligible':ready.length?'ineligible':'unresolved',randomTrigger:checks.some(e=>e.kind==='sampled-trigger'),definitiveOpportunity:eligible,
      observations:[],proxies:[],missingInputs:[],hiddenState:[],inferenceBasis:'observed',absenceAssessment:met?'conditions-supported':conditionChecks.length?'conditions-excluded':'no-observed-candidate',
      predicates:names.map(name=>{
        const history=predicates.filter(e=>`${e.stage}:${e.kind}`===name),predicate=history[0];
        const checked=met?history.find(e=>e.tick<=met.tick&&e.lastTick>=met.tick):undefined;
        return {expression:predicate.kind,key:predicate.kind.split(/[<>=!]/)[0],meaning:predicate.kind,mechanicsState:'understood' as const,
          observation:'Evaluated inside the simulator.',limitation:null,state:checked?checked.data.passed===true?'met' as const:'unmet' as const:'unknown' as const,
          observed:checked?String(checked.data.passed):'No check at this condition opportunity',time:checked?met!.time:null,
          role:predicate.stage==='precondition'?'precondition' as const:'condition' as const};
      })};
  });
  const met=branches.some(b=>b.state==='met'),state=met?'met':branches.every(b=>b.state==='unmet')?'unmet':'unknown';
  const eligible=branches.some(b=>b.eligibilityState==='eligible');
  return {state,inferredState:state,branches,mechanicsState:'understood',eligibilityState:eligible?'eligible':branches.every(b=>b.eligibilityState==='ineligible')?'ineligible':'unresolved',definitiveOpportunity:eligible,randomTrigger:branches.some(b=>b.randomTrigger)};
}

function skills(runner:Runner,events:DecisionEvent[],modeled:JsonObject,reference:ReferenceData|null,stop:number,runners:Runner[]) {
  const reported=objects(modeled.skillEvents).filter(e=>e.horseIndex===runner.index);
  const ids=[...new Set([...(runner.skills??[]).map(s=>s.id),...events.filter(e=>e.skillId&&['skill-definition','skill-wit','skill-activated'].includes(e.kind)).map(e=>Number(e.skillId)),...reported.map(e=>Number(e.skillId))])].filter(Number.isFinite);
  const metrics:Record<number,SkillMetric[]>={},rows:SkillRow[]=[];
  for(const id of ids){
    const own=events.filter(e=>Number(e.skillId)===id||e.kind==='cooldown-start'&&String(e.data.key)===String(id));
    const wit=own.filter(e=>e.kind==='skill-wit'),activated=own.filter(e=>e.kind==='skill-activated');
    const activations:SkillActivation[]=activated.map((e,index)=>{
      const next=activated[index+1]?.sequence??Infinity;
      const effects=own.filter(x=>x.sequence>e.sequence&&x.sequence<next&&x.tick===e.tick&&x.kind==='effect-evaluated');
      const applied=own.filter(x=>x.sequence>e.sequence&&x.sequence<next&&x.tick===e.tick&&x.kind==='effect-applied');
      const queued=own.filter(x=>x.sequence>e.sequence&&x.sequence<next&&x.tick===e.tick&&x.kind==='effect-queued');
      const ref=reference?.metadata.skills[id]?.branches.find((b,i)=>(b.branchIndex??i)===e.detail);
      const event=reported.find(p=>Number(p.skillId)===id&&Math.abs(Number(p.t)-e.time)<.001);
      const passive=effects.some(x=>Number(x.data.duration)<0),reportedDuration=num(event?.duration);
      const duration=reportedDuration??(effects.length?Math.max(0,...effects.map(x=>Number(x.data.duration))):null);
      const expiry=own.find(x=>x.kind==='effect-ended'&&x.sequence>e.sequence&&x.sequence<next);
      const end=passive?stop:expiry?.time??(duration===null?null:Math.min(stop,e.time+duration));
      // Reference effects supply labels/icons only. Magnitudes below are copied
      // from evaluated engine modifiers, never scaled by the UI formula engine.
      const displayEffects=effects.map(x=>({type:Number(x.data.type),rawValue:Number(x.data.modifier)*10000,valueUsage:1,levelUsage:0,
        targetType:ref?.effects[Number(x.data.ability)]?.targetType??1}));
      const targetRunnerIds=[...new Set(queued.flatMap(x=>Array.isArray(x.data.targets)?x.data.targets.map(v=>runners.find(r=>r.index===v)?.id).filter((v):v is string=>!!v):[]))];
      return {skillId:id,referenceSkillId:id,start:e.time,end,duration,effectiveEnd:end,effectiveDuration:end===null?null:Math.max(0,end-e.time),
        activationEvidence:'simulated',durationEvidence:'simulated',effectBranch:e.detail,effects:displayEffects,targetRunnerIds,
        timingKind:passive?'passive':duration===0?'instant':'reported',timingReason:'Engine activation and effect expiry ticks.',
        detail:`Simulator activation; ${applied.length} self effects applied, ${targetRunnerIds.length} queued recipients.`};
    });
    const evaluation=conditions(own),failed=wit.some(e=>e.data.checked===true&&e.data.passed===false);
    const nonProcReason=activations.length?'Activated in the simulation.':failed?'The simulator’s actual wit check failed.':evaluation?.state==='unmet'?'No branch became ready in the simulation.':'No activation in this simulation; consult the actual checks below.';
    rows.push({skillId:id,equipped:!!runner.skills?.some(s=>s.id===id),activationCount:activations.length,activations,nonProcReason,evidence:'simulated',
      activationStatus:activations.length?'simulated':failed?'wit-failure-supported':evaluation?.state==='unmet'?'conditions-unmet':'unknown',effectiveActive:!!activations.length,conditionEvaluation:evaluation,inferredBranches:[],simulation:{checks:own.filter(e=>e.kind!=='rng-draw'),wit}});
    const items:SkillMetric[]=[];
    const add=(label:string,value:number|string,unit:string,detail:string)=>items.push({label,value,unit,detail,evidence:'simulated'});
    for(const check of wit)add('Wit check',check.data.checked?`${Number(check.data.roll).toFixed(2)} / ${Number(check.data.threshold).toFixed(2)} · ${check.data.passed?'passed':'failed'}`:'Exempt · no draw','',`Actual engine check at ${check.time.toFixed(3)} s.`);
    for(const e of own.filter(e=>e.kind==='effect-applied')){
      const type=Number(e.data.type),names:Record<number,[string,string]>={1:['Speed stat',''],2:['Stamina stat',''],3:['Power stat',''],4:['Guts stat',''],5:['Wit stat',''],9:['HP effect',''],14:['Gate delay multiplier','×'],21:['Current speed','m/s'],22:['Current speed','m/s'],27:['Target speed','m/s'],28:['Lane speed','m/s'],31:['Acceleration','m/s²']};
      const [label,unit]=names[type]??[`Effect ${type}`,''];
      add(label,Number(e.data.modifier),unit,`Applied engine modifier at ${e.time.toFixed(3)} s. Duration: ${Number(e.data.duration).toFixed(3)} s. HP modifiers are fractions of maximum HP, not HP points.`);
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
    return {time:input.time,end:inputs[index+1]?.time??stop,trigger:index?'recovery':'late-entry',skillIds:[],candidates:[],matched:null,betterChance:null,
      decisionDistance:num(input.data.position),hp:num(input.data.hp),checkChance:rolls.length?rolls[0].threshold/100:null,
      reason:rolls.length?`${rolls.length} actual wit ${rolls.length===1?'roll':'rolls'}. The displayed target is the plan retained by the engine.`:'Deterministic budget decision; no wit draw was made.',
      deterministic:!rolls.length,rolls,observedTarget:num(accepted?.data.speed),observedDelay:accepted?Number(accepted.data.start)-Number(input.data.position):null,observedTargetTime:input.time,targetEvidence:null};
  });
  const last=decisions.at(-1),maximum=num(inputs.at(-1)?.data.max_speed),target=last?.observedTarget??null;
  return {source:'simulation',candidates:[],matched:null,betterChance:null,decisionDistance:last?.decisionDistance??null,hp:last?.hp??null,checkChance:last?.checkChance??null,
    reason:last?.reason??'No last-spurt decision occurred.',deterministic:last?.deterministic??true,target:target===null?null:exact(target),maximum:maximum===null?null:exact(maximum),
    shortfall:maximum===null||target===null?null:exact(Math.max(0,maximum-target)),initialTarget:decisions[0]?.observedTarget??null,initialTargetTime:decisions[0]?.time??null,
    targetTime:last?.time??null,waitingPlateau:null,startTime:start,delaySeconds:start===null||!inputs.length?null:Math.max(0,start-inputs[0].time),decisions};
}

export function projectSimulation(recorded:Race,report:AnalysisGateReport,reference:ReferenceData|null):PreparedRace|null {
  const trace=decisionTrace(report),modeled=report.simulation?.modeled;
  if(!trace||!modeled)return null;
  const results=objects(modeled.results);
  if(results.length!==recorded.runners.length)throw new Error('Simulator runner results are incomplete.');
  const runners=recorded.runners.map(r=>{const result=results[r.index];if(!result)throw new Error('Simulator runner mapping is incomplete.');return {...r,
    finishTimeRaw:num(result.finishTimeRaw),finishTime:num(result.finishTime),finishOrder:num(result.finishOrder)===null?null:Number(result.finishOrder)+1,
    startDelay:num(result.startDelayTime),lastSpurtDistance:num(result.actualLastSpurtStartDistance),strategyCode:num(result.runningStyle)??r.strategyCode};});
  const frames:Frame[]=objects(modeled.frames).map(f=>({time:Number(f.t),runners:runners.map(r=>{const row=objects(f.horses)[r.index];if(!row)throw new Error('Simulator frame is incomplete.');return {runnerId:r.id,distance:num(row.pos),speed:num(row.speed),hp:num(row.hp),lane:num(row.lane),temptationMode:num(row.temptationMode),blockFrontRunnerIndex:num(row.blockFrontHorseIndex)};})}));
  const race:Race={...recorded,analysisSource:'simulation',runners,frames,events:[],raw:undefined,duration:frames.at(-1)?.time??recorded.duration};
  const analysis:RaceAnalysis={source:'simulation',runners:{},debuffs:[],warnings:[]},prepared:PreparedRace={race,analysis,runners:{}};
  const sampleRanks=new Map(frames.map(f=>[f,rankSamples(race,f.runners,f.time)]));
  for(const runner of runners){
    const events=trace.events.filter(e=>e.horseIndex===runner.index),rows=trace.motion.filter(r=>r[m.horse]===runner.index),stop=runner.finishTimeRaw??race.duration;
    if(!rows.length)throw new Error('Simulator motion is incomplete.');
    const states=[...intervals(rows,stop),...internalIntervals(events,stop)].sort((a,b)=>a.start-b.start),{rows:skillRows,metrics}=skills(runner,events,modeled,reference,stop,runners),activations=skillRows.flatMap(s=>s.activations);
    const samples=frames.filter(f=>f.time<=stop+.067).map((f,index)=>{const s=f.runners.find(s=>s.runnerId===runner.id)!,before=frames[index-1]?.runners.find(s=>s.runnerId===runner.id),dt=index?f.time-frames[index-1].time:0;
      const hpDelta=before?.hp==null||s.hp===null?null:s.hp-before.hp;
      return {time:f.time,distance:s.distance,speed:s.speed,hp:s.hp,lane:s.lane,leadGap:runnerGap(race,f.runners,runner.id),rank:sampleRanks.get(f)!.get(runner.id)??null,
        acceleration:motionAt(rows,f.time)?.[m.acceleration]??null,hpDelta,hpRate:dt&&hpDelta!==null?hpDelta/dt:null};});
    const first=samples[0],last=samples.at(-1),spurtValue=spurt(events,rows,stop),blocking=blockingSummary(rows.filter(r=>r[m.time]<stop));
    const initial=events.find(e=>e.kind==='initial-stats');
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
    prepared.runners[runner.id]={motion,inferredMotion:motion,modes,spurt:spurtValue,blocking,speedChanges:[],metrics,impacts:Object.fromEntries(skillRows.map(s=>[s.skillId,null])),
      totals:{skills:skillRows.map(s=>({skillId:s.skillId,motion:null,score:null,coverage:0,active:0,assessed:0})),benefit:null,score:null,coverage:0,active:0,assessed:0}} satisfies PreparedRunner;
    for(const a of activations){
      race.events.push({time:a.start,type:'skill',runnerId:runner.id,skillId:a.skillId,label:'Simulated skill activation',params:[runner.index,a.skillId,a.duration??-1,a.effectBranch??0]});
      if(a.targetRunnerIds.length)analysis.debuffs.push({sourceRunnerId:runner.id,skillId:a.skillId,start:a.start,end:a.end,targetRunnerIds:a.targetRunnerIds,recipientsKnown:true,effects:a.effects,detail:'Recipients queued by the simulator; immunity checks may prevent effects.',effectiveEnd:a.effectiveEnd,effectiveDuration:a.effectiveDuration,timingKind:a.timingKind,timingReason:a.timingReason});
    }
  }
  race.events.sort((a,b)=>a.time-b.time);
  return prepared;
}
