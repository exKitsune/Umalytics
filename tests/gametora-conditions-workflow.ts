/** Public synthetic whole-file regressions for the complete current Global
 * condition inventory. Drives the real offline import/analyze/export CLIs. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {conditionCoverage} from '../src/data/skill-conditions';
const root=resolve(import.meta.dirname,'..'),folder=resolve(process.argv[2]),run=promisify(execFile);
await mkdir(folder,{recursive:true});const ref=join(folder,'reference');await mkdir(ref,{recursive:true});
const original=await readFile(join(root,'public/data/metadata.json')),metadata=JSON.parse(original.toString('utf8')),coverage=conditionCoverage(metadata);
const expectedKeys=`accumulatetime activate_count_all activate_count_end_after activate_count_heal activate_count_later_half activate_count_middle activate_count_start all_corner_random always base_power bashin_diff_behind bashin_diff_infront behind_near_lane_time behind_near_lane_time_set1 blocked_front blocked_front_continuetime blocked_side_continuetime change_order_onetime change_order_up_end_after change_order_up_finalcorner_after compete_fight_count corner corner_random distance_diff_rate distance_diff_top distance_rate distance_rate_after_random distance_type down_slope_random grade ground_condition ground_type hp_per infront_near_lane_time is_activate_any_skill is_badstart is_basis_distance is_behind_in is_dirtgrade is_exist_chara_id is_finalcorner is_finalcorner_laterhalf is_finalcorner_random is_last_straight_onetime is_lastspurt is_move_lane is_other_character_activate_advantage_skill is_overtake is_surrounded is_temptation lane_type last_straight_random lastspurt motivation near_count order order_rate order_rate_in20_continue order_rate_in50_continue order_rate_in80_continue order_rate_out20_continue order_rate_out40_continue order_rate_out50_continue order_rate_out70_continue overtake_target_no_order_up_time overtake_target_time phase phase_firsthalf_random phase_laterhalf_random phase_random popularity post_number random_lot remain_distance remain_distance_viewer_id rotation running_style running_style_count_nige_otherself running_style_count_oikomi_otherself running_style_count_same running_style_count_same_rate running_style_count_sashi_otherself running_style_count_senko_otherself running_style_equal_popularity_one running_style_temptation_opponent_count_nige running_style_temptation_opponent_count_oikomi running_style_temptation_opponent_count_sashi running_style_temptation_opponent_count_senko same_skill_horse_count season slope straight_front_type straight_random temptation_count temptation_opponent_count_behind temptation_opponent_count_infront time track_id up_slope_random weather`.split(' ');
assert.equal(expectedKeys.length,100);assert.deepEqual(coverage.keys.map(k=>k.key).sort(),expectedKeys.slice().sort());assert.equal(coverage.invalidExpressions,0);assert.equal(coverage.unsupportedKeys,0);assert.equal(coverage.understoodKeys,100);assert.equal(coverage.partialKeys,0);
let next=830000;const definitions=new Map<string,number>();
function rule(condition:string,precondition=''){const key=`${precondition}|${condition}`;let id=definitions.get(key);if(id)return id;id=++next;definitions.set(key,id);metadata.skills[id]={name:`Synthetic condition${id}`,rarity:1,groupId:id,activateLot:1,tagId:0,branches:[{branchIndex:0,condition,precondition,rawDuration:10000,durationUsage:1,effects:[{type:27,rawValue:1000,valueUsage:1,levelUsage:1,targetType:1}]}]};return id;}
const query=(expression:string,time=10)=>rule(`accumulatetime==${time}&${expression}`);
const sample=(id:string,distance:number,lane=.3,speed=20,rushed=0)=>({runnerId:id,distance,lane,speed,hp:2500,temptationMode:rushed,blockFrontRunnerIndex:-1});
const fixture=(n=4):any=>({schemaVersion:1,title:'Explicit synthetic GameTora condition workflow',synthetic:true,distance:2000,courseId:99991,category:'practice',grade:100,conditions:{ground:'1',weather:'1',season:'4',timeOfDay:'4'},
 runners:Array.from({length:n},(_,i)=>({id:`fixture-${i}`,gate:i+1,name:`Synthetic runner${i}`,cardId:100101+i*100,charaId:1001+i,strategyCode:i%4+1,mood:3,teamGroup:i===1?1:i+1,isNpc:false,popularity:i+1,finishTimeRaw:100,finishTime:100,lastSpurtDistance:-1,startDelay:.05,stats:{speed:1000,stamina:1000,power:1000,guts:1000,wisdom:1000},aptitudes:{turf:7,middle:7,front:7,pace:7,late:7,end:7},skills:[]})),
 frames:[0,10,11,12,20,50,70,90,100].map(time=>({time,runners:Array.from({length:n},(_,i)=>sample(`fixture-${i}`,time===0?0:20*time-i*10,.3+i*.1))})),events:[]});
const at=(r:any,time:number)=>r.frames.find((f:any)=>f.time===time),owned=(r:any,ids:number[])=>{r.runners[0].skills=ids.map(id=>({id,level:1}));return r;};
const replace=(r:any,time:number,values:any[])=>{at(r,time).runners=values.map((v,i)=>({...sample(`fixture-${i}`,v.distance),...v,runnerId:`fixture-${i}`}));};
const event=(id:number,time:number,source=0,branch=0)=>({time,type:3,runnerId:`fixture-${source}`,skillId:id,label:'Synthetic activation',params:[source,id,0,branch,0]});
interface Scenario {name:string;race:any;check:(data:any)=>void}
const scenarios:Scenario[]=[];
const row=(data:any,id:number)=>{const r=data.analysis.runners['fixture-0'].skillRows.find((r:any)=>r.skillId===id);assert.ok(r,`Missing condition row${id}`);return r.conditionEvaluation;};
const met=(d:any,id:number)=>assert.equal(row(d,id).inferredState,'met',`Expected inferred rule${id}: ${JSON.stringify(row(d,id))}`);
const notMet=(d:any,id:number)=>assert.notEqual(row(d,id).inferredState,'met',`Unexpected rule${id} opportunity`);
const add=(name:string,race:any,check:(data:any)=>void)=>scenarios.push({name,race,check});
// Every currently bundled key is exercised through a real joined definition.
const inventoryIds=coverage.keys.map(k=>rule(k.expressions[0]));add('all-100-keys',owned(fixture(9),inventoryIds),d=>{for(const id of inventoryIds){const c=row(d,id);assert.notEqual(c.mechanicsState,'unsupported');assert.ok(c.branches[0].predicates.every((p:any)=>p.meaning&&p.mechanicsState!=='unsupported'));}});
{
 const ids=[query('distance_diff_rate<=30'),query('distance_diff_rate>=50'),query('distance_diff_top<=5'),query('distance_diff_top>=6')],r=owned(fixture(3),ids);replace(r,10,[{distance:550},{distance:600},{distance:400}]);
 // A25m leader gap in a100m field spread is25%, not metres or course%.
 add('relative-field-percentage',r,d=>{met(d,ids[0]);notMet(d,ids[1]);});const floor=structuredClone(r);replace(floor,10,[{distance:594.1},{distance:600},{distance:400}]);add('whole-metre-leader-gap',floor,d=>{met(d,ids[2]);notMet(d,ids[3]);});
 const tie=structuredClone(r);replace(tie,10,[{distance:500},{distance:500},{distance:500}]);add('zero-field-spread',tie,d=>{notMet(d,ids[0]);assert.equal(row(d,ids[0]).state,'unknown');});
}
{
 const ids=[query('is_behind_in==1'),query('is_behind_in==0')],r=owned(fixture(3),ids);replace(r,10,[{distance:500,lane:.3},{distance:499,lane:.2},{distance:497,lane:.5}]);add('inner-ranked-runner-behind',r,d=>{met(d,ids[0]);notMet(d,ids[1]);});
 const tied=structuredClone(r);at(tied,10).runners[2].distance=499;add('tied-trailing-selector-unresolved',tied,d=>{notMet(d,ids[0]);notMet(d,ids[1]);});
}
for(const [lane,expected]of [[.2,0],[.200001,1],[.4,1],[.400001,2],[.6,2],[.600001,3]]){const ids=[query(`lane_type==${expected}`),query(`lane_type==${(expected+1)%4}`)],r=owned(fixture(),ids);at(r,10).runners[0].lane=lane;add(`lane-boundary-${lane}`,r,d=>{met(d,ids[0]);notMet(d,ids[1]);});}
for(const [name,from,to,direction]of [['inward',.3,.2,1],['outward',.2,.3,2]] as const){const ids=[query(`is_move_lane==${direction}`),query(`is_move_lane==${direction===1?2:1}`)],r=owned(fixture(),ids);at(r,0).runners[0].lane=from;at(r,10).runners[0].lane=to;add(`lane-direction-${name}`,r,d=>{met(d,ids[0]);notMet(d,ids[1]);});}
{
 const ids=[query('near_count==2'),query('near_count>2')],r=owned(fixture(),ids);replace(r,10,[{distance:500,lane:.3},{distance:503,lane:.3+3/18},{distance:497,lane:.3-3/18},{distance:503.01,lane:.3}]);add('inclusive-neighborhood-boundaries',r,d=>{met(d,ids[0]);notMet(d,ids[1]);});
}
{
 const ids=[query('is_surrounded==1')],r=owned(fixture(),ids);replace(r,10,[{distance:500,lane:.3},{distance:502,lane:.3},{distance:498,lane:.3},{distance:500,lane:.2}]);add('surrounded-inner-side',r,d=>met(d,ids[0]));
}
{
 const ids=[query('behind_near_lane_time_set1>=1',12),query('behind_near_lane_time>=1',12)],r=owned(fixture(),ids);
 for(const time of [10,11,12])replace(r,time,[{distance:20*time,lane:.3},{distance:20*time-.5,lane:.7},{distance:20*time-5,lane:.3+2.7/18},{distance:20*time+10,lane:.3}]);
 add('set1-any-runner-inclusive',r,d=>{met(d,ids[0]);notMet(d,ids[1]);});
 const ordinary=structuredClone(r);for(const time of [10,11,12])at(ordinary,time).runners[2]={...at(ordinary,time).runners[2],distance:20*time-2.5,lane:.3+1/18};add('ordinary-any-runner-proximity',ordinary,d=>met(d,ids[1]));
 const reset=structuredClone(ordinary);at(reset,11).runners[1].distance=20*11+1;add('own-rank-resets-proximity',reset,d=>notMet(d,ids[1]));
}
{
 const ids=[query('overtake_target_time>=1',12),query('overtake_target_no_order_up_time>=1',12)],r=owned(fixture(2),ids);
 for(const time of [10,11,12])replace(r,time,[{distance:20*time,lane:.3,speed:20},{distance:20*time-10,lane:.3,speed:22}]);add('being-an-overtake-target',r,d=>{met(d,ids[0]);notMet(d,ids[1]);});
 const outgoing=structuredClone(r);for(const time of [10,11,12])replace(outgoing,time,[{distance:20*time,lane:.3,speed:22},{distance:20*time+10,lane:.3,speed:20}]);add('having-an-overtake-target',outgoing,d=>{notMet(d,ids[0]);met(d,ids[1]);});
}
const healing=840001,nonhealing=840002;metadata.skills[healing]={name:'Synthetic positive recovery',rarity:1,groupId:healing,activateLot:0,branches:[{condition:'always==1',precondition:'',branchIndex:0,rawDuration:0,durationUsage:1,effects:[{type:9,rawValue:100,valueUsage:1,levelUsage:1,targetType:1}]}]};metadata.skills[nonhealing]={...metadata.skills[healing],name:'Synthetic non-healing',branches:[{...metadata.skills[healing].branches[0],effects:[{type:27,rawValue:100,valueUsage:1,levelUsage:1,targetType:1}]}]};
{
 const ids=[query('is_other_character_activate_advantage_skill==9'),query('activate_count_heal>=1',11)];
 for(const [name,proc,source,expectedOther,expectedOwn]of [['other-heal',healing,1,true,false],['other-speed',nonhealing,1,false,false],['own-heal',healing,0,false,true]] as const){const r=owned(fixture(),[...ids,...(source===0?[proc]:[])]);r.runners[source].skills.push({id:proc,level:1});r.events=[event(proc,10,source)];add(name,r,d=>{(expectedOther?met:notMet)(d,ids[0]);(expectedOwn?met:notMet)(d,ids[1]);});}
 const stale=owned(fixture(),ids);stale.runners[1].skills=[{id:healing,level:1}];stale.events=[event(healing,1,1)];add('healing-not-permanent-notification',stale,d=>notMet(d,ids[0]));
}
{
 const ids=[query('compete_fight_count>0'),query('compete_fight_count>1')],r=owned(fixture(),ids);r.events=[{time:9,type:5,runnerId:'fixture-0',skillId:null,label:'Synthetic duel start',params:[0]}];add('duel-existence-not-arbitrary-count',r,d=>{met(d,ids[0]);notMet(d,ids[1]);assert.equal(row(d,ids[1]).mechanicsState,'partial');});
}
{
 const ids=[query('temptation_opponent_count_infront>=1'),query('temptation_opponent_count_behind>=1'),query('running_style_temptation_opponent_count_nige>=1'),query('running_style_temptation_opponent_count_senko>=1')],r=owned(fixture(),ids);r.runners[1].teamGroup=1;r.runners[1].strategyCode=1;r.runners[2].strategyCode=2;r.runners[3].strategyCode=3;
 replace(r,10,[{distance:500},{distance:510,temptationMode:1},{distance:490,temptationMode:2},{distance:520,temptationMode:0}]);add('rushed-enemy-team-direction-style',r,d=>{notMet(d,ids[0]);met(d,ids[1]);notMet(d,ids[2]);met(d,ids[3]);});
 const unknown=structuredClone(r);delete unknown.runners[2].teamGroup;add('rushed-unknown-team-not-definite',unknown,d=>{assert.equal(row(d,ids[1]).state,'unknown');});
}
{
 const impossible=query('remain_distance_viewer_id>=800&remain_distance_viewer_id<=600'),one=query('remain_distance_viewer_id>=800&remain_distance_viewer_id<=1100'),r=owned(fixture(3),[impossible,one]);r.runners[0].isNpc=true;r.runners[1].isNpc=false;r.runners[2].isNpc=false;replace(r,10,[{distance:100},{distance:1500},{distance:1000}]);add('same-player-viewer-conjunction',r,d=>{notMet(d,impossible);met(d,one);});
 const legacy=structuredClone(r);for(const runner of legacy.runners)delete runner.isNpc;add('legacy-player-marker-unavailable',legacy,d=>{notMet(d,one);assert.equal(row(d,one).state,'unknown');});
}
{
 const rank=query('order_rate>50'),r=owned(fixture(9),[rank]);replace(r,10,Array.from({length:9},(_,i)=>({distance:i===0?500: i<=4?510+i:490-i})));add('whole-field-rounded-rank',r,d=>notMet(d,rank));
 const random=rule('phase_random==1&popularity<=3'),rr=owned(fixture(),[random]);add('random-window-stays-unobserved',rr,d=>{assert.equal(row(d,random).randomTrigger,true);assert.equal(row(d,random).state,'unknown');assert.notEqual(d.analysis.runners['fixture-0'].skillRows.find((r:any)=>r.skillId===random).activationStatus,'wit-failure-supported');});
 const latched=rule('accumulatetime==20&phase==1','accumulatetime==10&order==1'),pr=owned(fixture(),[latched]);replace(pr,10,[{distance:300},{distance:299},{distance:298},{distance:297}]);replace(pr,20,[{distance:500},{distance:510},{distance:520},{distance:530}]);add('precondition-latches-earlier-witness',pr,d=>met(d,latched));
}
{
 const early=query('phase_firsthalf_random==1',20),late=query('phase_laterhalf_random==1',20),r=owned(fixture(),[early,late]);at(r,20).runners[0].distance=1000;
 add('random-phase-half-region',r,d=>{assert.equal(row(d,early).eligibilityState,'unresolved');assert.equal(row(d,early).state,'unmet');assert.equal(row(d,late).eligibilityState,'eligible');assert.equal(row(d,late).state,'unknown');assert.equal(row(d,late).inferredState,'met');});
 const entry=query('is_last_straight_onetime==1',90),repeat=query('is_last_straight_onetime==1',91),straight=owned(fixture(),[entry,repeat]);straight.frames.push({time:91,runners:straight.runners.map((r:any,i:number)=>sample(r.id,1820-i*10,.3+i*.1))});straight.frames.sort((a:any,b:any)=>a.time-b.time);
 add('last-straight-entry-not10m-window',straight,d=>{met(d,entry);notMet(d,repeat);});const censored=structuredClone(straight);censored.frames=censored.frames.filter((f:any)=>f.time>=90);add('censored-last-straight-entry-unavailable',censored,d=>{notMet(d,entry);notMet(d,repeat);});
}
for(const [hp,category]of [[100,0],[1000,1],[2000,2]]){const ids=[query(`lastspurt==${category}`,70),query(`lastspurt==${category===2?0:2}`,70)],r=owned(fixture(2),ids);r.frames=Array.from({length:101},(_,time)=>({time,runners:r.runners.map((runner:any,i:number)=>({...sample(runner.id,time*20-i*2,.3+i*.1),hp:time===0?2760:hp}))}));add(`spurt-budget-${category}`,r,d=>{met(d,ids[0]);notMet(d,ids[1]);assert.equal(row(d,ids[0]).state,'unknown');});}
for(const r of scenarios){r.race.runners[0].skills=[...new Set(r.race.runners[0].skills.map((s:any)=>s.id))].map(id=>({id,level:1}));}
await writeFile(join(ref,'metadata.json'),JSON.stringify(metadata));for(const name of ['reference-source.json','simulator-skill-ids.json'])await writeFile(join(ref,name),await readFile(join(root,'public/data',name)));
await writeFile(join(ref,'courses.json'),JSON.stringify({99991:{distance:2000,raceTrackId:10006,surface:1,turn:1,course:1,laneMax:10000,courseSetStatus:[],corners:[{start:200,length:100},{start:500,length:100},{start:900,length:100},{start:1500,length:100}],straights:[{start:0,end:200,frontType:1},{start:600,end:900,frontType:2},{start:1600,end:2000,frontType:1}],slopes:[{start:700,length:100,slope:10000},{start:1000,length:100,slope:-10000}]}}));
let cases=0;let portableResult:any=null;const failures:string[]=[];
for(const scenario of scenarios){const input=join(folder,`${scenario.name}.json`),output=join(folder,`${scenario.name}-analysis.json`);await writeFile(input,JSON.stringify(scenario.race));await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,output,'--reference-dir',ref],{cwd:root,windowsHide:true,timeout:30000});const data=JSON.parse(await readFile(output,'utf8'))[0];try{scenario.check(data);}catch(error){failures.push(`${scenario.name}: ${(error as Error).message.slice(0,220)}`);}cases++;if(scenario.name==='same-player-viewer-conjunction')portableResult={input,data};}
// isNpc is a portable boolean, never an exposed viewer/account identity.
const portable=join(folder,'portable');await run(process.execPath,['--import','tsx',join(root,'scripts/import-race.ts'),portableResult.input,portable],{cwd:root,windowsHide:true,timeout:15000});const savedPath=join(portable,(await readdir(portable))[0]),saved=JSON.parse(await readFile(savedPath,'utf8'));assert.deepEqual(saved.runners.map((r:any)=>r.isNpc),[true,false,false]);const again=join(folder,'portable-analysis.json');await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),savedPath,again,'--reference-dir',ref],{cwd:root,windowsHide:true,timeout:30000});const restored=JSON.parse(await readFile(again,'utf8'))[0];assert.deepEqual(Object.values(restored.analysis.runners).map((r:any)=>r.skillRows.map((s:any)=>s.conditionEvaluation.inferredState)),Object.values(portableResult.data.analysis.runners).map((r:any)=>r.skillRows.map((s:any)=>s.conditionEvaluation.inferredState)));assert.equal(JSON.stringify(saved).includes('viewer_id'),false);assert.equal(JSON.stringify(saved).includes('trainer_name'),false);cases++;
assert.deepEqual(await readFile(join(root,'public/data/metadata.json')),original,'Condition workflow must not modify public metadata.');
assert.deepEqual(failures,[],'Whole-file condition regressions failed.');
console.log(JSON.stringify({cases,globalPredicateKeys:100,wholeFilePipeline:'passed',wholeInventory:'passed',distanceUnits:'passed',spatialBoundaries:'passed',laneDirection:'passed',proximityTimers:'passed',targetDirection:'passed',healingNotifications:'passed',duelExistence:'passed',rushedEnemyScope:'passed',samePlayerConjunction:'passed',legacyUnknownNpc:'passed',randomAndRank:'passed',sourceUnchanged:'passed',portablePrivacy:'passed'}));
