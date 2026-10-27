import assert from 'node:assert/strict';
import {veteranRows,veteranBuild,filterVeterans,emptyVeteranFilters,type VeteranSnapshot} from '../src/sandbox/veterans';
import type {ReferenceData} from '../src/data/reference';
const reference={metadata:{characters:{1001:'Special Week'},outfits:{100101:'Original outfit'},skills:{},skillNames:{}},courses:{}} as unknown as ReferenceData;
const snapshot:VeteranSnapshot={schemaVersion:1,capturedAt:'2026-10-27T04:57:35Z',count:1,veterans:[{
  trained_chara_id:123,card_id:100101,speed:1200,stamina:1000,power:800,guts:600,wiz:900,
  skill_array:[{skill_id:100011,level:4}],fans:100000,wins:12,rank_score:15000,rarity:5,
  proper_ground_turf:8,proper_running_style_senko:7,support_card_list:[{support_card_id:30001,level:50}],
  factor_info_array:[{factor_id:101,level:3}],succession_chara_array:[{position_id:10,card_id:100201}]
}]};
const [row]=veteranRows(snapshot,reference);
assert.equal(row.name,'Special Week');assert.equal(row.career.score,15000);
assert.equal(row.career.aptitudes.turf,8);assert.equal(row.career.legacies.length,1);
const build=veteranBuild(row);
assert.notEqual(build.id,row.id);assert.equal(build.folderId,'');assert.equal(build.favorite,false);
assert.equal(build.skills[0].level,4);assert.equal(build.fans,100000);
assert.equal('careerSummary' in build,false);
assert.ok(build.memo.startsWith('Veteran: '));
assert.ok(build.memo.includes((15000).toLocaleString()));assert.ok(build.memo.includes('5★'));
assert.ok(build.memo.endsWith('5★'));assert.equal(build.memo.split('\n').length,1);
assert.ok(!build.memo.includes('Spd')&&!build.memo.includes('Special Week'));
const originalMemo=build.memo;
build.stats.speed=10;build.skills[0].level=1;
assert.equal(row.career.stats.speed,1200);assert.equal(row.career.skills![0].level,4);
assert.equal(snapshot.veterans[0].speed,1200);assert.equal(build.memo,originalMemo,'Original details remain historical when the copy is edited');
console.log('Recorded Veterans: career projection, stable identities and independent Dorm copies passed.');

