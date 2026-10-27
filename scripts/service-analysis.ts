/** Headless display calculations. Python owns selection, authorization and IO. */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {parseRaceJson} from '../src/data/import';
import {assembleReferenceData} from '../src/data/reference';
import {readGeometry} from '../src/data/geometry';
import {projectSimulation,projectModeledRace} from '../src/simulation/project';
import {initialRace,summarize} from '../src/sandbox/results';
import {decodeSimulatorFrames} from '../src/sandbox/binary-frames';
import {decisionTrace} from '../src/simulation/trace';
import {packDashboard} from '../src/analysis/dashboard-codec';
import {enrichSimulation} from '../src/simulation/enrich';

const references=new Map<string,{data:any;reference:ReturnType<typeof assembleReferenceData>}>();
const inferenceHandlers=new Map<string,(event:any)=>unknown>();
async function prepare(input:any){
let cached=input.referenceKey?references.get(input.referenceKey):undefined;
if(!cached){
  let data=input.data;
  // Paths are selected by the service, never by a capture or browser request.
  // A restarted worker can reload the pinned snapshot without a large transfer.
  if(input.referencePath){
    const raw=readFileSync(input.referencePath);
    if(createHash('sha256').update(raw).digest('hex')!==input.referenceKey)throw new Error('Reference bundle changed.');
    data=JSON.parse(raw.toString('utf8'));
  }
  if(!data)throw new Error('Reference data was not supplied.');
  cached={data,reference:assembleReferenceData(data.metadata,data.courses,data.source,data.skillIds,readGeometry(data.geometry))};
}
if(input.referenceKey){references.delete(input.referenceKey);references.set(input.referenceKey,cached);while(references.size>3)references.delete(references.keys().next().value!);}
const {data,reference}=cached;
let value:any;
if(input.kind==='sandbox'){
  const race=initialRace(input.setup,input.run,input.jobId,input.engineVersion,reference);
  const frames=input.framesPath?decodeSimulatorFrames(readFileSync(input.framesPath),race.runners.map(r=>r.id)):undefined;
  value=projectModeledRace(race,input.modeled,input.modeled.decisionTrace,reference,input.summaryOnly,frames);
  await enrichSimulation(value,input.modeled.decisionTrace,reference,undefined,input.summaryOnly);
  writeFileSync(input.summaryOutput,JSON.stringify(summarize(value,input.run)));
  if(input.summaryOnly)return;
}else if(input.report.mode==='verified_simulation'){
  const race=parseRaceJson(input.capture)[0],trace=decisionTrace(input.report);
  value=projectSimulation(race,input.report,reference);
  if(!value||!trace)throw new Error('Matched trace unavailable.');
  await enrichSimulation(value,trace,reference);
}else if(input.report.mode==='inference_plan'){
  // Run the exact immutable historical artifact, with service-approved inputs.
  // It cannot fetch arbitrary files, URLs, or a newer reference snapshot.
  globalThis.fetch=(async(url:unknown)=>{
    const path=String(url),endpoint=`/api/simulation/races/${encodeURIComponent(input.raceId)}`;
    if(path===endpoint+'/inference')return Response.json(input.auth);
    if(path===input.auth.dataUrl)return Response.json(data);
    if(path===`/api/races/${encodeURIComponent(input.raceId)}`)return Response.json({data:input.capture,sha256:input.entrySha256});
    throw new Error('Unbound analysis resource.');
  }) as typeof fetch;
  const completed=new Promise<any>((resolve,reject)=>{
    (globalThis as any).self={postMessage:(message:any)=>message.type==='complete'?resolve(message.value):reject(new Error(message.error??message.type))};
  });
  if(!inferenceHandlers.has(input.artifact)){
    await import(pathToFileURL(input.artifact).href);
    inferenceHandlers.set(input.artifact,(globalThis as any).self.onmessage);
  }else (globalThis as any).self.onmessage=inferenceHandlers.get(input.artifact);
  (globalThis as any).self.onmessage({data:{type:'run',raceId:input.raceId,entrySha256:input.entrySha256,jobId:'service-owned',cacheKey:input.auth.cacheKey}});
  value=await completed;
}else throw new Error('No authorized analysis engine.');
value.race.raw=undefined;
const packed=packDashboard(value);
// Avoid serializing the shared empty path metadata twice.
for(const runner of Object.values(value.runners) as any[])if(runner.motion===runner.inferredMotion)runner.inferredMotion=null;
const recorded=input.kind==='sandbox'?null:parseRaceJson(input.capture)[0];if(recorded)recorded.raw=undefined;
writeFileSync(input.output,gzipSync(JSON.stringify({...packed,...(input.referenceKey?{referenceKey:input.referenceKey}:{referenceData:data}),recorded}),{level:1}));

}
if(process.argv.includes('--serve')){
  for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
    try{await prepare(JSON.parse(line));process.stdout.write('{"ok":true}\n');}
    catch(error){process.stdout.write(JSON.stringify({error:String(error)})+'\n');}
  }
}else await prepare(JSON.parse(readFileSync(0,'utf8')));
