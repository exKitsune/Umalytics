import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gzipSync, deflateSync } from 'node:zlib';
import { conditionCoverage } from '../src/data/skill-conditions';
import { startingBracket } from '../src/data/condition-observations';
const run = promisify(execFile), root = resolve(import.meta.dirname, '..'), folder = resolve(process.argv[2]);
await mkdir(folder, { recursive: true });
const metadata = JSON.parse(await readFile(join(root, 'public/data/metadata.json'), 'utf8'));
const coverage = conditionCoverage(metadata);
assert.equal(coverage.invalidExpressions, 0); assert.equal(coverage.unsupportedKeys, 0); assert.ok(coverage.predicateKeys >= 100);
const reference = join(folder, 'reference'); await mkdir(reference);
for (const name of ['courses.json', 'reference-source.json', 'simulator-skill-ids.json']) await writeFile(join(reference, name), await readFile(join(root, 'public/data', name)));
const rules = [
  'phase_random==1&order_rate<=50', 'activate_count_middle>=1', 'activate_count_heal>=1', 'is_activate_any_skill==1&phase==1',
  'phase>=1&order_rate_in50_continue==1', 'phase>=1&order_rate_out40_continue==1', 'bashin_diff_infront<=1&order==4', 'near_count>=2',
  'blocked_front_continuetime>=2', 'overtake_target_time>=1', 'popularity<=3&grade==100&time==4',
  'is_exist_chara_id==1002&running_style_count_same_rate>=40', 'same_skill_horse_count>=5', 'change_order_onetime<0', 'post_number<=2',
  'phase_random==1&popularity<=3', 'is_overtake==1&is_finalcorner==1', 'phase==2&activate_count_later_half>=1', 'last_straight_random==1',
  'random_lot==30&popularity<=3', 'hp_per<=50', 'is_temptation==1&temptation_count>=1', 'temptation_count==0&phase>=2',
];
for (let i = 0; i < rules.length; i++) metadata.skills[800001 + i] = { name: `Synthetic rule ${i + 1}`, rarity: 1, groupId: 80000 + i, activateLot: 1, iconId: 20011,
  branches: [{ condition: rules[i], precondition: '', branchIndex: 0, rawDuration: 30000, durationUsage: 1,
    effects: [{ type: 27, rawValue: 1500, valueUsage: 1, levelUsage: 1, targetType: 1 }] }] };
metadata.skills[800040] = { name: 'Synthetic side-block unique', rarity: 5, groupId: 80040, activateLot: 0, iconId: 20011,
  branches: [
    { branchIndex: 0, precondition: 'blocked_side_continuetime>=2', condition: 'accumulatetime>=5', rawDuration: 30000, durationUsage: 1,
      effects: [{ type: 27, rawValue: 5500, valueUsage: 1, levelUsage: 1, targetType: 1 }] },
    { branchIndex: 1, precondition: '', condition: 'accumulatetime>=5', rawDuration: 30000, durationUsage: 1,
      effects: [{ type: 27, rawValue: 2500, valueUsage: 1, levelUsage: 1, targetType: 1 }] },
  ] };
metadata.skills[800041] = { name: 'Synthetic midleg side-block', rarity: 5, groupId: 80041, activateLot: 0, iconId: 20011,
  branches: [{ branchIndex: 0, precondition: 'phase==1&blocked_side_continuetime>=2', condition: 'accumulatetime>=25', rawDuration: 30000, durationUsage: 1,
    effects: [{ type: 27, rawValue: 5500, valueUsage: 1, levelUsage: 1, targetType: 1 }] }] };
