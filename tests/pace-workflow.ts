/** Synthetic whole-replay import/reference/analysis checks; no private captures. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile), root = resolve(import.meta.dirname, '..'), folder = resolve(process.argv[2]);
await mkdir(folder, { recursive: true }); const reference = join(folder, 'reference'); await mkdir(reference);
const metadata = JSON.parse(await readFile(join(root, 'public/data/metadata.json'), 'utf8'));
for (const [id, type, rawValue, valueUsage] of [[830001, 27, 5000, 1], [830002, 21, 5000, 1], [830003, 31, 2000, 1], [830004, 27, 5000, 2]]) metadata.skills[id] = {
  name: `Synthetic pace effect ${id}`, rarity: 1, activateLot: 0, branches: [{ branchIndex: 0, condition: 'always==1', rawDuration: 100000, durationUsage: 1,
    effects: [{ type, rawValue, valueUsage, levelUsage: 1, targetType: 1, additionalActivateType: 0 }] }] };
metadata.skills[830005]={name:'Synthetic unresolved speed passive',rarity:1,activateLot:0,branches:[{branchIndex:0,condition:'fixture_unknown==1',rawDuration:-1,durationUsage:1,
  effects:[{type:1,rawValue:400000,valueUsage:1,levelUsage:1,targetType:1,additionalActivateType:0}]}]};
await writeFile(join(reference, 'metadata.json'), JSON.stringify(metadata));
await writeFile(join(reference, 'courses.json'), JSON.stringify({ 99992: { distance: 2000, raceTrackId: 10006, surface: 1, turn: 1, course: 1,
  courseSetStatus: [], corners: [], straights: [{ start: 0, end: 2000 }], slopes: [] } }));
for (const name of ['reference-source.json', 'simulator-skill-ids.json']) await writeFile(join(reference, name), await readFile(join(root, 'public/data', name)));
const base = (style = 3, speed = 20.78): any => ({ schemaVersion: 1, synthetic: true, title: 'Synthetic pace-mode workflow', courseId: 99992,
  distance: 2000, category: 'practice', conditions: { ground: '1', weather: '1', season: '4' },
  runners: [0, 1, 2].map(i => ({ id: `fixture-${i}`, name: `Synthetic runner ${i + 1}`, gate: i + 1, strategyCode: i === 0 ? style : i === 1 ? 1 : style,
    cardId: 100101 + i * 100, mood: 3, finishTimeRaw: 100, finishTime: 100, finishOrder: i + 1, lastSpurtDistance: -1,
    stats: { speed: 1000, stamina: 1000, power: 1200, guts: 500, wisdom: 600 }, aptitudes: { turf: 7, middle: 7, front: 7, late: 7, pace: 7, end: 7 },
    skills: [830001, 830002, 830003, 830004].map(id => ({ id, level: 1 })) })),
  frames: [0, ...Array.from({ length: 35 }, (_, i) => i + 10), 100].map(time => ({ time, runners: [0, 1, 2].map(i => ({ runnerId: `fixture-${i}`,
    distance: time === 0 ? 0 : 20 * time + (i === 1 ? 20 : i === 2 ? -5 : 0), speed: time === 0 ? 3 : i === 0 ? speed : 20,
    hp: 2760 - 22 * time, lane: .1 + .1 * i, temptationMode: 0, blockFrontRunnerIndex: -1 })) })), events: [], warnings: [] });
const event = (id: number) => ({ time: 20, type: 3, runnerId: 'fixture-0', skillId: id, params: [0, id, 100000, 0, 1], label: 'Synthetic recorded effect' });
let cases = 0;
async function analyze(name: string, race: any, full=false) {
  const input = join(folder, `${name}.json`), output = join(folder, `${name}-analysis.json`); await writeFile(input, JSON.stringify(race));
  await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/analyze-race.ts'), input, output, '--reference-dir', reference], { cwd: root, windowsHide: true, timeout: 30000 }); cases++;
  const detail=JSON.parse(await readFile(output, 'utf8'))[0].analysis.runners['fixture-0'];
  return full?detail:detail.intervals.filter((i: any) => ['pace-up-model', 'pace-down-model', 'speed-up-model', 'overtake-model'].includes(i.kind));
}
const overlaps = (values: any[], start: number, end: number) => values.some(i => i.start < end && i.end > start);
let race = base(), values = await analyze('pace-up-reference', race); assert.ok(values.some((i: any) => i.kind === 'pace-up-model' && i.start <= 20 && i.end >= 30));
for (const id of [830001, 830002, 830003]) {
  race = base(); race.events = [event(id)];
  if (id !== 830003) for (const f of race.frames) if (f.time >= 20 && f.time < 30) f.runners[0].speed += .5;
  values = await analyze(`resolved-${id}`, race); assert.ok(overlaps(values, 22, 28));
}
for (const id of [830001, 830002]) {
  race = base(3, 19.99); race.events = [event(id)]; for (const f of race.frames) if (f.time >= 20 && f.time < 30) f.runners[0].speed += .5;
  values = await analyze(`skill-only-${id}`, race); assert.equal(overlaps(values, 22, 28), false);
}
race = base(); race.events = [event(830004)]; values = await analyze('unknown-scaling-gap', race); assert.equal(overlaps(values, 20, 30), false); assert.ok(overlaps(values, 10, 19)); assert.ok(overlaps(values, 32, 40));
race = base(2); for (const f of race.frames) if (f.time >= 10 && f.time <= 12) { f.runners[0].speed = 10 + (f.time - 10) * 2; f.runners[0].hp = 2760 - .1 * f.time; f.runners[1].distance = f.runners[0].distance + 1; }
values = await analyze('start-dash-excluded', race); assert.equal(overlaps(values, 10, 12), false);
race = base(1, 20.4); for (const f of race.frames) if (f.time) { f.runners[1].distance = f.runners[0].distance - 2; f.runners[2].distance = f.runners[0].distance - 5; }
values = await analyze('front-speed-up', race); assert.ok(values.some((i: any) => i.kind === 'speed-up-model')); assert.ok(values.every((i: any) => i.kind !== 'overtake-model'));
race.events = [{ time: 15, type: 4, runnerId: 'fixture-0', skillId: null, params: [0], label: 'Synthetic spot-struggle start' }];
values = await analyze('velocity-kept-during-spot-struggle', race); assert.ok(values.some((i: any) => i.kind === 'speed-up-model' && i.end > 17 && i.start < 22));
race = base(1, 19.6); for (const f of race.frames) if (f.time) { f.runners[1].distance = f.runners[0].distance - 2; f.runners[2].distance = f.runners[0].distance - 5; }
race.events = [{ time: 15, type: 4, runnerId: 'fixture-0', skillId: null, params: [0], label: 'Synthetic spot-struggle start' }];
values = await analyze('ordinary-speed-during-spot-struggle', race); assert.equal(overlaps(values, 15, 22), false);
race = base(1, 20.6); for (const f of race.frames) if (f.time) f.runners[1].distance = f.runners[0].distance + (f.time < 20 ? 2 : f.time < 25 ? -2 : -12);
values = await analyze('overtake-after-leading', race); assert.ok(values.some((i: any) => i.kind === 'overtake-model' && i.start <= 20 && i.end >= 24)); assert.ok(values.every((i: any) => i.kind !== 'speed-up-model'));
race = base(1, 20.6); race.runners[1].strategyCode = 2; values = await analyze('later-style-global-leader', race); assert.ok(values.every((i: any) => i.kind !== 'overtake-model'));
race = base(5, 20.22); race.runners[2].strategyCode = 1; values = await analyze('runaway-distinct-peers', race); assert.ok(values.every((i: any) => i.kind !== 'overtake-model' || i.start >= 16));
race = base(1, 20.97); race.runners[1].strategyCode = 5; values = await analyze('front-behind-runaway', race); assert.ok(values.some((i: any) => i.kind === 'overtake-model'));
race = base(5, 22.3); values = await analyze('runaway-behind-field', race); assert.ok(values.some((i: any) => i.kind === 'overtake-model' && i.model?.speedMultiplier === 1.05));
race = base(); for (const f of race.frames) if (f.time >= 20) f.runners[1].distance = f.runners[0].distance + (f.time < 30 ? 12 : 10);
values = await analyze('pace-up-continuation-band', race); assert.ok(values.some((i: any) => i.kind === 'pace-up-model' && i.start <= 20 && i.end === 30));
race = base(); race.frames.find((f: any) => f.time === 24).runners[0].speed = null;
values = await analyze('unknown-gap-unjoined', race); assert.ok(values.some((i: any) => i.end === 23)); assert.ok(values.some((i: any) => i.start === 25)); assert.ok(values.every((i: any) => !(i.start < 24 && i.end > 24)));
// A missing final-speed passive must not erase an early/middle BOOST bonus.
// This complete file crosses the phase boundary within the observed status.
race=base();race.runners[0].skills.push({id:830005,level:1});
for(const f of race.frames)if(f.time>=10&&f.time<20)f.runners[0].temptationMode=4;
let detail=await analyze('rushed-phase-specific-inputs',race,true),rushed=detail.statusImpacts.find((i:any)=>i.kind==='rushed');
assert.equal(detail.statBreakdown.stats.speed.final,null);
const phaseTime=2000/6/20,expected=.04*20*(.938*(phaseTime-10)+.998*(20-phaseTime));
assert.ok(Math.abs(rushed.modeledExtraDistance-expected)<1e-8);assert.ok(rushed.modeledExtraHp>0);
// Mode 3 is the same +4% ceiling. Credit follows recorded speed, not the mode number.
race=base();for(const f of race.frames)if(f.time>=10&&f.time<20)f.runners[0].temptationMode=3;
detail=await analyze('rushed-mode-three-realized',race,true);rushed=detail.statusImpacts.find((i:any)=>i.kind==='rushed');
assert.ok(Math.abs(rushed.modeledExtraDistance-expected)<1e-8);
// A front block runs none of the bonus, even when the free speed would have.
race=base();for(const f of race.frames)if(f.time>=10&&f.time<20){f.runners[0].temptationMode=4;f.runners[0].blockFrontRunnerIndex=1;}
detail=await analyze('rushed-blocked-zero',race,true);rushed=detail.statusImpacts.find((i:any)=>i.kind==='rushed');
assert.equal(rushed.modeledExtraDistance,0);
// Still below the ordinary target: the bonus has not been reached.
race=base(3,16);for(const f of race.frames)if(f.time>=10&&f.time<20)f.runners[0].temptationMode=3;
detail=await analyze('rushed-below-target-zero',race,true);rushed=detail.statusImpacts.find((i:any)=>i.kind==='rushed');
assert.equal(rushed.modeledExtraDistance,0);
// Halfway up to the 4% counts half, and only inside one phase.
const climb=20*.938*.02;race=base(3,20*.938+climb);for(const f of race.frames)if(f.time>=10&&f.time<14)f.runners[0].temptationMode=3;
detail=await analyze('rushed-partial-climb',race,true);rushed=detail.statusImpacts.find((i:any)=>i.kind==='rushed');
assert.ok(Math.abs(rushed.modeledExtraDistance-climb*4)<1e-6);
// The same unknown speed is required in late race, so it remains unresolved.
race=base();race.runners[0].skills.push({id:830005,level:1});
race.frames=[0,70,75,80,100].map(time=>({time,runners:race.runners.map((r:any,i:number)=>({runnerId:r.id,distance:20*time,speed:time?20:3,hp:2760-22*time,lane:.1+i*.1,temptationMode:time>=70&&time<80&&i===0?4:0,blockFrontRunnerIndex:-1}))}));
detail=await analyze('rushed-late-required-input',race,true);rushed=detail.statusImpacts.find((i:any)=>i.kind==='rushed');
assert.equal(rushed.modeledExtraDistance,null);assert.equal(rushed.modeledExtraHp,null);
race.runners[0].skills=race.runners[0].skills.filter((s:any)=>s.id!==830005);race.runners[0].lastSpurtDistance=1400;
detail=await analyze('rushed-unreported-spurt-target',race,true);rushed=detail.statusImpacts.find((i:any)=>i.kind==='rushed');
assert.notEqual(detail.statBreakdown.stats.speed.final,null);assert.equal(rushed.modeledExtraDistance,null);
console.log(JSON.stringify({ cases, rushedPhaseInputs:'passed', resolvedSkillNormalization: 'passed', noSkillOnlyMode: 'passed', startDashCompetitionExclusions: 'passed', frontStrategySemantics: 'passed', continuationExitBand: 'passed', unknownGapsPreserved: 'passed', evidence: 'inferred-only' }));
