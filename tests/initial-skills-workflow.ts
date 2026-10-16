/** Synthetic whole-file import -> real analysis CLI -> portable roundtrip.
 * A time-zero skill event is a recorded start activation, including duration -1. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run=promisify(execFile),root=resolve(import.meta.dirname,'..'),folder=resolve(process.argv[2]);
await mkdir(folder,{recursive:true});
const metadata=JSON.parse(await readFile(join(root,'public/data/metadata.json'),'utf8')),source=JSON.parse(await readFile(join(root,'public/data/reference-source.json'),'utf8'));
const ids=[200012,200141,200431,200531,201601];
const meta=()=>({...metadata,skills:Object.fromEntries(ids.map(id=>[id,structuredClone(metadata.skills[id])]))});
const marker=(id:number,time=0)=>({time,type:3,runnerId:'synthetic-1',skillId:id,label:'Synthetic initial marker',params:[0,id,-1,0,0,0]});
function fixture(extra=.6){
  let speed=3,distance=0,dash=true;
  const frames=Array.from({length:181},(_,i)=>{
    const time=i/15;if(i){const accel=.0006*Math.sqrt(500*1000)+(time<=3?.4:0)+(time<=7.5?.2:0)+(extra-.6);
      if(dash){speed=Math.min(.85*19.5,speed+(24+accel)/15);if(speed>=.85*19.5-1e-9)dash=false;}
      else speed=Math.max(.85*19.5+Math.sqrt(200*1000)*.001,Math.min(20,speed+accel/15));
      distance+=speed/15;
    }
    return {time,runners:[{runnerId:'synthetic-1',distance,speed:Math.floor((speed+1e-9)*100)/100,hp:3205-i,lane:.3,temptationMode:0,blockFrontRunnerIndex:-1}]};
  });
  return {schemaVersion:1,title:'Synthetic initial timed skills',synthetic:true,distance:2500,courseId:99999,category:'practice',conditions:{ground:'1',weather:'1',season:'4'},
    runners:[{id:'synthetic-1',gate:1,name:'Synthetic runner',cardId:100101,charaId:1001,strategyCode:1,mood:3,startDelay:.02,lastSpurtDistance:-1,
      stats:{speed:1000,stamina:1000,power:1000,guts:1000,wisdom:1000},aptitudes:{turf:7,long:7,front:7},skills:ids.map(id=>({id,level:1}))}],frames,events:ids.map(id=>marker(id))};
}
let cases=0;
async function evaluate(name:string,race:any,reference:any=meta()){
  const path=join(folder,name),ref=join(path,'reference');await mkdir(ref,{recursive:true});
  const input=join(path,'input.json'),output=join(path,'analysis.json'),bytes=JSON.stringify(race);await writeFile(input,bytes);
  await Promise.all([writeFile(join(ref,'metadata.json'),JSON.stringify(reference)),writeFile(join(ref,'reference-source.json'),JSON.stringify(source)),writeFile(join(ref,'courses.json'),JSON.stringify({99999:{distance:2500,raceTrackId:10006,surface:1,turn:1,course:1,laneMax:10000,courseSetStatus:[],corners:[],straights:[{start:0,end:2500}],slopes:[]}}))]);
  await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),input,output,'--reference-dir',ref],{cwd:root,windowsHide:true,timeout:30000});
  assert.equal(await readFile(input,'utf8'),bytes,'analysis must preserve source bytes');cases++;
  const result=JSON.parse(await readFile(output,'utf8'))[0].analysis,detail:any=Object.values(result.runners)[0];
  return {path,input,ref,result,detail,initial:detail.skillActivations.filter((a:any)=>a.activationEvidence==='estimated')};
}
const good=await evaluate('supported',fixture());
assert.equal(good.initial.length,0);
for(const [id,end] of [[200531,3],[201601,7.5]]){
  const a=good.detail.skillActivations.find((a:any)=>a.skillId===id),row=good.detail.skillRows.find((r:any)=>r.skillId===id);
  assert.equal(a.activationEvidence,'recorded');assert.equal(a.start,0);assert.equal(a.duration,null);assert.equal(a.end,null);assert.equal(a.effectiveEnd,end);assert.equal(a.timingKind,'reference');
  assert.equal(row.activationCount,1);assert.equal(row.activationStatus,'recorded');assert.equal(row.effectiveActive,true);assert.equal(row.evidence,'recorded');
}
assert.equal(good.detail.skillRows.find((r:any)=>r.skillId===200431).activationStatus,'recorded');
const noInitial=(r:any)=>assert.equal(r.initial.length,0);
noInitial(await evaluate('baseline-not-skill',fixture(0)));
const unmet=meta();unmet.skills[200531].branches[0].condition='running_style==2&phase==0';noInitial(await evaluate('wrong-style-condition',fixture(),unmet));
const pre=meta();pre.skills[200531].branches[0].precondition='mystery_hidden_state==1';noInitial(await evaluate('unknown-precondition',fixture(),pre));
const missingGreens=fixture();missingGreens.events=missingGreens.events.filter(e=>![200012,200141].includes(e.skillId));noInitial(await evaluate('count-prerequisites-not-assumed',missingGreens));
const late=fixture();late.events=late.events.map(e=>[200531,201601].includes(e.skillId)?marker(e.skillId,5):e);noInitial(await evaluate('late-minus-one-withheld',late));
const branch=fixture();branch.events.find(e=>e.skillId===200531)!.params[3]=1;noInitial(await evaluate('unknown-branch',branch));
const blocked=fixture();for(const f of blocked.frames)f.runners[0].blockFrontRunnerIndex=0;noInitial(await evaluate('blocking-contamination',blocked));
const rushed=fixture();for(const f of rushed.frames)f.runners[0].temptationMode=4;noInitial(await evaluate('rushed-contamination',rushed));
const power=fixture();power.runners[0].stats.power=null as any;noInitial(await evaluate('unknown-power',power));
const gap=fixture();gap.frames=gap.frames.filter((_,i)=>i===0||i%15===0);noInitial(await evaluate('coarse-evidence',gap));
const cap=fixture();for(const f of cap.frames)if(f.time>.6)f.runners[0].speed=20;noInitial(await evaluate('already-at-cap',cap));
const ambiguous=fixture(),ambMeta=meta();ambMeta.skills[201602]={...structuredClone(ambMeta.skills[201601]),groupId:901602};ambMeta.skills[201602].branches[0].condition='always==1';ambiguous.runners[0].skills.push({id:201602,level:1});ambiguous.events.push(marker(201602));noInitial(await evaluate('same-accel-alternative-ambiguous',ambiguous,ambMeta));
const scaling=meta();scaling.skills[200531].branches[0].effects[0].valueUsage=11;noInitial(await evaluate('unknown-effect-scaling',fixture(),scaling));
const duration=meta();duration.skills[200531].branches[0].durationUsage=2;noInitial(await evaluate('nonordinary-duration',fixture(),duration));
const competing=fixture(),compMeta=meta();compMeta.skills[200532]=structuredClone(compMeta.skills[200531]);competing.runners[0].skills.push({id:200532,level:1});noInitial(await evaluate('competing-group',competing,compMeta));
const real=fixture();real.events.find(e=>e.skillId===200531)!.params[2]=30000;const recorded=await evaluate('recorded-not-duplicated',real);assert.equal(recorded.detail.skillActivations.filter((a:any)=>a.skillId===200531).length,1);assert.equal(recorded.detail.skillRows.find((r:any)=>r.skillId===200531).activationCount,1);
const duplicate=fixture();duplicate.events.push(marker(200531));noInitial(await evaluate('duplicate-markers',duplicate));
const portable=join(good.path,'portable');await run(process.execPath,['--import','tsx',join(root,'scripts/import-race.ts'),good.input,portable],{cwd:root,windowsHide:true,timeout:15000});
const saved=join(portable,(await readdir(portable))[0]),output=join(good.path,'portable-analysis.json');await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-race.ts'),saved,output,'--reference-dir',good.ref],{cwd:root,windowsHide:true,timeout:30000});
const after:any=Object.values(JSON.parse(await readFile(output,'utf8'))[0].analysis.runners)[0];assert.deepEqual(after.skillActivations,good.detail.skillActivations);cases++;
console.log(JSON.stringify({cases,wholeFilePipeline:'passed',initialInference:'passed',recordedCountsPreserved:'passed',ambiguousAndMissingWithheld:'passed',portable:'passed'}));
