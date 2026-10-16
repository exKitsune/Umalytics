/** Whole-file import and model produce temporal speed-change explanations. */
import assert from 'node:assert/strict';
import {parseRaceJson} from '../src/data/import';
import {analyzeRace} from '../src/data/analytics';
import {assembleReferenceData} from '../src/data/reference';
import {motionFor} from '../src/data/motion-analysis';
import {explainSpeedChanges} from '../src/data/speed-changes';
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
console.log(JSON.stringify({wholeReplay:'passed',overlappingCauses:'passed',timedEvidence:'passed',skillAndHp:'passed',noInventedTraffic:'passed',sectionVariation:'passed',positionKeepGuides:'passed'}));
