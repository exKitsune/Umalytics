import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { projectSimulation } from '../src/simulation/project';
import { attachPrepared } from '../src/analysis/prepared';
import { motionFor } from '../src/data/motion-analysis';
import { metricsForSkill } from '../src/data/skill-metrics';
import { sampleAt } from '../src/data/sample';
import { hpTimeline, hpSampledBridges } from '../src/data/hp-timeline';
import { replayCards, replayCardHelp, CARD_DWELL } from '../src/replay/cards';
import { parseRaceJson } from '../src/data/import';
import { motionIndex as m, TRACE_SCHEMA, type DecisionEvent } from '../src/simulation/trace';
import type { Race } from '../src/data/types';
import type { RaceAnalysis } from '../src/data/analytics';
import { AnalysisClient, type AnalysisState } from '../src/analysis/client';
import { AnalysisStore } from '../src/analysis/store';
import { toPortableRace } from '../src/data/share';
import { trafficIntervals, trafficAt, trafficActive, trafficColor } from '../src/simulation/traffic';
import {trafficTimeline,trafficSampleAt,trafficCells,trafficDurations} from '../src/simulation/traffic-lane';
import type {MotionSample} from '../src/data/race-motion';
import {powerSummary} from '../src/simulation/power';
import {showTelemetrySkill,telemetrySkillEnd} from '../src/data/telemetry-skills';
import {telemetryStatusKinds} from '../src/data/status-presentation';
import {decodeHiddenStatuses,defaultHiddenStatuses,groupTelemetryStatuses} from '../src/data/telemetry-statuses';
import {statusLegend,statusHelp,laterGlobalStatuses} from '../src/data/analysis-copy';
import {runnerMechanics} from '../src/data/runner-mechanics';
import {visionDistanceAt,populateSkillImpacts} from '../src/data/skill-impact';

