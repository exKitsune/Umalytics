/** Whole-file import/reference/analysis processes; synthetic HP traces only. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile), root = resolve(import.meta.dirname, '..'), folder = resolve(process.argv[2]);
await mkdir(folder, { recursive: true }); const reference = join(folder, 'reference'); await mkdir(reference);
const metadata = JSON.parse(await readFile(join(root, 'public/data/metadata.json'), 'utf8'));
const definitions = [
  [820001, 27, 3500, 1, 1], [820002, 31, 2000, 1, 1], [820003, 9, 550, 1, 1],
  [820004, 21, 100000, 1, 1], [820005, 21, 100000, 1, 2], [820006, 21, -10000, 2, 1], [820007, 35, 1000, 1, 1],
];
for (const [id, type, rawValue, targetType, valueUsage] of definitions) metadata.skills[id] = { name: `Synthetic downhill context ${id}`, rarity: 1,
  activateLot: 0, branches: [{ branchIndex: 0, condition: 'always==1', rawDuration: 100000, durationUsage: 1,
    effects: [{ type, rawValue, targetType, valueUsage, levelUsage: 1, additionalActivateType: 0 }] }] };
metadata.skills[820008] = structuredClone(metadata.skills[820001]); metadata.skills[820008].branches[0].effects.push(...metadata.skills[820003].branches[0].effects);
const flat = { distance: 2000, raceTrackId: 10006, surface: 1, turn: 1, course: 1, laneMax: 10000, courseSetStatus: [], corners: [], straights: [{ start: 0, end: 2000 }], slopes: [] };
await writeFile(join(reference, 'metadata.json'), JSON.stringify(metadata));
await writeFile(join(reference, 'courses.json'), JSON.stringify({ 99994: { ...flat, slopes: [{ start: 900, length: 600, slope: -10000 }] }, 99993: flat }));
for (const name of ['reference-source.json', 'simulator-skill-ids.json']) await writeFile(join(reference, name), await readFile(join(root, 'public/data', name)));
const event = (id: number, duration = 10, source = 0, mask?: number) => ({ time: 50, type: 3, runnerId: `fixture-${source}`, skillId: id,
  params: [source, id, duration * 10000, 0, ...(mask === undefined ? [] : [mask])], label: 'Synthetic recorded skill' });
const base = (drain = 8) => ({ schemaVersion: 1, synthetic: true, title: 'Synthetic downhill inference workflow', distance: 2000, courseId: 99994, category: 'practice',
  conditions: { ground: '1', weather: '1', season: '4' },
  runners: [0, 1].map(i => ({ id: `fixture-${i}`, name: `Synthetic runner ${i + 1}`, gate: i + 1, cardId: 100101 + i * 100,
    strategyCode: 1, mood: 3, finishTimeRaw: 100, finishTime: 100, finishOrder: i + 1, lastSpurtDistance: -1, teamGroup: i + 1,
    stats: { speed: 1000, stamina: 1000, power: 1200, guts: 500, wisdom: 600 }, aptitudes: { front: 7, middle: 7, turf: 7 },
    skills: Object.keys(metadata.skills).filter(id => Number(id) >= 820001 && Number(id) <= 820008).map(id => ({ id: Number(id), level: 1 })) })),
  frames: Array.from({ length: 101 }, (_, time) => ({ time, runners: [0, 1].map(i => ({ runnerId: `fixture-${i}`, distance: time * 20 - i,
    speed: 20, hp: 2760 - drain * time, lane: .1 + i * .1, temptationMode: 0, blockFrontRunnerIndex: -1 })) })), events: [] as any[], warnings: [] });
let cases = 0;
async function analyze(name: string, race: any) {
  const input = join(folder, `${name}.json`), output = join(folder, `${name}-analysis.json`); await writeFile(input, JSON.stringify(race));
  await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/analyze-race.ts'), input, output, '--reference-dir', reference], { cwd: root, windowsHide: true, timeout: 30000 }); cases++;
  return JSON.parse(await readFile(output, 'utf8'))[0].analysis.runners['fixture-0'].intervals.filter((i: any) => i.kind === 'downhill-mode-model');
}
const overlaps = (values: any[], a: number, b: number) => values.some(i => i.start < b && i.end > a);
let race = base(), intervals = await analyze('bare-hp-evidence', race); assert.ok(overlaps(intervals, 51, 59)); assert.ok(intervals.every((i: any) => i.evidence === 'estimated'));
race = base(); race.events = [event(820001), event(820002)]; for (const frame of race.frames) if (frame.time >= 50 && frame.time < 60) frame.runners[0].speed = 20.35; intervals = await analyze('resolved-target-and-acceleration', race); assert.ok(overlaps(intervals, 51, 59));
race = base(); race.events = [event(820001, 0)]; for (const frame of race.frames) if (frame.time >= 50 && frame.time < 60) frame.runners[0].speed = 20.35; intervals = await analyze('target-reference-duration', race); assert.ok(overlaps(intervals, 51, 59));
for (const duration of [0, 10]) {
  race = base(); race.events = [event(820003, duration)]; for (const frame of race.frames) if (frame.time >= 50) frame.runners[0].hp += 100;
  intervals = await analyze(`instant-heal-${duration}`, race); assert.ok(overlaps(intervals, 45, 49)); assert.ok(overlaps(intervals, 52, 59)); assert.equal(overlaps(intervals, 49, 51), false);
}
for (const drain of [20, 8]) {
  race = base(drain); race.events = [event(820004)]; for (const frame of race.frames) {
    if (frame.time >= 50 && frame.time < 60) frame.runners[0].speed = 30;
    frame.runners[0].distance += Math.max(0, Math.min(10, frame.time - 50)) * 10;
  }
  intervals = await analyze(`direct-speed-drain-${drain}`, race);
  if (drain === 20) assert.equal(intervals.length, 0); else assert.ok(overlaps(intervals, 51, 59));
}
race = base(); race.events = [event(820005)]; intervals = await analyze('unknown-current-scaling', race); assert.equal(overlaps(intervals, 50, 60), false); assert.ok(overlaps(intervals, 61, 70));
race = base(); race.events = [event(820006, 10, 1)]; intervals = await analyze('unknown-foreign-mask', race); assert.equal(overlaps(intervals, 50, 60), false); assert.ok(overlaps(intervals, 61, 70));
race = base(); race.events = [event(820007)]; intervals = await analyze('unsupported-lane-cost', race); assert.equal(overlaps(intervals, 50, 60), false);
race = base(); race.courseId = 99993; intervals = await analyze('low-drain-without-downhill', race); assert.equal(intervals.length, 0);
race = base(); for (const frame of race.frames) delete (frame.runners[0] as any).temptationMode;
intervals = await analyze('unknown-rushed-flags', race); assert.equal(intervals.length, 0);
race = base(); race.events = [event(820008)]; for (const frame of race.frames) if (frame.time >= 50) { frame.runners[0].hp += 100; if (frame.time < 60) frame.runners[0].speed = 20.35; }
intervals = await analyze('combined-heal-target', race); assert.equal(overlaps(intervals, 49, 51), false); assert.ok(overlaps(intervals, 52, 59));
// The speed-only one-sample fallback needs the same effect/recipient evidence
// as the HP fit. An unknown skill must not become zero movement contribution.
const spike=base(20);spike.frames[51].runners[0].speed=20.08;spike.frames[52].runners[0].speed=19.6;
assert.ok(overlaps(await analyze('single-sample-downhill',spike),51,52));
const unknownOwn=structuredClone(spike);unknownOwn.events=[event(999999,10,0,1)];
assert.equal(overlaps(await analyze('single-sample-unknown-own',unknownOwn),51,52),false);
const unknownForeign=structuredClone(spike);unknownForeign.events=[event(999999,10,1,3)];
assert.equal(overlaps(await analyze('single-sample-unknown-recipient',unknownForeign),51,52),false);
unknownForeign.events[0].params[4]=2;
assert.ok(overlaps(await analyze('single-sample-excluded-recipient',unknownForeign),51,52));
const immune=structuredClone(spike);immune.runners[1].teamGroup=immune.runners[0].teamGroup;immune.events=[event(820006,10,1,3)];
assert.ok(overlaps(await analyze('single-sample-immune-foreign-speed',immune),51,52));
console.log(JSON.stringify({ cases, independentHpInference: 'passed', resolvedSkills: 'passed', currentSpeedRemoval: 'passed', instantBrackets: 'passed', unknownInputsWithheld: 'passed', modeEvidence: 'inferred-only' }));
