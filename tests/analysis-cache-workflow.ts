/** Actual versioned artifact -> real HTTP reauthorization -> prepared cache. */
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { parseRaceJson } from '../src/data/import';
import { AnalysisClient } from '../src/analysis/client';
import { AnalysisStore } from '../src/analysis/store';
import { analysisNotice, FUTURE_WARNING } from '../src/simulation/presentation';
import { normalizeTags, withinDateRange } from '../src/library-filters';

const folder=resolve(process.argv[2]),root=resolve(import.meta.dirname,'..');
const input=JSON.parse(await readFile(join(folder,(await readdir(folder)).find(n=>n.endsWith('.json'))!),'utf8'));
const installed=JSON.parse(await readFile(join(root,'simulation/installed-bundles.json'),'utf8'));
const bundle=installed.bundles.filter((b:any)=>b.kind==='inference').at(-1);
assert.ok(bundle,'Build the actual inference artifact before this workflow.');
await mkdir(join(folder,'simulation'),{recursive:true});
await mkdir(join(folder,'storage/races'),{recursive:true});
for(const field of ['artifact','data']){const destination=join(folder,bundle[field]);await mkdir(resolve(destination,'..'),{recursive:true});await copyFile(join(root,bundle[field]),destination);}
await writeFile(join(folder,'simulation/installed-bundles.json'),JSON.stringify({schemaVersion:1,bundles:[bundle]}));
const facts=(at:string)=>({schemaVersion:1,facts:Object.fromEntries(Object.entries({region:'synthetic-global',mode:'practice',occurredAt:at}).map(([field,value])=>[field,{value,source:'independently-confirmed-original-race',reference:'SYNTHETIC TEST ONLY',...(field==='occurredAt'?{precisionMicros:1000000}:{})}]))});
const race={...input,originalRace:facts('2001-06-01T00:00:00Z')};
const registry:any={schemaVersion:1,registryId:'synthetic-test-only',eras:['old','current','future'].map((eraId,i)=>({eraId,sequence:i,region:'synthetic-global',modes:['practice'],reference:'SYNTHETIC ONLY',window:{from:`${2000+i}-01-01T00:00:00Z`,until:`${2001+i}-01-01T00:00:00Z`}})),engines:[{engineId:bundle.engine_id,kind:'inference',version:bundle.version,profile:bundle.profile,region:'synthetic-global',modes:['practice'],eraIds:['current'],identity:{artifactSha256:bundle.artifact_sha256,dataSha256:bundle.data_sha256},reference:'SYNTHETIC COVERAGE; real local worker'}],futureInferencePolicies:[]};
const saveRegistry=()=>writeFile(join(folder,'simulation/engine-registry.json'),JSON.stringify(registry));await saveRegistry();
await writeFile(join(folder,'storage/races/selected.json'),JSON.stringify([{},race]));
await writeFile(join(folder,'storage/races/unknown.json'),JSON.stringify(input));
const child=spawn('python',[join(root,'tests/versioned-service-fixture.py'),folder],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
let errors='';child.stderr.on('data',data=>errors+=data);
const connection:any=await new Promise((done,reject)=>{const lines=createInterface({input:child.stdout});lines.once('line',line=>{lines.close();done(JSON.parse(line));});child.once('exit',()=>reject(new Error(errors)));});
const request=async(path:string,body?:any)=>{const response=await fetch(connection.url+path,{headers:{'Content-Type':'application/json',Origin:connection.url,'X-UmaTrace-CSRF':connection.csrf},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
const originalFetch=globalThis.fetch;
const begin=async(id:string)=>{const stored=await request('/api/races/'+id);let job=await request('/api/simulation/races/'+id,{expectedEntrySha256:stored.sha256});while(job.phase!=='complete'){await new Promise(r=>setTimeout(r,10));job=await request(`/api/simulation/races/${id}?jobId=${job.jobId}`);}return {job,stored};};
const run=async(job:any,cached?:Uint8Array)=>{
  const auth=await request(`/api/simulation/races/${job.raceId}/inference`,{jobId:job.jobId});
  const worker=new Worker(new URL('./version-worker-host.mjs',import.meta.url),{execArgv:[],workerData:{url:connection.url,artifact:join(folder,bundle.artifact)}});
  const start=performance.now();
  try{return await new Promise<any>((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Worker timeout')),45000);worker.once('error',reject);worker.on('message',message=>{clearTimeout(timer);if(message.type==='error')reject(new Error(message.error));else done({...message,ms:performance.now()-start,auth});});worker.postMessage({type:'run',raceId:job.raceId,jobId:job.jobId,entrySha256:job.entrySha256,cacheKey:auth.cacheKey,token:connection.csrf,cached});});}finally{await worker.terminate();}
};
try{
  console.error('Selecting synthetic current race');
  const {job}=await begin('selected~1');assert.equal(job.report.mode,'inference_plan');
  assert.equal(job.report.observed,undefined,'Polling omits replay arrays.');
  console.error('Running current worker');
  const built=await run(job);console.error('Current worker complete');assert.equal(built.type,'complete');assert.ok(built.value.authorization);
  const packed=join(folder,'analysis.gz');await writeFile(packed,built.packed);
  console.error('Restoring current cache');
  const restored=await run(job,new Uint8Array(await readFile(packed)));
  assert.equal(JSON.stringify(restored.value),JSON.stringify(built.value),'Actual versioned worker restores identical serializable prepared results.');
  const legacy=structuredClone(built.value);delete legacy.authorization;
  const {compressAnalysis}=await import('../src/analysis/codec');
  assert.equal((await run(job,await compressAnalysis(legacy))).type,'corrupt','Legacy complete cache is quarantined.');
  // Unknown races must neither instantiate a worker nor read a model cache,
  // including configure/library/warm/open paths.
  console.error('Checking unknown client');
  const unknown=(await begin('unknown')).job;assert.equal(unknown.report.mode,'recorded_only');
  let cacheReads=0,workerStarts=0,parsed=0;
  Object.assign(globalThis,{Worker:class{constructor(){workerStarts++;throw new Error('Forbidden worker');}}});
  globalThis.fetch=((url:any,options:any)=>originalFetch(new URL(url,connection.url),{...options,headers:{...options?.headers,Origin:connection.url}})) as typeof fetch;
  const client=new AnalysisClient({get:async()=>{cacheReads++;throw new Error('Forbidden cache');}} as unknown as AnalysisStore,{parsed:()=>parsed++,base:()=>assert.fail('Forbidden analysis'),ready:()=>assert.fail('Forbidden cache'),state:()=>{},cache:()=>{},error:e=>assert.fail(e),token:()=>connection.csrf});
  await client.configure(built.reference);client.setLibrary([{id:'unknown',title:'Unknown',receivedAt:'2000-01-01',remoteId:'unknown'}],{});
  await client.open({id:'unknown',title:'Unknown',receivedAt:'2000-01-01',remoteId:'unknown'});client.dispose();
  assert.equal(parsed,1);assert.equal(cacheReads+workerStarts,0);
  // The client must save using the authorized bundle's revision, which is a
  // SHA-256 identity accepted by the actual desktop cache API.
  Object.assign(globalThis,{__ANALYSIS_REVISION__:bundle.uiRevision,Worker:class{
    onmessage:((event:any)=>void)|null=null;onerror:(()=>void)|null=null;
    inner=new Worker(new URL('./version-worker-host.mjs',import.meta.url),{execArgv:[],workerData:{url:connection.url,artifact:join(folder,bundle.artifact)}});
    constructor(){this.inner.on('message',data=>this.onmessage?.({data}));this.inner.on('error',()=>this.onerror?.());}
    postMessage(message:any){this.inner.postMessage(message);}
    terminate(){void this.inner.terminate();}
  }});
  const store=new AnalysisStore(()=>true,()=>connection.csrf);
  let saved!:()=>void;
  const persisted=new Promise<void>(resolve=>saved=resolve);
  const savingClient=new AnalysisClient(store,{parsed:()=>{},base:()=>{},ready:()=>{},state:()=>{},cache:()=>saved(),error:e=>assert.fail(e),token:()=>connection.csrf});
  try{
    await savingClient.open({id:'selected~1',title:'Synthetic',receivedAt:'2001-06-01',remoteId:'selected~1'});
    await persisted;
    const status=await store.status();assert.equal(status.entries.length,1);
    assert.equal(status.entries[0].revision,bundle.uiRevision);
    const disk=await store.get(status.entries[0].key);assert.ok(disk);
    assert.equal(JSON.stringify((await run(job,disk)).value),JSON.stringify(built.value));
  }finally{savingClient.dispose();}
  globalThis.fetch=originalFetch;
  // Provisional policy and warnings survive real worker cache/reload/export.
  race.originalRace=facts('2002-06-01T00:00:00Z');await writeFile(join(folder,'storage/races/future.json'),JSON.stringify(race));
  assert.equal((await begin('future')).job.report.mode,'recorded_only');
  registry.futureInferencePolicies=[{policyId:'synthetic-future',region:'synthetic-global',modes:['practice'],inferenceEngineId:bundle.engine_id,afterEraId:'current',eraIds:['future'],notice:'SYNTHETIC provisional policy',reference:'SYNTHETIC ONLY'}];await saveRegistry();
  const future=(await begin('future')).job;assert.equal(analysisNotice(future.report),FUTURE_WARNING);
  console.error('Running provisional worker');
  const provisional=await run(future);const again=await run(future,provisional.packed);
  assert.ok(again.value.authorization.plan.notices.some((n:any)=>n.code==='PROVISIONAL_FUTURE_INFERENCE'&&n.persistent));
  assert.match(JSON.stringify(again.value),/PROVISIONAL_FUTURE_INFERENCE/);
  registry.futureInferencePolicies=[];await saveRegistry();
  const stale=await fetch(`${connection.url}/api/simulation/races/future/inference`,{method:'POST',headers:{'Content-Type':'application/json',Origin:connection.url,'X-UmaTrace-CSRF':connection.csrf},body:JSON.stringify({jobId:future.jobId})});assert.equal(stale.status,409);
  // Changes to bytes invalidate an otherwise current inference plan.
  const current=(await begin('selected~1')).job;
  await writeFile(join(folder,bundle.artifact),'changed artifact');
  const changed=await fetch(`${connection.url}/api/simulation/races/selected~1/inference`,{method:'POST',headers:{'Content-Type':'application/json',Origin:connection.url,'X-UmaTrace-CSRF':connection.csrf},body:JSON.stringify({jobId:current.jobId})});assert.equal(changed.status,409);
  const hostile=await fetch(connection.url+'/api/simulation/races/selected~1',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://unrelated.example'},body:'{}'});assert.equal(hostile.status,403);
  assert.deepEqual(normalizeTags('Finals, finals, Wet'),['Finals','Wet']);assert.ok(withinDateRange('2026-10-14T12:00:00Z','2026-10-14','2026-10-14'));
  console.log(JSON.stringify({calculationEquality:'passed',diskRestore:'passed',noRecalculation:'passed',unknownNoWorkersOrCache:'passed',stalePolicy:'passed',artifactMismatch:'passed',futureWarnings:'passed',selectedSingleton:'passed',filters:'passed',coldMs:Math.round(built.ms),restoreMs:Math.round(restored.ms),compressedBytes:built.packed.length}));
}finally{globalThis.fetch=originalFetch;child.kill();await new Promise(done=>child.once('exit',done));}
