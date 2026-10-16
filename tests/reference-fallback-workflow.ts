/** Offline catalog refresh → real file import → analysis/motion → export. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadReference, importRaceFile } from '../scripts/offline-analysis';
import { analyzeRace } from '../src/data/analytics';
import { motionFor } from '../src/data/motion-analysis';
import { effectValue } from '../src/data/effect-value';
import { assembleReferenceData, skillName } from '../src/data/reference';

const root=resolve(import.meta.dirname,'..'),folder=resolve(process.argv[2]),run=promisify(execFile);
await mkdir(folder,{recursive:true});
const pythonPath=join(root,'.cache/proxy-venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const python=process.env.UMALYTICS_TEST_PYTHON??(existsSync(pythonPath)?pythonPath:'python');
const global=JSON.parse(await readFile(join(root,'public/data/metadata.json'),'utf8'));
const globalBefore=JSON.stringify(global.skills),fixture=join(folder,'catalog');await mkdir(fixture);
const group=(value:number,extra:any={})=>({condition:'always==1',base_time:20000,effects:[{type:27,value}],...extra});
const row=(id:number,extra:any={})=>({id,rarity:1,activation:1,enname:'JP fixture',name_en:'Global fixture',iconid:20011,condition_groups:[group(1500)],...extra});
await writeFile(join(fixture,'manifest.json'),JSON.stringify({skills:'abcdef12',characters:'abcdef13','character-cards':'abcdef14'}));
await writeFile(join(fixture,'skills.json'),JSON.stringify([
  row(110161,{condition_groups:[group(999999)],loc:{en:{}}}),
  row(860001),row(860002,{loc:{en:{condition_groups:[group(3500,{precondition:'phase==1'})]}}}),
  row(140991,{rarity:5,gene_version:row(940991),loc:{en:{gene_version:{condition_groups:[group(500)]}}}}),
  row(860003,{condition_groups:[group(1500,{time_scale:99,effects:[{type:999,value:1234,value_scale:99,target:20,target_details:3,additional_activation:3}]})]}),
]));
await writeFile(join(fixture,'characters.json'),JSON.stringify([{char_id:1001,name_en:'Must not replace Global'},{char_id:9991,name_en:'Fallback runner'}]));
await writeFile(join(fixture,'character-cards.json'),JSON.stringify([{card_id:100101,title:'Must not replace Global'},{card_id:999101,title:'Fallback outfit'}]));
const generated=join(folder,'metadata.json');await writeFile(generated,JSON.stringify(global));
const command=[join(root,'scripts/fetch-gametora-fallback.py'),'--metadata',generated,'--catalog-dir',fixture];
await run(python,command,{cwd:root,windowsHide:true,timeout:15000});
const first=await readFile(generated);await run(python,command,{cwd:root,windowsHide:true,timeout:15000});
assert.deepEqual(await readFile(generated),first,'Same source snapshot must regenerate identical bytes.');
const generatedMetadata=JSON.parse(first.toString());assert.equal(JSON.stringify(generatedMetadata.skills),globalBefore);
const fallbackRef=assembleReferenceData(generatedMetadata,{},global.source,[]);
assert.deepEqual(fallbackRef.metadata.skills[110161],global.skills[110161]);
assert.equal(fallbackRef.metadata.characters[1001],global.characters[1001]);assert.equal(fallbackRef.metadata.outfits[100101],global.outfits[100101]);
assert.equal(fallbackRef.metadata.characters[9991],'Fallback runner');assert.equal(fallbackRef.metadata.outfits[999101],'Fallback outfit');
assert.equal(fallbackRef.metadata.skills[860001].dataRegion,'JP');
assert.equal(fallbackRef.metadata.skills[860002].dataRegion,'Global');assert.equal(fallbackRef.metadata.skills[860002].branches[0].effects[0].rawValue,3500);
assert.equal(fallbackRef.metadata.skills[940991].branches[0].effects[0].rawValue,500,'Inherited regional patch must remain separate.');
const unsupported=fallbackRef.metadata.skills[860003].branches[0];assert.equal(unsupported.durationUsage,99);assert.equal(unsupported.effects[0].valueUsage,99);assert.equal(unsupported.effects[0].targetType,20);

const reference=await loadReference();
assert.ok(Object.keys(reference.metadata.skills).length>2000);
assert.ok(Object.keys(reference.metadata.characters).length>=170);assert.ok(Object.keys(reference.metadata.outfits).length>=270);
assert.equal(skillName(reference,110161),'Free from the Ashes');assert.equal(reference.metadata.skills[110161].dataRegion,undefined);
const jp=Object.entries(reference.metadata.skills).find(([id,s])=>Number(id)>=200000&&Number(id)<900000&&s.dataRegion==='JP'&&s.branches.length===1&&s.branches[0].durationUsage===1&&s.branches[0].rawDuration>0&&s.branches[0].effects.every(e=>e.type===27&&e.rawValue>0&&e.valueUsage===1&&e.targetType===1))!;
assert.ok(jp,'Catalog includes a modeled JP speed fallback.');
const skillIds=[110161,110161,910161,Number(jp[0])],ids=skillIds.map((_,i)=>`reference-${i}`);
const replay={schemaVersion:1,title:'Synthetic regional catalog replay',synthetic:true,category:'practice',distance:2500,courseId:10506,conditions:{ground:'1',weather:'1',season:'4'},
  runners:ids.map((id,i)=>({id,gate:i+1,name:`Synthetic ${i+1}`,charaId:i<2?1016:1001,cardId:i<2?101602:100101,strategyCode:2,mood:3,finishOrder:i+1,finishTime:125,finishTimeRaw:125,lastSpurtDistance:1700,startDelay:.02,
    stats:{speed:1200,stamina:1000,power:1100,guts:700,wisdom:900},aptitudes:{turf:7,long:7,pace:7},skills:[{id:skillIds[i],level:i<2?4:1}]})),
  frames:Array.from({length:501},(_,i)=>({time:i/4,runners:ids.map((runnerId,j)=>({runnerId,distance:i*5,speed:i<4?3+i*5:20,hp:3300-i*4,lane:.1+j*.15,temptationMode:0,blockFrontRunnerIndex:-1}))})),
  events:ids.map((runnerId,i)=>({time:100,type:3,runnerId,skillId:skillIds[i],label:'Synthetic activation',params:[i,skillIds[i],0,i===1?1:0,0]}))};
const input=join(folder,'replay.json');await writeFile(input,JSON.stringify(replay));
const [race]=await importRaceFile(input),analysis=analyzeRace(race,reference);
for(const [i,expected] of [5500,3500,1500].entries()){
  const skill=analysis.runners[ids[i]].skillActivations[0];assert.equal(skill.effects[0].rawValue,expected);
  assert.equal(skill.effectiveDuration,i<2?12.5:7.5);assert.equal(skill.timingKind,'reference');
  assert.equal(analysis.runners[ids[i]].skillRows[0].activationStatus,'recorded');
  const impact=analysis.runners[ids[i]].skillImpacts[0];assert.ok(impact);
  assert.ok(!impact.unavailableReasons.some(reason=>reason.includes('effect scaling')||reason.includes('definition unavailable')));
  const motion=motionFor(race,reference,analysis,ids[i]);assert.ok(motion.coverage.target>.9,JSON.stringify({i,coverage:motion.coverage,reasons:motion.samples[50]?.reasons,stats:race.runners[i].stats,aptitudes:race.runners[i].aptitudes}));
  assert.ok(motion.samples.some(s=>s.time>100&&s.time<107&&s.targetActive&&s.targetBase&&s.targetActive.mid>s.targetBase.mid));
}
assert.ok(Math.abs(effectValue(race.runners[0],110161,analysis.runners[ids[0]].skillActivations[0].effects[0])!-.5885)<1e-8);
assert.ok(analysis.runners[ids[3]].skillActivations[0].effects.length>0);
assert.ok(motionFor(race,reference,analysis,ids[3]).coverage.target>.9);
const portable=join(folder,'portable.json');await run(process.execPath,['--import','tsx',join(root,'scripts/import-race.ts'),input,portable],{cwd:root,windowsHide:true,timeout:15000});
const [exported]=await readdir(portable);const [roundtrip]=await importRaceFile(join(portable,exported));assert.deepEqual(roundtrip.runners.map(r=>r.skills),race.runners.map(r=>r.skills));
const eventSlots=(r:typeof race)=>r.events.map(({runnerId,...event})=>({...event,runnerIndex:r.runners.findIndex(r=>r.id===runnerId)}));
assert.deepEqual(eventSlots(roundtrip),eventSlots(race));
console.log(JSON.stringify({globalPriority:'passed',regionalVariants:'passed',unknownCodes:'preserved',wholeReplay:'passed',brianVariants:'passed',jpFallback:'passed',portable:'passed',deterministic:'passed'}));