const report=JSON.parse(execFileSync('python',['tests/globalsim/export_contract_fixtures.py'],{encoding:'utf8',windowsHide:true})).trial;
const runners=[0,1].map(index=>({id:`r${index}`,index,gate:2-index,name:`Runner ${index}`,charaId:null,cardId:null,trainer:null,strategy:null,finishTime:9,finishOrder:2-index,skills:[{id:123,level:1},{id:456,level:1}]}));
const original:Race={id:'test',title:'Synthetic projection',source:'normalized',sourceLabel:'test',distance:100,duration:9,courseId:null,runners,frames:[{time:0,runners:runners.map(r=>({runnerId:r.id,distance:50,speed:99,hp:9999,lane:0}))}],events:[],warnings:[],synthetic:true};
const snapshot=JSON.stringify(original);
const event=(kind:string,time:number,data:DecisionEvent['data'],skillId='123',horseIndex=0):DecisionEvent=>({kind,time,lastTime:time,tick:time*10,lastTick:time*10,sequence:++sequence,lastSequence:sequence,count:1,stage:kind==='skill-wit'?'initialization':'activation',skillId,horseIndex,detail:0,data});
let sequence=0;
const events=[event('skill-wit',0,{checked:true,roll:4,threshold:80,passed:true}),event('skill-definition',0,{condition:'phase==0',precondition:''}),event('condition',0,{passed:true}),event('activation-ready',0,{passed:true}),event('skill-activated',0,{}),event('effect-evaluated',0,{type:27,ability:0,modifier:.35,duration:1}),event('effect-applied',0,{type:27,ability:0,modifier:.35,duration:1}),event('initial-stats',0,{speed:1234,stamina:901,power:872,guts:673,wisdom:779},''),event('skill-wit',0,{checked:true,roll:90,threshold:80,passed:false},'456'),event('effect-ended',1,{}),event('spurt-input',1,{position:70,hp:350,max_speed:24},''),event('spurt-roll',1,{roll:30,threshold:60,passed:true,speed:23,start:70},''),event('spurt-plan',1,{speed:23,start:70,result:1},''),event('spurt-accepted',1,{speed:23,start:70},'')];
const motion=[0,1].flatMap(horse=>[.1,.2,1,1.1,2].map(time=>{const row=Array(43).fill(0);Object.assign(row,{[m.horse]:horse,[m.time]:time,[m.tick]:time*10,[m.dt]:.1,[m.hp]:400,[m.position]:time*40,[m.speed]:20,[m.target]:21,[m.base]:19,[m.acceleration]:.5,[m.blocker]:horse===0&&time===.2?1:-1,[m.selfLoss]:horse===0&&time===.2?2:0,[m.finalLoss]:horse===0&&time===.2?.25:0,[m.paceMode]:time<1?3:0,[m.spurt]:time>=1?1:0,[m.spurtSpeed]:23});return row;}));
events.push(event('skill-definition',1,{condition:'phase==0',precondition:''},'789'),event('condition',1,{passed:true},'789'),event('cooldown-ready',1,{passed:false},'789'),event('activation-ready',1,{passed:false},'789'));
report.simulation.capabilities.hiddenState='simulated_trace';
for(const row of motion)row[m.conservePower]=.4;
report.simulation.modeled={results:runners.map((_,i)=>({finishOrder:i,finishTime:2+i*.1,finishTimeRaw:2+i*.1,startDelayTime:.03,actualLastSpurtStartDistance:70})),frames:[0,1,2,2.1].map(t=>({t,horses:runners.map((_,i)=>({pos:t*50-i,speed:20+i,hp:500-t*50,lane:i*.1,temptationMode:0,blockFrontHorseIndex:-1}))})),skillEvents:[{horseIndex:0,skillId:123,t:0,duration:1}],decisionTrace:{schema:TRACE_SCHEMA,complete:true,dropped:0,events,motion,motionColumns:[]}};
const result=projectSimulation(original,report,null)!;assert.ok(result);attachPrepared(result);
assert.equal(JSON.stringify(original),snapshot,'Original capture and export source must remain untouched');
assert.equal(result.race.frames[1].runners[0].speed,20,'Replay uses engine output, not recorded or inferred values');
assert.equal(result.race.runners[0].finishOrder,1,'Request index, not gate or finishing order, maps results');
const detail=result.analysis.runners.r0,ready=result.runners.r0;
assert.equal(detail.statBreakdown.stats.speed.final,1234);
assert.equal(detail.intervals.find(s=>s.kind==='pace-up')?.end,1);
assert.equal(detail.intervals.find(s=>s.kind==='traffic')?.start,.2);
assert.ok(!detail.intervals.some(s=>s.kind==='release-conserve-power'),'A prepared magnitude does not mean the effect is active');
assert.equal(ready.blocking?.maximumSelfClamp,2);assert.equal(ready.blocking?.maximumFinalClamp,.25);
assert.equal(ready.spurt.decisions[0].rolls?.[0].roll,30);assert.equal(ready.spurt.decisions[0].observedTarget,23);
assert.equal(detail.skillRows.find(s=>s.skillId===123)?.activations[0].effectiveEnd,1);
assert.equal(detail.skillRows.find(s=>s.skillId===456)?.activationStatus,'wit-failure-supported');
const cooling=detail.skillRows.find(s=>s.skillId===789)!;
assert.equal(cooling.conditionEvaluation?.state,'met','A failed cooldown check must not turn a passed condition into an unmet condition');
assert.equal(cooling.conditionEvaluation?.eligibilityState,'ineligible');assert.equal(cooling.effectiveActive,false);
assert.equal(metricsForSkill(result.race,null,result.analysis,'r0',123).find(m=>m.label==='Target speed')?.value,.35);
assert.equal(motionFor(result.race,null,result.analysis,'r0'),ready.motion);
assert.throws(()=>motionFor(result.race,null,result.analysis,'r0',null,'remove-skill'),/counterfactual/);
assert.equal(sampleAt(result.race,.5)[0].hp,475,'Playback interpolates engine frames without reconstructing HP jumps');
assert.equal(hpTimeline(result.race,'r0',null).length,4);assert.deepEqual(hpSampledBridges(result.race,'r0',null),[]);
const cards=replayCards({race:result.race,analysis:result.analysis} as any,'r0',.25,result.race.frames[0].runners[0]);
assert.ok(cards.some(c=>c.kind==='status'&&c.label==='Pace up'));assert.ok(cards.some(c=>c.kind==='skill'));
const trafficRows=Array.from({length:10},(_,index)=>{
  const row=Array(43).fill(0);row[m.time]=index/10;row[m.dt]=.1;
  row[m.blocker]=[0,2,4,8].includes(index)?1:-1;
  row[m.nearFrontSeconds]=index===1?.1:0;row[m.nearBehindSeconds]=index===9?.1:0;
  row[m.selfLoss]=[.001,0,.8,0,1.6,0,0,0,.0009,0][index];row[m.finalLoss]=index===2?.6:0;
  return row;
});
const traffic=trafficIntervals(trafficRows,1);
assert.equal(traffic.length,2,'Contact spans remain visible; negligible cuts stay transparent');
assert.equal(traffic[0].start,0);assert.equal(traffic[0].end,.5);
trafficRows[8][m.selfLoss]=.35;
assert.equal(trafficIntervals(trafficRows,1)[1].start,.8,'A longer clear gap separates substantial episodes');
assert.equal(trafficActive(traffic[0],.05),true,'The minimum slowdown is inclusive');
assert.equal(trafficActive(traffic[0],.15),false,'Proximity without a speed cut stays transparent');
assert.equal(trafficActive(traffic[0],.35),false,'A joined clear gap is not a claimed traffic state');
assert.equal(trafficAt(traffic[0],-.01),null);assert.equal(trafficAt(traffic[0],.5),null);
assert.equal(trafficColor(trafficAt(traffic[0],.25)),trafficColor({...traffic[0].traffic![2],finalLoss:0}),'Never add the two cuts');
assert.equal(trafficColor(trafficAt(traffic[0],.45)),'#f04444');
assert.equal(trafficColor({...traffic[0].traffic![0],selfLoss:.6,finalLoss:0}),'#f04444','Red begins at 0.6 m/s');
assert.equal(trafficColor(traffic[0].traffic![0]),'#ffffff');
assert.equal(trafficColor({...traffic[0].traffic![0],selfLoss:.25,finalLoss:0}),'#ffec4a');
assert.equal(trafficColor({...traffic[0].traffic![0],selfLoss:.4,finalLoss:0}),'#ffa825');
assert.notEqual(trafficColor({...traffic[0].traffic![0],selfLoss:.4}),trafficColor({...traffic[0].traffic![0],selfLoss:.5}),'Severity changes continuously between anchors');
const lane=trafficTimeline([
  {time:0,blockingClamps:{self:.001,final:0},constraint:{kind:'recorded-block',runnerId:'r1'}},
  {time:.1,blockingClamps:{self:0,final:0},constraint:{kind:'recorded-block',runnerId:'r1'}},
  {time:.2,blockingClamps:{self:.4,final:.3},constraint:{kind:'recorded-block',runnerId:'r1'}},
  {time:.3,blockingClamps:{self:.6,final:0},constraint:{kind:'recorded-block',runnerId:'r1'}},
  {time:.4,blockingClamps:{self:2,final:0},constraint:{kind:'none'}},
  {time:.5,blockingClamps:{self:.0009,final:0},constraint:{kind:'recorded-block',runnerId:'r1'}},
] as MotionSample[],.6);
assert.equal(trafficSampleAt(lane,.15)?.blocked,true,'Keep contact even with zero instantaneous cut');
assert.equal(trafficSampleAt(lane,.15)?.selfLoss,0);
assert.equal(trafficSampleAt(lane,.45)?.blocked,false);
assert.equal(trafficSampleAt(lane,.45)?.selfLoss,0,'A global speed ceiling is not traffic');
assert.equal(trafficSampleAt(lane,-.1),null);assert.equal(trafficSampleAt(lane,.6),null);
assert.deepEqual(trafficCells(lane,t=>t*100),[
  {start:0,end:10,color:'#ffffff'},{start:20,end:30,color:'#ffa825'},{start:30,end:40,color:'#f04444'},
],'Paint each full tick at its own magnitude; retain transparent zero/below-threshold gaps');
assert.deepEqual(trafficCells(lane,t=>t*t*100),[
  {start:0,end:.1*.1*100,color:'#ffffff'},{start:.2*.2*100,end:.3*.3*100,color:'#ffa825'},{start:.3*.3*100,end:.4*.4*100,color:'#f04444'},
],'Use projected start/end boundaries on a nonlinear distance axis');
assert.equal(trafficCells(lane,()=>null).length,0);
const trafficTotals=trafficDurations(lane),paintedSeconds=trafficCells(lane,t=>t).reduce((sum,cell)=>sum+cell.end-cell.start,0);
assert.ok(Math.abs(trafficTotals.slowedSeconds-paintedSeconds)<1e-9,'Results slowed time equals the colored tick windows.');
assert.ok(Math.abs(trafficTotals.contactSeconds-.5)<1e-9,'Contact includes zero and sub-threshold cuts.');
assert.ok(Math.abs(trafficTotals.slowedSeconds-.3)<1e-9);
assert.equal(trafficColor({...lane[0],selfLoss:.001}),'#ffffff');
const clipped=trafficTimeline([{time:0,blockingClamps:{self:.001,final:0},constraint:{kind:'recorded-block',runnerId:'r1'}},{time:.0666,blockingClamps:{self:.05,final:0},constraint:{kind:'recorded-block',runnerId:'r1'}}] as MotionSample[],.08);
assert.equal(trafficDurations(clipped).slowedSeconds,.08,'The final colored tick stops at the runner finish.');


