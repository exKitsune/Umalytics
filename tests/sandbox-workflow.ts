import {mergeJobProgress} from '../src/sandbox/progress';
import {decodeSimulatorFrames} from '../src/sandbox/binary-frames';
import {STAT_PAIRS,STAT_STEP,nextStatOffset,statMeasurementBatch,statTrend} from '../src/sandbox/stat-trend';
import {metricDisplay,metricComparison} from '../src/sandbox/metric-display';
import {checkpointPositions,positionCheckpoints} from '../src/sandbox/position-checkpoints';
import {upcomingEvents,localDate} from '../src/sandbox/upcoming-events';
import {startQuality} from '../src/data/start-quality';
import {skillColumns,sortSkills,activatedWinDelta,skillCheckChance} from '../src/sandbox/skill-table';
import {libraryIndex,filterLibrary,emptyFilter,duplicateUma,exportUmas,inLibraryView,parseTags} from '../src/sandbox/library';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assembleReferenceData} from '../src/data/reference';
import {blankSetup,blankUma,participant,fromRace,type RunSummary} from '../src/sandbox/model';
import {initialRace,aggregate,distribution,summarize,comparisons,headToHead,lobbyMetrics} from '../src/sandbox/results';
import type {PreparedRace} from '../src/analysis/prepared';
import {skillSearch,emptySkillFilters,matchesSkillFilters} from '../src/sandbox/search';
import {withOwnUnique,nativeUnique,swapPopularity,normalizePopularity,normalizeTeams,engineTeams,saveTarget} from '../src/sandbox/editor';
import events from '../src/sandbox/event-presets.json';
import {impactSetup,impactTarget,winImpacts,impactJobsByTarget,statRange,statCurve,conditionSplits} from '../src/sandbox/insights';
import type {Job} from '../src/sandbox/model';
import {skillTotals} from '../src/data/skill-totals';
import type {RaceAnalysis} from '../src/data/analytics';
const binary=Buffer.alloc(12+8+48);binary.write('UMAF');binary.writeUInt32LE(1,4);binary.writeUInt32LE(1,8);
for(const [i,n] of [1.25,42.125,20.5,0,2.75,1,-1].entries())binary.writeDoubleLE(n,12+i*8);
assert.deepEqual(decodeSimulatorFrames(binary,['runner']),[{time:1.25,runners:[{runnerId:'runner',distance:42.125,speed:20.5,hp:0,lane:2.75,temptationMode:1,blockFrontRunnerIndex:-1}]}]);
assert.throws(()=>decodeSimulatorFrames(binary,[]),/layout/);assert.throws(()=>decodeSimulatorFrames(binary.subarray(0,20),['runner']),/layout/);
const invalidBinary=Buffer.from(binary);invalidBinary.writeDoubleLE(NaN,20);assert.throws(()=>decodeSimulatorFrames(invalidBinary,['runner']),/Non-finite/);
const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const dates=['2026-09-01','2026-10-26','2026-11-01','2026-12-01','2027-01-01'].map(date=>({kind:'cm',date}));
assert.deepEqual(upcomingEvents(dates,'cm','2026-10-26').map(e=>e.date),['2026-10-26','2026-11-01','2026-12-01']);
assert.equal(upcomingEvents(dates,'cm','2026-08-01').length,2,'No invented current event before the series starts');
assert.deepEqual(upcomingEvents(dates,'cm','2028-01-01').map(e=>e.date),['2027-01-01']);
assert.equal(upcomingEvents(dates,'loh','2026-10-26').length,0);
assert.equal(localDate(new Date(2026,9,26,23,59)),'2026-10-26','Filter by local calendar date');
assert.deepEqual([.019,.02,.04,.041,.08,.081].map(n=>startQuality(n)?.tone),['great','good','good','poor','poor','late']);
assert.equal(startQuality(null),null);
assert.equal(metricComparison('Position · halfway',2,5).color,'#a6dbad','Earlier position is favorable');
assert.equal(metricComparison('Start delay · s',.06,.04).color,'#efb0b3','Longer start delay is unfavorable');
assert.equal(metricComparison('Traffic loss · m',-.2,-1).color,'#a6dbad','Less signed distance loss is favorable');
assert.equal(metricComparison('downhill-mode gain · m',1,2).color,'#efb0b3','Smaller distance gain is unfavorable');
assert.equal(metricComparison('HP spent',1000,1100).color,'#a6dbad');
assert.equal(metricComparison('Rushed · s',5,2).color,'#efb0b3');
assert.equal(metricComparison('Last-spurt start · m',800,900).color,'#a6dbad');
assert.equal(metricComparison('Starting HP',1000,999.8).color,'#ead68a','Visually identical values stay neutral');
assert.equal(metricComparison('Start delay · s',null,.04).color,'#ead68a');
assert.equal(metricComparison('Start delay · s',.04,undefined).description,'Lobby comparison unavailable.');
const positionSamples=[{distance:0,rank:9},{distance:199.9,rank:8},{distance:200,rank:7},{distance:499.9,rank:6},{distance:500,rank:5},{distance:600.1,rank:4},{distance:800,rank:3}];
assert.deepEqual(Object.values(checkpointPositions(positionSamples,1200)),[7,5,4,3],'Discrete standing at each runner distance crossing');
assert.equal(positionCheckpoints[1].distance(2500),1040,'Use engine whole-metre section boundary');
assert.deepEqual(Object.values(checkpointPositions([],1200)),[null,null,null,null]);
assert.deepEqual(Object.values(checkpointPositions(positionSamples,null)),[null,null,null,null]);
assert.deepEqual(Object.values(checkpointPositions(positionSamples.slice(3),1200)),[null,5,4,3],'Do not extrapolate a missing opening');
assert.deepEqual(Object.values(checkpointPositions(positionSamples.slice(0,5),1200)),[7,5,null,null],'Do not reuse the last rank at missing checkpoints');
assert.equal(metricDisplay('Position · halfway').group,'Race position');
const reference=assembleReferenceData(json('public/data/metadata.json'),json('public/data/courses.json'),json('public/data/reference-source.json'),json('public/data/simulator-skill-ids.json'));
assert.equal(blankUma().favorite,false,'New Umas are not favorited automatically');
const special=withOwnUnique(blankUma(),reference);
assert.equal(special.skills[0].id,100011);
special.skills[0].level=4;
special.skills.push({id:100031,level:5},{id:900011,level:1});
const cleaned=withOwnUnique(special,reference);
assert.deepEqual(cleaned.skills,[{id:100011,level:4}],'Keep own unique level; remove foreign native and own inherited duplicate');
const changedOutfit=withOwnUnique({...cleaned,cardId:100701,charaId:1007},reference);
assert.equal(changedOutfit.skills[0].id,100071,'Default to upgraded native unique for low-rarity outfits');
assert(skillSearch(reference,'tokai teio').every(s=>!nativeUnique(s.skill)&&!s.name.includes('(inherited)')));
for(const [key,value] of [['strategy',1],['distance',2],['surface',2],['phase','middle'],['effect','recovery'],['rarity','inherited']] as const){
  const filters={...emptySkillFilters(),[key]:[value]},found=skillSearch(reference,'',[],true,filters);
  assert(found.length,`${key} finds skills`);assert(found.every(s=>matchesSkillFilters(s.id,s.skill,filters)));
}
const conditionSkill={name:'Multi-branch',rarity:1,branches:[{condition:'phase>=1&phase<=2&running_style==3',rawDuration:1,durationUsage:1,effects:[]}]};
assert(matchesSkillFilters(123,conditionSkill,{...emptySkillFilters(),phase:['middle'],strategy:[3]}));
assert(!matchesSkillFilters(123,conditionSkill,{...emptySkillFilters(),phase:['opening']}));
const slots=[participant(cleaned,0),participant(cleaned,1),participant(cleaned,2)];
assert.deepEqual(swapPopularity(slots,0,3).map(p=>p.popularity),[3,2,1]);
assert.deepEqual(normalizePopularity([slots[2],slots[0]]).map(p=>p.popularity),[2,1]);
assert.deepEqual(engineTeams(slots),[0,1,2],'No team is a separate team per runner');
slots[0].team=2;slots[1].team=2;assert.deepEqual(engineTeams(slots),[2,2,0]);
assert.deepEqual(normalizeTeams(slots).map(p=>p.team),[0,0,null]);
const saves=[{id:'one',name:'Sprint'}, {id:'two',name:'Mile'}];
assert.equal(saveTarget(saves,' sprint ','new')?.id,'one');assert.equal(saveTarget(saves,'New','one'),undefined,'Renaming creates a new save');
assert(events.events.every(p=>p.courseId===null||!!reference.courses[p.courseId]));
assert.equal(events.events.filter(p=>p.kind==='loh').length,15);
assert.equal(events.events.filter(p=>p.kind==='cm').length,49);
assert.equal(events.events.filter(p=>p.courseId===null).length,2,'Retain both unavailable Del Mar events');
for(const kind of ['cm','loh']){
  const presets=events.events.filter(p=>p.kind===kind).sort((a,b)=>a.date.localeCompare(b.date));
  assert.deepEqual(presets.map(p=>p.number),presets.map((_,i)=>i+1));
  assert(presets.every(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date)));
}
assert(events.events.filter(p=>p.kind==='loh').every(p=>p.weather===null&&p.ground===null),'LoH weather and ground vary; daytime is not sunny weather');
const ownedSkill=skillSearch(reference,'tokai teio')[0];
const organized={umas:[{...blankUma(),id:'fast',name:'Sprint test',memo:'Try recovery',folderId:'cm',tags:['Sprint'],favorite:true,updatedAt:'2026-10-22',skills:[{id:ownedSkill.id,level:1}]},{...blankUma(),id:'old',name:'Old build',archived:true},{...blankUma(),id:'free',name:'Unfiled',folderId:'missing',updatedAt:'2026-10-21'}],folders:[{id:'cm',name:'CM',color:'#7cb9ed',icon:'race'}],setups:[],conditions:[],templates:[]};
const indexed=libraryIndex(organized,reference),filtered=(extra:Partial<ReturnType<typeof emptyFilter>>)=>filterLibrary(indexed,{...emptyFilter(),view:'all',...extra},organized.folders).map(r=>r.uma.id);
assert.deepEqual(filtered({}),['fast','free']);
assert.deepEqual(filtered({view:'archive'}),['old']);
assert.deepEqual(filtered({view:'favorites'}),['fast']);
assert.deepEqual(filtered({view:'folder:cm',tag:'SPRINT'}),['fast']);
assert.deepEqual(filtered({view:'unfiled'}),['free'],'Missing folder is safely treated as unfiled');
assert.deepEqual(filtered({query:ownedSkill.name}),['fast'],'Search includes equipped skill names');
assert.deepEqual(filtered({query:'sprnt tst'}),['fast'],'Fuzzy build search');
assert.deepEqual(filtered({query:'recovery'}),['fast'],'Search includes memos');
assert.equal(inLibraryView(organized.umas[1],'all',organized.folders),false);
assert.deepEqual(parseTags('Sprint, Ready, sprint, ,'),['sprint','Ready']);
const variant=duplicateUma(organized.umas[0]);variant.stats.speed=10;variant.skills=[];
assert.notEqual(variant.id,'fast');assert.equal(variant.variantOf,'fast');assert.equal(variant.favorite,false);
assert.equal(organized.umas[0].stats.speed,1200);assert.equal(organized.umas[0].skills.length,1);
assert.equal(variant.updatedAt,undefined);
assert.equal(exportUmas(organized,['fast']).folders.length,1);
assert.equal(exportUmas(organized,['free']).folders.length,0);
assert.equal(exportUmas(organized,['fast']).umas.length,1);
const build=blankUma(),setup=blankSetup();setup.courseId=10101;setup.participants=[participant(build,0),participant(build,1)];
assert.equal(setup.shuffleGates,true);assert.equal(setup.keepSeed,false);
assert.equal(setup.participants[0].randomizeMood,false);
setup.participants[0].uma.stats.speed=999;assert.equal(build.stats.speed,1200);assert.equal(setup.participants[1].uma.stats.speed,1200);
setup.participants[0].trainer='Sample trainer';
assert(!('mood' in build));assert(!('aptitudes' in build));assert(!('strategy' in build));
const race=initialRace(setup,{index:0,seed:321,moods:[1,5],gates:[2,1]},'job','test',reference);
assert.equal(race.runners[0].mood,1);assert.equal(race.runners[0].gate,2);assert.equal(race.sandbox?.seed,321);
const copied=fromRace(race,reference);assert.equal(copied.setup.seed,321);assert.equal(copied.setup.participants[0].uma.stats.speed,999);assert.equal(copied.setup.shuffleGates,false);
assert.equal(race.runners[0].trainer,'Sample trainer');assert.equal(copied.setup.participants[0].trainer,'Sample trainer','Trainer names survive race/setup round trips');
assert(skillSearch(reference,'tokai teio').some(s=>s.name.toLowerCase().includes('victory')),'Character search resolves explicit unique ownership');
assert(skillSearch(reference,'certn victry').some(s=>s.name.toLowerCase().includes('victory')),'Fuzzy skill spelling');
const future=Object.entries(reference.metadata.skills).find(([,s])=>s.dataRegion==='JP'&&!nativeUnique(s))!;
assert(future,'Fixture has JP fallback skills');
assert(!skillSearch(reference,future[0]).some(s=>s.id===Number(future[0])),'Global-only search must exclude unreleased fallback records');
assert(skillSearch(reference,future[0],[],true).some(s=>s.id===Number(future[0])),'Explicit opt-in includes unreleased skills');
assert(skillSearch(reference,future[0],[Number(future[0])],true).every(s=>s.id!==Number(future[0])),'Owned skills stay excluded when unreleased search is enabled');
const localizedFuture=Object.entries(reference.metadata.skills).find(([,s])=>s.dataRegion==='Global'&&s.unreleasedGlobal&&!nativeUnique(s))!;
assert(localizedFuture,'Localized but unreleased catalog records exist');
assert(!skillSearch(reference,localizedFuture[0]).some(s=>s.id===Number(localizedFuture[0])),'Having an English regional definition does not mean released');
assert(skillSearch(reference,localizedFuture[0],[],true).some(s=>s.id===Number(localizedFuture[0])));
const detail={skillRows:[{skillId:11,effectiveActive:false,activationStatus:'wit-failure-supported'},{skillId:22,effectiveActive:false,activationStatus:'conditions-unmet'},{skillId:33,effectiveActive:false,activationStatus:'unknown'}],skillActivations:[]};
const analysis={runners:{[race.runners[0].id]:detail},warnings:[],debuffs:[]} as unknown as RaceAnalysis;
const totals=skillTotals(race,reference,analysis,race.runners[0].id);
assert.deepEqual(totals.skills.map(s=>s.score),[null,0,null]);assert.equal(totals.score,0);
const r={id:'a',name:'A',place:1,time:70,hp:100,traffic:1,exhausted:false,fullSpurt:true,gain:8,gainTime:-.3,carryover:2,power:1,powerTime:-.05,effectiveness:.8,skills:[{id:11,activated:true,checks:1,passed:1,effectiveness:.8,gain:4,time:-.2,carryover:1,carryoverTime:-.05,cost:200}]};
const runs:RunSummary[]=[{index:0,seed:1,moods:[3],gates:[1],runners:[r]}, {index:1,seed:2,moods:[3],gates:[1],runners:[{...r,place:2,time:72,gain:0,effectiveness:null,skills:[{...r.skills[0],activated:false,passed:0,effectiveness:null,gain:0,time:0,carryover:0,carryoverTime:0}]}]}];
const result=aggregate(runs)[0];assert.equal(result.skills[0].effectiveness.mean,.8);assert.equal(result.skills[0].effectiveness.n,1);assert.equal(result.skills[0].gain.mean,2);assert.equal(result.skills[0].reliability,.5);assert.equal(result.skills[0].activation,.5);assert.equal(result.gain.mean,4);
assert.equal(result.skills[0].winRateWhenActivated,1);assert.equal(result.skills[0].activatedRaces,1);assert.equal(result.skills[0].winsWhenActivated,1);
assert.equal(activatedWinDelta(result.skills[0],result.win),.5,'Conditional WR is compared to overall runner WR, in percentage points');
const skillLow={...result.skills[0],id:1},skillHigh={...skillLow,id:2,gain:distribution([4]),carryover:distribution([1]),time:distribution([-1]),effectiveness:distribution([.9]),activation:.9,winRateWhenActivated:1,per100Sp:4};
skillLow.winRateWhenActivated=.5;
const unknownSkill={...skillLow,id:3,gain:distribution([]),carryover:distribution([]),time:distribution([]),effectiveness:distribution([]),winRateWhenActivated:null,per100Sp:null};
const sortEvidence=new Map([['skill:1',{delta:-.1}],['skill:2',{delta:.1}]]);
for(const column of skillColumns){
  for(const direction of ['asc','desc'] as const){
    const ordered=sortSkills([skillHigh,unknownSkill,skillLow],column.key,direction,result.win,id=>['','Alpha','Beta','Gamma'][id],sortEvidence as Parameters<typeof sortSkills>[5]);
    const known=ordered.filter(s=>s.id!==3);
    assert.deepEqual(known.map(s=>s.id),direction==='asc'?[1,2]:[2,1],`${column.key} sorts the displayed value ${direction}`);
    if(!['name','activation'].includes(column.key))assert.equal(ordered.at(-1)!.id,3,'Unavailable values remain last in both directions');
  }
}
assert.equal(activatedWinDelta(unknownSkill,result.win),null);
assert.equal(skillCheckChance(1000,3),.91);assert.equal(skillCheckChance(100,3),.2);
assert.equal(skillCheckChance(1600,3),1-90/1400,'Apply the over-1200 soft cap');
assert(skillCheckChance(1000,5)>skillCheckChance(1000,1),'Mood affects initial Wit reliability');
const conditioned=aggregate([...runs,{...runs[0],index:2,runners:[{...r,place:2}]},{...runs[1],index:3,runners:[{...runs[1].runners[0],place:1}]},{...runs[0],index:4,runners:[{...r,skills:[]}]}])[0].skills[0];
assert.equal(conditioned.winRateWhenActivated,.5,'Win rate counts races with activation, excluding nonactivations and missing samples');assert.equal(conditioned.activatedRaces,2);assert.equal(conditioned.winsWhenActivated,1);
assert.equal(aggregate([runs[1]])[0].skills[0].winRateWhenActivated,null,'Never activated has no conditional win rate, not zero');
const measuredRuns:RunSummary[]=[
  {...runs[0],runners:[{...r,metrics:{'Uphill gain · m':-2,'Downhill gain · m':0,'downhill-mode gain · m':4,'pace-down gain · m':-6,'Rushed · s':3,'rushed gain · m':1,'rushed-boost gain · m':1,'dueling gain · m':0}}]},
  {...runs[1],runners:[{...r,metrics:{'Uphill loss · m':4,'Rushed · s':0,'dueling gain · m':null}}]},
  {...runs[0],index:2,runners:[{...r,metrics:{'Uphill gain · m':-3,'Rushed · s':0}}]},
  {...runs[0],index:3,outcomeOnly:true,runners:[{...r,metrics:{}}]},
];
const raceMetrics=aggregate(measuredRuns)[0].metrics,metric=(key:string)=>raceMetrics.find(m=>m.key===key)!;
assert.equal(metric('Uphill loss · m').mean,-3);assert.equal(metric('pace-down loss · m').mean,-2);
assert.equal(metric('downhill-mode gain · m').mean,4/3);
assert(!raceMetrics.some(m=>['Uphill gain · m','Downhill gain · m','rushed-boost gain · m'].includes(m.key)),'Do not double count downhill or the rushed boost portion');
assert.equal(metric('Rushed · s').mean,1);assert.equal(metric('Rushed · s').whenActive.mean,3);
assert.equal(metric('rushed gain · m').mean,1/3);assert.equal(metric('rushed gain · m').occurred,1);
assert.equal(metric('dueling gain · m').occurred,2,'Zero and unavailable gains both retain occurrence evidence');
assert.equal(metric('dueling gain · m').occurrenceSamples,3,'Outcome-only runs cannot establish status absence');
assert.equal(metric('dueling gain · m').n,2,'Explicit null does not become a zero-valued estimate');
assert.equal(metricDisplay('Uphill loss · m').label,'Uphill loss');
assert.equal(metricDisplay('pace-down loss · m').label,'Pace down loss');
assert.equal(metricDisplay('speed-up gain · m').label,'Pacemaker speed up');
assert.equal(aggregate(runs)[0].top2,aggregate(runs)[0].placements.slice(0,2).reduce((s,p)=>s+p,0));
const pooled=lobbyMetrics([{...runs[0],runners:[{...r,metrics:{'Uphill loss · m':2,'rushed gain · m':4}},{...r,id:'b',metrics:{'Uphill loss · m':8}}]},{...runs[1],runners:[{...r,metrics:{'Uphill loss · m':4}},{...r,id:'b',metrics:{}}]}]);
assert.equal(pooled['Uphill loss · m'].mean,-14/3);assert.equal(pooled['Uphill loss · m'].median,-4);
assert.equal(pooled['rushed gain · m'].mean,4/3);assert.equal(pooled['rushed gain · m'].n,3,'Missing status in an analyzed run is zero; outcome-only summary is unknown');
assert.equal(metricDisplay('rushed gain · m').order,metricDisplay('Rushed · s').order+1,'Rushed gain stays beside its duration');
assert.equal(metricDisplay('spot-struggle gain · m').label,'Spot struggle gain','Spot struggle is distinct from final-straight dueling');
assert.equal(result.skills[0].carryover.mean,.5,'Carryover averages include zero on nonactivation');assert.equal(result.skills[0].carryoverTime.mean,-.025);assert(result.skills[0].carryoverPaired);
assert.equal(result.skills[0].gain.mean!-result.skills[0].carryover.mean!,1.5,'Carryover is a component of total distance, not an added gain');
const legacy=structuredClone(runs);for(const run of legacy)for(const runner of run.runners)for(const skill of runner.skills){delete skill.carryover;delete skill.carryoverTime;}
assert.equal(aggregate(legacy)[0].skills[0].carryover.mean,null,'Absent saved carryover must not become zero');assert.equal(aggregate(legacy)[0].skills[0].carryoverRecorded,false);
const sortRuns=structuredClone(runs);for(const run of sortRuns){const runner=run.runners[0],base=runner.skills[0];runner.skills.push({...base,id:22,gain:8},{...base,id:33,gain:null},{...base,id:44,gain:-1},{...base,id:55,gain:0});}
assert.deepEqual(aggregate(sortRuns)[0].skills.map(s=>s.id),[22,11,55,44,33],'Sort signed distance gain descending with unavailable values last');
const comparison=comparisons([...runs,...runs.map(run=>({...run,index:run.index+2,variantIndex:1,variantLabel:'Alternative',runners:run.runners.map(r=>({...r,time:r.time-.25}))}))],'a');
assert.equal(comparison[1].delta.n,2);assert.equal(comparison[1].delta.mean,-.25);
const paired=headToHead([
  {...runs[0],runners:[r,{...r,id:'b',name:'B',place:2}]},
  {...runs[1],runners:[{...r,place:2},{...r,id:'b',name:'B',place:1}]},
  {...runs[0],runners:[r,{...r,id:'b',name:'B',place:1}]},
  {...runs[0],runners:[{...r,id:'b',name:'B'}]},
],'a');
assert.equal(paired[0].n,3,'Exclude races without the selected runner');assert.equal(paired[0].rate,1/3);assert.equal(paired[0].ties,1,'Ties do not count as finishing ahead');
const runner=race.runners[0],empty=summarize({race:{...race,runners:[{...runner,finishOrder:1,finishTimeRaw:70}]},
  analysis:{runners:{[runner.id]:{summary:{hpFinish:100,hpZeroTime:null},skillRows:[],skillActivations:[],hillTotals:{uphill:{},downhill:{}},cornerPath:{},slowdown:{blocking:{},exhaustion:{}}}}},
  runners:{[runner.id]:{spurt:{},totals:{benefit:null,score:null},power:{status:'initialPowerAtOrBelowThreshold',releases:[]},modes:[]}}
} as unknown as PreparedRace,{index:0,seed:1,moods:[3],gates:[1]}).runners[0];
assert.equal(empty.gain,0,'No activations must contribute zero, not disappear from batch gain averages');assert.equal(empty.power,0,'An ineligible power release contributes zero to the per-race average');
assert.deepEqual(distribution([]),{n:0,mean:null,median:null,p10:null,p90:null,standardError:null});assert.equal(distribution([1,3]).median,2);
const source=structuredClone(setup);source.participants[0].id='a';source.participants[1].id='b';source.participants[0].uma.skills=[{id:11,level:1},{id:22,level:3}];
const skillRequest={participantId:'a',target:{kind:'skill',skillId:11} as const,count:10};
const without=impactSetup(source,skillRequest);
assert.deepEqual(without.variations!.builds[0].skills,[{id:22,level:3}]);assert.equal(source.participants[0].uma.skills.length,2);
assert.deepEqual(impactTarget(source.participants[0].uma,without.variations!.builds[0]),skillRequest.target);
const plus=impactSetup(source,{participantId:'a',target:{kind:'stat',stat:'speed',delta:20},count:10});
assert.deepEqual(impactTarget(source.participants[0].uma,plus.variations!.builds[0]),{kind:'stat',stat:'speed',delta:20});
const confounded=structuredClone(without.variations!.builds[0]);confounded.stats.speed!+=20;
assert.equal(impactTarget(source.participants[0].uma,confounded),null,'Do not attribute multiple changed inputs to one skill');
assert.throws(()=>impactSetup(source,{participantId:'a',target:{kind:'stat',stat:'speed',delta:2000},count:10}));
const pairedRuns:RunSummary[]=[
  {...runs[0],moods:[3,4],gates:[2,1],runners:[r]},
  {...runs[1],moods:[4,2],gates:[1,2],runners:[{...r,place:2}]},
  {...runs[0],index:10,variantIndex:1,moods:[3,4],gates:[2,1],runners:[{...r,place:2}]},
  {...runs[1],index:11,variantIndex:1,moods:[4,2],gates:[1,2],runners:[{...r,place:2}]},
  {...runs[0],index:12,variantIndex:1,moods:[5,5],gates:[2,1],runners:[r]},
];
const measured={id:'measure',createdAt:'2026-10-22',setup:without,runs:pairedRuns} as Job;
const impact=winImpacts([measured],'a').get('skill:11')!;
assert.equal(impact.n,2,'Only matching seed, moods and gates pair');assert.equal(impact.delta,.5,'Skill value is WITH minus WITHOUT');
assert.equal(impact.baseRate,.5);assert.equal(impact.changedRate,0);assert(impact.low<impact.delta&&impact.high>impact.delta);
const pending={...measured,id:'new-measure',createdAt:'2026-10-23',phase:'running' as const,runs:[]};
const latest=impactJobsByTarget([pending,measured],'a');
assert.equal(latest.get('skill:11')?.id,'new-measure','Show the newer unfinished attempt, not an older saved result');
assert.equal(winImpacts([...latest.values()],'a').size,0,'An empty attempt must not display previous wins as new progress');
assert.equal(impactJobsByTarget([measured],'b').size,0,'Measurements belong to their selected participant');
assert.equal(impactJobsByTarget([{...measured,setup:{...without,variations:{participantId:'a',builds:[confounded]}}}],'a').size,0,'Confounded builds have no skill-specific detail result');
const statImpact=winImpacts([{...measured,setup:plus}],'a').get('stat:speed:20')!;
assert.equal(statImpact.delta,-.5,'Stat change value is changed minus baseline');
const noFlip=winImpacts([{...measured,runs:[pairedRuns[0],{...pairedRuns[2],runners:[r]}]}],'a').get('skill:11')!;
assert(noFlip.low<0&&noFlip.high>0,'Identical observed wins must not imply a zero-width uncertainty interval');
const fresh=structuredClone(measured);fresh.id='fresh';fresh.createdAt='2026-10-24';for(const run of fresh.runs)run.seed+=1000;
assert.equal(winImpacts([measured,fresh],'a').get('skill:11')!.n,4,'Append distinct pairs across measurements');
const accumulated=winImpacts([measured,fresh],'a').get('skill:11')!;
assert(accumulated.high-accumulated.low<impact.high-impact.low,'More independent samples of the same proportions improve precision');
assert.equal(winImpacts([measured,{...measured,id:'repeat',createdAt:'2026-10-25'}],'a').get('skill:11')!.n,2,'Repeated jobs cannot inflate sample counts');
assert.equal(winImpacts([measured,pending],'a').get('skill:11')!.n,2,'Keep prior evidence visible while additional races are pending');
const mirrored=structuredClone(measured);mirrored.id='mirrored';for(const run of mirrored.runs)run.seed=-run.seed;
assert.equal(winImpacts([measured,mirrored],'a').get('skill:11')!.n,2,'Positive and negative RNG aliases are not independent samples');
const differentEngine={...fresh,engine:{version:'changed',profile:'v74',artifact_sha256:'new'}};
assert.equal(winImpacts([measured,differentEngine],'a').get('skill:11')!.n,2,'Never pool different engine versions');
assert.equal(winImpacts([measured,{...fresh,referenceKey:'changed'}],'a').get('skill:11')!.n,2,'Never pool different reference snapshots');
const otherField=structuredClone(fresh);otherField.setup.participants[1].uma.stats.power!+=1;
assert.equal(winImpacts([measured,otherField],'a').get('skill:11')!.n,2,'Even a changed opponent isolates the comparison');
const incomplete=structuredClone(fresh);incomplete.runs=incomplete.runs.filter(r=>!r.variantIndex);
assert.equal(winImpacts([measured,incomplete],'a').get('skill:11')!.n,2,'Unpaired baselines must not enter the comparison');
const curveSource=structuredClone(source);curveSource.participants[0].uma.stats.speed=1200;
assert.equal(STAT_STEP,50);
assert.deepEqual(statRange(1200),[-200,-150,-100,-50,50,100,150,200]);
assert.deepEqual(statRange(1950),[-200,-150,-100,-50,50],'Do not generate out-of-range stats');
assert.deepEqual(statRange(30),[50,100,150,200]);
assert.equal(nextStatOffset(-100,-1),-150);assert.equal(nextStatOffset(100,1),150);
assert.equal(nextStatOffset(-125,-1),-150);assert.equal(nextStatOffset(325,1),350,'Legacy 25-step endpoints extend onto the new grid');
assert.deepEqual(statRange(1200,-125,325),[-100,-50,50,100,150,200,250,300],'Retain legacy graph points without adding them to new range batches');
const sweep=impactSetup(curveSource,{participantId:'a',target:{kind:'stat-range',stat:'speed',deltas:statRange(1200)},count:100});
assert.deepEqual(sweep.variations!.builds.map(b=>b.stats.speed),[1000,1050,1100,1150,1250,1300,1350,1400]);
assert.equal(sweep.count*(sweep.variations!.builds.length+1),900,'Reuse one baseline per sample across the curve');
assert.equal(curveSource.participants[0].uma.stats.speed,1200,'Range exploration leaves the original build unchanged');
assert.throws(()=>impactSetup(curveSource,{participantId:'a',target:{kind:'stat-range',stat:'speed',deltas:[25,25]},count:5}));
assert.throws(()=>impactSetup(curveSource,{participantId:'a',target:{kind:'stat-range',stat:'speed',deltas:statRange(1200)},count:500}));
const extension=impactSetup(curveSource,{participantId:'a',target:{kind:'stat',stat:'speed',delta:125},count:10});
assert.equal(extension.variations!.builds[0].stats.speed,1325);
const curveJob={...measured,setup:impactSetup(source,{participantId:'a',target:{kind:'stat',stat:'speed',delta:25},count:10})};
assert.deepEqual(statCurve([curveJob],'a','speed').map(p=>[p.offset,p.n,p.delta]),[[25,2,-.5]]);
assert.equal(statCurve([curveJob],'a','power').length,0);
assert.equal(STAT_PAIRS,100);
assert.equal(impactSetup(curveSource,{participantId:'a',target:{kind:'stat-range',stat:'speed',deltas:statRange(1200)},count:STAT_PAIRS}).count,100);
const trendMeasurements=[-100,-75,-50,-25,25,50,75,100].map(offset=>({offset,delta:offset*.001+offset**2*.000005,n:100}));
const fitted=statTrend(trendMeasurements)!;
assert.equal(fitted.kind,'Quadratic');
for(const point of fitted.points)assert(Math.abs(point.delta-(point.offset*.001+point.offset**2*.000005))<1e-10,'Fit recovers a known quadratic without extrapolation');
assert.equal(fitted.points[0].offset,-100);assert.equal(fitted.points.at(-1)!.offset,100);
assert.equal(fitted.points.find(p=>p.offset===0)!.delta,0,'Unchanged build has exactly zero impact');
assert.equal(statTrend([{offset:25,delta:.1,n:100}]),null);
assert.equal(statTrend([{offset:-25,delta:-.1,n:100},{offset:25,delta:.1,n:100}])!.kind,'Linear');
const weighted=statTrend([{offset:-25,delta:-.1,n:1000},{offset:25,delta:0,n:1}])!;
assert(weighted.points.at(-1)!.delta>.099,'More pairs carry more weight');
assert.equal(statTrend([{offset:NaN,delta:.1,n:100},...trendMeasurements])!.points.length,81);
const expanded=[-250,...statRange(1200),250],nextBatch=statMeasurementBatch(expanded,trendMeasurements);
assert.equal(nextBatch.length,9);assert(nextBatch.includes(-150)&&nextBatch.includes(150),'Extended values without samples take priority');
assert.equal(impactSetup(curveSource,{participantId:'a',target:{kind:'stat-range',stat:'speed',deltas:nextBatch},count:STAT_PAIRS}).count,100,'Extended ranges retain 100 pairs per value within the batch limit');
const evidence=winImpacts([measured],'a').get('skill:11')!;
assert.equal(evidence.skill?.activation,1);assert.equal(evidence.skill?.carryover.mean,1);assert.equal(evidence.timeSaved.mean,0);
const splits=conditionSplits(pairedRuns.filter(r=>!r.variantIndex),source,'a','gates');
assert.deepEqual(splits.map(r=>[r.value,r.n,r.win]),[[1,1,0],[2,1,1]],'Use roster index, never gate or finish order, to resolve actual draws');
assert.deepEqual(conditionSplits(pairedRuns,source,'absent','moods'),[]);
console.log('Simulator setup, build isolation, unique search, and wit-aware aggregate checks passed.');

