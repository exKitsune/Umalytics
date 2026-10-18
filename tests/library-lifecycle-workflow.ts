import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AnalysisClient,type AnalysisState} from '../src/analysis/client';
import {AnalysisStore} from '../src/analysis/store';
import {parseRaceJson} from '../src/data/import';
import {toPortableRace} from '../src/data/share';
import {raceTimestamp,formatRaceTime} from '../src/data/race-time';
import {withinDateRange} from '../src/library-filters';
const portable=JSON.parse(readFileSync(new URL('./fixtures/race.json',import.meta.url),'utf8'));
const nativeFetch=globalThis.fetch,nativeWorker=globalThis.Worker;
const entry=(id:string)=>({id,remoteId:id,title:id,receivedAt:'2026-10-18T00:00:00Z'});
const shown:string[]=[],errors:string[]=[],states:AnalysisState[]=[];
const callbacks={parsed:(_:unknown,id:string)=>shown.push(id),base:()=>{},ready:()=>{},state:(state:AnalysisState)=>states.push(state),cache:()=>{},error:(error:string)=>errors.push(error),token:()=> 'test'};
const store=new AnalysisStore(()=>false,()=>undefined);
let release!:(response:Response)=>void;
const delayed=new Promise<Response>(resolve=>release=resolve);
globalThis.fetch=async url=>String(url)==='/api/races/deleted'?delayed:Response.json(String(url).includes('/simulation/')?{phase:'complete',jobId:'test',report:{mode:'recorded_only'}}:{data:portable,sha256:'a'.repeat(64)});
const client=new AnalysisClient(store,callbacks,false);
try{
 const pending=client.open(entry('deleted'));
 assert.equal(states.at(-1)?.busy,true);
 client.forget('deleted');assert.equal(states.at(-1)?.busy,false);
 await client.open(entry('kept'));
 const before=states.length;
 release(Response.json({error:'Race not found.'},{status:404}));await pending;
 assert.deepEqual(shown,['kept']);assert.deepEqual(errors,[]);assert.equal(states.length,before,'An old failure must not change the current screen.');
 // Importing the same ID again can start fresh after deletion.
 globalThis.fetch=async url=>Response.json(String(url).includes('/simulation/')?{phase:'complete',jobId:'test',report:{mode:'recorded_only'}}:{data:portable,sha256:'b'.repeat(64)});
 await client.open(entry('deleted'));assert.deepEqual(shown,['kept','deleted']);
}finally{client.dispose();globalThis.fetch=nativeFetch;}
// A saved dashboard worker in flight must settle when its race is removed.
(globalThis as any).__ANALYSIS_REVISION__='test';
let worker:any;
class PendingWorker {onmessage:any;onerror:any;terminated=false;constructor(){worker=this;}postMessage(){}terminate(){this.terminated=true;}}
(globalThis as any).Worker=PendingWorker;
globalThis.fetch=async()=>Response.json({phase:'complete',key:'test',entrySha256:'a'.repeat(64),hasAnalysis:true,report:{mode:'verified_simulation'}});
const savedClient=new AnalysisClient(store,callbacks,false);savedClient.useService(true);
try{
 const pending=savedClient.open(entry('saved'));
 for(let i=0;i<100&&!worker;i++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.ok(worker);savedClient.forget('other');assert.equal(worker.terminated,false);
 savedClient.forget('saved');await pending;assert.equal(worker.terminated,true);assert.equal(states.at(-1)?.busy,false);assert.deepEqual(errors,[]);
}finally{savedClient.dispose();globalThis.fetch=nativeFetch;(globalThis as any).Worker=nativeWorker;delete (globalThis as any).__ANALYSIS_REVISION__;}
const stamp='2026-10-17T07:45:48';
assert.equal(raceTimestamp(stamp).toISOString(),stamp+'.000Z');
assert.equal(formatRaceTime(stamp,'en-US','America/New_York'),formatRaceTime(stamp+'Z','en-US','America/New_York'));
assert.match(formatRaceTime(stamp,'en-US','America/New_York'),/03:45:48 AM EDT/);
assert.match(formatRaceTime('2026-01-17T07:45:48','en-US','America/New_York'),/02:45:48 AM EST/);
assert.match(formatRaceTime(stamp,'en-US','Asia/Tokyo'),/04:45:48 PM/);
assert.equal(raceTimestamp('2026-10-17T03:45:48-04:00').toISOString(),stamp+'.000Z');
for(const clock of [stamp,stamp+'Z','2026-10-17T03:45:48-04:00','2026-10-17T07:45:48.123+00:00'])assert.equal(toPortableRace(parseRaceJson({...portable,racedAt:clock})[0]).racedAt,clock,'Display conversion must preserve original race clocks.');
const timezone=process.env.TZ;process.env.TZ='America/New_York';
try{assert.equal(withinDateRange('2026-10-18T01:00:00','2026-10-17','2026-10-17'),true);assert.equal(withinDateRange('2026-10-18T01:00:00','2026-10-18','2026-10-18'),false);}finally{if(timezone===undefined)delete process.env.TZ;else process.env.TZ=timezone;}
console.log('Library lifecycle: deleted selection cancellation, delayed failure isolation, worker termination, reimport and local timezone display passed.');