await writeFile(join(reference, 'metadata.json'), JSON.stringify(metadata));
const runnerIds = Array.from({ length: 9 }, (_, i) => `fixture-${i + 1}`);
const race = { schemaVersion: 1, title: 'Explicit synthetic condition workflow', synthetic: true, distance: 2400, courseId: 10606, category: 'practice',
  grade: 100, conditions: { ground: '2', weather: '1', season: '4', timeOfDay: '4' },
  runners: runnerIds.map((id, i) => ({ id, gate: i + 1, name: `Synthetic runner ${i + 1}`, charaId: 1001 + i, cardId: (1001 + i) * 100 + 1,
    popularity: i + 1, teamGroup: i < 3 ? 1 : i < 6 ? 2 : 3, strategyCode: i < 5 ? 3 : 2, mood: 3, finishOrder: i + 1, finishTimeRaw: 120, finishTime: 120,
    stats: { speed: 1000, stamina: 1000, power: 1000, guts: 600, wisdom: 600 }, aptitudes: { turf: 7, middle: 7, late: 7, pace: 7 },
    skills: (i === 0 ? rules.map((_, index) => 800001 + index) : i < 5 ? [800013] : []).map(id => ({ id, level: 1 })) })),
  frames: [0, 10, 20, 30, 50, 60, 70, 90, 100, 120].map(time => ({ time, runners: runnerIds.map((runnerId, i) => {
    const offsets = time < 30 ? [6, 0, 2, 4, 8, 10, 12, 14, 16] : [2, 0, 4, 6, 8, 10, 12, 14, 16];
    return { runnerId, distance: time === 0 ? 0 : 20 * time - offsets[i], speed: i === 0 ? 20 : 18, hp: 1000 - 7 * time,
      lane: .1, temptationMode: i === 0 && time >= 20 && time < 50 ? 1 : 0, blockFrontRunnerIndex: i === 0 && time >= 10 && time < 50 ? 1 : -1 };
  }) })),
  events: [40, 80].map(time => ({ time, type: 3, runnerId: runnerIds[0], skillId: 200351, label: 'Synthetic recorded recovery', params: [0, 200351, 20000, 0] })), warnings: ['Synthetic public workflow. No private game capture.'] };
const input = join(folder, 'conditions.json'), output = join(folder, 'analysis.json'); await writeFile(input, JSON.stringify(race));
await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/analyze-race.ts'), input, output, '--reference-dir', reference], { cwd: root, windowsHide: true, timeout: 30000 });
const analysis = JSON.parse(await readFile(output, 'utf8'))[0].analysis.runners[runnerIds[0]], row = (i: number) => analysis.skillRows.find((r: any) => r.skillId === 800000 + i), conditions = (i: number) => row(i).conditionEvaluation;
for (const i of [1, 16, 19, 20]) { assert.equal(conditions(i).mechanicsState, 'understood'); assert.equal(conditions(i).eligibilityState, 'eligible'); assert.equal(conditions(i).state, 'unknown'); assert.equal(conditions(i).randomTrigger, true); assert.equal(conditions(i).definitiveOpportunity, false); assert.notEqual(row(i).activationStatus, 'wit-failure-supported'); }
for (const i of [2, 3, 7, 11, 12, 13, 15, 18, 22]) { assert.equal(conditions(i).state, 'met', `observed predicate ${i}`); assert.equal(conditions(i).eligibilityState, 'eligible'); }
assert.equal(conditions(3).branches[0].firstOpportunity, 40); assert.equal(conditions(4).eligibilityState, 'eligible');
for (const i of [5, 8, 9, 14, 17, 21]) { assert.equal(conditions(i).mechanicsState, 'understood'); assert.equal(conditions(i).eligibilityState, 'eligible', `proxy opportunity ${i}`); assert.equal(conditions(i).definitiveOpportunity, false); assert.ok(conditions(i).branches[0].proxies.length); }
assert.equal(conditions(15).branches[0].staticOnly, true); assert.equal(startingBracket(9, 1), 1); assert.equal(startingBracket(9, 8), 8); assert.equal(startingBracket(9, 9), 8);
assert.equal(startingBracket(12, 4), 4); assert.equal(startingBracket(12, 7), 6); assert.equal(startingBracket(18, 13), 7); assert.equal(startingBracket(18, 16), 8); assert.equal(startingBracket(5, 4), 4); assert.equal(startingBracket(9, null), null);
// GameTora: overtake_target_time measures being chased. This fixture's
// subject is faster than every other runner, so only outgoing targets exist.
assert.equal(conditions(10).eligibilityState, 'unresolved');
assert.equal(conditions(6).eligibilityState, 'unresolved'); assert.equal(conditions(23).state, 'unknown');
assert.equal(analysis.skillActivations.length, 2); assert.ok(analysis.skillActivations.every((a: any) => a.skillId === 200351 && a.duration === 2));