assert.equal(trafficIntervals(trafficRows,.45)[0].end,.45,'Clamp to the runner finish');
const ceiling=Array(43).fill(0);ceiling[m.dt]=.1;ceiling[m.blocker]=-1;ceiling[m.selfLoss]=2;
assert.deepEqual(trafficIntervals([ceiling],.1),[],'Global speed ceiling without a blocker is not traffic loss');
const trafficAnalysis={...result.analysis,runners:{...result.analysis.runners,r0:{...detail,intervals:traffic}}};
const trafficCardAt=(time:number)=>replayCards({race:result.race,analysis:trafficAnalysis} as any,'r0',time,result.race.frames[0].runners[0]).find(c=>c.label==='Traffic');
assert.ok(trafficCardAt(.25));
const heldTraffic=trafficCardAt(.35);
assert.ok(heldTraffic?.visualOnly,'A brief clear gap holds the notification without claiming an active slowdown');
assert.equal(heldTraffic.end,.3,'Keep the actual tick end during the display hold');
assert.equal(trafficActive(traffic[0],.35),false,'Display holds do not extend the traffic analysis');
const lastTraffic=trafficCardAt(1.14);
assert.ok(lastTraffic?.visualOnly,'The last slowdown at 0.4 s holds the proc for at least 0.75 s');
assert.equal(lastTraffic.end,.5,'The held notification preserves the actual slowdown end');
assert.equal(lastTraffic.progress,null,'A held traffic proc has no duration bar');
assert.equal(lastTraffic.color,'#f04444','The hold retains the latest slowdown severity');
assert.equal(trafficCardAt(1.15),undefined,'The notification disappears when the minimum proc dwell ends');
assert.equal(ready.totals.score,null,'Unavailable counterfactual effectiveness is not zero');
assert.ok(ready.speedChanges.length>0&&ready.speedChanges.every(c=>c.reasons.length&&c.reasons.every(r=>r.evidence==='simulated'&&r.start<=c.start&&r.end>=c.end)),'Every executed tick has a directly traced explanation, including steady/ordinary acceleration');
assert.ok(ready.speedChanges.some(c=>c.reasons.some(r=>r.detail?.includes('Self/final cuts 2.0000 / 0.2500'))));
const passive={...detail.skillActivations[0],timingKind:'passive' as const,start:1,effectiveEnd:100,end:100};
assert.equal(telemetrySkillEnd(passive),4);assert.equal(passive.effectiveEnd,100,'Only the marker is shortened, never the passive mechanics');
assert.equal(telemetrySkillEnd(detail.skillActivations[0]),1);
assert.equal(showTelemetrySkill(passive,null),false,'Permanent passives do not clutter telemetry');
const passiveOptions={race:result.race,analysis:{...result.analysis,runners:{r0:{...detail,skillActivations:[passive]}}},reference:null} as any;
const passiveAt=(time:number)=>replayCards(passiveOptions,'r0',time,result.race.frames[0].runners[0]).find(c=>c.kind==='skill');
assert.equal(passiveAt(.9),undefined);
const passiveCard=passiveAt(1.25)!;
assert.ok(passiveCard,'Hidden telemetry passives still proc in replay');
assert.equal(passiveCard.displayEnd,passive.start+CARD_DWELL);
assert.equal(passiveCard.end,100,'Keep the actual effect expiry');
assert.equal(passiveCard.progress,null,'A permanent bonus has no countdown');
assert.equal(passiveCard.visualOnly,true);
assert.equal(replayCardHelp(passiveOptions,passiveCard),'Passive bonus applied.');
assert.ok(passiveAt(3.49));assert.equal(passiveAt(3.5),undefined);assert.equal(passiveAt(99),undefined);
assert.ok(passiveAt(2),'Seeking backward restores the proc');
assert.equal(passive.effectiveEnd,100,'Replay display never changes passive analysis');
const visionEffect=(value:number,start:number,end:number,targetType=1)=>({type:8,rawValue:value*10000,evaluatedValue:value,valueUsage:1,levelUsage:0,targetType,appliedStart:start,appliedEnd:end});
const visionAnalysis:RaceAnalysis={...result.analysis,runners:{...result.analysis.runners,
  r0:{...detail,skillActivations:[{...passive,start:0,effects:[visionEffect(10,0,100)]},{...detail.skillActivations[0],start:1,end:10,effectiveEnd:10,effects:[visionEffect(5,1,3),{type:27,rawValue:3500,valueUsage:1,levelUsage:0}]}]},
  r1:{...result.analysis.runners.r1,skillActivations:[{...detail.skillActivations[0],start:1,end:10,effectiveEnd:10,effects:[visionEffect(-15,1,10,2)],simulatedRecipients:{r0:[visionEffect(-15,2,4,2)]}}]},
}};
const sameTeam={...result.race,runners:result.race.runners.map(r=>({...r,teamGroup:1}))};
for(const [time,expected] of [[.5,30],[1.5,35],[2.5,20],[3,15],[4,30],[100,20]])assert.equal(visionDistanceAt(sameTeam,'r0',time,null,visionAnalysis).metres,expected,`Applied vision windows at ${time}s, independently of the caster's other effects and inferred immunity`);
visionAnalysis.runners.r1.skillActivations[0].simulatedRecipients={};
assert.equal(visionDistanceAt(sameTeam,'r0',2.5,null,visionAnalysis).metres,35,'No delivered effect means no assumed hit');
visionAnalysis.runners.r1.skillActivations[0].simulatedRecipients={r0:[visionEffect(-50,2,4,2)]};
assert.equal(visionDistanceAt(sameTeam,'r0',2.5,null,visionAnalysis).metres,0,'Vision cannot be negative');
const deliveryReport=structuredClone(report);
deliveryReport.simulation.modeled.decisionTrace.events.push(
  event('skill-activated',.5,{},'901'),event('effect-evaluated',.5,{type:8,ability:0,modifier:-10,duration:1},'901'),
  event('effect-applied',.5,{type:8,ability:0,modifier:-10,duration:1},'901',1),event('effect-queued',.5,{ability:0,targets:[1]},'901'),
  event('skill-activated',.5,{},'902'),event('effect-evaluated',.5,{type:10,ability:0,modifier:.9,duration:0},'902'),event('effect-applied',.5,{type:10,ability:0,modifier:.9,duration:0},'902'),
  event('skill-activated',.5,{},'903'),event('effect-evaluated',.5,{type:14,ability:0,modifier:.01,duration:0},'903'),event('effect-applied',.5,{type:14,ability:0,modifier:.01,duration:0},'903'));
