/** Synthetic whole-file import → analysis → shared ideal comparison. No mocks. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { importRace } from '../src/data/import';
import { assembleReferenceData } from '../src/data/reference';
import { analyzeRace } from '../src/data/analytics';
import { modeImpactsFor } from '../src/data/status-mode-impact';
import { motionFor } from '../src/data/motion-analysis';
import { substantialNearIntervals } from '../src/data/status-presentation';
const root=resolve(import.meta.dirname,'..'),run=promisify(execFile);
if(process.argv[2]==='--child'){
  const request=JSON.parse(await readFile(process.argv[3],'utf8')),json=async(n:string)=>JSON.parse(await readFile(join(request.reference,n),'utf8')),
    reference=assembleReferenceData(await json('metadata.json'),await json('courses.json'),await json('reference-source.json'),[]),race=(await importRace(JSON.stringify(request.race),'synthetic-modes.json'))[0],analysis=analyzeRace(race,reference,race.courseId),runner=race.runners[0],modes=modeImpactsFor(race,reference,analysis,runner.id,race.courseId);
  assert.equal(modeImpactsFor(race,reference,analysis,runner.id,race.courseId),modes);
  const near=substantialNearIntervals(analysis.runners[runner.id].intervals,motionFor(race,reference,analysis,runner.id,race.courseId,undefined,true).samples).filter(i=>i.kind==='near-slowdown');
  await writeFile(process.argv[4],JSON.stringify({detail:analysis.runners[runner.id],modes,near}));
}else{
  const folder=resolve(process.argv[2]),reference=join(folder,'reference');await mkdir(reference,{recursive:true});
  const metadata=JSON.parse(await readFile(join(root,'public/data/metadata.json'),'utf8'));
  for(const[id,type,value,usage]of[[840001,27,3500,1],[840002,21,5000,1],[840003,31,2000,1],[840004,9,150,1],[840005,27,3500,2]])metadata.skills[id]={name:`Synthetic mode context ${id}`,rarity:1,activateLot:0,branches:[{condition:'always==1',branchIndex:0,rawDuration:100000,durationUsage:1,effects:[{type,rawValue:value,valueUsage:usage,levelUsage:1,targetType:1,additionalActivateType:0}]}]};
  metadata.skills[840006]={name:'Synthetic direct-speed penalty',rarity:1,activateLot:0,branches:[{condition:'always==1',branchIndex:0,rawDuration:100000,durationUsage:1,effects:[{type:21,rawValue:-3000,valueUsage:1,levelUsage:1,targetType:1,additionalActivateType:0}]}]};
  await writeFile(join(reference,'metadata.json'),JSON.stringify(metadata));
  const course={distance:2000,raceTrackId:10006,surface:1,turn:1,course:1,courseSetStatus:[],corners:[],straights:[{start:0,end:2000}],slopes:[] as any[]};
  await writeFile(join(reference,'courses.json'),JSON.stringify({99991:course}));await writeFile(join(reference,'reference-source.json'),await readFile(join(root,'public/data/reference-source.json')));
  let cases=0;
  const event=(id:number,start:number,duration=7.5)=>({time:start,type:3,runnerId:'r0',skillId:id,params:[0,id,duration*10000,0,1]});
  const make=(options:{on?:number;off?:number;style?:number;heal?:number;skill?:number;direct?:boolean;accel?:boolean;dh?:boolean;power?:number;slope?:number}={}):any=>{
    const style=options.style??3,power=options.power??1200,coef=style===1?[1,.98]:[.938,.998],variance=600/5500*Math.log10(60),wit=20*(variance-.325)/100,force=.0006*Math.sqrt(500*power);
    const race:any={schemaVersion:1,synthetic:true,title:'Whole-file mode inference',distance:2000,courseId:99991,category:'practice',conditions:{ground:'1',weather:'1',season:'4'},
      runners:[0,1,2].map(i=>({id:`r${i}`,name:`Synthetic ${i}`,gate:i+1,strategyCode:i===0?style:i===1?1:style,cardId:100101+i*100,mood:3,finishTimeRaw:100,finishTime:100,lastSpurtDistance:-1,stats:{speed:1000,stamina:1000,power,guts:600,wisdom:600},aptitudes:{turf:7,middle:7,front:7,late:7},skills:[840001,840002,840003,840004,840005].map(id=>({id,level:1}))})),frames:[],events:[]};
    if(options.heal!=null)race.events.push(event(840004,options.heal,0));if(options.skill!=null)race.events.push(event(840001,options.skill));if(options.direct)race.events.push(event(840002,20));if(options.accel)race.events.push(event(840003,20));
    let speed=20*coef[0]+wit,hp=2800;race.frames.push({time:0,runners:[0,1,2].map(i=>({runnerId:`r${i}`,distance:0,speed:3,hp,lane:.1+i*.1,temptationMode:0,blockFrontRunnerIndex:-1}))});
    for(let time=10;time<=46;time+=.25){const d=20*time,phase=d>=2000/6?1:0,slope=options.slope??0,mode=options.on!=null&&time>=options.on&&time<(options.off??30),mult=mode?(style===1?1.05:1.04):1,skill=options.skill!=null&&time>=options.skill&&time<options.skill+7.5?.35:0,dh=options.dh&&time>=20&&time<30,
      target=20*coef[phase]*mult+wit-(slope>0?slope*200/power:0)+skill+(dh?.4:0),a=force+(options.accel&&time>=20&&time<27.5?.2:0);
      if(time>10)speed=speed<target?Math.min(target,speed+a*.25):Math.max(target,speed-(phase===0?1.2:.8)*.25);
      if(time>10)hp-=20*(speed-20+12)**2/144*(dh?.4:1)*.25;if(time===options.heal)hp+=80;
      const direct=options.direct&&time>=20&&time<27.5?.5:0;
      race.frames.push({time,runners:[0,1,2].map(i=>({runnerId:`r${i}`,distance:d+(i===1?25:i===2?-5:0),speed:i===0?speed+direct:20,hp:i===0?hp:2800-20*time,lane:.1+i*.1,temptationMode:0,blockFrontRunnerIndex:-1}))});}
    race.frames.push({time:100,runners:[0,1,2].map(i=>({runnerId:`r${i}`,distance:2000,speed:20,hp:500,lane:.1+i*.1,temptationMode:0,blockFrontRunnerIndex:-1}))});return race;
  };
  async function analyze(name:string,race:any){const input=join(folder,`${name}.json`),output=join(folder,`${name}-result.json`);await writeFile(input,JSON.stringify({race,reference}));await run(process.execPath,['--import','tsx',import.meta.filename,'--child',input,output],{cwd:root,windowsHide:true,timeout:30000});cases++;return JSON.parse(await readFile(output,'utf8'));}
  const intervals=(r:any,kind='pace-up-model')=>r.detail.intervals.filter((i:any)=>i.kind===kind),has=(r:any,start:number,end:number,kind='pace-up-model')=>intervals(r,kind).some((i:any)=>i.start<end&&i.end>start);
  let result=await analyze('heal-does-not-censor-speed-ramp',make({on:12,off:16,heal:13.25}));assert.ok(has(result,12.5,13.25));assert.ok(intervals(result).some((i:any)=>i.start<14));
  result=await analyze('phase-crossing-until-recovery',make({on:15,off:23,heal:21.25}));assert.ok(has(result,15.5,16));assert.ok(has(result,20.5,21.25));
  result=await analyze('ordinary-phase-acceleration',make());assert.equal(intervals(result).length,0);
  result=await analyze('heal-alone-is-not-a-mode',make({heal:13.25}));assert.equal(intervals(result).length,0);
  result=await analyze('target-skill-alone-is-not-a-mode',make({skill:20}));assert.equal(has(result,20,27),false);
  result=await analyze('direct-skill-alone-is-not-a-mode',make({direct:true}));assert.equal(has(result,20.25,27),false);
  result=await analyze('acceleration-skill-alone-is-not-a-mode',make({accel:true}));assert.equal(has(result,20,27),false);
  const startup=make({style:1});startup.events=[event(840003,0,10)];
  const early=Array.from({length:40},(_,i)=>{const time=i*.25,speed=Math.min(19.974,3+24.664*Math.min(time,.6)+.664*Math.max(0,time-.6));return{time,runners:[0,1,2].map(j=>({runnerId:`r${j}`,distance:time*17+(time===0?0:j===1?20:j===2?-5:0),speed:j===0?speed:19.974,hp:2800-time*18,lane:.1+j*.1,temptationMode:0,blockFrontRunnerIndex:-1}))};});
  startup.frames=[...early,...startup.frames.filter((f:any)=>f.time>=10)];result=await analyze('known-startup-acceleration-no-mode',startup);assert.equal(has(result,0,8,'overtake-model'),false);assert.equal(has(result,0,8,'speed-up-model'),false);
  result=await analyze('mode-with-known-target-skill',make({on:19,off:28,skill:20}));assert.ok(has(result,22,26));
  const pu=result.modes.find((m:any)=>m.kind==='pace-up');assert.ok(pu);assert.ok(pu.reachableExtraDistance>0);assert.ok(pu.reachableExtraTime>0);assert.ok(pu.reachableExtraHp>0);assert.equal(pu.coverage,1);assert.ok(pu.reachableRange.distance[0]<=pu.reachableExtraDistance&&pu.reachableRange.distance[1]>=pu.reachableExtraDistance);
  const broken=make({on:19,off:28});broken.frames.find((f:any)=>f.time===24).runners[0].speed=null;result=await analyze('missing-speed-no-bridge',broken);assert.ok(intervals(result).every((i:any)=>!(i.start<24&&i.end>24)));
  const unknown=make({on:19,off:32});unknown.events=[event(840005,20)];result=await analyze('unknown-scaling-stays-unresolved',unknown);assert.equal(has(result,20,27),false);
  result=await analyze('front-overtake',make({on:19,off:28,style:1}));assert.ok(has(result,22,26,'overtake-model'));assert.equal(intervals(result,'speed-up-model').length,0);
  const traffic=(nearby=true,recorded=false)=>{
    const race=make({on:19,off:26.75,style:1});
    for(const frame of race.frames)if(frame.time>=24&&frame.time<=26.5){
      const self=frame.runners[0],front=frame.runners[1];
      self.speed-=.5-.1*(frame.time-24);
      if(nearby){front.distance=self.distance+1.5;front.lane=self.lane;front.speed=self.speed-.08;}
      if(recorded)self.blockFrontRunnerIndex=1;
    }
    return race;
  };
  result=await analyze('near-recovery-keeps-overtake-tail',traffic());
  assert.ok(intervals(result,'overtake-model').some((i:any)=>i.start<23&&i.end>=26.5&&i.end<28));
  assert.ok(result.near.some((i:any)=>i.start<25&&i.end>=26));
  result=await analyze('recorded-block-keeps-overtake-tail',traffic(true,true));
  assert.ok(intervals(result,'overtake-model').some((i:any)=>i.start<23&&i.end>=26.5&&i.end<28));
  const wideRecovery=traffic();for(const frame of wideRecovery.frames)if(frame.time>=24&&frame.time<=26.5){
    const self=frame.runners[0],front=frame.runners[1];self.speed-=.2-.1*(frame.time-24);front.distance=self.distance+3.2;front.lane=self.lane;front.speed=self.speed+.02;
  }
  result=await analyze('speed-matched-near-recovery-outside-collision-width',wideRecovery);
  assert.ok(intervals(result,'overtake-model').some((i:any)=>i.start<23&&i.end>=26.5));
  assert.ok(result.near.some((i:any)=>i.start<25&&i.end>=26.5));
  result=await analyze('clear-road-exit-ends-overtake',make({on:19,off:24,style:1}));
  assert.ok(intervals(result,'overtake-model').every((i:any)=>!(i.start<23&&i.end>=26.5)));
  assert.equal(result.near.length,0);
  const unreadableTraffic=traffic();unreadableTraffic.frames.find((f:any)=>f.time===25).runners[0].speed=null;
  result=await analyze('near-does-not-bridge-unknown-speed',unreadableTraffic);
  assert.ok(intervals(result,'overtake-model').every((i:any)=>!(i.start<25&&i.end>25)));
  for(const deficit of [.14,.15,.16]){
    const race=make({on:19,off:28,style:1});
    for(const frame of race.frames)if(frame.time>=24&&frame.time<=26.5){
      const self=frame.runners[0],front=frame.runners[1];self.speed-=deficit;front.distance=self.distance+3.2;front.lane=self.lane;front.speed=self.speed;
    }
    result=await analyze(`near-threshold-${deficit}`,race);
    assert.equal(result.near.some((i:any)=>i.start<26&&i.end>25),deficit>.15,JSON.stringify({deficit,near:result.near}));
  }
  const penalized=make({on:19,off:28,style:1});penalized.events=[event(840006,24,2.75)];
  for(const frame of penalized.frames)if(frame.time>=24&&frame.time<26.75){
    const self=frame.runners[0],front=frame.runners[1];self.speed-=.3;front.distance=self.distance+3.2;front.lane=self.lane;front.speed=self.speed;
  }
  result=await analyze('direct-speed-penalty-is-not-near-loss',penalized);
  assert.ok(!result.near.some((i:any)=>i.start<26&&i.end>25));
  result=await analyze('front-mode-capped-at-position-limit',make({on:38.5,off:41.667,style:1,power:500}));assert.ok(has(result,40,41,'overtake-model'));assert.ok(intervals(result,'overtake-model').every((i:any)=>i.end<=2000/24*10/20+1e-6));
  course.slopes=[{start:0,length:2000,slope:-10000}];await writeFile(join(reference,'courses.json'),JSON.stringify({99991:course}));
  result=await analyze('speed-skill-no-downhill-without-hp',make({skill:20}));assert.equal(intervals(result,'downhill-mode-model').length,0);
  result=await analyze('independent-downhill-with-target-skill',make({skill:20,dh:true}));assert.ok(has(result,21,26,'downhill-mode-model'));const dh=result.modes.find((m:any)=>m.kind==='downhill-mode');assert.ok(dh.reachableExtraHp<0);assert.ok(dh.reachableExtraDistance>=0);
  result=await analyze('downhill-heal-bracket-isolated',make({dh:true,heal:21.25}));assert.equal(has(result,21,21.5,'downhill-mode-model'),false);assert.ok(has(result,22,25,'downhill-mode-model'));
  const lostTail=make({dh:true});let h=2800;for(const f of lostTail.frames){if(f.time>=10&&f.time<=46){h-=20*(f.runners[0].speed-20+12)**2/144*.4*.25;f.runners[0].hp=h;}}
  result=await analyze('speed-exit-ends-downhill',lostTail);const partial=result.modes.find((m:any)=>m.kind==='downhill-mode');assert.equal(partial.complete,true);assert.ok(partial.reachableExtraDistance!==null);assert.ok(partial.assessedReachableExtraDistance!==null);
  // One imported race crossing two hills: split the existing shared comparison,
  // never run a separate counterfactual per hill or double count its tail.
  course.slopes=[{start:0,length:503,slope:-10000},{start:503,length:1497,slope:-10000}];
  await writeFile(join(reference,'courses.json'),JSON.stringify({99991:course}));
  result=await analyze('two-downhills-share-one-comparison',make({skill:20,dh:true}));
  const split=result.modes.find((m:any)=>m.kind==='downhill-mode');
  assert.equal(split.hills.length,2);
  assert.ok(split.hills.every((h:any)=>h.duration>0&&h.distance>0&&h.hp<0));
  for(const [part,total] of [['distance','assessedReachableExtraDistance'],['time','assessedReachableExtraTime'],['hp','assessedReachableExtraHp'],['duration','duration'],['carryoverDuration','carryoverDuration']])assert.ok(Math.abs(split.hills.reduce((n:number,h:any)=>n+h[part],0)-split[total])<1e-6,`${part} must reconcile with the combined result`);
  console.log(JSON.stringify({cases,paceOnset:'passed',phaseAndHeal:'passed',skillNormalization:'passed',noInventedMode:'passed',positionLimit:'passed',independentDownhill:'passed',reachableGains:'passed',unknownGaps:'passed',sharedEngine:'passed',nearContinuity:'passed',nearThreshold:'passed'}));
}