// A supported failed wit roll does not identify the reason for a missing proc
// when the randomly selected activation window is absent from the replay.
const randomWit = structuredClone(race) as any; randomWit.randomSeed = 42; randomWit.events = [];
randomWit.runners = randomWit.runners.slice(0, 2);
randomWit.runners[0].skills = [800001, 200431].map(id => ({ id, level: 1 }));
randomWit.runners[1].skills = [202051, 200431].map(id => ({ id, level: 1 })); randomWit.runners[1].strategyCode = 1;
randomWit.runners[0].stats.wisdom = 100; randomWit.runners[1].stats.wisdom = 100;
randomWit.runners[0].startDelay = .02091057039797306; randomWit.runners[1].startDelay = .006737368181347847;
randomWit.frames = randomWit.frames.map((f: any) => ({ ...f, runners: f.runners.slice(0, 2).map((s: any, i: number) => ({ ...s, distance: f.time === 0 ? 0 : 20 * f.time - i })) }));
const randomInput = join(folder, 'random-wit.json'), randomOutput = join(folder, 'random-wit-analysis.json'); await writeFile(randomInput, JSON.stringify(randomWit));
await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/analyze-race.ts'), randomInput, randomOutput, '--reference-dir', reference], { cwd: root, windowsHide: true, timeout: 30000 });
const randomRow = JSON.parse(await readFile(randomOutput, 'utf8'))[0].analysis.runners[runnerIds[0]].skillRows.find((r: any) => r.skillId === 800001);
assert.equal(randomRow.lottery.won, false); assert.equal(randomRow.lottery.method, 'aligned-rng');
assert.equal(randomRow.conditionEvaluation.eligibilityState, 'eligible'); assert.equal(randomRow.conditionEvaluation.state, 'unknown');
assert.equal(randomRow.conditionEvaluation.definitiveOpportunity, false); assert.notEqual(randomRow.activationStatus, 'wit-failure-supported');

