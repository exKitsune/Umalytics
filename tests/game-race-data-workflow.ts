import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assembleReferenceData,loadInstalledRaceLookup} from '../src/data/reference';
import {resolveCourseIdentity,withRaceLookup} from '../src/data/course-detection';
import {parseRaceJson} from '../src/data/import';
import {installedCareer,installedMasterRevision} from '../src/data/installed-master';
import {skillCost} from '../src/data/skill-cost';

const json=(name:string)=>JSON.parse(readFileSync(name,'utf8'));
const baseline=assembleReferenceData(json('public/data/metadata.json'),json('public/data/courses.json'),json('public/data/reference-source.json'),[]);
const recorded={...parseRaceJson(json('tests/fixtures/race.json'))[0],courseId:null,distance:null,
  courseIdentity:{source:'unknown' as const,raceInstanceId:678901}};
assert.equal(resolveCourseIdentity(recorded,baseline).courseId,null);
Object.assign(globalThis,{document:{baseURI:'http://127.0.0.1:9999/'}});
let projection:Record<string,unknown>={raceInstances:{678901:10701},raceInstanceConditions:{678901:{grade:100,time:2}},
  characters:{987654:'Installed character'},skillNames:{987654:'Installed skill'},skills:{987654:{name:'Installed skill'}},
  career:{schema:2,source:{sha256:'first-master'},skills:{987654:{cost:123,group:987654,order:1,rarity:1}}}};
globalThis.fetch=async()=>Response.json(projection);
const local=await loadInstalledRaceLookup(baseline);
const race=resolveCourseIdentity(recorded,local);
assert.equal(race.courseId,10701);assert.equal(race.distance,1200);
assert.equal(race.grade,100);assert.equal(race.conditions?.timeOfDay,'2');
assert.equal(recorded.courseId,null);
assert.equal(local.metadata.characters['987654'],'Installed character');
assert.equal(local.metadata.skillNames['987654'],'Installed skill');
assert.ok(local.metadata.installedGameSkillIds?.includes('987654'));
assert.equal(skillCost(987654).cost,123);
assert.equal(installedMasterRevision,'first-master');
const retainedPrices=installedCareer.skills;
// Switching to pinned analysis display data must retain newly discovered IDs.
assert.equal(resolveCourseIdentity(recorded,withRaceLookup(baseline,local)).courseId,10701);
const pinned={...baseline,metadata:{...baseline.metadata,raceInstances:{678901:10606}}};
assert.equal(resolveCourseIdentity(recorded,withRaceLookup(pinned,local)).courseId,10606);
assert.equal(resolveCourseIdentity({...recorded,courseId:10606},local).courseId,10606);
projection={raceInstances:{678901:10606},raceInstanceConditions:{678901:{grade:100,time:2}}};
assert.equal(resolveCourseIdentity(recorded,await loadInstalledRaceLookup(baseline)).courseId,10606);
assert.equal(installedMasterRevision,'');
assert.equal(installedCareer.skills,retainedPrices);
assert.equal(skillCost(987654).cost,null);
globalThis.fetch=async()=>{throw new Error('unavailable');};
assert.equal(await loadInstalledRaceLookup(baseline),baseline);
console.log('Installed race lookup: refresh, selected race, pinned display and captured precedence passed.');
