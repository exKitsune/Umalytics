/** Whole-file import → reference join → actual analytics → component metrics →
 * portable roundtrip. All inputs below are explicitly synthetic public data. */
import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile,readdir } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { importRace } from '../src/data/import';
import { assembleReferenceData } from '../src/data/reference';
import { analyzeRace } from '../src/data/analytics';
import { metricsForSkill } from '../src/data/skill-metrics';
const root=resolve(import.meta.dirname,'..'),run=promisify(execFile);
if(process.argv[2]==='--evaluate'){
  const [input,ref,output]=process.argv.slice(3),bytes=await readFile(input),[race]=await importRace(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,'metric-workflow.json');
  const json=async(name:string)=>JSON.parse(await readFile(join(ref,name),'utf8'));
  const reference=assembleReferenceData(await json('metadata.json'),await json('courses.json'),await json('reference-source.json'),[]),analysis=analyzeRace(race,reference);
  const result=Object.fromEntries(race.runners.flatMap(r=>analysis.runners[r.id].skillRows.map(row=>[`${r.id}:${row.skillId}`,metricsForSkill(race,reference,analysis,r.id,row.skillId)])));
  await writeFile(output,JSON.stringify({result,stat:analysis.runners[race.runners[0].id].statBreakdown,events:race.events,skills:race.runners[0].skills}));
}else{
  const folder=resolve(process.argv[2]);await mkdir(folder,{recursive:true});
  const source=JSON.parse(await readFile(join(root,'public/data/reference-source.json'),'utf8'));
  const names=['speed','stamina','power','guts','wisdom'];
  const effect=(type:number,rawValue:number,extra:any={})=>({type,rawValue,targetType:1,valueUsage:1,levelUsage:1,...extra});
  const definition=(effects:any[],passive=true,extra:any={})=>({name:'Synthetic component',rarity:1,groupId:1,activateLot:0,tagId:0,branches:[{branchIndex:0,precondition:'',condition:'always==1',rawDuration:passive?-1:20000,durationUsage:1,effects}],...extra});
  const metadata=()=>({characters:{},outfits:{},trackNames:{},skillNames:{},source,skills:{
    ...Object.fromEntries(names.map((_,i)=>[700101+i,definition([effect(i+1,600000)])])),
    700106:definition([effect(8,50000)]),700107:definition([effect(10,4000)],false),700108:definition([effect(10,9000)],false),700109:definition([effect(14,850)],false),
    700110:definition([effect(28,10000)],false),700111:definition([effect(35,20000)],false),700112:definition([effect(29,-30000)]),700113:definition([effect(13,50000)],false),
    202051:definition([effect(6,10000)]),700114:definition([effect(37,10000)],false),700115:definition([effect(21,1000)],false,{rarity:2}),700116:definition([effect(501,10000),effect(502,10000),effect(503,10000)]),
    700117:definition([effect(1,600000,{valueUsage:3})]),700118:definition([effect(8,100000,{targetType:4})],false),700119:definition([effect(1,600000,{additionalActivateType:1})]),
  }});
  const fixture=(skills:number[])=>({schemaVersion:1,title:'Explicit synthetic component workflow',synthetic:true,distance:2000,courseId:99999,category:'practice',conditions:{ground:'1',weather:'1',season:'4'},
    runners:[{id:'fixture-1',gate:1,name:'Synthetic runner',cardId:100101,charaId:1001,strategyCode:1,mood:3,finishOrder:1,finishTime:100,finishTimeRaw:100,lastSpurtDistance:-1,startDelay:.018,
      stats:{speed:1000,stamina:1000,power:1000,guts:1000,wisdom:1000},aptitudes:{turf:7,middle:7,front:7},skills:skills.map(id=>({id,level:1}))}],
    frames:Array.from({length:401},(_,i)=>({time:i/4,runners:[{runnerId:'fixture-1',distance:i*5,speed:20,hp:2760-i*5,lane:.1+i/4000,temptationMode:i>=200&&i<240?1:0,blockFrontRunnerIndex:-1}]})),events:[] as any[]});
  const event=(id:number,time=0,duration=0)=>({time,type:3,runnerId:'fixture-1',skillId:id,label:'Synthetic activation',params:[0,id,duration*10000,0,0]});
  let cases=0;
  async function evaluate(name:string,race:any,meta:any=metadata()){
    const path=join(folder,name),ref=join(path,'reference');await mkdir(ref,{recursive:true});const input=join(path,'input.json'),output=join(path,'metrics.json');await writeFile(input,JSON.stringify(race));await writeFile(join(ref,'metadata.json'),JSON.stringify(meta));await writeFile(join(ref,'reference-source.json'),JSON.stringify(source));await writeFile(join(ref,'courses.json'),JSON.stringify({99999:{distance:2000,raceTrackId:10006,surface:1,turn:1,course:1,laneMax:10000,courseSetStatus:[],corners:[],straights:[{start:0,end:2000}],slopes:[]}}));
    await run(process.execPath,['--import','tsx',import.meta.filename,'--evaluate',input,ref,output],{cwd:root,windowsHide:true,timeout:30000});cases++;return {input,ref,path,...JSON.parse(await readFile(output,'utf8'))};
  }
  const metric=(r:any,id:number,label:string)=>{const m=r.result[`fixture-1:${id}`]?.find((m:any)=>m.label===label);assert.ok(m,`${id} ${label} missing`);return m;};
  const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} ≠ ${expected}`);
  const p=await evaluate('passives',fixture([700101,700102,700103,700104,700105,700106,700112]));
  for(let i=0;i<5;i++)near(metric(p,700101+i,`${i===4?'Wit':names[i][0].toUpperCase()+names[i].slice(1)} stat`).value,60);
  near(metric(p,700102,'Starting HP contribution').value,.8*.95*60);assert.ok(metric(p,700101,'Late target coefficient').value>0);assert.ok(metric(p,700103,'Initial acceleration coefficient').value>0);assert.ok(metric(p,700104,'Late HP drain change').value<0);assert.ok(metric(p,700105,'Mean section target coefficient').value>0);near(metric(p,700106,'Vision modifier').value,5);near(metric(p,700112,'Rushed chance modifier').value,-3);
  const gate=fixture([700107,700108]);gate.events=[event(700107),event(700108)];const g=await evaluate('gate-products',gate);near(metric(g,700107,'Inferred raw gate draw').value,.05);near(metric(g,700107,'Gate delay saved').value,.027);near(metric(g,700108,'Gate delay saved').value,.002);
  const overridden=structuredClone(gate);overridden.runners[0].skills.push({id:700109,level:1});overridden.events.push(event(700109));overridden.runners[0].startDelay=.085;const o=await evaluate('gate-override',overridden);near(metric(o,700109,'Gate delay override').value,.085);assert.equal(metric(o,700109,'Inferred raw gate draw').value,null);assert.match(metric(o,700107,'Gate delay saved').reason,/override/);
  const zeroMeta=metadata();zeroMeta.skills[700107].branches[0].effects[0].rawValue=0;const z=await evaluate('gate-zero',gate,zeroMeta);assert.equal(metric(z,700107,'Inferred raw gate draw').value,null);assert.match(metric(z,700107,'Gate delay saved').reason,/noninvertible/);
  const gateUnknown=metadata();gateUnknown.skills[700108].branches[0].condition='mystery==1';const guRace=fixture([700107,700108]);guRace.events=[event(700107)];const gu=await evaluate('gate-unknown',guRace,gateUnknown);assert.equal(metric(gu,700107,'Gate delay saved').value,null);
  const lanes=fixture([700110,700111]);lanes.events=[event(700110,50,2),event(700111,50,2)];const l=await evaluate('lateral',lanes);near(metric(l,700110,'Sampled lane travel').value,.002);near(metric(l,700111,'Target-lane setting').value,2);assert.match(metric(l,700110,'Sampled lane travel').detail,/no per-skill causal/);
  const laneMissing=structuredClone(lanes);laneMissing.frames[203].runners[0].lane=null as any;const lm=await evaluate('lane-gap',laneMissing);assert.equal(metric(lm,700110,'Sampled lane travel').value,null);
  const rush=fixture([700113]);rush.events=[event(700113,52,2)];const r=await evaluate('rush-reset',rush);near(metric(r,700113,'Rushed reset timer').value,5);near(metric(r,700113,'Rushed observed after activation').value,8);
  const runaway=await evaluate('runaway',fixture([202051]));assert.equal(metric(runaway,202051,'Running style').value,'Runaway');near(metric(runaway,202051,'Early target coefficient').value,1.26);near(metric(runaway,202051,'Starting HP style change').value,-72);
  const random=fixture([700114,700115]);random.events=[event(700114,50,2),event(700115,50,2)];const rd=await evaluate('random-candidates',random);near(metric(rd,700114,'Requested gold activations').value,1);near(metric(rd,700114,'Same-frame gold candidates').value,1);assert.match(metric(rd,700114,'Same-frame gold candidates').detail,/not reported/);
  const carnival=await evaluate('carnival',fixture([700116]));assert.equal(carnival.result['fixture-1:700116'].length,3);assert.ok(carnival.result['fixture-1:700116'].every((m:any)=>m.value===null&&/unsupported/.test(m.reason)));
  // Missing training totals use the documented maximum tier; additional-hit
  // counts remain unknown and must not be inferred from equipped skills.
  const unknown=await evaluate('unknown-training',fixture([700117,700119]));near(metric(unknown,700117,'Speed stat').value,72);assert.match(metric(unknown,700117,'Speed stat').detail,/Training-team total.*assumes the maximum 1\.2 tier/);assert.equal(metric(unknown,700119,'Speed stat').value,null);
  const foreign=fixture([700118]);foreign.events=[event(700118,50,2)];const f=await evaluate('foreign-vision',foreign);near(metric(f,700118,'Vision modifier').value,10);assert.match(metric(f,700118,'Vision modifier').detail,/immunity/);assert.ok(!f.result['fixture-1:700118'].some((m:any)=>/gain|damage/.test(m.label)));
  const cap=fixture([700101]);cap.runners[0].stats.speed=4000;const cp=await evaluate('capped-stat',cap);near(metric(cp,700101,'Speed stat').value,60);near(metric(cp,700101,'Late target coefficient').value,0);
  const missingStats=fixture([700102]);missingStats.runners[0].stats.stamina=null as any;const ms=await evaluate('missing-stat',missingStats);near(metric(ms,700102,'Stamina stat').value,60);assert.equal(metric(ms,700102,'Starting HP contribution').value,null);
  const portable=join(g.path,'portable');await run(process.execPath,['--import','tsx',join(root,'scripts/import-race.ts'),g.input,portable],{cwd:root,windowsHide:true,timeout:15000});const saved=join(portable,(await readdir(portable))[0]),portableOut=join(g.path,'portable-metrics.json');await run(process.execPath,['--import','tsx',import.meta.filename,'--evaluate',saved,g.ref,portableOut],{cwd:root,windowsHide:true,timeout:30000});const again=JSON.parse(await readFile(portableOut,'utf8'));assert.deepEqual(Object.values(again.result),Object.values(g.result));assert.deepEqual(again.events.map(({runnerId,...e}:any)=>e),g.events.map(({runnerId,...e}:any)=>e));assert.deepEqual(again.skills,g.skills);cases++;
  console.log(JSON.stringify({cases,synthetic:true,wholeFilePipeline:'passed',passiveCoefficients:'passed',gateInversion:'passed',lateralSampling:'passed',rushedAndRunaway:'passed',randomAssociation:'passed',unsupportedWithheld:'passed',portable:'passed'}));
}