// Actual bounded binary header (with extended header bytes), sanitization,
// offline import and portable reimport: public ranks/context survive, raw team
// IDs and all owner/trainer sentinels do not. Exercise both gzip and zlib.
function scenario(compress: (bytes: Buffer) => Buffer) {
  const chunks: Buffer[] = [], int = (n: number) => { const b = Buffer.alloc(4); b.writeInt32LE(n); chunks.push(b); }, float = (n: number) => { const b = Buffer.alloc(4); b.writeFloatLE(n); chunks.push(b); };
  int(8); int(100000002); int(0); float(20); int(2); int(12); int(31); int(0); int(3); int(28);
  for (let t = 0; t <= 2; t++) { float(t); for (let i = 0; i < 2; i++) { const b = Buffer.alloc(12); b.writeFloatLE(t * 800, 0); b.writeUInt16LE(1000, 4); b.writeUInt16LE(2000, 6); b.writeUInt16LE(1000 - 100 * t, 8); b.writeInt8(0, 10); b.writeInt8(-1, 11); chunks.push(b); } }
  int(0); for (let i = 0; i < 2; i++) { const b = Buffer.alloc(31); b.writeInt32LE(i, 0); b.writeFloatLE(2, 4); b.writeFloatLE(.05, 12); b.writeFloatLE(-1, 18); b.writeUInt8(3, 22); b.writeFloatLE(2, 27); chunks.push(b); }
  int(0); int(0); return compress(Buffer.concat(chunks)).toString('base64');
}
for (const [name, compress] of [['gzip', gzipSync], ['zlib', deflateSync]] as const) {
  const source = join(folder, `raw-${name}.json`), sanitized = join(folder, `sanitized-${name}.json`), imported = join(folder, `imported-${name}`), again = join(folder, `again-${name}`);
  const raw = { data: { race_scenario: scenario(compress), race_instance_id: 101801, start_time_type: 4, race_grade: 200,
    auth: { token: 'PRIVATE_TOKEN' }, trainer_info: { id: 'PRIVATE_TRAINER_INFO' },
    race_horse_data_array: [{ frame_order: 1, card_id: 100101, popularity: 2, team_id: 917364928, trained_chara_id: 55, viewer_id: 'PRIVATE_OWNER', trainer_name: 'PRIVATE_TRAINER' },
      { frame_order: 2, card_id: 100201, popularity: 99, team_id: 917364928, owner_viewer_id: 'PRIVATE_OWNER' }],
    trained_chara_array: [{ trained_chara_id: 55, viewer_id: 'PRIVATE_OWNER', single_mode_win_count: 20, acquired_skill_array: [{ id: 210061, level: 1 }], succession_history_array: [{ viewer_id: 'PRIVATE_OWNER' }] }] } };
  await writeFile(source, JSON.stringify(raw));
  await run('python', [join(root, 'scripts/proxy/extract-file.py'), source, sanitized, '--endpoint', '/\x75mamusume/room_match/result'], { cwd: root, windowsHide: true, timeout: 15000 });
  const safe = await readFile(sanitized, 'utf8'); assert.ok(!safe.includes('PRIVATE_TOKEN')); assert.ok(!safe.includes('PRIVATE_TRAINER_INFO')); assert.ok(!safe.includes('"auth"'));
  assert.ok(safe.includes('PRIVATE_OWNER')); assert.ok(safe.includes('917364928')); assert.ok(safe.includes('team_id')); assert.ok(safe.includes('trained_chara_data'));
  await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/import-race.ts'), sanitized, imported], { cwd: root, windowsHide: true, timeout: 15000 });
  const portable = JSON.parse(await readFile(join(imported, (await readdir(imported))[0]), 'utf8'));
  assert.equal(portable.runners[0].popularity, 2); assert.equal(portable.runners[1].popularity, null); assert.equal(portable.runners[0].teamGroup, 1); assert.equal(portable.runners[1].teamGroup, 1);
  assert.equal(portable.grade, 200); assert.equal(portable.conditions.timeOfDay, '4'); assert.equal(portable.conditionEvidence.grade, 'recorded'); assert.equal(portable.conditionEvidence.timeOfDay, 'recorded');
  assert.equal(typeof portable.simDataBase64, 'string'); assert.ok(portable.simDataBase64.length > 20);
  assert.ok(Array.isArray(portable.raceHorse) && portable.raceHorse.length === 2);
  assert.equal(portable.raceHorse[0].finishOrder, 0); assert.equal(portable.raceType, 'RoomMatch');
  assert.equal(portable.raceHorse[0].responseHorseData.viewer_id, 'PRIVATE_OWNER');
  assert.equal(portable.raceHorse[0].responseHorseData.trainer_name, 'PRIVATE_TRAINER');
  assert.equal(portable.raceHorse[0].trained_chara_data.trained_chara_id, 55);
  assert.equal(portable.raceHorse[0].trained_chara_data.succession_history_array[0].viewer_id, 'PRIVATE_OWNER');
  assert.equal(portable.trainedCharaArray[0].trained_chara_id, 55);
  assert.equal(JSON.stringify(portable).includes('PRIVATE_TOKEN'), false);
  const exportPath = join(folder, `portable-${name}.json`); await writeFile(exportPath, JSON.stringify(portable));
  await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/import-race.ts'), exportPath, again], { cwd: root, windowsHide: true, timeout: 15000 });
  const restored = JSON.parse(await readFile(join(again, (await readdir(again))[0]), 'utf8'));
  for (const field of ['grade', 'conditions', 'conditionEvidence', 'runners', 'events', 'simDataBase64', 'raceType']) assert.deepEqual(restored[field], portable[field]);
  assert.equal(restored.raceHorse[0].finishOrder, 0);
  const { start_time_type: _time, race_grade: _grade, ...withoutContext } = raw.data;
  await writeFile(source, JSON.stringify({ data: withoutContext }));
  await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/import-race.ts'), source, join(folder, `joined-${name}`)], { cwd: root, windowsHide: true, timeout: 15000 });
  const joined = JSON.parse(await readFile(join(folder, `joined-${name}`, (await readdir(join(folder, `joined-${name}`)))[0]), 'utf8'));
  assert.equal(joined.grade, 100); assert.equal(joined.conditions.timeOfDay, '2'); assert.equal(joined.conditionEvidence.grade, 'race-instance');
}
const actSource = join(folder, 'horseact.json'), actImported = join(folder, 'horseact-imported');
await writeFile(actSource, JSON.stringify({
  simDataBase64: scenario(gzipSync), horseACT_version: '9.9.9', weather: 'Sunny', randomSeed: 42,
  raceCourseSet: { id: 10606, distance: 2400 },
  raceHorse: [
    { charaName: 'Synthetic one', finishOrder: 0, responseHorseData: { frame_order: 1, chara_id: 1001, viewer_id: 'PRIVATE_OWNER', trainer_name: 'PRIVATE_TRAINER', skill_array: [{ id: 210061, level: 1 }], single_mode_win_count: 20 },
      trained_chara_data: { trained_chara_id: 998877, viewer_id: 'PRIVATE_OWNER', acquiredSkillArray: [{ id: 210061, level: 1 }] } },
    { charaName: 'Synthetic two', finishOrder: 1, responseHorseData: { frame_order: 2, chara_id: 1002, owner_viewer_id: 'PRIVATE_OWNER' } },
  ],
}));
await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/import-race.ts'), actSource, actImported], { cwd: root, windowsHide: true, timeout: 15000 });
const act = JSON.parse(await readFile(join(actImported, (await readdir(actImported))[0]), 'utf8'));
assert.equal(act.schemaVersion, 1); assert.ok(Array.isArray(act.runners) && Array.isArray(act.frames));
assert.equal(act.simDataBase64, scenario(gzipSync)); assert.equal(act.horseACT_version, '9.9.9'); assert.equal(act.weather, 'Sunny');
assert.equal(act.raceHorse[0].trained_chara_data.trained_chara_id, 998877); assert.equal(act.runners[0].raceWinCount, 20);
assert.equal(act.raceHorse[0].responseHorseData.viewer_id, 'PRIVATE_OWNER');
assert.equal(act.raceHorse[0].trained_chara_data.viewer_id, 'PRIVATE_OWNER');
assert.ok(JSON.stringify(act).includes('998877'));
const sideIds = ['side-1', 'side-2'];
const sideRace = { schemaVersion: 1, title: 'Synthetic side-block timer', synthetic: true, distance: 2400, courseId: 10606, category: 'practice',
  grade: 100, conditions: { ground: '2', weather: '1', season: '4', timeOfDay: '4' },
  runners: sideIds.map((id, i) => ({ id, gate: i + 1, name: `Side ${i + 1}`, charaId: 1001 + i, cardId: (1001 + i) * 100 + 1,
    popularity: i + 1, teamGroup: 1, strategyCode: 3, mood: 3, finishOrder: i + 1, finishTimeRaw: 120, finishTime: 120,
    stats: { speed: 1000, stamina: 1000, power: 1000, guts: 600, wisdom: 600 }, aptitudes: { turf: 7, middle: 7, late: 7 },
    skills: i === 0 ? [{ id: 800040, level: 1 }] : [] })),
  frames: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 10].map(time => ({ time, runners: sideIds.map((runnerId, i) => ({
    runnerId, distance: 20 * time + i * 0.3, speed: 20, hp: 1000, lane: 0.2 + i * 0.02, temptationMode: 0, blockFrontRunnerIndex: -1 })) })),
  events: [{ time: 6, type: 3, runnerId: sideIds[0], skillId: 800040, label: 'Synthetic side-block unique', params: [0, 800040, 30000, 0] }],
  warnings: ['Synthetic public workflow. No private game capture.'] };