const delivery=projectSimulation(original,deliveryReport,null)!;
assert.equal(delivery.analysis.debuffs[0].simulatedRecipients?.r1[0].evaluatedValue,-10);
populateSkillImpacts(delivery.race,null,null,delivery.analysis);
assert.equal(delivery.analysis.debuffs[0].simulatedRecipients?.r1[0].appliedEnd,1.5,'Mathematical enrichment must retain delivery evidence and timing');
// Both runners own the same mixed buff/debuff. The first caster later receives
// the other caster's copy; that received expiry must not extend its own proc.
const sharedSkillReport=structuredClone(report);
sharedSkillReport.simulation.modeled.skillEvents=[];
sharedSkillReport.simulation.modeled.decisionTrace.events=[
  event('skill-activated',0,{},'100251'),
  event('effect-evaluated',0,{type:27,ability:0,modifier:.25,duration:.5},'100251'),
  event('effect-applied',0,{type:27,ability:0,modifier:.25,duration:.5},'100251'),
  event('effect-evaluated',0,{type:21,ability:1,modifier:-.05,duration:.5},'100251'),
  event('effect-applied',0,{type:21,ability:0,modifier:-.05,duration:.5},'100251',1),
  event('effect-queued',0,{ability:1,targets:[1]},'100251'),
  event('effect-ended',.533,{},'100251'),event('effect-ended',.533,{},'100251',1),
  event('skill-activated',1.1,{},'100251',1),
  event('effect-evaluated',1.1,{type:27,ability:0,modifier:.25,duration:.5},'100251',1),
  event('effect-applied',1.1,{type:27,ability:0,modifier:.25,duration:.5},'100251',1),
  event('effect-evaluated',1.1,{type:21,ability:1,modifier:-.05,duration:.5},'100251',1),
  event('effect-evaluated',1.1,{type:21,ability:0,modifier:-.05,duration:.5,followUp:true},'100251'),
  event('effect-applied',1.1,{type:21,ability:0,modifier:-.05,duration:.5},'100251'),
  event('effect-queued',1.1,{ability:1,targets:[0]},'100251',1),
  event('effect-ended',1.633,{},'100251'),event('effect-ended',1.633,{},'100251',1),
];
const sharedSkill=projectSimulation(original,sharedSkillReport,null)!;
for(const [id,start,end] of [['r0',0,.533],['r1',1.1,1.633]] as const){
  const activation=sharedSkill.analysis.runners[id].skillActivations[0];
  assert.equal(activation.effectiveEnd,end,'A received copy cannot extend the equipped skill');
  assert.equal(activation.effectiveDuration,end-start);
  assert.equal(telemetrySkillEnd(activation),end);
  assert.equal(sharedSkill.analysis.debuffs.find(d=>d.sourceRunnerId===id)?.effectiveEnd,end);
  assert.ok(!sharedSkill.runners[id].metrics[100251].some(m=>m.label==='Current speed'),'Received debuffs do not belong in the caster\'s own modifier metrics');
}
populateSkillImpacts(sharedSkill.race,null,null,sharedSkill.analysis);
assert.equal(sharedSkill.analysis.runners.r0.skillImpacts[0].scheduledDuration,.533,'Effectiveness must use the caster\'s active window');
assert.equal(sharedSkill.analysis.runners.r1.receivedDebuffImpacts[0].scheduledDuration,.533);
assert.ok(delivery.runners.r0.metrics[902].some(m=>m.label==='Gate delay multiplier'&&m.value===.9&&m.unit==='×'));
assert.ok(delivery.runners.r0.metrics[903].some(m=>m.label==='Gate delay override'&&m.value===.01&&m.unit==='s'));
assert.equal(showTelemetrySkill(detail.skillActivations[0],null),true,'Timed skill activations remain visible');
for(const type of [10,14]){
  const effects=[{type,rawValue:9000,valueUsage:1,levelUsage:0}];
  assert.equal(showTelemetrySkill({...passive,effects},null),true,'Start-delay effects remain visible even with passive timing');
  assert.equal(showTelemetrySkill({...passive,timingKind:'instant',effects},null),true,'Instant gate skills remain visible');
}
const unknown={...passive,timingKind:'unknown' as const,effects:[],effectBranch:null};
assert.equal(showTelemetrySkill(unknown,null),true,'Missing definitions must not hide unknown skills');
const passiveReference={metadata:{skills:{[unknown.skillId]:{branches:[{rawDuration:-1,effects:[{type:1,rawValue:400000,valueUsage:1,levelUsage:0}]}]}}}} as any;
assert.equal(showTelemetrySkill(unknown,passiveReference),false,'Reference passives are hidden when capture timing is unknown');
passiveReference.metadata.skills[unknown.skillId].branches[0].effects.push({type:10,rawValue:9000,valueUsage:1,levelUsage:0});
assert.equal(showTelemetrySkill(unknown,passiveReference),true,'Mixed passive/start-delay skills retain their marker');
assert.equal(laterGlobalStatuses.has('extra-pace-up'),false,'Pace up EX is available in the current Global engine');
const powerEvents=[event('skill-activated',8,{},'asitame'),event('effect-applied',8,{type:31,modifier:.12,duration:1.7},'asitame'),event('effect-ended',9.73,{},'asitame')];
const power=powerSummary(powerEvents,{finalStatus:'supported',finalGauge:20,timeline:[{kind:'clockStarted',t:.1},{kind:'gainBlocked',t:2},{kind:'cooldownStarted',t:3,nextGainAt:5.5},{kind:'accumulationCutoff',t:6},{kind:'release',t:8,gauge:20,usedLegacyFallback:false,distance:1300}]},10);
assert.deepEqual(power.intervals.filter(i=>i.kind==='conserve-power').map(i=>[i.start,i.end]),[[.1,2],[4.5,6]]);
assert.equal(power.releases[0].end,9.73);assert.equal(power.releases[0].acceleration,.12);assert.equal(power.releases[0].gauge,20);
assert.equal(powerSummary([],undefined,10).accumulationSeconds,null,'Absent ledger is not an invented zero');
assert.deepEqual([...defaultHiddenStatuses()],['last-spurt','force-in','conserve-power']);
assert.deepEqual(decodeHiddenStatuses(null),defaultHiddenStatuses());
assert.deepEqual(decodeHiddenStatuses('broken'),defaultHiddenStatuses());
assert.deepEqual([...decodeHiddenStatuses('[]')],[],'Explicitly showing all statuses survives reload');
assert.deepEqual([...decodeHiddenStatuses('["traffic","unknown"]')],['traffic'],'Only recognized hidden statuses are restored');
const laneBursts=[{start:10,end:10.1},{start:10.2,end:10.3},{start:14,end:14.1}].map(b=>({...b,kind:'lane-bonus',label:'Lane',skillId:200492,evidence:'simulated' as const,detail:'Lane bonus',model:{speedDelta:.49}}));
const laneOriginal=structuredClone(laneBursts),groups=groupTelemetryStatuses(laneBursts);
assert.equal(groups.length,2,'Brief on/off flicker uses one chart band; long inactive gaps stay separate');
assert.deepEqual(groups[0].bursts!.map(b=>[b.start,b.end]),[[10,10.1],[10.2,10.3]],'Every inactive gap remains available to rendering and hover');
assert.deepEqual(laneBursts,laneOriginal,'Display grouping cannot change the analysis duration');
assert.equal(groupTelemetryStatuses([laneBursts[0],{...laneBursts[1],skillId:123}]).length,2,'Different skills cannot be merged');
assert.equal(groupTelemetryStatuses([laneBursts[0],{...laneBursts[1],model:{speedDelta:.5}}]).length,2,'A changed bonus is a separate band');
assert.ok(replayCards({race:result.race,analysis:result.analysis} as any,'r0',1.5,result.race.frames[1].runners[0]).some(c=>c.label==='Last spurt'),'Telemetry defaults never hide the replay spurt');
for(const kind of telemetryStatusKinds){if(kind==='traffic')continue;assert.ok(statusLegend.some(i=>i.kind===kind),`Missing legend: ${kind}`);assert.notEqual(statusHelp(kind),'Time spent in this status.');}
const mechanics=runnerMechanics({...original,distance:2000},{...runners[0],strategyCode:1,aptitudes:{middle:'A',turf:'A'}}, {surface:1} as any,detail.statBreakdown);
assert.equal(mechanics.speed[0].value,20);assert.equal(mechanics.speed[1].value,20);assert.equal(mechanics.speed[2].value,19.6);
const speedTerm=Math.sqrt(500*1234)*.002;
assert.ok(Math.abs(mechanics.speed[4].value!-((20*.962+speedTerm+.2)*1.05+speedTerm+(450*673)**.597*.0001))<1e-10);
const withWit={...runners[0],stats:{wisdom:1307},mood:5} as typeof runners[0];
const initialFacts=runnerMechanics(original,withWit,null,detail.statBreakdown);
const skillWit=initialFacts.other.find(f=>f.label==='Skill-check Wit')!.value!;
assert.ok(Math.abs(skillWit-1303.64)<.001,'Half the points over 1200, then apply mood before green skills');
assert.ok(Math.abs(initialFacts.other.find(f=>f.label==='Skill activation chance')!.value!-(100-9000/skillWit))<1e-8);
assert.equal(runnerMechanics(original,withWit,null,detail.statBreakdown,93.1).other.find(f=>f.label==='Skill activation chance')!.value,93.1,'Prefer the executed threshold when available');
assert.equal(runnerMechanics(original,runners[0],null,detail.statBreakdown).other.find(f=>f.label==='Skill activation chance')!.value,null,'Missing initial inputs must not be replaced by final race Wit');
assert.equal(runnerMechanics(original,{...withWit,stats:{wisdom:1}} as typeof withWit,null,detail.statBreakdown).other.find(f=>f.label==='Skill activation chance')!.value,20);
assert.equal(detail.skillRows[0].simulation?.wit[0].data.roll,4,'Keep the exact roll in the underlying trace');
for(const mutate of [(r:any)=>r.mode='recorded_only',(r:any)=>r.simulation.status='mismatch',(r:any)=>r.simulation.modeled.decisionTrace.complete=false]){
  const changed=structuredClone(report);mutate(changed);assert.equal(projectSimulation(original,changed,null),null);
}
// Optional private, end-to-end payload from the production HTTP gate. No capture
// or runner information is printed or committed.
if(process.argv[2]&&process.argv[3]){
  const full=JSON.parse(readFileSync(process.argv[2],'utf8')),capture=parseRaceJson(JSON.parse(readFileSync(process.argv[3],'utf8')))[0];
  const p=projectSimulation(capture,full,null)!;assert.ok(p);
  const t=full.simulation.modeled.decisionTrace;
  for(const r of p.race.runners){
    assert.equal(r.finishOrder,capture.runners.find(x=>x.id===r.id)?.finishOrder,'Convert zero-based engine order to the one-based UI');
    assert.equal(p.analysis.runners[r.id].skillActivations.length,t.events.filter((e:any)=>e.horseIndex===r.index&&e.kind==='skill-activated'&&/^\d+$/.test(e.skillId)).length);
    assert.ok(p.analysis.runners[r.id].statBreakdown.stats.speed.final!==null);
    assert.equal(p.runners[r.id].motion.samples[0].targetActive?.mid,t.motion.find((v:number[])=>v[m.horse]===r.index)[m.target]);
  }
}
// Deferred HTTP replies exercise the entire busy lifecycle, including the
// parsed-but-not-analyzed window that previously flashed the replay page.
const savedFetch=globalThis.fetch;
type RequestReply={url:string;reply:(value:unknown,status?:number)=>void};
const requests:RequestReply[]=[];
globalThis.fetch=async input=>new Promise<Response>(resolve=>requests.push({url:String(input),reply:(value,status=200)=>resolve(new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}}))}));
const nextRequest=async()=>{
  const until=Date.now()+5000;
  while(!requests.length){assert.ok(Date.now()<until,'Expected client request');await new Promise(resolve=>setTimeout(resolve,5));}
  return requests.shift()!;
};
const states:AnalysisState[]=[],readyIds:string[]=[],parsedIds:string[]=[],errors:string[]=[];
const client=new AnalysisClient({status:async()=>({entries:[],bytes:0,policy:{mode:'unlimited',value:1000,background:false}})} as unknown as AnalysisStore,{
  parsed:(_,id)=>parsedIds.push(id),base:()=>assert.fail('No inference'),ready:(_,id)=>readyIds.push(id),state:s=>states.push(s),
  cache:()=>{},error:e=>errors.push(e),token:()=> 'synthetic-token',
});
const entry=(id:string)=>({id,remoteId:id,title:'synthetic',receivedAt:'2000-01-01T00:00:00Z'});
const stored={data:toPortableRace(original),sha256:'a'.repeat(64)};
const job=(r:any,phase='complete')=>({jobId:'synthetic-job',phase,report:r});
const busy=()=>states.at(-1)?.busy;
try{
  let opening=client.open(entry('first'));
  assert.equal(busy(),true);
  (await nextRequest()).reply(stored);
  const submit=await nextRequest();assert.equal(parsedIds.at(-1),'first');assert.equal(busy(),true);
  submit.reply(job(null,'queued'));
  const poll=await nextRequest();assert.equal(busy(),true);poll.reply(job(report));
  const details=await nextRequest();assert.match(details.url,/include=payloads/);assert.equal(busy(),true);
  assert.equal(readyIds.length,0);details.reply(job(report));await opening;
  assert.equal(busy(),false);assert.deepEqual(readyIds,['first']);
  opening=client.open(entry('first'));(await nextRequest()).reply(stored);
  (await nextRequest()).reply(job(report));await opening;
  assert.deepEqual(readyIds,['first','first']);assert.equal(requests.length,0,'Fresh gate reuses prepared dashboard without transferring the trace or starting a worker');
  opening=client.open(entry('first'));(await nextRequest()).reply({...stored,sha256:'b'.repeat(64)});
  (await nextRequest()).reply(job(report));
  const changed=await nextRequest();assert.match(changed.url,/include=payloads/);changed.reply(job(report));await opening;
  // Terminal fallback and failure must never leave a permanent skeleton.
  for(const mode of ['recorded_only','simulation_mismatch']){
    opening=client.open(entry(mode));(await nextRequest()).reply(stored);
    (await nextRequest()).reply(job({...report,mode}));await opening;assert.equal(busy(),false);
  }
  opening=client.open(entry('failed'));(await nextRequest()).reply({error:'synthetic transport failure'},500);
  await opening;assert.equal(busy(),false);assert.equal(errors.length,1);
  // A late response for the prior race cannot clear the current race's loader.
  const old=client.open(entry('old'));(await nextRequest()).reply(stored);const oldSubmit=await nextRequest();
  opening=client.open(entry('new'));(await nextRequest()).reply(stored);const newSubmit=await nextRequest();
  oldSubmit.reply(job({...report,mode:'recorded_only'}));await old;assert.equal(busy(),true);
  newSubmit.reply(job({...report,mode:'recorded_only'}));await opening;assert.equal(busy(),false);
  await client.open({id:'local',title:'local',receivedAt:'',race:original});assert.equal(busy(),false);
}finally{client.dispose();globalThis.fetch=savedFetch;}
console.log('Simulator projection: original capture preserved; engine frames, stats, states, skills, rolls and clamp stages reach the existing UI; mismatches stay gated; loading remains visible until completion and clears on fallback, error and race changes.');

