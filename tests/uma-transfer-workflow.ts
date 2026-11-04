import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {assembleReferenceData} from '../src/data/reference';
import {buildUmalatorExport} from '../src/data/umalator';
import {blankUma} from '../src/sandbox/model';
import {exportUma,importUmas} from '../src/sandbox/uma-transfer';

const json=(name:string)=>JSON.parse(readFileSync(`public/data/${name}.json`,'utf8'));
const reference=assembleReferenceData(json('metadata'),json('courses'),json('reference-source'),json('simulator-skill-ids'));
const uma={...blankUma(),name:'Transfer fixture',memo:'Preserve this note',folderId:'folder',tags:['Test'],favorite:true,
  aptitudes:{turf:'A',dirt:'G',short:'C',mile:'S',middle:'A',long:'B',front:'D',pace:'A',late:'B',end:'C'},
  skills:[{id:100011,level:4},{id:200011,level:1}]} as ReturnType<typeof blankUma>;
const folders=[{id:'folder',name:'Transfer folder',color:'#8bc783',icon:'folder'}];
const exported=JSON.parse(JSON.stringify(exportUma(uma,folders,reference)));
assert.equal(exported.outfitId,String(uma.cardId));assert.equal(exported.uniqueLv,4);
assert.equal(exported.strategy,'Senkou');assert.equal(exported.distanceAptitude,'S');
assert.deepEqual(exported.skills,['100011','200011']);assert.equal(exported.kind,'umalytics-uma');
assert.deepEqual(importUmas(exported,reference),{umas:[uma],folders});
// Native files from older exports have no extension. Retain all native inputs
// across import, service persistence/restart, and another export.
const native={...exported,strategy:'Oonige',mood:2,starCount:5,uniqueLv:6,
  skills:['100011','200011-1'],forcedSkillPositions:{'200011':'800'}} as any;
delete native.kind;delete native.uma;delete native.schemaVersion;delete native.folders;
const imported=importUmas(native,reference)!;
assert.equal(imported.umas[0].skills[0].level,6);
assert.equal(imported.umas[0].exportContext?.strategy,'Oonige');
const folder=mkdtempSync(join(tmpdir(),'uma-transfer-'));
try{
  writeFileSync(join(folder,'import.json'),JSON.stringify({umas:[uma,...imported.umas],folders}));
  execFileSync(process.env.UMALYTICS_CHECK_PYTHON??'python',['tests/uma-transfer-storage.py',folder],{windowsHide:true,timeout:15000});
  const saved=JSON.parse(readFileSync(join(folder,'saved.json'),'utf8'));
  const full=saved.umas.find((u:any)=>u.name===uma.name);
  for(const key of ['stats','aptitudes','skills','memo','tags','favorite'])assert.deepEqual(full[key],uma[key as keyof typeof uma]);
  const plain=saved.umas.find((u:any)=>u.exportContext);
  const again=exportUma(plain,saved.folders,reference);
  for(const key of Object.keys(native))assert.deepEqual(again[key as keyof typeof again],native[key],`Native ${key} survived the library`);
  plain.skills.push({id:200012,level:1});assert.ok(exportUma(plain,[],reference).skills.includes('200012'),'Newly equipped skills must not disappear behind imported context');
  const race={id:'race',courseId:10606,distance:2400,title:'Fixture',runners:[],frames:[],events:[],warnings:[],conditions:{},duration:120} as any;
  const runner={...uma,id:'runner',index:0,gate:1,strategyCode:2,mood:3,starCount:3} as any;
  const raceExport=buildUmalatorExport(runner,race,reference);
  assert.deepEqual(raceExport.missing,[]);
  const replayImport=importUmas(JSON.parse(raceExport.json!),reference)!;
  assert.deepEqual(replayImport.umas[0].skills,uma.skills);
  assert.deepEqual(replayImport.umas[0].aptitudes,uma.aptitudes);
  for(const bad of [{...native,mood:8},{...native,speed:null},{...native,skills:['bad']},{...native,forcedSkillPositions:[]}])assert.throws(()=>importUmas(bad,reference));
}finally{rmSync(folder,{recursive:true,force:true});}
console.log('Uma transfer passed: dual-format exports, full library metadata, native import, unique levels, forced positions, persistence/restart, race-runner import, and invalid input rejection.');