const sideInput = join(folder, 'side-block.json'), sideOutput = join(folder, 'side-block-analysis.json');
await writeFile(sideInput, JSON.stringify(sideRace));
await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/analyze-race.ts'), sideInput, sideOutput, '--reference-dir', reference], { cwd: root, windowsHide: true, timeout: 30000 });
const sideBranch = JSON.parse(await readFile(sideOutput, 'utf8'))[0].analysis.runners[sideIds[0]].skillRows.find((r: any) => r.skillId === 800040).conditionEvaluation.branches[0];
const sideTimer = sideBranch.predicates.find((p: any) => p.expression === 'blocked_side_continuetime>=2');
assert.equal(sideBranch.state, 'met');
assert.equal(sideTimer.state, 'met');
assert.equal(sideTimer.time, 2);
assert.match(sideTimer.observed, /Reconstructed timer 2\.00 s/);
const missRace = structuredClone(sideRace);
for (const frame of missRace.frames) frame.runners[1].distance += 20;
const missInput = join(folder, 'side-block-miss.json'), missOutput = join(folder, 'side-block-miss-analysis.json');
await writeFile(missInput, JSON.stringify(missRace));
await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/analyze-race.ts'), missInput, missOutput, '--reference-dir', reference], { cwd: root, windowsHide: true, timeout: 30000 });
const missBranch = JSON.parse(await readFile(missOutput, 'utf8'))[0].analysis.runners[sideIds[0]].skillRows.find((r: any) => r.skillId === 800040).conditionEvaluation.branches[0];
const missTimer = missBranch.predicates.find((p: any) => p.expression === 'blocked_side_continuetime>=2');
assert.equal(missBranch.state, 'met');
assert.equal(missTimer.state, 'unmet');
assert.match(missTimer.observed, /Reconstructed timer 0\.00 s/);
assert.doesNotMatch(missTimer.observed, /Recorded activation/);
const midRace = { schemaVersion: 1, title: 'Synthetic midleg side-block conjunction', synthetic: true, distance: 2400, courseId: 10606, category: 'practice',
  grade: 100, conditions: { ground: '2', weather: '1', season: '4', timeOfDay: '4' },
  runners: sideIds.map((id, i) => ({ id, gate: i + 1, name: `Side ${i + 1}`, charaId: 1001 + i, cardId: (1001 + i) * 100 + 1,
    popularity: i + 1, teamGroup: 1, strategyCode: 3, mood: 3, finishOrder: i + 1, finishTimeRaw: 30, finishTime: 30,
    stats: { speed: 1000, stamina: 1000, power: 1000, guts: 600, wisdom: 600 }, aptitudes: { turf: 7, middle: 7, late: 7 },
    skills: i === 0 ? [{ id: 800041, level: 1 }] : [] })),
  frames: [0, 5, 10, 15, 21, 26, 30].map(time => ({ time, runners: sideIds.map((runnerId, i) => ({
    runnerId, distance: 20 * time + i * 0.3, speed: 20, hp: 1000, lane: 0.2 + i * 0.02, temptationMode: 0, blockFrontRunnerIndex: -1 })) })),
  events: [{ time: 26, type: 3, runnerId: sideIds[0], skillId: 800041, label: 'Synthetic midleg side-block', params: [0, 800041, 30000, 0] }],
  warnings: ['Synthetic public workflow. No private game capture.'] };
