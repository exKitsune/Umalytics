// A complete local HTTP workflow. All races below are explicitly synthetic.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { createLibraryCaptionHydrator } from '../src/library';
import { parseRaceJson } from '../src/data/import';
import { assembleReferenceData } from '../src/data/reference';
import { resolveCourseIdentity } from '../src/data/course-detection';
import { courseCaption } from '../src/race-display';

const folder=resolve(process.argv[2]),root=resolve(import.meta.dirname,'..');
const data=join(folder,'installation');await mkdir(join(data,'races'),{recursive:true});
await mkdir(join(folder,'dist'),{recursive:true});await cp(join(root,'public/data'),join(folder,'dist/data'),{recursive:true});
await writeFile(join(folder,'dist/index.html'),'<!doctype html><title>Synthetic caption workflow</title>');
const json=async(name:string)=>JSON.parse(await readFile(join(root,'public/data',name),'utf8'));
const [metadata,courses,source,ids]=await Promise.all(['metadata.json','courses.json','reference-source.json','simulator-skill-ids.json'].map(json));
const reference=assembleReferenceData(metadata,courses,source,ids);
const fixture=JSON.parse(await readFile(join(root,'tests/fixtures/race.json'),'utf8'));
fixture.distance=2500;fixture.courseId=null;fixture.courseIdentity={source:'unknown'};fixture.conditions={weather:'2',ground:'2',season:'4'};
fixture.runners=fixture.runners.map((r:any)=>({...r,finishTime:110,finishTimeRaw:110,lastSpurtDistance:-1}));
fixture.frames=[[0,0],[80,1955],[90,1965],[110,2500]].map(([time,distance])=>({time,runners:fixture.runners.map((r:any)=>({runnerId:r.id,distance,speed:20,hp:1000,lane:.1,temptationMode:0,blockFrontRunnerIndex:-1}))}));
fixture.events=[{time:85,type:3,runnerId:fixture.runners[0].id,skillId:120011,label:'Synthetic course proc',params:[0,120011,125000,0]}];
const body=JSON.stringify(fixture);
for(let i=0;i<45;i++)await writeFile(join(data,'races',`history-${i}.json`),body);
const instance={...fixture,courseId:null,distance:null,courseIdentity:{source:'unknown',raceInstanceId:101801},auth:{token:'PRIVATE_SYNTHETIC_SENTINEL'}};
await writeFile(join(data,'races/instance.json'),JSON.stringify(instance));
const imported=parseRaceJson(instance)[0];assert.equal(imported.courseId,10805);assert.equal(imported.courseIdentity?.source,'race-instance');
const missing=parseRaceJson({...instance,courseIdentity:{source:'unknown',raceInstanceId:99990001}})[0];assert.equal(missing.courseId,null);
const updated={...reference,metadata:{...metadata,raceInstances:{...metadata.raceInstances,'99990001':10506}}};
assert.equal(resolveCourseIdentity(missing,updated).courseId,10506);assert.equal(missing.courseId,null);
const manual=parseRaceJson({...fixture,courseId:10506,courseIdentity:{source:'manual'}})[0];assert.equal(manual.courseIdentity?.source,'manual');
const probe=createServer();await new Promise<void>(done=>probe.listen(0,'127.0.0.1',done));
const port=(probe.address() as {port:number}).port;await new Promise<void>(done=>probe.close(()=>done()));
const child=spawn('python',[join(root,'tests/desktop-service-fixture.py'),folder,String(process.pid),'--serve','--no-proxy','--port',String(port),'--data-dir',data],{cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe']});
let stderr='';child.stderr.on('data',chunk=>stderr=(stderr+chunk).slice(-4096));
const base=`http://127.0.0.1:${port}`;
const get=async(path:string)=>{const r=await fetch(base+path);assert.ok(r.ok);return r.json();};
const samePath=async(a:string,b:string)=>{const paths=await Promise.all([realpath(a),realpath(b)]);return process.platform==='win32'?paths[0].toLowerCase()===paths[1].toLowerCase():paths[0]===paths[1];};
let health:any,primaryError:unknown;
try {
  for(let i=0;i<100;i++){try{health=await get('/api/health');break;}catch{if(child.exitCode!==null)throw new Error('Synthetic desktop service exited.');await new Promise(done=>setTimeout(done,100));}}
  if(!health)throw new Error(`Synthetic desktop service did not become ready. ${stderr}`);
  assert.ok(await samePath(health.dataDirectory,data));assert.equal(health.certificate.exists,false);
  const page=await get('/api/races?summary=1');assert.equal(page.total,46);
  const row=page.races.find((e:any)=>e.filename==='instance.json');assert.equal(row.courseId,10805);assert.equal(row.raceInstanceId,101801);assert.equal(row.courseIdentity.source,'race-instance');assert.ok(!JSON.stringify(page).includes('PRIVATE_SYNTHETIC_SENTINEL'));
  const entries=page.races.filter((e:any)=>e.filename.startsWith('history-')).map((e:any)=>({...e,remoteId:e.id}));
  let reads=0;const captions=new Map<string,any>();
  const fetcher=async(id:string,limit:number)=>{reads++;const r=await fetch(base+'/api/races/'+encodeURIComponent(id));assert.ok(r.ok);const text=await r.text();assert.ok(Buffer.byteLength(text)<=limit);return {envelopeJson:text,bytes:Buffer.byteLength(text)};};
  // Keep the service, HTTP requests and decoding real. Advance only the child
  // workflow's application clock to exercise the full minute quota boundary.
  const actualNow=Date.now;let captionNow=actualNow();Date.now=()=>captionNow;
  try {
  const hydrate=createLibraryCaptionHydrator((id,caption)=>captions.set(id,caption),fetcher);
  await hydrate(entries,reference);assert.equal(reads,12);
  for(let i=0;i<4;i++)await hydrate(entries,reference);assert.equal(reads,40);assert.equal(captions.size,40);
  captionNow+=59999;await hydrate(entries,reference);assert.equal(reads,40);assert.equal(captions.size,40);
  captionNow+=1;
  await hydrate(entries,reference);assert.equal(reads,45);assert.equal(captions.size,45);
  assert.ok([...captions.values()].every(c=>c.courseId===null&&c.courseInference===null&&courseCaption(c,reference)==='2500 m · Course unknown'));
  assert.ok([...captions.values()].every(c=>!('frames' in c)&&!('events' in c)&&!('runners' in c)));
  await hydrate(entries,reference);assert.equal(reads,45);
  const cached=hydrate.cached(entries[0],reference);assert.equal(cached.courseId,null);assert.equal(cached.courseIdentity?.source,'unknown');
  hydrate.dispose();await hydrate(entries,reference);assert.equal(reads,45);
  let release!:()=>void,arrived!:()=>void,callbacks=0,lateReads=0;
  const gate=new Promise<void>(done=>release=done),ready=new Promise<void>(done=>arrived=done);
  const late=createLibraryCaptionHydrator(()=>callbacks++,async(id,limit)=>{lateReads++;const result=await fetcher(id,limit);arrived();await gate;return result;});
  const pending=late([entries[0]],reference);await ready;late.dispose();release();await pending;await late(entries,reference);assert.equal(callbacks,0);assert.equal(lateReads,1);
  } finally {Date.now=actualNow;}
  assert.equal(await readFile(join(data,'races/history-0.json'),'utf8'),body);
  console.log(JSON.stringify({syntheticHistoryRows:45,budgetResume:'passed',recordedCaptionsNoInference:'passed',recordedInstanceSource:'passed',updatedInstanceMapping:'passed',manualSource:'preserved',captionCache:'passed',pendingDisposal:'passed',sourceCapture:'unchanged',certificateChanges:false}));
} catch(error){primaryError=error;throw error;} finally {
  try {
    if(health&&await samePath(health.dataDirectory,data))await fetch(base+'/api/app/exit',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,'X-UmaTrace-CSRF':health.csrfToken},body:'{}'});
    await new Promise<void>((done,reject)=>{if(child.exitCode!==null){done();return;}child.once('exit',()=>done());setTimeout(()=>reject(new Error('Owned synthetic service did not exit.')),5000).unref();});
  } catch(error){
    if(child.exitCode===null){const stopped=new Promise<void>(done=>child.once('exit',()=>done()));child.kill();await stopped;}
    if(!primaryError)throw error;
  }
}