const filteredSnapshot:VeteranSnapshot={...snapshot,schemaVersion:2,veterans:[
  {...snapshot.veterans[0],trained_chara_id:20,create_time:'2026-10-20 20:00:00',factor_info_array:[{factor_id:102}],proper_distance_mile:8,
    succession_chara_array:[{position_id:10,card_id:100201,factor_info_array:[{factor_id:201}]},{position_id:20,card_id:100301,factor_info_array:[{factor_id:202}]},{position_id:11,card_id:100401,factor_info_array:[{factor_id:303}]}]},
  {...snapshot.veterans[0],trained_chara_id:10,create_time:'2026-10-21 20:00:00',factor_info_array:[{factor_id:103},{factor_id:203}],proper_distance_mile:7},
  {...snapshot.veterans[0],trained_chara_id:30,create_time:'2026-10-21T17:00:00-04:00',factor_info_array:[{factor_id:103}],proper_distance_mile:null},
],favorites:[{trained_chara_id:10,icon_type:9,memo:' Mile test '},{trained_chara_id:20,icon_type:5,memo:''},{trained_chara_id:999,icon_type:1,memo:'unrelated'}]};
const candidates=veteranRows(filteredSnapshot,reference),filters=emptyVeteranFilters();
assert.equal(filters.character,'');assert.equal(filters.sort,'recent');
assert.deepEqual(filterVeterans(candidates,filters).map(r=>r.id),['veteran-30','veteran-10','veteran-20']);
assert.equal(candidates[0].marker,6);assert.equal(candidates[1].marker,10);assert.equal(candidates[2].marker,0);
assert.equal(candidates[1].memo,'Mile test');
const copied=veteranBuild({...candidates[1],epithet:'Independent Learner'});
assert.ok(copied.memo.startsWith('Veteran: '));assert.ok(copied.memo.endsWith(' · Mile test'));
assert.equal(copied.memo.split('\n').length,1);
assert.ok(copied.memo.includes('Independent Learner'));
assert.ok(copied.memo.includes('2026'));
assert.equal(copied.favorite,false);assert.equal('careerSummary' in copied,false);
assert.ok(!copied.memo.includes('Pink shoe'),'Game favorite markers do not transfer to editable builds');
const missing=veteranBuild({...row,created:0,epithet:'',career:{...row.career,score:null,rank:null,stars:null,scenarioId:null,stats:{speed:null,stamina:null,power:null,guts:null,wisdom:null}}});
assert.equal(missing.memo,'Veteran:');
assert.equal(veteranRows(snapshot,reference)[0].marker,null,'Older captures must not invent marker state');
assert.deepEqual(filterVeterans(candidates,{...filters,markers:[6,10]}).map(r=>r.id),['veteran-10','veteran-20']);
assert.equal(filterVeterans(candidates,{...filters,query:'Mile test'})[0].id,'veteran-10');
assert.deepEqual(filterVeterans(candidates,{...filters,sparks:[{group:'1',minStars:3},{group:'2',minStars:2}]}).map(r=>r.id),['veteran-10']);
assert.deepEqual(filterVeterans(candidates,{...filters,aptitudes:[{key:'mile',minGrade:'S'}]}).map(r=>r.id),['veteran-20']);
assert.deepEqual(filterVeterans(candidates,{...filters,aptitudes:[{key:'mile',minGrade:'A'},{key:'turf',minGrade:'S'}],markers:[10]}).map(r=>r.id),['veteran-10']);
assert.equal(filterVeterans(candidates,{...filters,sparks:[{group:'missing',minStars:1}]}).length,0);
assert.deepEqual(filterVeterans(candidates,{...filters,direction:'asc'}).map(r=>r.id),['veteran-20','veteran-10','veteran-30']);
assert.deepEqual(filterVeterans(candidates,{...filters,sort:'distance',sortDetail:'mile',direction:'asc'}).map(r=>r.id),['veteran-10','veteran-20','veteran-30']);
assert.deepEqual(filterVeterans(candidates,{...filters,memo:'yes'}).map(r=>r.id),['veteran-10']);
assert.deepEqual(filterVeterans(candidates,{...filters,memo:'no'}).map(r=>r.id),['veteran-30','veteran-20']);
const inherited={...emptyVeteranFilters(),markers:[6]};
inherited.sparkCategories[0]={type:1,groups:['2'],minStars:2,includeParents:false};
assert.equal(filterVeterans(candidates,inherited).length,0);
inherited.sparkCategories[0].includeParents=true;
assert.equal(filterVeterans(candidates,inherited).length,1);
inherited.sparkCategories[0].minStars=3;
assert.equal(filterVeterans(candidates,inherited).length,0,'Do not add two low-star sparks to satisfy a 3-star requirement');
inherited.sparkCategories[0].groups=['3'];
assert.equal(filterVeterans(candidates,inherited).length,0,'Do not include the Veteran’s grandparents as inheritable origin sparks');
const aptitudes={...emptyVeteranFilters()};aptitudes.aptitudeCategories[1]={keys:['mile','long'],minGrade:'S'};
assert.deepEqual(filterVeterans(candidates,aptitudes).map(r=>r.id),['veteran-20']);
aptitudes.aptitudeCategories[2]={keys:['end'],minGrade:'S'};
assert.equal(filterVeterans(candidates,aptitudes).length,0,'Different aptitude categories must all match');
for(let icon=0;icon<15;icon++){
  const [marked]=veteranRows({...snapshot,favorites:[{trained_chara_id:123,icon_type:icon,memo:''}]},reference);
  assert.equal(marked.marker,icon+1,'Zero-based server icons map to one-based artwork');
}
assert.equal(veteranRows({...snapshot,favorites:[]},reference)[0].marker,0);
assert.equal(veteranRows({...snapshot,favorites:[{trained_chara_id:123,icon_type:6}]},reference)[0].marker,7,'Fuji: spade, not diamond');
assert.equal(veteranRows({...snapshot,favorites:[{trained_chara_id:123,icon_type:5}]},reference)[0].marker,6,'Nature: diamond, not cake');
console.log('Veteran filters: favorites and memos by ID, spark rarities, combined aptitude thresholds and newest-first dates passed.');