const {packDashboard,restoreDashboard}=await import('../src/analysis/dashboard-codec');
const roundTrip=restoreDashboard(JSON.parse(JSON.stringify(packDashboard(structuredClone(result)))));
assert.deepEqual(roundTrip.runners.r0.motion.samples,JSON.parse(JSON.stringify(result.runners.r0.motion.samples)),'Compact snapshots retain exact simulator motion and missing values.');
assert.deepEqual(roundTrip.analysis.runners.r0.samples,JSON.parse(JSON.stringify(result.analysis.runners.r0.samples)));
assert.deepEqual(roundTrip.runners.r0.speedChanges,result.runners.r0.speedChanges,'Compact explanations must retain every label, number and boundary.');
const special=structuredClone(result);
special.runners.r0.speedChanges=[{start:1,end:2,from:0,to:1,reasons:[{label:'技能 +1.000 / -0.00 · \u0001n 12',evidence:'simulated',start:1.2,end:1.8,detail:'tick 01 +0.0000; -2.50; 1e-9 · \u0001e'}]}];
const lazy=restoreDashboard(JSON.parse(JSON.stringify(packDashboard(structuredClone(special)))),true);
assert.equal(typeof Object.getOwnPropertyDescriptor(lazy.runners.r0.motion,'samples')?.get,'function','Unselected telemetry remains compact until requested.');
assert.deepEqual(lazy.runners.r0.speedChanges,special.runners.r0.speedChanges);
assert.deepEqual(lazy.runners.r0.motion.samples,special.runners.r0.motion.samples);
