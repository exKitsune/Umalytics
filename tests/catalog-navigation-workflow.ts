import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseRoute,routeHash,type WorkspaceRoute} from '../src/sandbox/navigation';
import {assembleReferenceData} from '../src/data/reference';
import {catalog,installCatalog,catalogReference} from '../src/data/catalog';
import {isOutfitReleased} from '../src/sandbox/outfit-release';
import {outfitUniques} from '../src/sandbox/editor';
import {skillSearch} from '../src/sandbox/search';

const routes:WorkspaceRoute[]=[{kind:'races'},{kind:'races',id:'capture +/#1'},{kind:'umas'},
  {kind:'simulator',view:'setup'},{kind:'simulator',view:'results',jobId:'job one'},
  {kind:'simulation',jobId:'a-b-c',index:3}];
for(const route of routes)assert.deepEqual(parseRoute(routeHash(route)),route);
for(const bad of ['#simulation?job=a&run=-1','#simulation?job=a&run=NaN','#simulation?job=a','#unknown'])assert.deepEqual(parseRoute(bad),{kind:'races'});
const json=(name:string)=>JSON.parse(readFileSync(`public/data/${name}.json`,'utf8'));
const ref=assembleReferenceData(json('metadata'),json('courses'),json('reference-source'),json('simulator-skill-ids'));
const all=skillSearch(ref,'',[],true);
assert(all.length>1000,'Search returns the complete catalog; rendering is progressively loaded');
assert.equal(all.length,Object.values(ref.metadata.skills).filter(s=>![3,4,5].includes(s.rarity)).length);
assert(all.every(s=>s.supported===undefined),'Moomoolator export IDs cannot assert GlobalSim support');
const actual=catalogReference(ref,undefined,new Set(['300051']));
assert.equal(skillSearch(actual,'300051',[],true).find(s=>s.id===300051)?.supported,true);
const career=structuredClone(catalog);
const current=ref.metadata.skills['100011'];
career.skillOwners['199991' as keyof typeof career.skillOwners]=[199901];
(career.outfitGlobalReleases as Record<string,string|null>)['199901']='2026-10-26';
const fallback={characters:{'1999':'Catalog Uma'},outfits:{'199901':'New outfit'},skillNames:{'199991':'New unique'},
  skills:{'199991':{...current,name:'New unique'},'100011':{...current,branches:[]}},source:ref.source};
const stableMap=catalog.skillOwners;
assert(installCatalog({schemaVersion:1,revision:'test-catalog',checkedAt:null,updatedAt:null,error:null,career,fallback}));
assert.equal(catalog.skillOwners,stableMap,'Existing consumers retain their map references');
const refreshed=catalogReference(ref);
assert.equal(refreshed.metadata.skills['100011'],current,'Catalog refresh cannot replace installed mechanics');
assert.equal(ref.metadata.skills['199991'],undefined,'The old analysis reference is immutable');
assert.deepEqual(outfitUniques(refreshed,199901),[199991],'Unique-owner index refreshes with the catalog');
assert(isOutfitReleased(199901,'2026-10-26'));
assert(!isOutfitReleased(199901,'2026-10-25'));
assert(!installCatalog({schemaVersion:1,revision:'bad',checkedAt:null,updatedAt:null,error:null,career:null,fallback:null}));
assert.equal(catalog.skillOwners['199991' as keyof typeof catalog.skillOwners][0],199901);
console.log('Complete skill catalog, live presentation refresh, immutable mechanics, and navigation routes passed.');
