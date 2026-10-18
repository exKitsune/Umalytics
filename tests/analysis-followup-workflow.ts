import assert from 'node:assert/strict';
import {BackgroundQueue} from '../src/analysis/background';
import {simulationConditions,simulationRestriction} from '../src/simulation/conditions';
import type {DecisionEvent} from '../src/simulation/trace';
import type {LibraryEntry} from '../src/library';
import {readHiddenStatuses,saveHiddenStatuses} from '../src/data/telemetry-statuses';
import {AnalysisClient} from '../src/analysis/client';
import {AnalysisStore} from '../src/analysis/store';
import {readFileSync} from 'node:fs';

let sequence=0;
const e=(kind:string,tick:number,passed:boolean,stage='activation'):DecisionEvent=>({kind,tick,lastTick:tick,time:tick/10,lastTime:tick/10,sequence:++sequence,lastSequence:sequence,count:1,stage,skillId:'123',horseIndex:0,detail:0,data:{passed}});
const definition=(condition:string,precondition='')=>({...e('skill-definition',0,true),data:{condition,precondition}});
const checks=[definition('phase==2&order<=3&hp_per>=30'),e('phase==2',10,false),e('condition',10,false),e('phase==2',20,true),e('order<=3',20,false),e('condition',20,false),e('phase==2',30,false),e('condition',30,false)];
let result=simulationConditions(checks)!;
assert.deepEqual(result.branches[0].predicates.map(p=>p.state),['met','unmet','unknown']);
assert.equal(result.branches[0].predicates[1].time,2,'Show the closest conjunction, not the final phase failure');
assert.match(result.branches[0].detail,/Position.*3/);
assert.equal(result.state,'unmet');
assert.equal(simulationRestriction(checks,result).label,'Conditions unmet');
const latched=[definition('phase==2','order==1'),e('order==1',10,true,'precondition'),e('precondition-latched',10,true),e('precondition-ready',20,true),e('phase==2',20,true),e('condition',20,true),e('activation-ready',20,true)];
result=simulationConditions(latched)!;
assert.deepEqual(result.branches[0].predicates.map(p=>p.state),['met','met'],'Latched prerequisites use their earlier successful check');
const conjunction=[definition('order==1&hp_per>=30'),e('order==1',10,true),e('hp_per>=30',10,false),e('condition',10,false),e('order==1',20,false),e('condition',20,false)];
assert.equal(simulationConditions(conjunction)!.state,'unmet','Checks from different ticks must not invent a successful opportunity');
const cooling=[definition('always==1'),e('condition',20,true),e('cooldown-ready',20,false),e('activation-ready',20,false)];
result=simulationConditions(cooling)!;assert.equal(result.state,'met');assert.equal(result.eligibilityState,'ineligible');
assert.equal(simulationRestriction(cooling,result).label,'On cooldown');
const noTarget=[definition('always==1'),e('condition',20,true),e('target-available',20,false),e('activation-ready',20,false)];
assert.equal(simulationRestriction(noTarget,simulationConditions(noTarget)).label,'No eligible target');
const prereq=[definition('phase==2','order==1'),e('order==1',10,false,'precondition'),e('precondition-latched',10,false),e('precondition-ready',10,false)];
result=simulationConditions(prereq)!;assert.equal(result.branches[0].predicates[0].state,'unmet');
assert.equal(simulationRestriction(prereq,result).label,'Prerequisite unmet');
const staticFail=[definition('distance_type==3&order<=3'),{...e('static-condition',0,false,'build-condition'),data:{predicate:'distance_type',operator:'==',argument:3,dynamic:false,windows:[]}},e('trigger-window',10,false)];
result=simulationConditions(staticFail)!;assert.equal(result.state,'unmet');assert.equal(result.branches[0].predicates[0].state,'unmet');assert.equal(result.branches[0].predicates[1].state,'unknown');
assert.match(simulationRestriction(staticFail,result).detail,/Medium/);
const startup=[definition('track_id==10005'),{...e('static-condition',0,true,'build-condition'),data:{predicate:'track_id',operator:'==',argument:10005,dynamic:false,windows:[[0,2500]]}},e('condition',0,true),e('activation-ready',0,true),{...e('skill-activated',0,true),data:{position:0}}];
assert.equal(simulationConditions(startup,[])!.branches[0].predicates[0].state,'met','The activation position proves a startup passive before movement samples exist');
const wit=[{...e('skill-wit',0,false),data:{checked:true,passed:false}}];assert.equal(simulationRestriction(wit,null).label,'Wit check failed');
assert.equal(simulationRestriction([definition('order==1')],null).label,'Check unavailable','Missing evidence cannot be invented as a failed condition or roll');

