import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {gzip,ungzip} from 'pako';
import {loadReference} from '../scripts/offline-analysis';
import {projectSimulation} from '../src/simulation/project';
import {enrichSimulation} from '../src/simulation/enrich';
import {createTraceMotionEngine} from '../src/simulation/replay-motion';
import {packDerived,restoreDerived} from '../src/simulation/derived-cache';
import {motionIndex as m,TRACE_SCHEMA,type DecisionEvent} from '../src/simulation/trace';
import {activationMotionKey} from '../src/data/race-motion';
import {measureMotionBenefit} from '../src/data/motion-benefit';
import type {Race} from '../src/data/types';

const report=JSON.parse(execFileSync('python',['tests/globalsim/export_contract_fixtures.py'],{encoding:'utf8',windowsHide:true})).trial;
const reference=await loadReference();
const id=840001;
reference.metadata.skills[id]={name:'Synthetic direct speed',rarity:1,activateLot:0,branches:[{branchIndex:0,condition:'always==1',rawDuration:20000,durationUsage:1,effects:[{type:21,rawValue:10000,valueUsage:1,levelUsage:1,targetType:1}]}]} as any;
const runner={id:'r0',index:0,gate:1,name:'Synthetic runner',charaId:null,cardId:null,trainer:null,strategy:'Pace Chaser',strategyCode:2,finishTime:4,finishTimeRaw:4,finishOrder:1,stats:{speed:800,stamina:800,power:800,guts:800,wisdom:800},skills:[{id,level:1}]};
const race:Race={id:'test',title:'Synthetic fixed replay',source:'normalized',sourceLabel:'test',distance:2500,duration:4,courseId:10506,runners:[runner],frames:[],events:[],warnings:[],synthetic:true};
let sequence=0;
const event=(kind:string,time:number,data:DecisionEvent['data'],skillId=String(id),horseIndex=0):DecisionEvent=>({kind,time,lastTime:time,tick:Math.round(time*10),lastTick:Math.round(time*10),sequence:++sequence,lastSequence:sequence,count:1,stage:'activation',skillId,horseIndex,detail:0,data});
const events=[event('initial-stats',0,{speed:800,stamina:800,power:800,guts:800,wisdom:800},''),event('skill-activated',1,{}),event('effect-evaluated',1,{type:21,ability:0,modifier:1,duration:2}),event('effect-applied',1,{type:21,ability:0,modifier:1,duration:2}),event('effect-ended',3,{}),
  event('spurt-input',3,{position:2000,hp:300,max_speed:24,base_speed:20,distance:2500,wisdom:800},''),
  ...[24,23,22].map(speed=>event('spurt-search',3,{speed,start:2000,feasible:true},'')),
  event('spurt-roll',3,{speed:24,start:2000,roll:80,threshold:40,passed:false},''),event('spurt-roll',3,{speed:23,start:2000,roll:20,threshold:40,passed:true},''),event('spurt-accepted',3,{speed:23,start:2000},'')];
