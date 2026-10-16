import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),root=resolve(import.meta.dirname,'..'),folder=resolve(process.argv[2]);
await mkdir(folder,{recursive:true});
const publicBytes=await readFile(join(root,'public/data/metadata.json'));
const auditPath=join(folder,'catalog.json');
await run(process.execPath,['--import','tsx',join(root,'scripts/report-condition-coverage.ts'),join(root,'public/data/metadata.json'),auditPath],{cwd:root,windowsHide:true,timeout:30000});
const audit=JSON.parse(await readFile(auditPath,'utf8'));
assert.equal(audit.skills,734);assert.equal(audit.branches,788);assert.equal(audit.predicateKeys,100);assert.equal(audit.invalidExpressions,0);assert.equal(audit.unsupportedKeys,0);
assert.equal(audit.understoodKeys,100);assert.equal(audit.partialKeys,0);assert.equal(audit.understoodBranches,788);
assert.equal(audit.conditionReference.reviewedKeys,100);assert.deepEqual(audit.conditionReference.unreviewedKeys,[]);
assert.ok(audit.keys.every((k:any)=>k.gametora?.reviewed===true&&k.gametora.key===k.key&&/^[a-f0-9]{64}$/.test(k.gametora.sectionSha256)));
assert.equal(audit.keys.reduce((n:number,k:any)=>n+k.occurrences,0),audit.parsedAtoms);
assert.ok(audit.keys.every((k:any)=>k.skillIds.length&&k.branches.length&&k.expressions.length&&k.simulator));
const emptyBranches=Object.values(JSON.parse(publicBytes.toString()).skills).flatMap((s:any)=>s.branches).filter((b:any)=>!b.condition&&!b.precondition).length;
assert.equal(new Set(audit.keys.flatMap((k:any)=>k.branches)).size+emptyBranches,788);
assert.deepEqual(audit,JSON.parse(await readFile(join(root,'docs/condition-coverage.json'),'utf8')),'committed catalog report must be reproducible');
const metadata=JSON.parse(publicBytes.toString()),reference=join(folder,'reference');await mkdir(reference);
for(const name of ['courses.json','reference-source.json','simulator-skill-ids.json'])await writeFile(join(reference,name),await readFile(join(root,'public/data',name)));
const rules=[
 'is_used_skill_id==200351&phase>=2','is_used_skill_id==999999&phase>=2',
 'always==1','phase_random==1&distance_type==3','phase_random==1&order<=3',
 'always==1','near_count>=1','is_used_skill_id==900031&phase>=2',
 'is_activate_other_skill_detail==1','visiblehorse>=1&accumulatetime>=21',
 'visiblehorse>=1&accumulatetime>=30',
];
for(const [i,condition]of rules.entries())metadata.skills[890001+i]={name:`Synthetic condition catalog ${i}`,rarity:1,groupId:89000+i,activateLot:i===5?0:1,branches:[{branchIndex:0,condition,precondition:'',rawDuration:30000,durationUsage:1,effects:[{type:27,rawValue:1500,valueUsage:1,levelUsage:1,targetType:1}]}]};
// GameTora: another trigger of THIS skill, not any earlier activation of the
// same trigger. Branch 1 waits for a recorded branch 0 activation.
metadata.skills[890009].branches[0].branchIndex=1;
metadata.skills[890009].branches.push({...structuredClone(metadata.skills[890009].branches[0]),branchIndex:0,condition:'always==1'});
metadata.skills[890020]={name:'Synthetic timed vision',rarity:1,groupId:89020,activateLot:0,branches:[{branchIndex:0,condition:'always==1',precondition:'',rawDuration:20000,durationUsage:1,effects:[{type:8,rawValue:100000,valueUsage:1,levelUsage:1,targetType:1}]}]};
metadata.skills[890021]={...structuredClone(metadata.skills[890020]),name:'Synthetic unresolved vision branch',branches:[0,1].map(branchIndex=>({...structuredClone(metadata.skills[890020].branches[0]),branchIndex}))};
metadata.skills[890022]={...structuredClone(metadata.skills[890021]),name:'Synthetic unresolved foreign vision branch'};
for(const b of metadata.skills[890022].branches)for(const e of b.effects){e.targetType=2;e.rawValue=-100000;}
// Public catalog branches are installed as independently addressable probes so
// the real importer + analysis CLI evaluates every branch, including mutually
// exclusive branches of the same source skill, in one complete synthetic race.
const probes=Object.values(JSON.parse(publicBytes.toString()).skills).flatMap((s:any)=>s.branches.map((b:any)=>({skill:s,branch:b})));
for(const [i,{skill,branch}]of probes.entries())metadata.skills[910000+i]={...skill,name:`Public catalog branch probe ${i}`,groupId:910000+i,branches:[{...branch,branchIndex:0}]};
await writeFile(join(reference,'metadata.json'),JSON.stringify(metadata));
const ids=Array.from({length:9},(_,i)=>`catalog-${i}`),times=[0,10,20,21,22,24,25,30,50,60,70,80,90,100,110,120];
const base:any={schemaVersion:1,title:'Synthetic complete condition catalog workflow',synthetic:true,category:'practice',distance:2400,courseId:10606,
 runners:ids.map((id,i)=>({id,gate:i+1,charaId:1001+i,cardId:(1001+i)*100+1,name:`Synthetic ${i+1}`,strategyCode:3,mood:3,finishOrder:i+1,finishTimeRaw:120,finishTime:120,teamGroup:i===0?1:2,
 stats:{speed:1000,stamina:1000,power:1000,guts:600,wisdom:600},aptitudes:{turf:7,middle:7,late:7},skills:i===0?[...rules.map((_,i)=>890001+i),890020,100031].map(id=>({id,level:1})):[]})),
 frames:times.map(time=>({time,runners:ids.map((runnerId,i)=>({runnerId,distance:time===0?0:time===120?2400:20*time+(i===1?25:-i*8),speed:20,hp:3000-time*7,lane:.1,temptationMode:0,blockFrontRunnerIndex:-1}))})),
 events:[{time:20,type:3,runnerId:ids[0],skillId:890020,label:'Synthetic vision',params:[0,890020,0,0]},{time:50,type:3,runnerId:ids[0],skillId:200351,label:'Synthetic recovery',params:[0,200351,0,0]},
 {time:60,type:3,runnerId:ids[0],skillId:100031,label:'Synthetic inherited unique',params:[0,100031,0,0]},{time:70,type:3,runnerId:ids[0],skillId:890009,label:'Synthetic first activation',params:[0,890009,10000,0]}],warnings:['Public synthetic fixture; no private capture.']};