const midInput = join(folder, 'midleg-side-block.json'), midOutput = join(folder, 'midleg-side-block-analysis.json');
await writeFile(midInput, JSON.stringify(midRace));
await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/analyze-race.ts'), midInput, midOutput, '--reference-dir', reference], { cwd: root, windowsHide: true, timeout: 30000 });
const midBranch = JSON.parse(await readFile(midOutput, 'utf8'))[0].analysis.runners[sideIds[0]].skillRows.find((r: any) => r.skillId === 800041).conditionEvaluation.branches[0];
const midTimer = midBranch.predicates.find((p: any) => p.expression === 'blocked_side_continuetime>=2');
const midPhase = midBranch.predicates.find((p: any) => p.expression === 'phase==1');
assert.equal(midBranch.state, 'met');
assert.equal(midTimer.state, 'met');
assert.equal(midPhase.state, 'met');
assert.equal(midTimer.time, midPhase.time);
assert.equal(midTimer.time, 21, 'AND with phase==1 uses the first midleg sample, not the opening-leg timer crossing');
assert.match(midTimer.observed, /Reconstructed timer 2[0-9]/);
const styleRace = { schemaVersion: 1, title: 'Synthetic pace-or-late overtake', synthetic: true, distance: 2400, courseId: 10606, category: 'practice',
  grade: 100, conditions: { ground: '2', weather: '1', season: '4', timeOfDay: '4' },
  runners: sideIds.map((id, i) => ({ id, gate: i + 1, name: `Style ${i + 1}`, charaId: 1001 + i, cardId: (1001 + i) * 100 + 1,
    popularity: i + 1, teamGroup: 1, strategyCode: i === 0 ? 2 : 4, mood: 3, finishOrder: i + 1, finishTimeRaw: 80, finishTime: 80,
    stats: { speed: 1000, stamina: 1000, power: 1000, guts: 600, wisdom: 600 }, aptitudes: { turf: 7, middle: 7, pace: 7 },
    skills: i === 0 ? [{ id: 800042, level: 1 }] : [] })),
  frames: [0, 40, 70, 80].map(time => ({ time, runners: sideIds.map((runnerId, i) => ({
    runnerId, distance: (time === 0 ? 0 : 20 * time) + (i === 0 ? 0 : 8), speed: i === 0 ? 21 : 19, hp: 1000, lane: 0.3, temptationMode: 0, blockFrontRunnerIndex: -1 })) })),
  events: [{ time: 72, type: 3, runnerId: sideIds[0], skillId: 800042, label: 'Synthetic hot pursuit', params: [0, 800042, 24000, 0] }],
  warnings: ['Synthetic public workflow. No private game capture.'] };
