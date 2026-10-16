/** Whole replay -> worker -> compressed disk file -> fresh worker -> UI caches. */
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { assembleReferenceData } from '../src/data/reference';
import { readGeometry } from '../src/data/geometry';
import { analyzeRace, rememberAnalysis } from '../src/data/analytics';
import { parseRaceJson } from '../src/data/import';
import { motionFor } from '../src/data/motion-analysis';
import { modeImpactsFor } from '../src/data/status-mode-impact';
import { skillTotals } from '../src/data/skill-totals';
import { metricsForSkill } from '../src/data/skill-metrics';
import { motionSkillImpact } from '../src/data/motion-skill-impact';
import { attachPrepared, type PreparedRace } from '../src/analysis/prepared';
import { decompressAnalysis } from '../src/analysis/codec';
import { resolveAnalysisRace } from '../src/analysis/prepare';
import { normalizeTags, withinDateRange } from '../src/library-filters';
import { AnalysisClient } from '../src/analysis/client';
import {explainSpeedChanges} from '../src/data/speed-changes';
import { AnalysisStore, defaultCachePolicy, type CacheEntry, type CacheStatus } from '../src/analysis/store';
import type { LibraryEntry } from '../src/library';
const folder=process.argv[2],root=join(import.meta.dirname,'..');
const json=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const input=await json(join(folder,(await readdir(folder)).find(n=>n.endsWith('.json'))!));
const reference=assembleReferenceData(await json(join(root,'public/data/metadata.json')),await json(join(root,'public/data/courses.json')),await json(join(root,'public/data/reference-source.json')),await json(join(root,'public/data/simulator-skill-ids.json')),readGeometry(await json(join(root,'public/data/course-geometry.json'))));
const race=resolveAnalysisRace(parseRaceJson(input)[0],reference),direct=analyzeRace(race,reference);
async function job(payload:object,background=false){
  const worker=new Worker(new URL('./analysis-worker-host.mjs',import.meta.url));let parsed=0,base=0,progress=0,ticks=0;
  const timer=setInterval(()=>ticks++,5),start=performance.now();
  try{return await new Promise<{value:PreparedRace;packed?:Uint8Array;parsed:number;base:number;progress:number;ms:number;ticks:number}>((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Analysis worker timed out')),45000);
    worker.on('error',reject);worker.on('message',message=>{
      if(message.type==='parsed')parsed++;
      if(message.type==='base')base++;
      if(message.type==='progress')progress++;
      if(message.type==='error'||message.type==='corrupt'){clearTimeout(timeout);reject(new Error(JSON.stringify(message)));}
      if(message.type==='complete'){clearTimeout(timeout);resolve({...message,parsed,base,progress,ms:performance.now()-start,ticks});}
    });
    if(!('cached' in payload))worker.postMessage({type:'reference',reference});worker.postMessage({type:'priority',foreground:!background,paused:background});
    worker.postMessage({type:'run',foreground:!background,...payload});
    if(background)setTimeout(()=>worker.postMessage({type:'priority',foreground:true,paused:false}),100);
  });}finally{clearInterval(timer);await worker.terminate();}
}
const built=await job({data:input},true);
assert.equal(built.parsed,1);assert.equal(built.base,1);assert.equal(built.progress,race.runners.length);assert.ok(built.ticks>5,'The main thread remains responsive while the worker runs.');
assert.deepEqual(built.value.analysis,direct,'Yielding must not change analysis.');
for(const runner of race.runners){const output=built.value.runners[runner.id];
  assert.deepEqual(output.motion,motionFor(race,reference,direct,runner.id));
  assert.deepEqual(output.inferredMotion,motionFor(race,reference,direct,runner.id,undefined,undefined,true));
  assert.deepEqual(output.modes,modeImpactsFor(race,reference,direct,runner.id));
  assert.deepEqual(output.totals,skillTotals(race,reference,direct,runner.id));
  assert.deepEqual(output.speedChanges,explainSpeedChanges(race,reference,direct,runner,output.inferredMotion));
}
const path=join(folder,'analysis.gz');await writeFile(path,built.packed!);
const restored=await job({cached:new Uint8Array(await readFile(path))});
assert.equal(restored.parsed+restored.base+restored.progress,0,'A cache hit must not recalculate the race.');
// JSON serialization preserves all display values; absent optional fields are
// equivalent to undefined. Non-finite numbers must never silently become zero.
function comparable(value:any):any {
  if(Array.isArray(value))return value.map(item=>item===undefined?null:comparable(item));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).map(([key,item])=>[key,comparable(item)]));
  return value;
}
assert.deepEqual(comparable(restored.value),comparable(built.value));
const saved=restored.value;attachPrepared(saved);rememberAnalysis(saved.race,reference,saved.analysis);
assert.equal(analyzeRace(saved.race,reference),saved.analysis);
for(const runner of saved.race.runners){const output=saved.runners[runner.id];
  assert.equal(motionFor(saved.race,reference,saved.analysis,runner.id),output.motion);
  assert.equal(skillTotals(saved.race,reference,saved.analysis,runner.id),output.totals);
  assert.equal(modeImpactsFor(saved.race,reference,saved.analysis,runner.id),output.modes);
  for(const row of saved.analysis.runners[runner.id].skillRows){
    assert.equal(metricsForSkill(saved.race,reference,saved.analysis,runner.id,row.skillId),output.metrics[row.skillId]);
    assert.equal(motionSkillImpact(saved.race,reference,saved.analysis,runner.id,row.skillId),output.impacts[row.skillId]);
  }
}
await assert.rejects(decompressAnalysis(new Uint8Array([1,2,3])));
assert.deepEqual(normalizeTags('Finals, finals, Wet,  Wet  '),['Finals','Wet']);
assert.equal(withinDateRange('2026-10-14T12:00:00Z','2026-10-14','2026-10-14'),true);
assert.equal(withinDateRange('2026-10-13T12:00:00Z','2026-10-14',''),false);
// Drive the application scheduler with the real worker. Only browser storage
// is replaced by temporary disk files; desktop retention has its own HTTP test.
class DiskStore {
  value:CacheStatus={policy:defaultCachePolicy(),entries:[],bytes:0};
  async status(){return structuredClone(this.value);}
  async get(key:string){try{return new Uint8Array(await readFile(join(folder,key+'.gz')));}catch{return null;}}
  async change(body:Record<string,unknown>){
    if(body.action==='revision')this.value.entries=this.value.entries.filter(e=>e.revision===body.revision);
    if(body.action==='purge')this.value.entries=[];
    if(body.action==='remove')this.value.entries=this.value.entries.filter(e=>e.key!==body.key);
    if(body.action==='policy')this.value.policy=body.policy as CacheStatus['policy'];
    this.value.bytes=this.value.entries.reduce((sum,e)=>sum+e.bytes,0);return this.status();
  }
  async put(entry:Omit<CacheEntry,'bytes'>,payload:Uint8Array){await writeFile(join(folder,entry.key+'.gz'),payload);this.value.entries=this.value.entries.filter(e=>e.raceId!==entry.raceId);this.value.entries.push({...entry,bytes:payload.length});return this.change({});}
}
const workers:BrowserWorker[]=[];
class BrowserWorker {
  raw=new Worker(new URL('./analysis-worker-host.mjs',import.meta.url));
  onmessage:((event:{data:any})=>void)|null=null;onerror:(()=>void)|null=null;
  messages:any[]=[];sent:any[]=[];terminated=false;
  constructor(){workers.push(this);this.raw.on('message',data=>{this.messages.push(data);this.onmessage?.({data});});this.raw.on('error',()=>this.onerror?.());}
  postMessage(value:unknown){this.sent.push(value);this.raw.postMessage(value);}
  terminate(){this.terminated=true;void this.raw.terminate();}
}
Object.assign(globalThis,{Worker:BrowserWorker,__ANALYSIS_REVISION__:'functional-workflow'});
const store=new DiskStore(),errors:string[]=[],ready:string[]=[];
const makeClient=()=>new AnalysisClient(store as unknown as AnalysisStore,{parsed:()=>{},base:()=>{},ready:(_value,id)=>ready.push(id),state:()=>{},cache:()=>{},error:e=>errors.push(e)});
const entry=(id:string,date:string):LibraryEntry=>({id,receivedAt:date,title:id,race:parseRaceJson(input)[0]});
const newest=entry('newest','2026-10-16T12:00:00Z'),older=entry('older','2026-10-15T12:00:00Z'),selected=entry('selected','2026-10-14T12:00:00Z');
const until=async(check:()=>boolean)=>{const deadline=Date.now()+30000;while(!check()){assert.deepEqual(errors,[]);if(Date.now()>deadline)throw new Error('Client workflow timed out');await new Promise(r=>setTimeout(r,10));}};
const client=makeClient();let memoryMs=0,clientRestoreMs=0;
try{
  await client.configure(reference);client.setLibrary([older,newest],{});
  await until(()=>workers.length===1&&workers[0].messages.some(m=>m.type==='parsed'));
  await client.open(newest);await until(()=>store.value.entries.some(e=>e.raceId===newest.id));
  assert.equal(workers.length,1,'Selecting the warming race promotes the existing worker.');
  assert.ok(ready.includes(newest.id),'The newest race warms first.');
  await client.policy({...defaultCachePolicy(),background:false});
  const memoryStart=performance.now();await client.open(newest);memoryMs=performance.now()-memoryStart;assert.equal(workers.length,1,'Memory restore does not start a worker.');
  await client.open(older);await until(()=>workers.length===2);
  const before=ready.length;await client.open(selected);await until(()=>store.value.entries.some(e=>e.raceId===selected.id));
  assert.ok(workers[1].terminated,'Foreground selection stops the previous job.');
  assert.ok(ready.slice(before).every(id=>id===selected.id),'Old workers cannot overwrite the selected race.');
}finally{client.dispose();}
const reopened=makeClient();
try{
  await reopened.configure(reference);const count=workers.length;
  const restoreStart=performance.now();await reopened.open(selected);await until(()=>workers[count]?.messages.some(m=>m.type==='complete'));clientRestoreMs=performance.now()-restoreStart;
  assert.ok(!workers[count].sent.some(m=>m.type==='reference'),'A cache hit restores without cloning reference data.');
  const restoreRequest=workers[count].sent.find(m=>m.type==='run');assert.ok(restoreRequest.cached&&!('data' in restoreRequest),'A cache hit sends only packed analysis, not the raw replay.');
  assert.ok(!workers[count].messages.some(m=>['parsed','base','progress'].includes(m.type)),'A fresh client restores saved calculations.');
  const changed=structuredClone(reference);changed.courses[Object.keys(changed.courses)[0]].name+=' revision';
  await reopened.configure(changed);assert.equal(store.value.entries.length,0,'Reference updates invalidate saved analysis.');
  await reopened.purge();assert.equal(store.value.policy.background,false,'Clearing cache does not immediately refill it.');
}finally{reopened.dispose();for(const worker of workers)await worker.raw.terminate();}
assert.deepEqual(errors,[]);
console.log(JSON.stringify({calculationEquality:'passed',diskRestore:'passed',noRecalculation:'passed',promotion:'passed',preemption:'passed',invalidation:'passed',filters:'passed',coldMs:Math.round(built.ms),restoreMs:Math.round(restored.ms),memoryMs:Math.round(memoryMs),clientRestoreMs:Math.round(clientRestoreMs),compressedBytes:built.packed!.length}));
