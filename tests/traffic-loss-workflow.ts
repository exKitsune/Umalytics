/** Whole-file importer + real shared motion engine; no private race fixtures. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const root=resolve(import.meta.dirname,'..'),folder=resolve(process.argv[2]),run=promisify(execFile);await mkdir(folder,{recursive:true});
const reference=join(folder,'reference');await mkdir(reference);
for(const name of ['metadata.json','reference-source.json','simulator-skill-ids.json'])await writeFile(join(reference,name),await readFile(join(root,'public/data',name)));
const metadata=JSON.parse(await readFile(join(reference,'metadata.json'),'utf8'));
for(const[id,type,rawValue]of[[850001,27,3500],[850002,21,3000],[850003,31,2000],[850004,21,-3000]])metadata.skills[id]={name:`Synthetic traffic context ${id}`,rarity:1,activateLot:0,branches:[{condition:'always==1',branchIndex:0,rawDuration:100000,durationUsage:1,effects:[{type,rawValue,valueUsage:1,levelUsage:1,targetType:1,additionalActivateType:0}]}]};
await writeFile(join(reference,'metadata.json'),JSON.stringify(metadata));
await writeFile(join(reference,'courses.json'),JSON.stringify({99993:{distance:2000,raceTrackId:10006,surface:1,turn:1,course:1,laneMax:15000,courseSetStatus:[],corners:[],straights:[{start:0,end:2000}],slopes:[]}}));
const fixture=():any=>({schemaVersion:1,synthetic:true,title:'Synthetic continuous traffic reference',courseId:99993,distance:2000,category:'practice',conditions:{ground:'1',weather:'1',season:'1'},
 runners:[0,1].map(i=>({id:`traffic-${i}`,gate:i+1,name:`Synthetic ${i}`,cardId:100101+i*100,strategyCode:1,mood:3,teamGroup:i+1,startDelay:0,lastSpurtDistance:-1,finishTime:100,finishTimeRaw:100,
 stats:{speed:1000,stamina:1000,power:1200,guts:500,wisdom:600},aptitudes:{turf:7,middle:7,front:7},skills:[]})),
 frames:Array.from({length:401},(_,i)=>i/4).map(time=>({time,runners:[0,1].map(i=>({runnerId:`traffic-${i}`,distance:20*time+(i?100:0),speed:time===0?3:19.6,hp:3000-time*20,lane:i?.6:.1,temptationMode:0,blockFrontRunnerIndex:-1}))})),events:[],warnings:[]});
function traffic(){const race=fixture();for(const f of race.frames){const t=f.time,s=f.runners[0];if(t>=50&&t<51)s.speed=19.6-1.6*(t-50);else if(t>=51&&t<=53)s.speed=18;else if(t>53&&t<=55)s.speed=18+.8*(t-53);if(t>=51&&t<53){s.blockFrontRunnerIndex=1;f.runners[1].distance=s.distance+1;f.runners[1].speed=18/.994;}}return race;}
const term=Math.sqrt(500*1000)*.002,maximum=(20*.962+term+.2)*1.05+term+(450*500)**.597*.0001;
const runningRate=20*(maximum-20+12)**2/144*(1+200/Math.sqrt(600*500));
function exhaustion(){const race=fixture();race.runners[0].lastSpurtDistance=2000*2/3;for(const f of race.frames){const t=f.time,s=f.runners[0];s.hp=Math.max(0,(98-t)*runningRate);if(t>=67)s.speed=maximum;if(t>=98)s.speed=maximum-1.2*(t-98);}return race;}
let cases=0;
async function analyze(name:string,race:any){const input=join(folder,`${name}.json`),output=join(folder,`${name}-report.json`),original=JSON.stringify(race);await writeFile(input,original);await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-motion.ts'),input,output,'--reference-dir',reference],{cwd:root,windowsHide:true,timeout:30000});assert.equal(await readFile(input,'utf8'),original);cases++;const report=JSON.parse(await readFile(output,'utf8'))[0];return{motion:report.runners[0].motion,detail:report.analysis.runners['traffic-0']};}
const near=(a:number,b:number,t=.0001)=>assert.ok(Math.abs(a-b)<t,`${a} vs ${b}`),at=(r:any,time:number)=>r.motion.samples.reduce((a:any,b:any)=>Math.abs(b.time-time)<Math.abs(a.time-time)?b:a);
let r=await analyze('braking-flag-regain',traffic());near(r.detail.summary.blockedDuration,2);near(r.motion.trafficLoss.episodes[0].start,50);near(r.motion.trafficLoss.episodes[0].end,55);near(r.motion.trafficLoss.duration,5);assert.ok(r.motion.trafficLoss.distanceLoss.min>5.1&&r.motion.trafficLoss.distanceLoss.min<5.6&&r.motion.trafficLoss.distanceLoss.max>5.6&&r.motion.trafficLoss.distanceLoss.max<5.8);near(r.motion.trafficLoss.coverage,1);
let race=traffic();for(const f of race.frames){f.runners[0].blockFrontRunnerIndex=-1;f.runners[1].distance=f.runners[0].distance+100;}r=await analyze('braking-without-anchor-is-not-traffic',race);near(r.motion.trafficLoss.duration,0);near(r.motion.trafficLoss.distanceLoss.max,0);
race=traffic();for(const f of race.frames){f.runners[0].blockFrontRunnerIndex=-1;if(f.time>=51&&f.time<53){f.runners[1].distance=f.runners[0].distance+2.5;f.runners[1].lane=f.runners[0].lane;}}r=await analyze('speed-matched-near-hold-without-collision',race);assert.ok(r.motion.trafficLoss.duration>4.5);assert.ok(r.motion.trafficLoss.distanceLoss.max>5);
race=traffic();for(const f of race.frames){f.runners[0].blockFrontRunnerIndex=-1;f.runners[1].distance=f.runners[0].distance+4.1;f.runners[1].lane=f.runners[0].lane;}r=await analyze('outside-near-neighborhood-is-not-traffic',race);near(r.motion.trafficLoss.duration,0);
race=traffic();for(const f of race.frames){f.runners[0].blockFrontRunnerIndex=-1;if(f.time>=51&&f.time<53)f.runners[1].lane=f.runners[0].lane;}r=await analyze('geometry-anchor-without-flag',race);assert.ok(r.motion.trafficLoss.duration>4.5);assert.ok(r.motion.trafficLoss.distanceLoss.max>5);
race=traffic();race.runners[0].stats.power=null;r=await analyze('missing-force-is-unassessed',race);assert.equal(r.motion.trafficLoss.distanceLoss,null);near(r.motion.trafficLoss.assessedDuration,0);
race=traffic();race.frames=race.frames.filter((f:any)=>f.time<=51||f.time>=53.5);r=await analyze('unsupported-gap-does-not-bridge-loss',race);assert.ok(r.motion.trafficLoss.coverage<1);assert.ok(r.motion.samples.some((s:any)=>s.time>51&&s.time<53.5&&s.free===null));
race=traffic();for(const f of race.frames)if(f.time>=48&&f.time<50)f.runners[0].speed=19; r=await analyze('unrelated-earlier-plateau-not-swallowed',race);assert.ok(r.motion.trafficLoss.episodes[0].start>=50);
race=traffic();race.runners.forEach((r:any)=>{r.finishTimeRaw=54;r.finishTime=54;});r=await analyze('episode-stops-at-finish',race);assert.ok(r.motion.trafficLoss.episodes.every((e:any)=>e.end<=54));
r=await analyze('known-healthy-hp-history',fixture());near(r.motion.exhaustionLoss.duration,0);near(r.motion.exhaustionLoss.distanceLoss.max,0);near(r.motion.exhaustionLoss.coverage,1);
race=fixture();for(const f of race.frames)f.runners[0].hp=null;r=await analyze('missing-hp-is-not-zero-exhaustion',race);assert.equal(r.motion.exhaustionLoss.coverage,null);assert.equal(r.motion.exhaustionLoss.distanceLoss,null);
r=await analyze('healthy-reference-triangular-exhaustion',exhaustion());assert.ok(r.motion.exhaustionLoss.episodes[0].onsetMin<98);assert.ok(r.motion.exhaustionLoss.episodes[0].onsetMax<=98);assert.ok(r.motion.exhaustionLoss.distanceLoss.min>2.35&&r.motion.exhaustionLoss.distanceLoss.max<2.5);assert.ok(r.motion.exhaustionLoss.timeLoss.min>.09);near(r.motion.exhaustionLoss.coverage,1);assert.ok(at(r,99).healthyTargetActive.min>at(r,99).targetActive.max+3);
race=exhaustion();race.runners[0].finishTimeRaw=99;race.runners[0].finishTime=99;r=await analyze('exhaustion-before-finish-only',race);assert.ok(r.motion.exhaustionLoss.episodes[0].end<=99);assert.ok(r.motion.exhaustionLoss.distanceLoss.max<.65);
race=exhaustion();for(const f of race.frames)if(f.time>=98){f.runners[0].speed=16;f.runners[0].blockFrontRunnerIndex=1;f.runners[1].distance=f.runners[0].distance+1;f.runners[1].speed=16/.994;}r=await analyze('healthy-counterfactual-keeps-traffic-cap',race);assert.ok(r.motion.exhaustionLoss.distanceLoss.max<.01);
race=exhaustion();race.runners[0].stats.guts=null;r=await analyze('unknown-healthy-inputs-stay-unassessed',race);assert.equal(r.motion.exhaustionLoss.distanceLoss,null);near(r.motion.exhaustionLoss.assessedDuration,0);
for(const id of [200351,999999]){race=exhaustion();race.events=[{time:97.9,type:3,runnerId:'traffic-0',skillId:id,params:[0,id,0,0],label:'Synthetic unresolved HP bracket'}];r=await analyze('hp-or-unknown-event-withholds-zero-crossing-'+id,race);near(r.motion.exhaustionLoss.episodes[0].start,98);assert.equal(r.motion.exhaustionLoss.episodes[0].onsetMin,undefined);}
race=fixture();race.runners[0].startDelay=.038;r=await analyze('subframe-delay-does-not-prorate-acceleration',race);const expected=3+(24+.0006*Math.sqrt(500*1200))/15;near(at(r,1/15).free.mid,expected,.00001);
race=fixture();race.runners[0].startDelay=.08;r=await analyze('whole-delayed-frame-skips-acceleration',race);near(at(r,1/15).free.mid,3,.00001);assert.ok(at(r,2/15).free.mid>4.6);
// A whole race with an independently visible OT ramp/ceiling before the hold.
// The dipped speed still exceeds ordinary speed: using the ordinary target
// erases the loss. The braking, hold and acceleration areas are all known.
function overtakeTraffic(recorded=true){
  const race=fixture(),force=.0006*Math.sqrt(500*1200),ordinary=19.6,ceiling=ordinary+20*.98*.05,regained=24+.6/force;
  for(const f of race.frames){const t=f.time,s=f.runners[0],front=f.runners[1];
    s.speed=t===0?3:t<18?ordinary:t<22?Math.min(ceiling,ordinary+force*(t-18)):t<23?ceiling-.6*(t-22):t<24?ceiling-.6:t<regained?ceiling-.6+force*(t-24):t<30?ceiling:Math.max(ordinary,ceiling-.8*(t-30));
    if(t>=22&&t<24){front.distance=s.distance+(recorded?1:3.2);front.lane=s.lane;front.speed=recorded?s.speed/.994:s.speed;if(recorded&&t>=23)s.blockFrontRunnerIndex=1;}
  }
  return race;
}
const expectedOvertakeArea=.6/2+.6+.6**2/(2*.0006*Math.sqrt(500*1200));
for(const recorded of [true,false]){
  r=await analyze(recorded?'overtake-dip-above-ordinary':'overtake-near-without-collision',overtakeTraffic(recorded));
  const sample=at(r,23.5),loss=r.motion.trafficLoss;
  assert.ok(sample.actual>sample.targetActive.max&&sample.trafficTargetActive.min>sample.actual+.15);
  assert.ok(loss.distanceLoss.min<expectedOvertakeArea&&loss.distanceLoss.max>expectedOvertakeArea);
  assert.ok(loss.distanceLoss.min>expectedOvertakeArea-.35&&loss.distanceLoss.max<expectedOvertakeArea+.35);
  assert.ok(Math.abs(loss.distanceLoss.mid-expectedOvertakeArea)<.1);
  assert.ok(loss.episodes.some((e:any)=>e.start<=22&&e.end>=25.25&&e.end<26));
  assert.ok(r.detail.intervals.some((i:any)=>i.kind==='overtake-model'&&i.start<22&&i.end>25));
  near(r.detail.summary.blockedDuration,recorded?1:0);near(loss.coverage,1);
}
race=overtakeTraffic(false);for(const f of race.frames){f.runners[1].distance=f.runners[0].distance+100;f.runners[1].lane=.6;}
r=await analyze('same-overtake-dip-without-neighbor-is-unattributed',race);near(r.motion.trafficLoss.duration,0);near(r.motion.trafficLoss.distanceLoss.max,0);
race=overtakeTraffic();for(const f of race.frames)if(f.time===23.5)f.runners[0].speed=null;
r=await analyze('overtake-traffic-unknown-speed-remains-partial',race);assert.ok(r.motion.trafficLoss.coverage<1);assert.ok(r.motion.trafficLoss.assessedDuration<r.motion.trafficLoss.duration);
const wit=20*(600/5500*Math.log10(60)-.325)/100;
function contextTraffic(mode:'pace-up'|'pace-down'|'speed-up'|'downhill'|'ordinary',stacked=false,spurt=false,slope=0){
  const race=fixture(),style=mode.startsWith('pace-')?3:1,coef=style===3?[.938,.998]:[1,.98],force=(slope>0?.0004:.0006)*Math.sqrt(500*1200)+(stacked?.2:0);
  race.runners[0].strategyCode=style;race.runners[0].aptitudes.late=7;
  if(spurt)race.runners[0].lastSpurtDistance=2000*2/3;
  if(stacked){race.runners[0].skills=[850001,850002,850003].map(id=>({id,level:1}));race.events=[850001,850002,850003].map(id=>({time:18,type:3,runnerId:'traffic-0',skillId:id,params:[0,id,150000,0,1]}));}
  const onset=spurt?80:22,off=onset+3,active=(t:number)=>t>=18&&t<30;
  let velocity=20*coef[0]+wit-(slope>0?slope*200/1200:0),hp=3000;
  for(const f of race.frames){const t=f.time,s=f.runners[0],front=f.runners[1],phase=s.distance>=2000/6?1:0,boost=active(t)?mode==='pace-up'?1.04:mode==='pace-down'?.945:mode==='speed-up'?1.04:1:1;
    const goal=spurt&&t>=67?maximum:20*coef[phase]*boost+wit-(slope>0?slope*200/1200:0)+(mode==='downhill'&&active(t)?.4:0)+(stacked&&t>=18&&t<33?.35:0);
    if(t>0)velocity=velocity<goal?Math.min(goal,velocity+force*.25):Math.max(goal,velocity-.8*.25);
    const deficit=t<onset||t>=off?0:t<onset+1?.4*(t-onset):t<onset+2?.4:Math.max(0,.4-force*(t-onset-2));
    s.speed=t===0?3:velocity-deficit+(stacked&&t>=18&&t<33?.3:0);
    hp-=20*(s.speed-20+12)**2/144*(active(t)&&mode==='pace-down'?.6:active(t)&&mode==='downhill'?.4:1)*.25;s.hp=hp;
    front.distance=s.distance+(mode==='pace-up'?30:mode==='pace-down'?1:-3);front.lane=.6;front.speed=20;
    if(t>=onset&&t<onset+2){front.distance=s.distance+1;front.lane=s.lane;front.speed=s.speed/.994;if(t>=onset+1)s.blockFrontRunnerIndex=1;}
  }
  return race;
}
for(const mode of ['pace-up','pace-down','speed-up','ordinary']as const){
  r=await analyze(`${mode}-traffic-with-stacked-skills`,contextTraffic(mode,true));
  assert.ok(r.motion.trafficLoss.distanceLoss.mid>.5&&r.motion.trafficLoss.distanceLoss.mid<1.3,`${mode}: ${JSON.stringify(r.motion.trafficLoss)}`);
  assert.ok(r.motion.trafficLoss.episodes.some((e:any)=>e.start<=22&&e.end>=24.5));
  assert.ok(r.motion.samples.filter((s:any)=>s.blockCap!==null&&s.constrained).every((s:any)=>s.constrained.max-s.currentSpeedDelta<=s.blockCap+1e-6));
  if(mode!=='ordinary')assert.ok(r.detail.intervals.some((i:any)=>i.kind===`${mode}-model`&&i.start<22&&i.end>24));
}
r=await analyze('last-spurt-traffic-and-regain',contextTraffic('ordinary',false,true));assert.ok(r.motion.trafficLoss.distanceLoss.mid>.6&&r.motion.trafficLoss.distanceLoss.mid<1.2);assert.ok(r.motion.trafficLoss.episodes.some((e:any)=>e.start<=80&&e.end>=82.75));
await writeFile(join(reference,'courses.json'),JSON.stringify({99993:{distance:2000,raceTrackId:10006,surface:1,turn:1,course:1,courseSetStatus:[],corners:[],straights:[{start:0,end:2000}],slopes:[{start:0,length:2000,slope:-10000}]}}));
r=await analyze('downhill-mode-traffic-with-stacked-skills',contextTraffic('downhill',true));assert.ok(r.motion.trafficLoss.distanceLoss.mid>.5&&r.motion.trafficLoss.distanceLoss.mid<1.3);assert.ok(r.detail.intervals.some((i:any)=>i.kind==='downhill-mode-model'&&i.start<22&&i.end>24));
await writeFile(join(reference,'courses.json'),JSON.stringify({99993:{distance:2000,raceTrackId:10006,surface:1,turn:1,course:1,courseSetStatus:[],corners:[],straights:[{start:0,end:2000}],slopes:[{start:0,length:2000,slope:10000}]}}));
r=await analyze('uphill-traffic-with-stacked-skills',contextTraffic('ordinary',true,false,1));assert.ok(r.motion.trafficLoss.distanceLoss.mid>.5&&r.motion.trafficLoss.distanceLoss.mid<1.3);
await writeFile(join(reference,'courses.json'),JSON.stringify({99993:{distance:2000,raceTrackId:10006,surface:1,turn:1,course:1,courseSetStatus:[],corners:[],straights:[{start:0,end:2000}],slopes:[]}}));
race=overtakeTraffic();const early=21+wit,late=20*.98*1.05+wit;
for(const f of race.frames){const t=f.time,s=f.runners[0],front=f.runners[1];s.distance=Math.max(0,2000/6+20*(t-22));
  s.speed=t===0?3:t<18?20+wit:t<22?Math.min(early,20+wit+.0006*Math.sqrt(500*1200)*(t-18)):t<23?early-.7*(t-22):t<24?late-.28+.28*(t-23):t<30?late:Math.max(19.6+wit,late-.8*(t-30));
  s.blockFrontRunnerIndex=t>=23&&t<24?1:-1;front.distance=s.distance+100;front.lane=.6;
  if(t>=22.5&&t<24){front.distance=s.distance+1;front.lane=s.lane;front.speed=s.speed/.994;}
}
r=await analyze('phase-drop-is-separated-from-traffic-dip',race);
// Natural target drop .42; actual brakes .70 then regains .28. Only the
// final .4 s of braking (.056 m) and the 1 s regain (.14 m) are traffic area.
near(r.motion.trafficLoss.distanceLoss.mid,.5*.4*.28+.5*1*.28,.015);assert.ok(r.motion.trafficLoss.episodes[0].start<=22.5&&r.motion.trafficLoss.episodes[0].end>=24);
race=contextTraffic('ordinary',true);race.runners[0].skills=race.runners[0].skills.map((s:any)=>s.id===850002?{...s,id:850004}:s);race.events=race.events.map((e:any)=>e.skillId===850002?{...e,skillId:850004,params:[0,850004,150000,0,1]}:e);
for(const f of race.frames)if(f.time>=18&&f.time<33){f.runners[0].speed-=.6;if(f.time>=22&&f.time<24)f.runners[1].speed=f.runners[0].speed/.994;}
r=await analyze('negative-current-speed-applies-after-self-collision-cap',race);assert.ok(r.motion.trafficLoss.distanceLoss.mid>.5);assert.ok(r.motion.samples.filter((s:any)=>s.blockCap!==null&&s.constrained).every((s:any)=>s.constrained.max-s.currentSpeedDelta<=s.blockCap+1e-6));
race=exhaustion();race.runners[0].skills=[{id:850002,level:1}];race.events=[{time:97,type:3,runnerId:'traffic-0',skillId:850002,params:[0,850002,30000,0,1]}];
for(const f of race.frames)if(f.time>=98){f.runners[0].speed=16.3;f.runners[0].blockFrontRunnerIndex=1;f.runners[1].distance=f.runners[0].distance+1;f.runners[1].speed=16/.994;}
r=await analyze('healthy-reference-keeps-self-traffic-cap-before-current-skill',race);assert.ok(r.motion.exhaustionLoss.distanceLoss.max<.01);
const {importRaceFile,loadReference}=await import('../scripts/offline-analysis');
const {analyzeRace}=await import('../src/data/analytics'),{motionFor}=await import('../src/data/motion-analysis'),{motionLosses}=await import('../src/data/traffic-loss');
const parsed=(await importRaceFile(join(folder,'phase-drop-is-separated-from-traffic-dip.json')))[0],catalog=await loadReference(reference),analysis=analyzeRace(parsed,catalog),runner=parsed.runners[0],motion=motionFor(parsed,catalog,analysis,runner.id),segments:any[]=[];
const diagnostic=motionLosses(parsed,runner,motion.samples,catalog.courses[parsed.courseId!],analysis,{onSegment:segment=>segments.push(segment)});
assert.deepEqual(diagnostic.trafficLoss,motion.trafficLoss);assert.ok(segments.some(s=>s.kind==='traffic'&&s.channel==='mid'&&s.referenceStart<s.actualStart&&s.referenceEnd>s.actualEnd));
for(const channel of ['min','mid','max']as const){near(segments.filter(s=>s.kind==='traffic'&&s.channel===channel).reduce((n,s)=>n+s.distanceLoss,0),motion.trafficLoss.distanceLoss![channel],1e-10);near(segments.filter(s=>s.kind==='traffic'&&s.channel===channel).reduce((n,s)=>n+s.timeLoss,0),motion.trafficLoss.timeLoss![channel],1e-10);}
console.log(JSON.stringify({cases,trafficApproachAndRegain:'passed',recordedDurationSeparate:'passed',exactLocalAreas:'passed',exhaustionHealthyReference:'passed',zeroCrossingBounds:'passed',unknownGaps:'passed',gatePhysics:'passed',trafficAcrossModes:'passed',contextCap:'passed',phaseSeparation:'passed',productionTrace:'passed',capture:'unchanged'}));