metadata.skills[800042] = { name: 'Synthetic pace or late', rarity: 2, groupId: 80042, activateLot: 1, iconId: 20012,
  branches: [{ branchIndex: 0, precondition: '', condition: 'running_style==2&distance_rate>=50&is_overtake==1@running_style==3&distance_rate>=50&is_overtake==1', rawDuration: 24000, durationUsage: 1,
    effects: [{ type: 27, rawValue: 3500, valueUsage: 1, levelUsage: 1, targetType: 1 }] }] };
await writeFile(join(reference, 'metadata.json'), JSON.stringify(metadata));
const styleInput = join(folder, 'style-or.json'), styleOutput = join(folder, 'style-or-analysis.json');
await writeFile(styleInput, JSON.stringify(styleRace));
await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/analyze-race.ts'), styleInput, styleOutput, '--reference-dir', reference], { cwd: root, windowsHide: true, timeout: 30000 });
const styleBranch = JSON.parse(await readFile(styleOutput, 'utf8'))[0].analysis.runners[sideIds[0]].skillRows.find((r: any) => r.skillId === 800042).conditionEvaluation.branches[0];
const styleOf = (expression: string) => styleBranch.predicates.find((p: any) => p.expression === expression);
assert.equal(styleOf('running_style==2').state, 'met');
assert.equal(styleOf('running_style==3').state, 'unmet');
assert.equal(styleOf('is_overtake==1').state, 'met');
assert.doesNotMatch(styleOf('running_style==3').observed ?? '', /Recorded activation/);
assert.doesNotMatch(styleOf('is_overtake==1').observed ?? '', /Recorded activation/);
console.log(JSON.stringify({ globalSkills: coverage.skills, globalBranches: coverage.branches, predicateKeys: coverage.predicateKeys, understoodKeys: coverage.understoodKeys, partialKeys: coverage.partialKeys,
  syntaxCoverage: 'complete', observedHistory: 'passed', randomWindowSeparation: 'passed', lotteryCauseSeparation: 'passed', spatialProxies: 'passed', rankContinuity: 'passed', eventOrder: 'passed', captureContext: 'passed', privacy: 'passed', portable: 'passed', rawExport: 'passed' }));
