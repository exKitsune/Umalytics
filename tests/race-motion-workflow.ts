/** Whole-file importer + real analysis + shared motion engine. Synthetic data only. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
if(process.argv[2]==='--scenario'){
  const {importRace}=await import('../src/data/import');const {assembleReferenceData}=await import('../src/data/reference');const {analyzeRace}=await import('../src/data/analytics');
  const {createRaceMotionEngine,activationMotionKey}=await import('../src/data/race-motion');
  const folder=resolve(process.argv[3]),input=JSON.parse(await readFile(process.argv[4],'utf8')),json=async(name:string)=>JSON.parse(await readFile(join(folder,name),'utf8'));
  const reference=assembleReferenceData(await json('metadata.json'),await json('courses.json'),await json('reference-source.json'),await json('simulator-skill-ids.json'));
  const bytes=new TextEncoder().encode(JSON.stringify(input));const race=(await importRace(bytes.buffer as ArrayBuffer,'synthetic-motion.json'))[0],analysis=analyzeRace(race,reference),engine=createRaceMotionEngine(race,reference,race.courseId,analysis);
  const full=engine.build({runnerId:race.runners[0].id}),value=full.runners[race.runners[0].id],activation=analysis.runners[race.runners[0].id].skillActivations[0];
  const excluded=activation?engine.build({runnerId:race.runners[0].id,excludeActivationKey:activationMotionKey(race.runners[0].id,activation)}).runners[race.runners[0].id]:null;
  console.log(JSON.stringify({motion:value,excluded,cacheIdentity:engine.build({runnerId:race.runners[0].id}).runners[race.runners[0].id]===value,intervals:analysis.runners[race.runners[0].id].intervals}));
}else{
  const root=resolve(import.meta.dirname,'..'),folder=resolve(process.argv[2]),run=promisify(execFile);await mkdir(folder,{recursive:true});const reference=join(folder,'reference');await mkdir(reference);
  for(const name of ['metadata.json','reference-source.json','simulator-skill-ids.json'])await writeFile(join(reference,name),await readFile(join(root,'public/data',name)));
  const metadata=JSON.parse(await readFile(join(reference,'metadata.json'),'utf8'));
  for(const [id,type,value,target]of [[850001,27,5000,1],[850002,31,4000,1],[850003,21,10000,1],[850004,22,10000,1],[850005,27,-5000,2],[850006,27,5000,1]])metadata.skills[id]={name:`Synthetic motion${id}`,rarity:1,activateLot:0,branches:[{branchIndex:0,condition:'always==1',rawDuration:100000,durationUsage:1,effects:[{type,rawValue:value,valueUsage:id===850006?3:1,levelUsage:1,targetType:target,additionalActivateType:0}]}]};
  metadata.skills[850007]={name:'Synthetic wit passive',rarity:1,activateLot:0,branches:[{branchIndex:0,condition:'always==1',rawDuration:-1,durationUsage:1,effects:[{type:5,rawValue:600000,valueUsage:1,levelUsage:1,targetType:1,additionalActivateType:0}]}]};
  metadata.skills[850008]={name:'Synthetic uncertain guts passive',rarity:1,activateLot:0,branches:[{branchIndex:0,condition:'popularity==1',rawDuration:-1,durationUsage:1,effects:[{type:4,rawValue:600000,valueUsage:1,levelUsage:1,targetType:1,additionalActivateType:0}]}]};
  metadata.skills[850009]={name:'Synthetic lane speed',rarity:1,activateLot:0,branches:[{branchIndex:0,condition:'always==1',rawDuration:100000,durationUsage:1,effects:[{type:28,rawValue:500,valueUsage:1,levelUsage:1,targetType:1,additionalActivateType:0}]}]};
  metadata.skills[850010]={name:'Synthetic spurt recovery',rarity:1,activateLot:0,branches:[{branchIndex:0,condition:'always==1',rawDuration:0,durationUsage:1,effects:[{type:9,rawValue:150,valueUsage:1,levelUsage:1,targetType:1,additionalActivateType:0}]}]};
  await writeFile(join(reference,'metadata.json'),JSON.stringify(metadata));
  const course={distance:2000,raceTrackId:10006,surface:1,turn:1,course:1,laneMax:15000,courseSetStatus:[],corners:[],straights:[{start:0,end:2000}],slopes:[] as any[]};
  const saveCourse=()=>writeFile(join(reference,'courses.json'),JSON.stringify({99995:course}));await saveCourse();
  const base=():any=>({schemaVersion:1,synthetic:true,title:'Synthetic shared motion',courseId:99995,distance:2000,category:'practice',conditions:{weather:'1',ground:'1',season:'1'},
    runners:[0,1].map(i=>({id:`fixture-${i}`,name:`Synthetic runner${i}`,gate:i+1,cardId:100101+i*100,strategyCode:1,mood:3,startDelay:0,finishTime:100,finishTimeRaw:100,lastSpurtDistance:-1,
      stats:{speed:1000,stamina:1000,power:1200,guts:500,wisdom:600},aptitudes:{turf:7,middle:7,front:7,late:7,end:7},skills:[850001,850002,850003,850004,850005,850006].map(id=>({id,level:1}))})),
    frames:Array.from({length:401},(_,i)=>i/4).map(time=>({time,runners:[0,1].map(i=>({runnerId:`fixture-${i}`,distance:20*time+(i?100:0),speed:time===0?3:20,hp:2760-time*20,lane:i?.5:.1,temptationMode:0,blockFrontRunnerIndex:-1}))})),events:[],warnings:[]});
  const event=(id:number,time=50,duration=4,source=0,mask=1)=>({time,type:3,runnerId:`fixture-${source}`,skillId:id,label:'Synthetic motion skill',params:[source,id,duration*10000,0,mask]});
  let cases=0;async function analyze(name:string,race:any){const input=join(folder,`${name}.json`);await writeFile(input,JSON.stringify(race));const output=await run(process.execPath,['--import','tsx',resolve(import.meta.filename),'--scenario',reference,input],{cwd:root,windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});cases++;return JSON.parse(output.stdout);}
  const at=(value:any,time:number)=>value.motion.samples.reduce((a:any,b:any)=>Math.abs(b.time-time)<Math.abs(a.time-time)?b:a);
  const near=(a:number,b:number,t=.0001)=>assert.ok(Math.abs(a-b)<t,`${a} vs${b}`);
  let race=base(),result=await analyze('normal-bounded-early-path',race);assert.ok(at(result,10).free);assert.ok(at(result,10).targetActive.max>at(result,10).targetActive.min);assert.match(at(result,10).pace,/reference/);assert.equal(result.cacheIdentity,true);
  assert.ok(at(result,.1).free.mid<at(result,.1).targetActive.mid);assert.ok(at(result,2).free.mid>17);assert.ok(at(result,60).free.mid<=at(result,60).targetActive.max+.001);
  race=base();race.events=[event(850001)];result=await analyze('compound-target-skill-and-exclusion',race);near(at(result,51).targetActive.mid-at(result,51).targetBase.mid,.5);const excludedAt=result.excluded.samples.find((s:any)=>s.time===at(result,51).time);assert.ok(at(result,54).free.mid>result.excluded.samples.find((s:any)=>s.time===at(result,54).time).free.mid);near(at(result,51).targetActive.mid-excludedAt.targetActive.mid,.5);
  race=base();race.events=[event(850001),event(850002)];result=await analyze('compound-target-plus-acceleration',race);assert.ok(at(result,51).acceleration>.8);near(at(result,51).targetActive.mid-at(result,51).targetBase.mid,.5);
  race=base();race.events=[event(850003)];for(const f of race.frames)if(f.time>=50&&f.time<54)f.runners[0].speed=21;result=await analyze('direct-speed-normalization',race);near(at(result,51).currentSpeedDelta,1);near(at(result,51).selfActual,20);near(at(result,51).targetActive.mid,at(result,51).targetBase.mid);
  race=base();race.events=[event(850004)];result=await analyze('type22-expiry-self-residual',race);const before=at(result,53.999),after=at(result,54);assert.ok(after.free.mid>after.targetActive.mid+.5);near(after.currentSpeedDelta,0);
  race=base();race.events=[event(850005,50,4,1)];result=await analyze('foreign-target-debuff',race);near(at(result,51).targetActive.mid-at(result,51).targetBase.mid,-.5);
  assert.ok(at(result,51).targetActive.max-at(result,51).targetActive.min>.5);assert.match(at(result,51).assumptions.join(' '),/immunity unknown/);
  race=base();race.events=[event(850005,50,4,1)];race.runners.forEach((r:any)=>r.teamGroup=1);result=await analyze('same-team-debuff-immunity',race);near(at(result,51).targetActive.mid,at(result,51).targetBase.mid);
  race=base();race.events=[event(850006)];result=await analyze('scenario-scale-uses-maximum',race);near(at(result,51).targetActive.mid-at(result,51).targetBase.mid,.6);assert.ok(at(result,51).free);assert.match(at(result,51).assumptions.join(' '),/1\.2/);assert.ok(at(result,56).free);
  race=base();for(const f of race.frames)if(f.time>=50&&f.time<=55){f.runners[1].distance=f.runners[0].distance+1;f.runners[1].lane=f.runners[0].lane;f.runners[1].speed=18/.994;}result=await analyze('geometry-neighbor-before-recorded-block',race);assert.equal(at(result,51).constraint.kind,'geometry-block');assert.ok(at(result,52).constrained.mid<at(result,52).free.mid);assert.ok(at(result,52).cumulativeDistance.mid>0);
  race=base();for(const f of race.frames)if(f.time>=50&&f.time<=55){f.runners[1].distance=f.runners[0].distance+3;f.runners[1].lane=f.runners[0].lane;f.runners[1].speed=18;}result=await analyze('mere-proximity-no-invented-cap',race);assert.equal(at(result,51).constraint.kind,'none');near(at(result,51).constrained.mid,at(result,51).free.mid);
  race=base();for(const f of race.frames)if(f.time>=50&&f.time<=55){f.runners[0].blockFrontRunnerIndex=1;f.runners[1].distance=f.runners[0].distance+1;f.runners[1].speed=18/.994;}result=await analyze('recorded-block-separate-provenance',race);assert.equal(at(result,51).constraint.kind,'recorded-block');near(at(result,51).blockCap,18);
  race=base();for(const f of race.frames)if(f.time>=70)f.runners[0].hp=0;result=await analyze('hp-zero-minimum-and-deceleration',race);assert.ok(at(result,74).free.mid<at(result,69).free.mid);assert.ok(at(result,80).targetActive.mid<18);
  course.slopes=[{start:900,length:300,slope:-10000}];await saveCourse();race=base();let hp=2760;for(const f of race.frames){f.runners[0].hp=hp;hp-=(f.time>=45&&f.time<60?8:20)*.25;}result=await analyze('independent-downhill-target-bonus',race);near(at(result,51).downhillTargetDelta.mid,0);assert.ok(Math.abs(at(result,51).targetActive.mid-at(result,51).targetBase.mid)<.05);
  course.slopes=[{start:900,length:300,slope:10000}];await saveCourse();result=await analyze('uphill-target-and-acceleration',base());assert.ok(at(result,51).targetBase.mid<19.6);assert.ok(at(result,51).acceleration<.4);course.slopes=[];await saveCourse();
  race=base();for(const f of race.frames)if(f.time>=50&&f.time<60)f.runners[0].speed=19.6;result=await analyze('section-residual-calibration',race);assert.ok(result.motion.sections.some((s:any)=>s.evidence==='calibrated'));assert.ok(at(result,52).evidence==='calibrated');
  race=base();race.frames=race.frames.filter((f:any)=>f.time<50||f.time>54);result=await analyze('missing-history-gap-reset',race);assert.equal(at(result,52).free,null);assert.equal(result.motion.distanceLoss,null);assert.ok(at(result,56).free);
  race=base();race.runners[0].strategyCode=3;const referenceAccel=.0006*Math.sqrt(500*1200);
  for(const f of race.frames)if(f.time>=20&&f.time<=28)f.runners[0].speed=Math.min(20.78,20+(f.time-20)*referenceAccel);
  result=await analyze('pace-up-onset-includes-supported-acceleration',race);const pu=result.intervals.find((i:any)=>i.kind==='pace-up-model'&&i.start<=22&&i.end>=24);assert.ok(pu);near(pu.start,20);assert.ok(Math.abs(at(result,20.5).targetActive.mid-at(result,20.5).targetBase.mid)<.05);
  race=base();race.runners[0].strategyCode=3;for(const f of race.frames)if(f.time>=20&&f.time<=21)f.runners[0].speed=20+(f.time-20)*referenceAccel;
  result=await analyze('unconfirmed-acceleration-ramp-is-not-a-mode',race);assert.equal(result.intervals.some((i:any)=>i.kind==='pace-up-model'&&i.start<=21&&i.end>=20),false);
  race=base();race.frames[200].runners[0].blockFrontRunnerIndex=1;race.frames[200].runners[1].distance=race.frames[200].runners[0].distance+1;race.frames[201].runners[1].distance=race.frames[201].runners[0].distance+3;race.frames[200].runners[1].lane=.1;race.frames[201].runners[1].lane=.1;
  result=await analyze('complete-geometry-across-unreported-flag-transition',race);assert.equal(at(result,50.2).constraint.kind,'none');assert.ok(at(result,50.2).constrained);assert.match(at(result,50.2).assumptions.join(' '),/block-transition/);
  race=base();race.runners.push({...race.runners[1],id:'fixture-2',gate:3});for(const f of race.frames)if(f.time>=50&&f.time<=55){f.runners[1].distance=f.runners[0].distance+1;f.runners[1].lane=.1;f.runners[1].speed=18;}
  result=await analyze('missing-neighbor-prevents-definite-cap',race);assert.equal(at(result,51).constraint.kind,'unknown');assert.equal(at(result,51).constrained,null);assert.ok(at(result,51).free);
  race=base();race.frames=race.frames.filter((f:any)=>f.time<1||f.time>=5);for(const f of race.frames)if(f.time<=5)f.runners[0].speed=3;
  result=await analyze('long-start-dash-history-after-gap',race);assert.equal(at(result,5).startDash,true);assert.ok(at(result,5).free.mid<17);
  race=base();race.events=[event(850004)];for(const f of race.frames)if(f.time>=50&&f.time<=55){f.runners[0].blockFrontRunnerIndex=1;f.runners[1].distance=f.runners[0].distance+1;f.runners[1].speed=18/.994;}
  result=await analyze('type22-expiry-respects-self-block-cap',race);near(at(result,54).currentSpeedDelta,0);assert.ok(at(result,54).constrained.mid<=18.0001);
  race=base();race.runners[0].skills.push({id:850007,level:1});race.events=[event(850007,0,0)];for(const f of race.frames)if(f.time>=50&&f.time<60)f.runners[0].speed=19.6;
  result=await analyze('wit-passive-preserves-calibrated-quantile',race);const sample=at(result,52),without=result.excluded.samples.find((s:any)=>s.time===sample.time),delta=20*(660/5500*Math.log10(66)-600/5500*Math.log10(60))/100;near(sample.targetActive.mid-without.targetActive.mid,delta);
  // Complete proc coverage proves this lottery-free passive did not activate.
  // A censored file retains the unresolved passive's reference range.
  race=base();race.runners[0].skills.push({id:850008,level:1});result=await analyze('absent-passive-in-complete-recording',race);near(result.motion.initialStats.guts.min,500);near(result.motion.initialStats.guts.max,500);assert.ok(at(result,80).free);
  race.frames=race.frames.filter((f:any)=>f.time<=90);result=await analyze('unknown-passive-in-censored-recording',race);near(result.motion.initialStats.guts.min,500);near(result.motion.initialStats.guts.max,560);assert.ok(at(result,80).free);
  race=base();race.runners[0].skills.push({id:910341,level:1});race.events=[event(910341,50,4)];result=await analyze('firelight-fixed-simulator-reference',race);assert.ok(at(result,51).free);near(at(result,51).targetActive.mid-at(result,51).targetBase.mid,.15);assert.match(at(result,51).assumptions.join(' '),/native pass-count scaling/);
  race=base();for(const f of race.frames)if(f.time>=50&&f.time<=55){f.runners[0].speed=18;f.runners[1].distance=f.runners[0].distance+1;f.runners[1].lane=.1;f.runners[1].speed=18/.994;}
  result=await analyze('actual-shortfall-only-during-traffic',race);assert.ok(result.motion.observedTrafficDeficit.mid>0);assert.ok(result.motion.observedTrafficDuration<6);assert.equal(result.motion.observedTrafficCoverage,1);
  race=base();race.runners[0].lastSpurtDistance=1400;const spurtTerm=Math.sqrt(500*1000)*.002,spurtOrdinary=20*.962+spurtTerm,spurtMaximum=(spurtOrdinary+.2)*1.05+spurtTerm+(450*500)**.597*.0001,spurtPlateau=spurtMaximum-.2;
  for(const f of race.frames)if(f.time>=72){f.runners[0].speed=spurtPlateau;if(f.time>=80&&f.time<82){f.runners[0].speed=spurtPlateau-1.2;f.runners[0].blockFrontRunnerIndex=1;f.runners[1].distance=f.runners[0].distance+1;f.runners[1].lane=.1;f.runners[1].speed=(spurtPlateau-1.2)/.994;}}
  result=await analyze('spurt-plateau-not-theoretical-maximum',race);near(at(result,76).targetActive.mid,spurtPlateau,.05);assert.ok(at(result,76).targetActive.mid<spurtMaximum-.1);
  const blockedSpurt=at(result,80.5);near(blockedSpurt.targetActive.mid,spurtPlateau,.05);assert.ok(blockedSpurt.free.mid>blockedSpurt.actual+.4);
  race=base();race.runners[0].lastSpurtDistance=1400;for(const f of race.frames)if(f.time>=72)f.runners[0].speed=spurtMaximum;
  result=await analyze('spurt-on-maximum-uses-maximum',race);near(at(result,76).targetActive.mid,spurtMaximum,.05);
  race=base();race.runners[0].lastSpurtDistance=1400;const crowded=spurtMaximum-.6;
  for(const f of race.frames)if(f.time>=72){f.runners[0].speed=crowded;f.runners[1].distance=f.runners[0].distance+3.2;f.runners[1].lane=f.runners[0].lane;f.runners[1].speed=crowded;}
  result=await analyze('crowded-spurt-keeps-theoretical-maximum',race);assert.ok(at(result,76).targetActive.mid>crowded+.3);assert.ok(result.intervals.some((i:any)=>i.kind==='near-slowdown'&&i.start<=76&&(i.end==null||i.end>=80)));
  race=base();race.runners[0].lastSpurtDistance=1400;
  for(const f of race.frames)if(f.time>=72){f.runners[0].speed=spurtPlateau;f.runners[1].distance=f.runners[0].distance-0.6;f.runners[1].lane=f.runners[0].lane+0.81/18;f.runners[1].speed=spurtPlateau;}
  result=await analyze('horse-behind-is-a-clear-road',race);near(at(result,76).targetActive.mid,spurtPlateau,.05);assert.ok(result.intervals.every((i:any)=>i.kind!=='near-slowdown'));
  race=base();race.runners[0].lastSpurtDistance=1400;
  for(const f of race.frames)if(f.time>=72){f.runners[0].speed=spurtPlateau;f.runners[1].distance=f.runners[0].distance+3.2;f.runners[1].lane=f.runners[0].lane;f.runners[1].speed=spurtPlateau+.3;}
  result=await analyze('faster-horse-ahead-keeps-own-pace',race);near(at(result,76).targetActive.mid,spurtPlateau,.05);assert.ok(result.intervals.every((i:any)=>i.kind!=='near-slowdown'));
  course.slopes=[{start:1600,length:300,slope:20000}];await saveCourse();
  race=base();race.runners[0].lastSpurtDistance=1400;race.events=[event(850001,72,26),event(850003,72,26)];
  for(const f of race.frames)if(f.time>=72){const hill=f.time>=80&&f.time<95,boost=f.time<98?1.5:0;f.runners[0].speed=spurtPlateau+boost-(hill?1/3:0);
    // Only uphill samples supply the clear plateau fit; the same flat base
    // must be restored before adding terrain and the two resolved effects.
    if(!hill){f.runners[0].blockFrontRunnerIndex=1;f.runners[1].distance=f.runners[0].distance+1;f.runners[1].speed=f.runners[0].speed/.994;}
  }
  result=await analyze('spurt-uphill-fit-normalizes-terrain-and-speed-effects',race);
  near(at(result,76).targetBase.mid,spurtPlateau,.015);near(at(result,85).targetBase.mid,spurtPlateau-1/3,.015);near(at(result,85).targetActive.mid,spurtPlateau+.5-1/3,.015);near(at(result,85).currentSpeedDelta,1);
  course.slopes=[];await saveCourse();
  race=base();race.runners[0].lastSpurtDistance=1400;race.runners[0].skills.push({id:850010,level:1});race.events=[event(850010,84,0),event(850010,94,0)];
  const firstChoice=spurtMaximum-.6,secondChoice=spurtMaximum-.2;
  for(const f of race.frames)if(f.time>=72){const t=f.time;f.runners[0].speed=t<84?firstChoice:t<94?Math.min(secondChoice,firstChoice+referenceAccel*(t-84)):Math.min(spurtMaximum,secondChoice+referenceAccel*(t-94));f.runners[0].hp+=t>=94?800:t>=84?400:0;}
  result=await analyze('spurt-fits-stay-inside-each-recovery-decision',race);
  near(at(result,76).targetActive.mid,firstChoice,.015);near(at(result,90).targetActive.mid,secondChoice,.015);near(at(result,97).targetActive.mid,spurtMaximum,.015);
  assert.ok(at(result,76).decisionTime<84);near(at(result,90).decisionTime,84);near(at(result,97).decisionTime,94);
  race=base();race.runners[0].skills.push({id:850009,level:1});race.events=[event(850009,50,6)];
  for(const f of race.frames)if(f.time>=52&&f.time<56)f.runners[0].lane=.1+(f.time-52)*.01;
  result=await analyze('move-lane-target-while-changing',race);const laneBonus=Math.sqrt(.0002*1200);
  near(at(result,51).targetActive.mid,at(result,51).targetBase.mid);near(at(result,53).targetActive.mid-at(result,53).targetBase.mid,laneBonus,.001);near(at(result,57).targetActive.mid,at(result,57).targetBase.mid);
  const laneMarks=result.intervals.filter((i:any)=>i.kind==='lane-bonus');assert.ok(laneMarks.some((i:any)=>i.start<=53&&i.end>=53));assert.ok(laneMarks.every((i:any)=>i.start>=52&&i.end<=56));near(laneMarks[0].model.speedDelta,laneBonus,.001);
  const {substantialNearIntervals}=await import('../src/data/status-presentation');
  const matchedAtTarget=substantialNearIntervals([{kind:'near-slowdown',label:'Near',start:74,end:78,observedUntil:78,evidence:'estimated',detail:'Matched.'}],[{time:76,actual:spurtPlateau,targetActive:{min:spurtPlateau,mid:spurtPlateau,max:spurtPlateau},hpEmpty:false,startDash:false}]);
  assert.equal(matchedAtTarget.length,0);
  const heldUnder=substantialNearIntervals([{kind:'near-slowdown',label:'Near',start:74,end:78,observedUntil:78,evidence:'estimated',detail:'Held.'},{kind:'pace-down',label:'Pace down',start:10,end:12,observedUntil:12,evidence:'estimated',detail:'Pace.'}],[{time:76,actual:spurtPlateau-.6,targetActive:{min:spurtPlateau,mid:spurtPlateau,max:spurtPlateau},hpEmpty:false,startDash:false},{time:11,actual:17,targetActive:{min:18,mid:18,max:18},hpEmpty:false,startDash:false}]);
  assert.equal(heldUnder.filter((i:any)=>i.kind==='near-slowdown').length,1);assert.ok(heldUnder.some((i:any)=>i.kind==='pace-down'));
  console.log(JSON.stringify({cases,sharedTargets:'passed',reachableVelocity:'passed',skillsAndDebuffs:'passed',sectionCalibration:'passed',downhillBonus:'passed',neighborhoodGeometry:'passed',unknownCoverage:'passed',pairedCache:'passed'}));
}
