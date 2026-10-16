/** Imported races exercise baseline target recovery and HP/wit choice odds. */
import assert from 'node:assert/strict';
import { parseRaceJson } from '../src/data/import';
import { analyzeRace } from '../src/data/analytics';
import { assembleReferenceData } from '../src/data/reference';
import { motionFor } from '../src/data/motion-analysis';
import { spurtComparison, spurtDisplayGroups, spurtLuck, spurtDistribution, NORMAL_SPURT_START_DELAY } from '../src/data/spurt-comparison';
const total=2000,entry=total*2/3,speed=1000,guts=600,wisdom=600;
const term=Math.sqrt(500*speed)*.002,late=20*.994+term,maximum=(late+.2)*1.05+term+(450*guts)**.597*.0001;
const hpPerMeter=(v:number)=>20*(v-20+12)**2/144*(1+200/Math.sqrt(600*guts))/v;
const budget=total-entry-60,low=hpPerMeter(late)*budget,high=hpPerMeter(maximum)*budget;
const metadata={characters:{},outfits:{},trackNames:{},skillNames:{},skills:{},source:{name:'Fixture',revision:'1',url:''}};
const reference=assembleReferenceData(metadata,{'96321':{distance:total,raceTrackId:10006,surface:1,turn:1,course:1,laneMax:10000,courseSetStatus:[],corners:[],straights:[],slopes:[]}},{name:'Fixture',revision:'1',url:''},[]);
function evaluate(hp:number,target=maximum,delay=0,missingWisdom=false){
  const raw={schemaVersion:1,title:'Spurt selection fixture',synthetic:true,distance:total,courseId:96321,category:'practice',conditions:{ground:'1',weather:'1',season:'1'},
    runners:[{id:'runner-1',index:0,gate:1,name:'Fixture',strategyCode:3,lastSpurtDistance:entry+delay,mood:3,stats:{speed,stamina:1000,power:1000,guts,wisdom:missingWisdom?null:wisdom},aptitudes:{middle:7,turf:7,late:7},skills:[]}],events:[],
    frames:Array.from({length:201},(_,i)=>{const distance=i*10,time=distance/late,spurtTime=Math.max(0,(distance-entry-delay)/late);return {time,runners:[{runnerId:'runner-1',distance,speed:distance<entry+delay?late:Math.min(target,late+.6*spurtTime),hp:hp+(entry-distance)*hpPerMeter(late),lane:0,blockFrontRunnerIndex:-1}]};})};
  const race=parseRaceJson(raw)[0],analysis=analyzeRace(race,reference),motion=motionFor(race,reference,analysis,'runner-1');
  return {race,analysis,value:spurtComparison(race,reference,analysis,race.runners[0],motion)};
}
const full=evaluate(high+100);
assert.ok(Math.abs(full.value.maximum!.mid-maximum)<1e-8);
assert.ok(Math.abs(full.value.target!.mid-maximum)<.001);
assert.ok(full.analysis.runners['runner-1'].summary.spurtSpeed!<maximum-1,'Spurt-start speed must not be displayed as target.');
assert.equal(full.value.deterministic,true);assert.equal(full.value.candidates[0].probability,1);
const limited=evaluate((low+high)/2),choices=limited.value.candidates;
assert.ok(choices.length>10);assert.ok(Math.abs(choices.reduce((n,c)=>n+c.probability,0)-1)<1e-12);
assert.ok(Math.abs(choices[0].probability-.45)<1e-12);
for(let i=1;i<choices.length;i++)assert.ok(choices[i].time>=choices[i-1].time);
const candidate=choices[2],matched=evaluate((low+high)/2,candidate.speed,candidate.delay).value;
assert.equal(matched.matched,2);assert.ok(Math.abs(matched.betterChance!-(.45+.55*.45))<1e-12);
assert.ok(Math.abs(matched.shortfall!.mid-(maximum-candidate.speed))<.05);
assert.equal(evaluate(10).value.deterministic,true);
assert.equal(evaluate((low+high)/2,maximum,123).value.matched,null,'A mismatched speed/delay must not acquire invented luck.');
assert.equal(evaluate(high+100,maximum,0,true).value.candidates.length,0);
// Complete imported replay with two recoveries. Each speed choice must be
// identified from samples before the next recovery, never the final plateau.
const recoveryRef=structuredClone(reference);
recoveryRef.metadata.skills[850010]={name:'Synthetic recovery',rarity:1,activateLot:0,branches:[{branchIndex:0,condition:'always==1',rawDuration:0,durationUsage:1,effects:[{type:9,rawValue:1500,valueUsage:1,levelUsage:1,targetType:1,additionalActivateType:0}]}]};
const multi=structuredClone(evaluate((low+high)/2,candidate.speed,candidate.delay).race);
multi.runners[0].skills=[{id:850010,level:1}];
const times=[1750/late,1880/late];
multi.events=times.map(time=>({time,type:3,runnerId:'runner-1',skillId:850010,params:[0,850010,0,0,1],label:'Recovery'}));
for(const f of multi.frames){const s=f.runners[0];if(f.time>=times[0]){s.hp!+=420;s.speed=Math.min(maximum,candidate.speed+.6*(f.time-times[0]));}if(f.time>=times[1])s.hp!+=420;}
const multiRace=parseRaceJson(multi)[0],multiAnalysis=analyzeRace(multiRace,recoveryRef),multiMotion=motionFor(multiRace,recoveryRef,multiAnalysis,'runner-1');
const multiValue=spurtComparison(multiRace,recoveryRef,multiAnalysis,multiRace.runners[0],multiMotion);
assert.equal(multiValue.decisions.length,3);
assert.equal(multiValue.decisions[0].matched,2,'The initial choice remains identifiable despite later recoveries.');
assert.ok(Math.abs(multiValue.decisions[0].observedTarget!-candidate.speed)<.02);
assert.ok(Math.abs(multiValue.decisions[1].observedTarget!-maximum)<.02);
assert.ok(Math.abs(multiValue.initialTarget!-candidate.speed)<.02,'First target must preserve the earlier choice rather than the final maximum.');
assert.ok(Math.abs(multiValue.waitingPlateau!.speed-late)<.02,'The lower waiting plateau is late cruising, not a selected spurt target.');
assert.ok(multiValue.waitingPlateau!.end<multiValue.startTime!);
assert.ok(multiValue.decisions[1].hp!>multiValue.decisions[0].hp!-(1750-entry)*hpPerMeter(late));
assert.equal(multiValue.decisions[2].deterministic,true);
assert.ok(multiValue.decisions.every(d=>!d.candidates.length||Math.abs(d.candidates.reduce((n,c)=>n+c.probability,0)-1)<1e-10));
// A new decision can overwrite a choice before any plateau is retained.
const early=structuredClone(multiRace);early.events[0].time=entry/late+.1;
const earlyAnalysis=analyzeRace(early,recoveryRef),earlyValue=spurtComparison(early,recoveryRef,earlyAnalysis,early.runners[0],motionFor(early,recoveryRef,earlyAnalysis,'runner-1'));
assert.equal(earlyValue.decisions[0].matched,null);
assert.equal(earlyValue.decisions[0].observedTarget,null);
// A clean accelerating pair that reaches the known maximum can establish a
// ceiling even when a subsequent block hides the next plateau sample.
const clipped=structuredClone(multiRace),after=clipped.frames.filter(f=>f.time>=times[0]&&f.time<times[1]);
const reach=after.findIndex(f=>f.runners[0].speed!>=maximum-.02);
assert.ok(reach>0);
for(const f of after.slice(reach+1))f.runners[0].blockFrontRunnerIndex=0;
const clippedAnalysis=analyzeRace(clipped,recoveryRef),clippedValue=spurtComparison(clipped,recoveryRef,clippedAnalysis,clipped.runners[0],motionFor(clipped,recoveryRef,clippedAnalysis,'runner-1'));
assert.equal(clippedValue.decisions[1].targetEvidence,'maximum-reached');
assert.ok(Math.abs(clippedValue.decisions[1].observedTarget!-maximum)<.025);
const obscuredFinal=structuredClone(multiRace);
for(const frame of obscuredFinal.frames)if(frame.time>=times[1])frame.runners[0].blockFrontRunnerIndex=0;
const obscuredAnalysis=analyzeRace(obscuredFinal,recoveryRef),obscuredValue=spurtComparison(obscuredFinal,recoveryRef,obscuredAnalysis,obscuredFinal.runners[0],motionFor(obscuredFinal,recoveryRef,obscuredAnalysis,'runner-1'));
assert.ok(obscuredValue.initialTarget!=null,'An obscured final window does not erase the initial reading.');
assert.equal(obscuredValue.target,null,'The motion model must not supply a final target when the last window has no clean reading.');
assert.equal(obscuredValue.targetTime,null);
assert.equal(obscuredValue.shortfall,null,'Unknown final speed cannot establish a shortfall.');
assert.ok(multiValue.targetTime!>=times[1],'Final evidence must come after the last recovery.');
// Whole replay with a recovery before acceleration settles: the HP checks agree
// on a full spurt, while only the later window has a clear speed reading.
const unchanged=structuredClone(evaluate(high+100,maximum,2).race);
unchanged.runners[0].skills=[{id:850010,level:1}];
const earlyRecovery=entry/late+1;
unchanged.events=[{time:earlyRecovery,type:3,runnerId:'runner-1',skillId:850010,params:[0,850010,0,0,1],label:'Recovery'}];
for(const frame of unchanged.frames)if(frame.time>=earlyRecovery)frame.runners[0].hp!+=420;
const unchangedRace=parseRaceJson(unchanged)[0],unchangedAnalysis=analyzeRace(unchangedRace,recoveryRef),unchangedValue=spurtComparison(unchangedRace,recoveryRef,unchangedAnalysis,unchangedRace.runners[0],motionFor(unchangedRace,recoveryRef,unchangedAnalysis,'runner-1'));
assert.equal(unchangedValue.decisions.length,2);
assert.equal(unchangedValue.decisions[0].observedTarget,null);
assert.ok(unchangedValue.delaySeconds!<=NORMAL_SPURT_START_DELAY);
const grouped=spurtDisplayGroups(unchangedValue);
assert.equal(grouped.length,1,'Unchanged full-spurt checks share a summary.');
assert.deepEqual(grouped[0].indices,[0,1]);
assert.ok(Math.abs(grouped[0].target!-maximum)<.001);
assert.equal(unchangedValue.decisions[0].observedTarget,null,'Grouping must not backfill an unobserved early target.');
assert.equal(spurtDisplayGroups(multiValue).length,2,'A lower earlier choice stays separate from later unchanged full-spurt checks.');
console.log(JSON.stringify({baselineTarget:'passed',maximum:'passed',hpBranches:'passed',probabilityMass:'passed',choiceMatching:'passed',unknownInputs:'passed',recoveryDecisions:'passed',noFutureFit:'passed'}));

// Presentation derives odds only from the imported replay's matched choice.
assert.equal(spurtLuck(matched)?.failedMin,2);
assert.equal(spurtLuck(matched)?.failedMax,2);
assert.equal(spurtLuck(full.value),null);
assert.equal(spurtLuck(evaluate((low+high)/2,maximum,123).value),null);
for(const axis of ['speed','delay'] as const){
 const distribution=spurtDistribution(matched,axis);
 assert.ok(Math.abs(distribution.reduce((sum,p)=>sum+p.probability,0)-1)<1e-10);
 assert.equal(distribution.flatMap(p=>p.indices).length,matched.candidates.length);
 assert.ok(distribution.every((p,i)=>!i||p.value>distribution[i-1].value));
}
const delayedFull=evaluate(high+100,maximum,60).value;
assert.ok(delayedFull.decisions[0].observedTarget!=null);
assert.ok(delayedFull.decisions[0].observedDelay!>3);
assert.equal(spurtLuck(delayedFull),null,'Observed speed does not resolve a contradictory no-roll budget.');