const motion=Array.from({length:40},(_,i)=>{const r=Array(43).fill(0),time=i/10,speed=20+(time>=1&&time<3?1:0);Object.assign(r,{[m.horse]:0,[m.time]:time,[m.dt]:.1,[m.tick]:i,[m.hp]:400,[m.position]:500+time*20,[m.base]:20,[m.target]:20,[m.acceleration]:2,[m.minimum]:1,[m.cap]:30,[m.blocker]:-1,[m.unclamped]:20,[m.selfSpeed]:20,[m.skillSpeed]:speed,[m.speed]:speed,[m.phase]:1,[m.pace]:1});return r;});
report.simulation.capabilities.hiddenState='simulated_trace';
report.simulation.modeled={results:[{finishOrder:0,finishTime:4,finishTimeRaw:4,startDelayTime:0,actualLastSpurtStartDistance:-1}],frames:[...motion,motion.at(-1)!].map((r:number[],i:number)=>({t:i/10,horses:[{pos:i*2,speed:r[m.speed],hp:400,lane:0,temptationMode:0,blockFrontHorseIndex:-1}]})),skillEvents:[{horseIndex:0,skillId:id,t:1,duration:2}],decisionTrace:{schema:TRACE_SCHEMA,complete:true,dropped:0,events,motion,motionColumns:[]}};
const trace=report.simulation.modeled.decisionTrace;
const value=projectSimulation(race,report,reference)!;
const analysis={...value.analysis,source:undefined};
const engine=createTraceMotionEngine(value.race,reference,analysis,trace);
const activation=analysis.runners.r0.skillActivations[0],key=activationMotionKey('r0',activation);
const full=engine.build({runnerId:'r0'}).runners.r0;
assert.deepEqual(full.samples.slice(0,-1).map(s=>s.constrained!.mid),motion.map(r=>r[m.speed]),'No-removal path is exactly native, never inferred');
const without=engine.build({runnerId:'r0',excludeActivationKey:key}).runners.r0;
const benefit=measureMotionBenefit(full,without,[{start:1,end:3}]);
assert.ok(Math.abs(benefit.distance!.mid-2)<1e-8,'1 m/s for two seconds = 2 m');
assert.ok(Math.abs(benefit.time!.mid+.1)<1e-8,'2 m at 20 m/s = .1 s equivalent travel time');
assert.equal(benefit.coverage,1);
assert.ok(without.samples.every(s=>s.constrained!.mid===20));
assert.equal(engine.build({runnerId:'r0',excludeActivationKey:key}).runners.r0,without,'Repeated comparisons reuse indexed paths');
const blockedTrace=structuredClone(trace);
blockedTrace.motion.forEach((r:number[])=>{r[m.cap]=20;r[m.blocker]=1;r[m.finalLoss]=r[m.skillSpeed]-20;r[m.speed]=20;});
const blocked=createTraceMotionEngine(value.race,reference,analysis,blockedTrace);
const noGain=measureMotionBenefit(blocked.build().runners.r0,blocked.build({excludeActivationKey:key}).runners.r0,[{start:1,end:3}]);
assert.equal(noGain.distance!.mid,0,'Final cap removes the entire direct-speed gain');
assert.ok(Math.abs(noGain.blockedDistance!.mid-2)<1e-8);

// Both skills alone fill the cap. Individual marginal removals are zero, but
// jointly removing them loses 2 m: the total must be its own comparison.
const pairedAnalysis=structuredClone(analysis),pairedTrace=structuredClone(trace);
pairedAnalysis.runners.r0.skillActivations.push({...activation,skillId:id+1});
pairedTrace.motion.forEach((r:number[])=>{if(r[m.time]>=1&&r[m.time]<3){r[m.skillSpeed]=22;r[m.speed]=21;r[m.cap]=21;r[m.blocker]=1;r[m.finalLoss]=1;}});
const paired=createTraceMotionEngine(value.race,reference,pairedAnalysis,pairedTrace);
const pairedFull=paired.build().runners.r0;
assert.equal(measureMotionBenefit(pairedFull,paired.build({excludeActivationKey:key}).runners.r0,[{start:1,end:3}]).distance!.mid,0);
assert.ok(Math.abs(measureMotionBenefit(pairedFull,paired.build({excludeActivationKeys:[key,activationMotionKey('r0',{...activation,skillId:id+1})]}).runners.r0,[{start:1,end:3}]).distance!.mid-2)<1e-8);

// Natural-deceleration current speed transfers into self speed at expiry.
const naturalAnalysis=structuredClone(analysis),naturalTrace=structuredClone(trace);
naturalAnalysis.runners.r0.skillActivations[0].effects[0].type=22;
naturalTrace.motion.forEach((r:number[])=>{if(r[m.time]>=3){r[m.unclamped]=r[m.selfSpeed]=r[m.skillSpeed]=r[m.speed]=21-(r[m.time]-3)*.8;}});
const natural=createTraceMotionEngine(value.race,reference,naturalAnalysis,naturalTrace);
assert.ok(natural.build({excludeActivationKey:key}).runners.r0.samples.every(s=>Math.abs(s.constrained!.mid-20)<1e-8),'Removed type-22 cannot retain its expiry impulse');
assert.ok(measureMotionBenefit(natural.build().runners.r0,natural.build({excludeActivationKey:key}).runners.r0,[{start:1,end:3}]).distance!.mid>2,'Natural-deceleration carryover survives its timer');
const choice=value.runners.r0.spurt.decisions[0];
assert.deepEqual(choice.candidates.map(c=>Number(c.probability.toFixed(4))),[.4,.24,.36]);
assert.equal(choice.matched,1);assert.equal(choice.betterChance,.4);assert.equal(choice.rolls!.length,2);