const entries:LibraryEntry[]=[1,3,2].map(n=>({id:`race${n}`,remoteId:`race${n}`,title:'Synthetic',receivedAt:`2026-10-0${4-n}`,racedAt:`2026-10-0${n}`,sha256:String(n)}));
const until=async(predicate:()=>boolean)=>{for(let i=0;i<200&&!predicate();i++)await new Promise(r=>setTimeout(r,5));assert.ok(predicate(),'Timed out waiting for the queue');};
const starts:string[]=[],completed:string[]=[];
let release:(()=>void)|null=null;
const queue=new BackgroundQueue(async(entry,signal)=>{
  starts.push(entry.id);
  await new Promise<void>(resolve=>{release=resolve;signal.addEventListener('abort',()=>resolve(),{once:true});});
  if(!signal.aborted)completed.push(entry.id);
},()=>{},5);
queue.setLibrary(entries);queue.configure({mode:'unlimited',value:1000,background:true});
await until(()=>starts.length===1);assert.equal(starts[0],'race3','Actual race date takes precedence over capture/import order');
queue.pause(true);await new Promise(r=>setTimeout(r,20));assert.deepEqual(completed,[],'Foreground opening aborts background work');
queue.mark(entries.find(e=>e.id==='race3')!);queue.pause(false);
await until(()=>starts.length===2);assert.equal(starts[1],'race2');release!();
await until(()=>starts.length===3);assert.equal(starts[2],'race1');release!();
await until(()=>completed.length===2);await new Promise(r=>setTimeout(r,20));assert.equal(starts.length,3,'Completed races are not repeatedly analyzed');
queue.dispose();
const bounded:string[]=[];const limited=new BackgroundQueue(async entry=>{bounded.push(entry.id);},()=>{},1);
limited.setLibrary(entries);limited.configure({mode:'races',value:1,background:true});await until(()=>bounded.length===1);await new Promise(r=>setTimeout(r,20));assert.deepEqual(bounded,['race3'],'Bounded caches do not churn through older races');limited.dispose();
const full:string[]=[];const capped=new BackgroundQueue(async entry=>{full.push(entry.id);},()=>{},1);capped.setLibrary(entries);capped.configure({mode:'size',value:1,background:true},1024*1024);await new Promise(r=>setTimeout(r,20));assert.deepEqual(full,[]);capped.dispose();

const storage=new Map([['umalytics.telemetry-hidden-statuses.v1','["dueling"]']]);
(globalThis as any).localStorage={getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)};
assert.deepEqual([...readHiddenStatuses()],['dueling','conserve-power'],'Migration preserves existing choices and adds the new default');
saveHiddenStatuses(new Set(['dueling']));assert.deepEqual([...readHiddenStatuses()],['dueling'],'Explicitly enabling conserve power persists');
delete (globalThis as any).localStorage;
// Exercise the actual client wiring: background reads must pass the same service
// gate, keep foreground callbacks untouched, and retain the saved preference.
const previousFetch=globalThis.fetch,submissions:string[]=[],shown:string[]=[];
const portable=JSON.parse(readFileSync(new URL('./fixtures/race.json',import.meta.url),'utf8'));
let progress=false;
const fakeStore=new AnalysisStore(()=>false,()=>undefined);
fakeStore.status=async()=>({policy:{mode:'unlimited',value:1000,background:true},entries:[],bytes:0});
globalThis.fetch=async(url,options)=>{
  const path=String(url);
  if(path.includes('/simulation/')){if(options?.method==='POST')submissions.push(path.split('/').at(-1)!);return new Response(JSON.stringify({phase:'complete',jobId:'test',report:{mode:'recorded_only'}}),{headers:{'content-type':'application/json'}});}
  return new Response(JSON.stringify({data:portable,sha256:'a'.repeat(64)}),{headers:{'content-type':'application/json'}});
};
const client=new AnalysisClient(fakeStore,{parsed:(_,id)=>shown.push(id),base:()=>{},ready:()=>{},state:s=>{if(s.background)progress=true;},cache:()=>{},error:message=>{throw new Error(message);},token:()=> 'synthetic'});
try{
  await client.configure({} as any);client.setLibrary([entries[0]],{});await client.refresh();
  await until(()=>submissions.length===1);assert.deepEqual(shown,[]);assert.equal(progress,true);
  await client.open(entries[0]);assert.deepEqual(shown,['race1']);assert.equal((await fakeStore.status()).policy.background,true);
}finally{client.dispose();globalThis.fetch=previousFetch;}
console.log('Analysis follow-up: condition blockers, latched prerequisites, skipped predicates, cooldown, static exclusions, unknown evidence, newest-first background priority, cancellation, limits and status preferences passed.');

// The ordinary dashboard remains available without authorizing any mechanics.
const {recordedDashboard}=await import('../src/analysis/recorded');
const {parseRaceJson}=await import('../src/data/import');
const {packDashboard,restoreDashboard}=await import('../src/analysis/dashboard-codec');
const observations=recordedDashboard(parseRaceJson(JSON.parse(readFileSync(new URL('./fixtures/race.json',import.meta.url),'utf8')))[0]);
assert.equal(observations.analysis.source,'recorded');
for(const runner of Object.values(observations.runners)){assert.equal(runner.spurt.target,null);assert.equal(runner.totals.benefit,null);assert.deepEqual(runner.motion.samples,[]);}
for(const runner of Object.values(observations.analysis.runners)){assert.equal(runner.statBreakdown.stats.speed.final,null);assert.ok(runner.samples.length);assert.equal(runner.summary.blockedDuration,null);assert.equal(runner.summary.finishTime!==null,true);}
const before=JSON.stringify(observations),after=restoreDashboard(JSON.parse(JSON.stringify(packDashboard(observations))));
assert.equal(JSON.stringify(after),before,'Dashboard codec preserves observations and missing mechanics.');