async function analyze(race:any,name:string){const input=join(folder,`${name}.json`),output=join(folder,`${name}-analysis.json`);await writeFile(input,JSON.stringify(race));await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,output,'--reference-dir',reference],{cwd:root,windowsHide:true,timeout:30000});return JSON.parse(await readFile(output,'utf8'))[0].analysis.runners[ids[0]];}
const complete=await analyze(base,'complete'),row=(report:any,id:number)=>report.skillRows.find((r:any)=>r.skillId===id),branch=(report:any,id:number)=>row(report,id).conditionEvaluation.branches[0];
assert.equal(branch(complete,890001).state,'met','specific prerequisite compares requested ID, not boolean1');
assert.equal(branch(complete,890002).state,'unknown','missing event is not proven failure');
assert.equal(row(complete,890003).activationStatus,'wit-failure-inferred');assert.equal(branch(complete,890003).inferenceBasis,'observed');
assert.equal(branch(complete,890004).inferredState,'met');assert.equal(branch(complete,890004).inferenceBasis,'complete-random-region');assert.equal(row(complete,890004).activationStatus,'wit-failure-inferred');
assert.equal(branch(complete,890005).state,'unknown');assert.equal(branch(complete,890005).inferredState,'met');assert.equal(branch(complete,890005).inferenceBasis,'recorded-conjunction');assert.equal(row(complete,890005).activationStatus,'wit-failure-inferred');
assert.equal(row(complete,890006).activationStatus,'conditions-met','lottery-free skill must not be called wit failure');
assert.equal(row(complete,890007).activationStatus,'conditions-inferred');assert.equal(branch(complete,890007).inferenceBasis,'replay-proxy');
assert.equal(branch(complete,890008).state,'met','raw inherited event resolves to equipped reference ID');
assert.ok(Math.abs(branch(complete,890009).firstOpportunity-(70+1/15))<1e-9,'current proc does not count itself; a prior different trigger of the same skill qualifies');
const sameTrigger=structuredClone(base);sameTrigger.events.find((e:any)=>e.skillId===890009).params[3]=1;
assert.equal(branch(await analyze(sameTrigger,'same-trigger'),890009).opportunities,0,'another activation of the same trigger does not qualify');
assert.equal(branch(complete,890010).firstOpportunity,21,'reference duration supplies active vision after missing reported end');
assert.equal(branch(complete,890011).opportunities,0,'vision expires at resolved reference duration');
const partial=structuredClone(base);partial.frames=partial.frames.filter((f:any)=>f.time>=10);const censored=await analyze(partial,'censored');assert.notEqual(row(censored,890003).activationStatus,'wit-failure-inferred');assert.notEqual(row(censored,890004).activationStatus,'wit-failure-inferred');
const unknownInventory=structuredClone(base);delete unknownInventory.runners[8].skills;const inventory=await analyze(unknownInventory,'missing-inventory');assert.notEqual(row(inventory,890003).activationStatus,'wit-failure-inferred');
const noVision=structuredClone(base);noVision.events=noVision.events.filter((e:any)=>e.skillId!==890020);const off=await analyze(noVision,'no-vision');assert.equal(branch(off,890010).opportunities,0);
// A recorded vision proc with an unresolved trigger must not become zero vision
// gain/cost. Exercise the actual importer and analysis process, including expiry.
const unknownVision=structuredClone(noVision);unknownVision.runners[0].skills.push({id:890021,level:1});
unknownVision.events.push({time:20,type:3,runnerId:ids[0],skillId:890021,label:'Synthetic unresolved vision',params:[0,890021,40000,99,1]});
const unknownOwn=await analyze(unknownVision,'unknown-vision-branch');
assert.ok(branch(unknownOwn,890010).missingInputs.some((s:string)=>s.includes('visiblehorse')),'unresolved own vision branch must leave visibility unknown');
assert.equal(branch(unknownOwn,890011).state,'unmet','reported expiry resolves the visibility uncertainty before the required time');
const unknownForeign=structuredClone(noVision);unknownForeign.runners[1].skills.push({id:890022,level:1});
unknownForeign.events.push({time:20,type:3,runnerId:ids[1],skillId:890022,label:'Synthetic unresolved foreign vision',params:[1,890022,40000,99,3]});
const foreign=await analyze(unknownForeign,'unknown-foreign-vision-branch');
assert.ok(branch(foreign,890010).missingInputs.some((s:string)=>s.includes('visiblehorse')),'targeted unresolved foreign vision branch must leave visibility unknown');
unknownForeign.events.at(-1).params[4]=2;
assert.equal(branch(await analyze(unknownForeign,'unselected-foreign-vision-branch'),890010).missingInputs.some((s:string)=>s.includes('visiblehorse')),false,'a recipient mask can exclude the subject before resolving the branch');
for(const selected of [0,99]){
  const expired=structuredClone(unknownForeign);expired.events.at(-1).params=[1,890022,40000,selected];
  const after=await analyze(expired,`expired-foreign-vision-missing-mask-${selected}`);
  assert.ok(branch(after,890010).missingInputs.some((s:string)=>s.includes('visiblehorse')),'an active foreign vision proc with missing mask stays unknown');
  assert.equal(branch(after,890011).state,'unmet','expiry resolves missing-mask uncertainty for known and unknown branches');
}
const entireCatalog=structuredClone(base);entireCatalog.events=[];entireCatalog.runners[0].skills=probes.map((_:unknown,i:number)=>({id:910000+i,level:1}));
const catalog=await analyze(entireCatalog,'all-global-branches'),evaluations=catalog.skillRows.filter((r:any)=>r.skillId>=910000&&r.skillId<910788).map((r:any)=>r.conditionEvaluation.branches[0]);
assert.equal(evaluations.length,788);assert.equal(new Set(evaluations.flatMap((b:any)=>b.predicates.map((p:any)=>p.key))).size,100);
assert.ok(evaluations.every((b:any)=>b.mechanicsState!=='unsupported'&&b.absenceAssessment&&b.inferenceBasis));
assert.deepEqual(await readFile(join(root,'public/data/metadata.json')),publicBytes);
console.log(JSON.stringify({globalSkills:audit.skills,globalBranches:audit.branches,predicateKeys:audit.predicateKeys,cases:22,wholeCatalog:'passed',sourceAudit:'passed',specificSkillHistory:'passed',inferenceBoundaries:'passed',visionTiming:'passed',metadata:'unchanged'}));
