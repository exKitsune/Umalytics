import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRaceJson } from '../src/data/import';
import { toPortableRace, toShareableRace } from '../src/data/share';
import { raceForExport } from '../src/desktop-storage';
import { sampleRecordedAt } from '../src/data/observational-sample';
const capture=JSON.parse(execFileSync('python',['-c',"import sys,json;sys.path.insert(0,'tests/globalsim');from test_runtime import fixture;print(json.dumps(fixture()[0]))"],{encoding:'utf8'}));
const originalRace={schemaVersion:1,observations:[{sourceField:'start_time',rawValue:946684800,unit:'unix-seconds',offset:'UTC',precisionSeconds:1,semantics:'unestablished',route:'/synthetic/start',association:{kind:'same-response-scenario',scenarioSha256:'a'.repeat(64)}}],facts:{region:{value:'synthetic-global',source:'independently-confirmed-original-race',reference:'synthetic test'},mode:{value:'practice',source:'upstream-original-race',reference:'synthetic route'},occurredAt:{value:'2000-01-01T01:00:00+01:00',precisionMicros:1000000,source:'independently-confirmed-original-race',reference:'synthetic occurrence'},rulesetId:{value:'synthetic-rules',source:'independently-confirmed-original-race',reference:'synthetic original rules'}}};
const raw={...capture,race_category:'practice',race_course_id:10805,course_id:10801,distance:1600,race_distance:1800,metadata:{umaTrace:{courseSource:'room-response'}},original_race:originalRace,raced_at:'2000-01-01T01:00:00',raced_at_source:'game',saved_replay:true};
const parsed=parseRaceJson(raw)[0],portable=toPortableRace(parsed),restored=parseRaceJson(portable)[0],again=toPortableRace(restored);
assert.equal((portable.raceCourseSet as any).id,10805);
assert.deepEqual(portable.raceCourseAliases,{race_course_id:10805,course_id:10801});
assert.deepEqual(portable.raceDistanceAliases,{distance:1600,race_distance:1800});
assert.equal(portable.raceDistance,1800);assert.deepEqual(again.raceDistanceAliases,portable.raceDistanceAliases);
assert.deepEqual(again.originalRace,originalRace);assert.deepEqual(toShareableRace(restored).originalRace,originalRace);
assert.equal(again.capture?.courseSource,'room-response');assert.equal(again.racedAt,raw.raced_at);
assert.equal(again.savedReplay,true);assert.equal(again.racedAtSource,'game');
for(const course of [10805,{id:10805},{id:10805,distance:1500,race_distance:1700}]){
 const race=parseRaceJson({...capture,race_course_set:course})[0];
 const rawAfter=toPortableRace(parseRaceJson(toPortableRace(race))[0]);
 assert.deepEqual(rawAfter.raceCourseSet,typeof course==='number'?{id:course}:course);
 assert.equal(rawAfter.raceDistance,undefined);
}
const normalized={...portable,raceCourseSet:{id:10805},raceDistance:undefined,raceDistanceAliases:undefined,distance:1600,distanceEvidence:'finish-derived'};
const clean=toPortableRace(parseRaceJson(normalized)[0]);assert.equal(clean.raceDistance,undefined);assert.equal((clean.raceCourseSet as any).distance,undefined);
// A huge recovery event or current definition cannot affect numeric HP interpolation.
const time=(parsed.frames[0].time+parsed.frames[1].time)/2;
const before=sampleRecordedAt(parsed,time);parsed.events.push({time,type:3,runnerId:parsed.runners[0].id,skillId:100001,label:'Synthetic recovery',params:[0,100001,999999]});
assert.deepEqual(sampleRecordedAt(parsed,time),before);assert.equal(before[0].hp,999.5);
// Reopening a saved dashboard omits raw inputs for performance. Export must
// retrieve its original source, even when the cached view came from simulation.
const cached={...parsed,raw:undefined},entry={id:'capture-source~0',remoteId:'source~0',sha256:'a'.repeat(64),title:'Saved race',receivedAt:'2000-01-01'};
const nativeFetch=globalThis.fetch;
let exported:ReturnType<typeof toPortableRace>;
try{
 globalThis.fetch=async url=>{assert.equal(String(url),'/api/races/source~0');return Response.json({data:raw,sha256:entry.sha256});};
 exported=toPortableRace(await raceForExport(entry,cached));
 assert.equal(exported.simDataBase64,portable.simDataBase64);
 assert.deepEqual(exported.raceHorse,portable.raceHorse);
 assert.equal(exported.randomSeed,portable.randomSeed);
 assert.deepEqual(exported.originalRace,originalRace);
 assert.deepEqual(toPortableRace(parseRaceJson(exported)[0]),again);
 assert.equal(cached.raw,undefined,'Export must not enlarge the cached dashboard.');
 await assert.rejects(raceForExport({...entry,sha256:'b'.repeat(64)},cached),/saved race changed/);
 globalThis.fetch=async()=>Response.json({error:'Source unavailable'},{status:503});
 await assert.rejects(raceForExport(entry,cached),/Source unavailable/);
 assert.equal(await raceForExport(undefined,parsed),parsed,'Browser-only exports retain their original inputs.');
}finally{globalThis.fetch=nativeFetch;}
const stored=JSON.parse(execFileSync('python',['tests/service-import-roundtrip.py'],{input:JSON.stringify(exported),encoding:'utf8'}));
assert.equal(stored.simDataBase64,portable.simDataBase64);
assert.deepEqual(stored.raceHorse,JSON.parse(JSON.stringify(portable.raceHorse)));
for(const key of ['originalRace','raceDistance','raceCourseAliases','raceDistanceAliases','capture','racedAt','racedAtSource'])assert.deepEqual(stored[key],JSON.parse(JSON.stringify((portable as any)[key])));
console.log(JSON.stringify({rawAliases:'passed',distanceFeedbackPrevented:'passed',provenance:'passed',serviceRoundTrip:'passed',cachedDashboardExport:'passed',observationalSampler:'passed'}));
