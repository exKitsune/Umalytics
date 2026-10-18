import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { projectSimulation } from '../src/simulation/project';
import { attachPrepared } from '../src/analysis/prepared';
import { motionFor } from '../src/data/motion-analysis';
import { metricsForSkill } from '../src/data/skill-metrics';
import { sampleAt } from '../src/data/sample';
import { hpTimeline, hpSampledBridges } from '../src/data/hp-timeline';
import { replayCards } from '../src/replay/cards';
import { parseRaceJson } from '../src/data/import';
import { motionIndex as m, TRACE_SCHEMA, type DecisionEvent } from '../src/simulation/trace';
import type { Race } from '../src/data/types';

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
assert.equal(detail.intervals.find(s=>s.kind==='front-block')?.start,.2);
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
assert.equal(ready.totals.score,null,'Unavailable counterfactual effectiveness is not zero');
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
console.log('Simulator projection: original capture preserved; engine frames, stats, states, skills, rolls and clamp stages reach the existing UI; mismatches stay gated; no inference fallback.');
