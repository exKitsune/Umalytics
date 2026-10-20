/** Whole-file import and model produce temporal speed-change explanations. */
import assert from 'node:assert/strict';
import {parseRaceJson} from '../src/data/import';
import {analyzeRace} from '../src/data/analytics';
import {assembleReferenceData} from '../src/data/reference';
import {motionFor} from '../src/data/motion-analysis';
import {explainSpeedChanges} from '../src/data/speed-changes';
import {explainTraceSpeed,traceSlopeGrades} from '../src/simulation/speed-explanations';
import {motionIndex as m,type DecisionEvent} from '../src/simulation/trace';
import {positionKeepGuides,positionKeepGuideSpans,positionKeepGuideTimeline,positionKeepMarkerGuides} from '../src/data/position-keep-guides';
const reference=assembleReferenceData({characters:{},outfits:{},trackNames:{},skillNames:{850020:'Test speed skill'},skills:{850020:{name:'Test speed skill',rarity:1,activateLot:0,branches:[{branchIndex:0,condition:'always==1',rawDuration:30000,durationUsage:1,effects:[{type:27,rawValue:3500,valueUsage:1,levelUsage:1,targetType:1,additionalActivateType:0}]}]}},source:{name:'Fixture',revision:'1',url:''}},{'96320':{distance:2400,raceTrackId:10006,surface:1,turn:1,course:1,laneMax:10000,courseSetStatus:[],corners:[],straights:[],slopes:[]}},{name:'Fixture',revision:'1',url:''},[]);
const source={schemaVersion:1,title:'Speed context fixture',synthetic:true,courseId:96320,distance:2400,category:'practice',conditions:{ground:'1',weather:'1',season:'1'},runners:[0,1].map(i=>({id:`runner-${i}`,index:i,gate:i+1,name:i?'Runner ahead':'Selected runner',strategyCode:1,mood:3,lastSpurtDistance:1600,stats:{speed:1000,stamina:1000,power:1000,guts:600,wisdom:600},aptitudes:{middle:7,turf:7,front:7},skills:i?[]:[{id:850020,level:1}]})),events:[{time:60,type:3,runnerId:'runner-0',skillId:850020,params:[0,850020,30000,0,1]}],frames:Array.from({length:121},(_,time)=>({time,runners:[0,1].map(i=>({runnerId:`runner-${i}`,distance:time*20+i*1.5,speed:i?20.2:time===19?20.8:time===20?20.6:time===21?20.2:time===22?20.1:time===23?20.4:time===59?19.6:time===60?19.95:time>=118?17.9:19.6,hp:time>=118?0:2800-time*20,lane:i*.03,blockFrontRunnerIndex:!i&&time===21?1:-1,temptationMode:0}))}))};
function evaluate(raw:typeof source){const race=parseRaceJson(raw)[0],analysis=analyzeRace(race,reference);return explainSpeedChanges(race,reference,analysis,race.runners[0],motionFor(race,reference,analysis,'runner-0',undefined,undefined,true));}
const changes=evaluate(source),dip=changes.find(c=>c.start===19)!;
assert.ok(dip.reasons.some(r=>r.label==='Middle leg lowers target'));
assert.ok(dip.reasons.some(r=>r.label==='Approaching Runner ahead'&&r.evidence==='position'));
assert.ok(changes.find(c=>c.start===20)!.reasons.some(r=>r.label==='Blocked by Runner ahead'&&r.evidence==='recorded'&&r.start===21),'A later retained block is timed at its sample, never backdated.');
assert.ok(changes.find(c=>c.start===59)!.reasons.some(r=>r.label==='Test speed skill activated'));
assert.ok(changes.find(c=>c.start===117)!.reasons.some(r=>r.label==='Exhausted'));
const separated=structuredClone(source);for(const f of separated.frames){f.runners[1].lane=.8;f.runners[0].blockFrontRunnerIndex=-1;}
assert.ok(evaluate(separated).every(c=>c.reasons.every(r=>!r.label.includes('Runner ahead'))),'Speed alone must not invent a traffic cause.');
const sections=structuredClone(source);sections.events=[];sections.runners[0].skills=[];
for(const f of sections.frames){f.runners[0].speed=f.time>=5?19.65:19.6;f.runners[0].blockFrontRunnerIndex=-1;f.runners[1].lane=.8;}
const sectionChanges=evaluate(sections),sectionChange=sectionChanges.find(c=>c.start===4)!;
assert.ok(sectionChange.reasons.some(r=>r.label==='Possible section variation'&&r.detail?.includes('unrecorded')),'A small free-running section-boundary change has an explicitly conditional explanation.');
const tooLarge=structuredClone(sections);for(const f of tooLarge.frames)if(f.time>=5)f.runners[0].speed=19.9;
assert.ok(evaluate(tooLarge).every(c=>c.reasons.every(r=>r.label!=='Possible section variation')),'A change larger than the full section-roll range cannot be assigned to wit.');
const away=structuredClone(sections);for(const f of away.frames)f.runners[0].speed=f.time>=6?19.65:19.6;
assert.ok(evaluate(away).every(c=>c.reasons.every(r=>r.label!=='Possible section variation')),'A fluctuation away from a section boundary remains unresolved.');
const spurt=structuredClone(sections);spurt.runners[0].lastSpurtDistance=80;
assert.ok(evaluate(spurt).every(c=>c.reasons.every(r=>r.label!=='Possible section variation')),'Section randomness is off during the actual last spurt.');
function guides(raw:typeof source,time=20){const race=parseRaceJson(raw)[0];return positionKeepGuides(race,analyzeRace(race,reference),race.runners[0].id,time);}
assert.deepEqual(guides(source).map(g=>[g.id,g.gap]),[['SU',-4.5],['OT',-10]]);
const chasing=structuredClone(separated);chasing.runners[0].strategyCode=3;
assert.deepEqual(guides(chasing).map(g=>[g.id,g.gap]),[['PD',13.780000000000001],['PU',14.84]]);
assert.equal(guides(chasing,60).length,0,'Position-keep entry thresholds stop after section 10.');
const solo=structuredClone(source);solo.runners[1].strategyCode=2;
assert.deepEqual(guides(solo).map(g=>[g.id,g.gap]),[['SU',-12.5]],'A lone Front Runner uses the solo SU threshold and has no OT peer.');
const runaway=structuredClone(source);runaway.runners.forEach(r=>r.strategyCode=5);
assert.deepEqual(guides(runaway).map(g=>[g.id,g.gap]),[['SU',-17.5],['OT',-27.5]]);
function guideSpans(raw:typeof source){const race=parseRaceJson(raw)[0];return positionKeepGuideSpans(race,analyzeRace(race,reference),race.runners[0].id);}
const passing=structuredClone(source);
for(const frame of passing.frames){
  const t=frame.time,lead=t<=15?10.25-t:t<=30?t-19.75:40.25-t;
  frame.runners[1].distance=frame.runners[0].distance+lead;
}
const spans=guideSpans(passing);
assert.deepEqual(spans.filter(s=>s.id==='SU').map(s=>[s.start,s.end]),[[10.25,19.75],[40.25,50]],'SU guides cover only first-place portions, split at passes between retained frames.');
assert.deepEqual(spans.filter(s=>s.id==='OT').map(s=>[s.start,s.end]),[[0,10.25],[19.75,40.25]],'OT guides exclude every first-place portion.');
assert.ok(guideSpans(chasing).every(s=>s.end<=50),'Following-strategy guides also stop at the end of section 10.');
assert.equal(guideSpans(chasing).find(s=>s.id==='PU')?.end,50);
const missing=structuredClone(passing);missing.frames[30].runners[0].temptationMode=null as unknown as number;
assert.ok(guideSpans(missing).every(s=>s.end<=29||s.start>=31),'Unknown rushed state must leave a gap in the guide.');
assert.match(guides(passing)[0].detail,/Speed Up stop/);
assert.match(guides(passing)[1].detail,/Overtake stop/);
const markerRace=parseRaceJson(missing)[0],markerTimeline=positionKeepGuideTimeline(markerRace,analyzeRace(markerRace,reference),'runner-0');
assert.deepEqual(positionKeepMarkerGuides(markerTimeline,120).map(g=>g.id),['SU','OT'],'Axis markers remain visible at the finish without seeking to a status.');
assert.deepEqual(positionKeepMarkerGuides(markerTimeline,30).map(g=>g.id),['SU','OT'],'A missing or ineligible current sample does not hide reference markers.');
assert.deepEqual(positionKeepMarkerGuides(markerTimeline,-1).map(g=>g.id),['SU','OT'],'A cursor before the first retained sample uses the first valid marker reference.');
// Matched execution must explain sustained effects and their actual boundaries,
// including hills that share an inclusive endpoint and overlapping skill effects.
const nativeRace=parseRaceJson(source)[0],nativeRunner=nativeRace.runners[0],nativeReference=structuredClone(reference);
nativeReference.courses[96320].slopes=[{start:100,length:10,slopePercent:2},{start:120,length:10,slopePercent:-1.5}];
const nativeRows=[99,100,110,111,120,125,130,131,132].map((position,i)=>{
  const row=Array(43).fill(0);
  Object.assign(row,{[m.tick]:i+1,[m.time]:i+1,[m.dt]:1,[m.position]:position,[m.hp]:100,
    [m.target]:20,[m.base]:20,[m.pace]:1,[m.unclamped]:20,[m.selfSpeed]:20,[m.skillSpeed]:20,[m.speed]:20,
    [m.cap]:30,[m.minimum]:17,[m.blocker]:-1,[m.downhill]:i>=4?1:0});
  return row;
});
let seq=0;
const nativeEvent=(kind:string,time:number,skillId:string,data:DecisionEvent['data']):DecisionEvent=>({
  kind,time,lastTime:time,skillId,data,sequence:++seq,lastSequence:seq,tick:time,lastTick:time,count:1,horseIndex:0,stage:'test',detail:0,
});
const nativeEvents=[
  nativeEvent('initial-stats',0,'',{power:1000}),
  nativeEvent('effect-applied',3,'850021',{type:3,modifier:1000,duration:1}),
  nativeEvent('effect-ended',4,'850021',{}),
];
const nativeExplain=(rows=nativeRows,events=nativeEvents)=>explainTraceSpeed(nativeRace,nativeRunner,nativeReference,rows,events);
const label=(changes:ReturnType<typeof nativeExplain>,time:number)=>changes.find(c=>c.start===time)!.reasons.map(r=>r.label).join(' ');
const slopes=nativeExplain();
assert.match(label(slopes,2),/Uphill −0\.400 m\/s target/);
assert.match(label(slopes,3),/Uphill −0\.200 m\/s target/,'Current Power, not raw career Power, sets the penalty');
assert.match(label(slopes,4),/Uphill penalty ends \(\+0\.200 m\/s target\)/);
assert.match(label(slopes,5),/Downhill boost \+0\.450 m\/s target/);
assert.match(label(slopes,7),/Downhill boost \+0\.450/,'Slope endpoint remains inclusive');
assert.match(label(slopes,8),/Downhill boost ends \(−0\.450/,'Mode alone cannot provide speed on flat ground');
assert.doesNotMatch(label(slopes,9),/Downhill boost/);
assert.deepEqual(traceSlopeGrades(nativeRows.slice(0,4),[{start:100,length:10,slopePercent:2},{start:110,length:10,slopePercent:1}]),[0,2,1,0],
  'A shared same-direction boundary adopts the new grade with the first region end; the one-shot event cannot be rediscovered');
const mixedEvents=[
  nativeEvent('initial-stats',0,'',{power:1000}),
  nativeEvent('effect-applied',2,'850020',{type:31,modifier:.2,duration:3}),
  nativeEvent('effect-applied',2,'850022',{type:10,modifier:5,duration:3}),
  nativeEvent('effect-applied',2,'asitame',{type:31,modifier:.15,duration:3}),
  nativeEvent('effect-applied',2,'staminasyoubu',{type:27,modifier:.1,duration:3}),
  nativeEvent('effect-ended',5,'850020',{}),
  nativeEvent('effect-ended',5,'850022',{}),
  nativeEvent('effect-ended',5,'asitame',{}),
  nativeEvent('effect-ended',5,'staminasyoubu',{}),
];
const activeRows=structuredClone(nativeRows);
activeRows.forEach((r,i)=>{r[m.acceleration]=.5;r[m.unclamped]=r[m.selfSpeed]=r[m.skillSpeed]=r[m.speed]=19+i*.1;});
const active=nativeExplain(activeRows,mixedEvents);
assert.match(label(active,3),/Test speed skill \+0\.200 m\/s² acceleration/,'Ongoing acceleration names its active skill, not only its activation tick');
assert.match(label(active,3),/Uphill −0\.400/,'Simultaneous causes survive together');
assert.match(label(active,3),/Power release \+0\.150 m\/s² acceleration/);
assert.match(label(active,3),/Stamina limit break \+0\.100 m\/s target/);
assert.match(label(active,5),/Power release ends/);
assert.match(label(active,5),/Stamina limit break ends/);
assert.doesNotMatch(label(active,5),/850022/,'Vision-only expiry is not a velocity cause');
assert.doesNotMatch(label(active,6),/Power release|Test speed skill/,'Expired acceleration is not still presented as active');
const modeRows=structuredClone(nativeRows);
modeRows[0][m.paceMode]=1;modeRows[0][m.pace]=1.04;
modeRows[1][m.paceMode]=2;modeRows[1][m.pace]=1.04;
modeRows[2][m.paceMode]=0;
modeRows[0][m.rushing]=1;modeRows[1][m.rushing]=4;modeRows[2][m.rushing]=1;
modeRows[0][m.blocker]=1;modeRows[0][m.finalLoss]=.2;
const modes=nativeExplain(modeRows,[]);
assert.match(label(modes,2),/Overtake ×1\.040/,'A mode change still matters when its multiplier stays equal');
assert.match(label(modes,2),/Traffic speed cut ends/);
assert.match(label(modes,2),/Rushed target speed ×1\.040/);
assert.doesNotMatch(label(modes,2),/Rushed starts/,'Entering the speed boost is not a second rushed episode');
assert.match(label(modes,3),/Rushed speed boost ends/);
assert.match(label(modes,3),/Overtake ends/);
modeRows[3][m.hp]=0;modeRows[3][m.unclamped]=modeRows[3][m.selfSpeed]=modeRows[3][m.skillSpeed]=modeRows[3][m.speed]=19;
assert.match(label(nativeExplain(modeRows,[]),4),/HP-empty deceleration/);
console.log(JSON.stringify({wholeReplay:'passed',overlappingCauses:'passed',timedEvidence:'passed',skillAndHp:'passed',noInventedTraffic:'passed',sectionVariation:'passed',positionKeepGuides:'passed',tracedSlopesAndEffects:'passed',tracedModeTransitions:'passed'}));
