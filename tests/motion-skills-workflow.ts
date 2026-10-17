/** Real whole-file import + reference path CLI; public synthetic fixtures only. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const root=resolve(import.meta.dirname,'..'),folder=resolve(process.argv[2]),run=promisify(execFile);await mkdir(folder,{recursive:true});
const reference=join(folder,'reference');await mkdir(reference);
for(const name of ['metadata.json','reference-source.json','simulator-skill-ids.json'])await writeFile(join(reference,name),await readFile(join(root,'public/data',name)));
const metadata=JSON.parse(await readFile(join(reference,'metadata.json'),'utf8'));
const effect=(type:number,value:number,target=1)=>({type,rawValue:value,valueUsage:1,levelUsage:1,targetType:target});
const definitions:any={860001:[effect(27,5000)],860002:[effect(27,5000),effect(31,4000)],860003:[effect(21,-10000,2)],860004:[effect(31,0)],860005:[effect(31,-2000)],860006:[effect(31,4000)],860007:[effect(21,10000)],860008:[effect(27,5000)],860009:[effect(27,5000)],860010:[effect(27,5000)],860011:[effect(27,-3000,2)],860012:[effect(27,15000)],860013:[effect(27,1000)],860014:[effect(22,10000)],860015:[effect(22,90000)]};
for(const [id,effects]of Object.entries(definitions))metadata.skills[id]={name:`Synthetic skill paths ${id}`,rarity:1,activateLot:0,groupId:Number(id),branches:[{branchIndex:0,condition:'always==1',precondition:'',rawDuration:20000,durationUsage:id==='860008'?2:id==='860009'?3:id==='860010'?4:1,effects}]};
await writeFile(join(reference,'metadata.json'),JSON.stringify(metadata));
await writeFile(join(reference,'courses.json'),JSON.stringify({99994:{distance:2000,raceTrackId:10006,surface:1,turn:1,course:1,laneMax:15000,courseSetStatus:[],corners:[],straights:[{start:0,end:2000}],slopes:[]}}));
const fixture=():any=>({schemaVersion:1,synthetic:true,title:'Synthetic movement scoring',courseId:99994,distance:2000,category:'practice',conditions:{weather:'1',ground:'1',season:'1'},
 runners:[0,1].map(i=>({id:`motion-${i}`,name:`Synthetic ${i}`,gate:i+1,cardId:100101+i*100,strategyCode:1,mood:3,teamGroup:i+1,startDelay:0,lastSpurtDistance:-1,finishTime:100,finishTimeRaw:100,
 stats:{speed:1000,stamina:1000,power:1200,guts:500,wisdom:600},aptitudes:{turf:7,middle:7,front:7},skills:Object.keys(definitions).map(Number).map(id=>({id,level:1}))})),
 frames:Array.from({length:401},(_,i)=>i/4).map(time=>({time,runners:[0,1].map(i=>({runnerId:`motion-${i}`,distance:20*time+(i?100:0),speed:time===0?3:19.6,hp:3200-7*time,lane:i?.6:.1,temptationMode:0,blockFrontRunnerIndex:-1}))})),events:[],warnings:[]});
const event=(skillId:number,time=50,duration=4,source=0)=>({time,type:3,runnerId:`motion-${source}`,skillId,label:'Synthetic scoring proc',params:[source,skillId,duration*10000,0,1]});
const ramp=(race:any,start=50,end=54)=>{for(const f of race.frames)if(f.time>=start&&f.time<=end)f.runners[0].speed=19.6+Math.min(.5,(f.time-start)*.5);};
let cases=0;
async function analyze(name:string,race:any,id=860001){const input=join(folder,`${name}.json`),output=join(folder,`${name}-report.json`),bytes=JSON.stringify(race);await writeFile(input,bytes);await run(process.execPath,['--import','tsx',join(root,'scripts/analyze-motion.ts'),input,output,'--reference-dir',reference],{cwd:root,windowsHide:true,timeout:30000});assert.equal(await readFile(input,'utf8'),bytes);cases++;return JSON.parse(await readFile(output,'utf8'))[0].runners[0].skills.find((s:any)=>s.skillId===id).motion;}
const component=(value:any,kind='target-speed')=>value.effects.find((e:any)=>e.kind===kind),near=(a:number,b:number,t=.0001)=>assert.ok(Math.abs(a-b)<t,`${a} vs ${b}`);
let race=fixture();race.events=[event(860001)];ramp(race);const normal=await analyze('positive-target-half-credit',race),target=component(normal);assert.ok(target.acceleratingDuration>.7);assert.ok(target.fullyEffectiveDuration>2.8);assert.ok(target.usefulDuration>3&&target.usefulDuration<3.9);assert.ok(normal.distance.max>0);near(normal.speedPotentialDistance.mid,2);near(normal.carryoverEfficiency,normal.carryoverDistance.mid/2);
race=fixture();race.events=[event(860001)];for(const f of race.frames)if(f.time>=50&&f.time<=54)f.runners[0].speed=19;let value=await analyze('below-normal-zero-credit',race);near(component(value).usefulDuration,0);assert.ok(component(value).belowBaselineDuration>3.9);
race=fixture();race.events=[event(860001),event(860003,48,8,1)];ramp(race);for(const f of race.frames)if(f.time>=48&&f.time<56)f.runners[0].speed-=1;value=await analyze('incoming-direct-debuff-preserves-normal-self-target',race);near(component(value).usefulDuration,target.usefulDuration,.02);assert.ok(value.distance.max>0);
race=fixture();race.events=[event(860001),event(860011,48,8,1)];ramp(race);for(const f of race.frames)if(f.time>=48&&f.time<=56)f.runners[0].speed-=.3;value=await analyze('incoming-target-debuff-lowers-both-targets',race);near(component(value).usefulDuration,target.usefulDuration,.05);assert.ok(value.distance.max>0);
race=fixture();race.events=[event(860001)];ramp(race);for(const f of race.frames)if(f.time>=50&&f.time<=54){f.runners[0].blockFrontRunnerIndex=1;f.runners[1].distance=f.runners[0].distance+1;f.runners[1].speed=25;}value=await analyze('recorded-block-zero-even-with-nonbinding-cap',race);near(component(value).usefulDuration,0);near(component(value).blockedDuration,4);near(value.speedPotentialDistance.mid,2);
race=fixture();race.events=[event(860001)];ramp(race);for(const f of race.frames)if(f.time>=50&&f.time<54)f.runners[0].blockFrontRunnerIndex=null;value=await analyze('missing-block-flag-still-scores-speed',race);assert.ok(component(value).coverageRate>.99);assert.ok(component(value).usefulDuration>3);
race=fixture();race.events=[event(860002)];for(const f of race.frames)if(f.time>=50&&f.time<=54)f.runners[0].speed=20.1;value=await analyze('mixed-target-and-capped-acceleration',race,860002);assert.ok(component(value).usefulDuration>3.8);near(component(value,'acceleration').usefulDuration,0);assert.ok(component(value,'acceleration').cappedDuration>3.8);
for(const [id,name]of [[860004,'zero-selected-acceleration'],[860005,'negative-selected-acceleration']]as const){race=fixture();race.events=[event(id)];for(const f of race.frames)if(f.time>=50&&f.time<54)f.runners[0].speed=19+Math.min(.5,(f.time-50)*.3);value=await analyze(name,race,id);near(component(value,'acceleration').usefulDuration,0);}
race=fixture();race.events=[event(860006)];for(const f of race.frames)if(f.time>=50&&f.time<54)f.runners[0].speed=Math.min(19.6,19.4+(f.time-50)*.8);value=await analyze('acceleration-reaches-cap-fractionally',race,860006);assert.ok(component(value,'acceleration').usefulDuration>0&&component(value,'acceleration').usefulDuration<.5);assert.ok(component(value,'acceleration').cappedDuration>3.4);
race=fixture();race.events=[event(860001,98,6)];ramp(race,98,104);value=await analyze('after-finish-assessed-unused',race);near(component(value).activeDuration,6);near(component(value).afterFinishDuration,4);assert.ok(component(value).usefulDuration<2);assert.ok(component(value).scenarioUtilization.max<1/3+.001);near(component(value).coverageRate,1);near(value.speedPotentialDistance.mid,3);
race=fixture();race.events=[event(860001,50,1)];ramp(race,50,51);for(const f of race.frames)if(f.time>51&&f.time<=53)f.runners[0].speed=20.1;value=await analyze('separate-post-expiry-carryover',race);assert.ok(value.carryoverDistance?.mid>0);assert.ok(value.carryoverTime?.mid<0);
race=fixture();race.events=[event(860008,50,0)];for(const f of race.frames)f.runners[1].distance=f.runners[0].distance+25;value=await analyze('duration-usage2-leader-gap',race,860008);near(component(value).activeDuration,4.8);near(value.speedPotentialDistance.mid,2.4);
race=fixture();race.events=[event(860009,50,0)];value=await analyze('duration-usage3-hp-tier',race,860009);near(component(value).activeDuration,10);
race=fixture();race.events=[event(860010,50,0)];for(const f of race.frames)if(f.time>=50&&f.time<=53)f.runners[1].distance=f.runners[0].distance+(51-f.time);value=await analyze('duration-usage4-sampled-pass',race,860010);near(component(value).activeDuration,6);
race=fixture();race.events=[event(860001)];race.runners[0].stats.power=null;value=await analyze('unavailable-model-does-not-imply-zero',race);assert.equal(component(value).usefulDuration,null);assert.equal(component(value).scenarioUtilization,undefined);
race=fixture();race.runners[0].lastSpurtDistance=1300;race.events=[event(860001,70,4)];for(const f of race.frames)if(f.time>=70&&f.time<74)f.runners[0].speed=22;value=await analyze('funded-spurt-below-normal-zero-credit',race);near(component(value).utilization,0);near(component(value).belowBaselineDuration,4);
// Low HP and speed below the ordinary/maximum midpoint do not select a target.
// A replay already running near maximum now intentionally supports full spurt.
for(const f of race.frames){f.runners[0].hp=100;if(f.time>=70&&f.time<74)f.runners[0].speed=21;}
value=await analyze('unresolved-spurt-target-retains-scenarios',race);
const uncertainReport=JSON.parse(await readFile(join(folder,'unresolved-spurt-target-retains-scenarios-report.json'),'utf8'))[0].runners[0].motion;
const uncertainTarget=uncertainReport.samples.find((s:any)=>s.time===70).targetActive;assert.ok(uncertainTarget.max>uncertainTarget.min);
assert.ok(component(value).scenarioUtilization.max>=component(value).scenarioUtilization.min);
race=fixture();race.events=[event(860007)];for(const f of race.frames)if(f.time>=50&&f.time<54)f.runners[0].speed+=1;value=await analyze('direct-speed-has-independent-component',race,860007);near(component(value,'current-speed').usefulDuration,4);assert.equal(value.effects.length,1);near(value.distance.mid,4,.000001);near(value.carryoverDistance.mid,0,.000001);
race=fixture();race.events=[event(860001,44,12),event(860008,46,4)];
for(const f of race.frames)if(f.time>=44&&f.time<=56)f.runners[0].speed=f.time<46?Math.min(20.1,19.6+(f.time-44)*.5):f.time<50?Math.min(20.6,20.1+(f.time-46)*.5):Math.max(20.1,20.6-(f.time-50)*.8);
value=await analyze('retained-benefit-while-another-skill-expires',race);assert.ok(component(value).deceleratingEffectiveDuration>.4);assert.ok(component(value).fullyEffectiveDuration>9);assert.ok(value.distance.min>0);
race=fixture();race.events=[event(860001,50,4),event(860012,46,4)];
for(const f of race.frames)if(f.time>=46&&f.time<=54)f.runners[0].speed=f.time<50?Math.min(21.1,19.6+(f.time-46)*.5):Math.max(20.1,21.1-(f.time-50)*.8);
value=await analyze('unrelated-overspeed-is-not-new-skill-benefit',race);assert.ok(component(value).deceleratingEffectiveDuration<.05);assert.ok(component(value).fullyEffectiveDuration<3);
race=fixture();race.events=[event(860002,50,4),event(860013,49,1.8)];
race.frames=race.frames.filter((f:any)=>f.time<=50||f.time>=51);
for(const f of race.frames)if(f.time>=49&&f.time<=50)f.runners[0].speed=19.7;else if(f.time>=51&&f.time<=54)f.runners[0].speed=20.1;
value=await analyze('coarse-cap-arrival-before-other-skill-expiry',race,860002);assert.ok(component(value,'acceleration').usefulDuration>.56&&component(value,'acceleration').usefulDuration<.6);assert.ok(component(value,'acceleration').cappedDuration>3.2);
const mismatch=structuredClone(race);mismatch.frames.find((f:any)=>f.time===51).runners[0].speed=19.9;
value=await analyze('coarse-cap-reconstruction-requires-endpoint-fit',mismatch,860002);assert.ok(component(value,'acceleration').usefulDuration>.95);
// Acceleration's full head start is ordinary gain, even after the skill expires
// and after the faster path reaches its cap while the other keeps accelerating.
race=fixture();race.runners[0].lastSpurtDistance=2000*2/3;race.events=[event(860006,67,1)];
const accelerationOnly=await analyze('acceleration-head-start-is-direct',race,860006);
assert.ok(accelerationOnly.distance.mid>.05);near(accelerationOnly.activeDistance.mid,accelerationOnly.distance.mid,.000001);
near(accelerationOnly.carryoverDistance.mid,0,.000001);near(accelerationOnly.carryoverTime.mid,0,.000001);assert.equal(accelerationOnly.carryoverEfficiency,null);near(accelerationOnly.speedPotentialDistance.mid,0);
let accelerationReport=JSON.parse(await readFile(join(folder,'acceleration-head-start-is-direct-report.json'),'utf8'))[0].runners[0];
near(accelerationReport.totals.benefit.carryoverDistance.mid,0,.000001);
// A mixed skill whose target boost never binds must produce the same head
// start as acceleration alone, with no invented speed carryover.
race.events=[event(860002,67,1)];const mixedHeadStart=await analyze('mixed-head-start-excludes-acceleration-carryover',race,860002);
near(mixedHeadStart.distance.mid,accelerationOnly.distance.mid,.000001);near(mixedHeadStart.activeDistance.mid,mixedHeadStart.distance.mid,.000001);near(mixedHeadStart.carryoverDistance.mid,0,.000001);near(mixedHeadStart.speedPotentialDistance.mid,.5);
// Retained speed from a real velocity modifier still counts, alongside direct
// acceleration gain. The combined components must add back to the same total.
race.events=[event(860006,67,1),event(860014,67.25,2)];await analyze('joint-speed-carryover-keeps-acceleration-direct',race,860006);
accelerationReport=JSON.parse(await readFile(join(folder,'joint-speed-carryover-keeps-acceleration-direct-report.json'),'utf8'))[0].runners[0];
assert.ok(accelerationReport.totals.benefit.carryoverDistance.mid>0);near(accelerationReport.totals.benefit.distance.mid,accelerationReport.totals.benefit.activeDistance.mid+accelerationReport.totals.benefit.carryoverDistance.mid,.000001);
near(accelerationReport.skills.find((s:any)=>s.skillId===860006).motion.carryoverDistance.mid,0,.000001);near(accelerationReport.totals.benefit.speedPotentialDistance.mid,2);near(accelerationReport.totals.benefit.carryoverEfficiency,accelerationReport.totals.benefit.carryoverDistance.mid/2);
race.events=[event(860006,67,1),event(860006,69,1)];value=await analyze('repeated-acceleration-stays-direct',race,860006);
assert.ok(value.distance.mid>accelerationOnly.distance.mid);near(value.activeDistance.mid,value.distance.mid,.000001);near(value.carryoverDistance.mid,0,.000001);
// Direct speed changes are instantaneous, including off-grid event boundaries.
race=fixture();race.events=[event(860007,50.07,3.13)];value=await analyze('instant-off-grid-area',race,860007);near(value.distance.mid,3.13,.000001);near(value.activeDistance.mid,3.13,.000001);
race=fixture();race.events=[event(860007)];for(const f of race.frames)if(f.time>=50&&f.time<=54){f.runners[0].blockFrontRunnerIndex=1;f.runners[1].distance=f.runners[0].distance+1;f.runners[1].speed=19;}
value=await analyze('direct-speed-applies-after-traffic-cap',race,860007);near(value.distance.mid,4,.000001);near(component(value,'current-speed').usefulDuration,4);
race=fixture();race.events=[event(860014)];value=await analyze('natural-deceleration-tail',race,860014);near(value.activeDistance.mid,4,.000001);assert.ok(value.carryoverDistance.mid>.5);near(value.distance.mid,value.activeDistance.mid+value.carryoverDistance.mid);near(value.carryoverEfficiency,value.carryoverDistance.mid/4);assert.equal(value.carryoverComplete,true);
const clearCarry=value.carryoverDistance.mid;
for(const f of race.frames)if(f.time>=54){f.runners[0].blockFrontRunnerIndex=1;f.runners[1].distance=f.runners[0].distance+1;f.runners[1].speed=18;}
value=await analyze('traffic-removes-expiry-tail',race,860014);assert.ok(value.carryoverDistance.mid<clearCarry*.05);
race=fixture();race.events=[event(860014)];race.frames=race.frames.filter((f:any)=>f.time<=54||f.time>=58);
value=await analyze('missing-tail-is-not-zero-or-complete',race,860014);assert.equal(value.carryoverComplete,false);assert.equal(value.carryoverEfficiency,null);
// A long decay remains useful beyond the old 12/15-second cutoffs.
race=fixture();race.events=[event(860015,30,1)];value=await analyze('no-arbitrary-carryover-cutoff',race,860015);assert.ok(value.carryoverDistance.mid>50);near(value.activeDistance.mid,9,.000001);assert.equal(value.carryoverComplete,true);
race=fixture();race.events=[event(860007,50,1),event(860007,60,3)];value=await analyze('repeat-procs-joint-gain',race,860007);near(value.speedPotentialDistance.mid,4);near(value.distance.mid,4,.000001);near(value.activeDistance.mid,4,.000001);
// The combined score includes both effects of a mixed skill and weights time.
race=fixture();race.events=[event(860002),event(860007,60,8)];for(const f of race.frames)if(f.time>=50&&f.time<=54)f.runners[0].speed=20.1;
await analyze('joint-mixed-components',race,860002);
let report=JSON.parse(await readFile(join(folder,'joint-mixed-components-report.json'),'utf8'))[0].runners[0],totals=report.totals;
const missed=totals.skills.filter((s:any)=>s.score===0&&s.motion==null);assert.ok(missed.length>=13);const rated=totals.skills.filter((s:any)=>s.score!=null);near(totals.score,rated.reduce((n:number,s:any)=>n+s.score,0)/rated.length);assert.ok(totals.score<.2);near(totals.assessed,16);near(totals.benefit.speedPotentialDistance.mid,10);near(totals.benefit.carryoverEfficiency,totals.benefit.carryoverDistance.mid/10);near(totals.benefit.distance.mid,totals.benefit.activeDistance.mid+totals.benefit.carryoverDistance.mid);
// Simultaneous expiring bonuses have a nonlinear joint decay. Do not sum marginals.
race=fixture();race.events=[event(860014),event(860015,50,4)];await analyze('joint-overlapping-carryover',race,860014);
report=JSON.parse(await readFile(join(folder,'joint-overlapping-carryover-report.json'),'utf8'))[0].runners[0];totals=report.totals;
near(totals.benefit.activeDistance.mid,40,.000001);near(totals.benefit.carryoverEfficiency,totals.benefit.carryoverDistance.mid/40);
const marginalSum=totals.skills.reduce((n:number,s:any)=>n+(s.motion?.distance?.mid??0),0);assert.ok(Math.abs(marginalSum-totals.benefit.distance.mid)>.1,'Joint gain must not be a sum of overlapping removals.');
// First-arrival priority belongs to scoring only, not the joint distance model.
race=fixture();race.events=[event(860001,50,6),event(860008,50.25,6),event(860009,50.5,6)];
for(const f of race.frames)if(f.time>=50&&f.time<=56.5)f.runners[0].speed=19.6+Math.min(1.5,(f.time-50)*.5);
await analyze('stacked-speed-earlier-first',race);
report=JSON.parse(await readFile(join(folder,'stacked-speed-earlier-first-report.json'),'utf8'))[0].runners[0];
const uses=[860001,860008,860009].map(id=>component(report.skills.find((s:any)=>s.skillId===id).motion));
assert.ok(uses[0].acceleratingDuration>.85&&uses[0].acceleratingDuration<1.05);assert.ok(uses[0].fullyEffectiveDuration>4.9);
assert.ok(uses[1].acceleratingDuration>1.6&&uses[1].acceleratingDuration<1.85);assert.ok(uses[2].acceleratingDuration>2.3&&uses[2].acceleratingDuration<2.65);
assert.ok(uses[0].usefulDuration>uses[1].usefulDuration&&uses[1].usefulDuration>uses[2].usefulDuration);
for(const use of uses)near(use.belowBaselineDuration,0,.000001);near(report.totals.benefit.speedPotentialDistance.mid,9);
race.events=[event(860001,50,6),event(860008,50,6),event(860009,50,6)];await analyze('simultaneous-speed-shares-tier',race);
report=JSON.parse(await readFile(join(folder,'simultaneous-speed-shares-tier-report.json'),'utf8'))[0].runners[0];
const simultaneous=[860001,860008,860009].map(id=>component(report.skills.find((s:any)=>s.skillId===id).motion));
near(simultaneous[0].usefulDuration,simultaneous[1].usefulDuration,.000001);near(simultaneous[1].usefulDuration,simultaneous[2].usefulDuration,.000001);
race.events=[event(860001,50,.75),event(860008,50.25,6),event(860009,50.5,6)];await analyze('expired-lower-tier-drops-ceiling',race);
report=JSON.parse(await readFile(join(folder,'expired-lower-tier-drops-ceiling-report.json'),'utf8'))[0].runners[0];
const stack=report.motion.samples.find((s:any)=>s.time===51).targetStack;
near(stack.ceilings['motion-0:860008:50.25'].mid-stack.baseline.mid,.5,.000001);
near(stack.ceilings['motion-0:860009:50.5'].mid-stack.baseline.mid,1,.000001);
const courses=JSON.parse(await readFile(join(reference,'courses.json'),'utf8'));courses[99994].slopes=[{start:1000,length:100,slope:20000}];await writeFile(join(reference,'courses.json'),JSON.stringify(courses));
race=fixture();race.events=[event(860001,44,12)];
for(const f of race.frames)if(f.time>=44&&f.time<=56)f.runners[0].speed=f.time<50?Math.min(20.1,19.6+(f.time-44)*.5):f.time<55?Math.max(20.1-1/3,20.1-(f.time-50)*.8):Math.min(20.1,20.1-1/3+(f.time-55)*.5);
value=await analyze('retained-benefit-while-entering-uphill',race);assert.ok(component(value).deceleratingEffectiveDuration>.2);assert.ok(value.distance.min>0);
console.log(JSON.stringify({cases,wholeFileImport:'passed',halfCreditAndScenarios:'passed',debuffBaseline:'passed',blockedZeroCredit:'passed',mixedAcceleration:'passed',scheduledDuration:'passed',durationScalings:'passed',carryover:'passed',accelerationDirectGain:'passed',speedPotential:'passed',beneficialDeceleration:'passed',retainedCapArrival:'passed',instantArea:'passed',jointTotals:'passed',stackPriority:'passed',tailCoverage:'passed',originals:'unchanged'}));