await enrichSimulation(value,trace,reference);
assert.ok(Math.abs(value.runners.r0.impacts[id]!.distance!.mid-2)<1e-8);
assert.ok(Math.abs(value.analysis.runners.r0.skillImpacts[0].modeledDistanceDelta!-2)<1e-8);
assert.equal(value.runners.r0.totals.score,1);
const packed=packDerived(value,'authorized-synthetic-key'),restored=projectSimulation(race,report,reference)!;
assert.equal(restoreDerived(restored,'wrong-key',packed),false);
assert.equal(restoreDerived(restored,'authorized-synthetic-key',new Uint8Array([1,2])),false);
assert.equal(restoreDerived(restored,'authorized-synthetic-key',packed),true);
assert.deepEqual(restored.runners.r0.totals,value.runners.r0.totals);
assert.deepEqual(restored.analysis.runners.r0.skillImpacts,value.analysis.runners.r0.skillImpacts);
assert.deepEqual(restored.runners.r0.metrics,value.runners.r0.metrics);
const malicious=JSON.parse(ungzip(packed,{to:'string'}));
malicious.runners.r0.analysis.skillActivations=[];malicious.runners.r0.prepared.spurt={rolls:[]};malicious.runners.r0.motion.samples=[];malicious.runners.r0.breakdown.stats.speed.final=99999;
const safe=projectSimulation(race,report,reference)!;
assert.equal(restoreDerived(safe,'authorized-synthetic-key',gzip(JSON.stringify(malicious))),true);
assert.equal(safe.analysis.runners.r0.skillActivations.length,1);assert.equal(safe.analysis.runners.r0.statBreakdown.stats.speed.final,800);
assert.equal(safe.runners.r0.spurt.decisions[0].rolls!.length,2);assert.ok(safe.runners.r0.motion.samples.length>0);

// A selected target is not a delivered effect. Only a recipient effect-applied
// event inside the native immediate-delivery sequence qualifies.
const foreign=structuredClone(report),foreignRace=structuredClone(race);
foreignRace.runners.push({...runner,id:'r1',index:1,gate:2});
foreign.simulation.modeled.results.push({...foreign.simulation.modeled.results[0],finishOrder:1});
foreign.simulation.modeled.frames.forEach((f:any)=>f.horses.push({...f.horses[0]}));
foreign.simulation.modeled.decisionTrace.motion.push(...motion.map(r=>{const copy=[...r];copy[m.horse]=1;return copy;}));
sequence=0;
foreign.simulation.modeled.decisionTrace.events=[event('skill-activated',1,{}),event('effect-evaluated',1,{type:21,ability:0,modifier:-1,duration:2}),event('effect-applied',1,{type:21,ability:0,modifier:-1,duration:2},String(id),1),event('effect-queued',1,{ability:0,targets:[1]})];
reference.metadata.skills[id].branches[0].effects[0].targetType=2;
let recipient=projectSimulation(foreignRace,foreign,reference)!.analysis.runners.r0.skillActivations[0];
assert.deepEqual(recipient.targetRunnerIds,['r1']);assert.equal(recipient.simulatedRecipients!.r1[0].evaluatedValue,-1);
foreign.simulation.modeled.decisionTrace.events=foreign.simulation.modeled.decisionTrace.events.filter((e:DecisionEvent)=>e.kind!=='effect-applied');
recipient=projectSimulation(foreignRace,foreign,reference)!.analysis.runners.r0.skillActivations[0];
assert.deepEqual(recipient.targetRunnerIds,[],'An immune/unapplied selection earns no incoming hit');
console.log('Fixed replay math, blocked gain, spurt odds, dashboard wiring and derived cache passed');
