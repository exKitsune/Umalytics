/** Headless display calculations. Python owns selection, authorization and IO. */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {parseRaceJson} from '../src/data/import';
import {assembleReferenceData} from '../src/data/reference';
import {readGeometry} from '../src/data/geometry';
import {projectSimulation} from '../src/simulation/project';
import {decisionTrace} from '../src/simulation/trace';
import {packDashboard} from '../src/analysis/dashboard-codec';
import {enrichSimulation} from '../src/simulation/enrich';

const input=JSON.parse(readFileSync(0,'utf8'));
const data=input.data,reference=assembleReferenceData(data.metadata,data.courses,data.source,data.skillIds,readGeometry(data.geometry));
let value:any;
if(input.report.mode==='verified_simulation'){
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
  await import(pathToFileURL(input.artifact).href);
  (globalThis as any).self.onmessage({data:{type:'run',raceId:input.raceId,entrySha256:input.entrySha256,jobId:'service-owned',cacheKey:input.auth.cacheKey}});
  value=await completed;
}else throw new Error('No authorized analysis engine.');
value.race.raw=undefined;
const packed=packDashboard(value);
// Avoid serializing the shared empty path metadata twice.
for(const runner of Object.values(value.runners) as any[])if(runner.motion===runner.inferredMotion)runner.inferredMotion=null;
const recorded=parseRaceJson(input.capture)[0];recorded.raw=undefined;
writeFileSync(input.output,gzipSync(JSON.stringify({...packed,referenceData:data,recorded}),{level:1}));