const originalProgress={...measured,runs:[pairedRuns[0],{...pairedRuns[0],index:100}],runCursor:2};
const nextProgress={...measured,runs:[{...pairedRuns[0],index:1},{...pairedRuns[0],index:101}],runsPartial:true,runCursor:4};
const merged=mergeJobProgress(originalProgress,nextProgress);
assert.deepEqual(merged.runs.map(r=>r.index),[0,1,100,101],'Interleaved low indices must not be dropped');
assert.equal(mergeJobProgress(merged,{...merged,runs:[],runsPartial:true}).runs,merged.runs,'Idle polls preserve run identity');
assert.deepEqual(mergeJobProgress(merged,nextProgress).runs,merged.runs,'Repeated deltas cannot duplicate samples');
assert.equal(mergeJobProgress(merged,{...nextProgress,runsPartial:false}).runs,nextProgress.runs,'Full snapshots replace old state');
const outcome={...r,hp:null,traffic:null,exhausted:null,fullSpurt:null,gain:null,carryover:null,skills:[]};
const sparse=aggregate([{...runs[0],outcomeOnly:true,runners:[outcome]}])[0];
assert.equal(sparse.exhaustion,null);assert.equal(sparse.fullSpurt,null);assert.equal(sparse.traffic.mean,null);
