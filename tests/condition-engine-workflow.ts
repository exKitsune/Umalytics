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
    race_horse_data_array: [{ frame_order: 1, card_id: 100101, popularity: 2, team_id: 917364928, viewer_id: 'PRIVATE_OWNER', trainer_name: 'PRIVATE_TRAINER' },
      { frame_order: 2, card_id: 100201, popularity: 99, team_id: 917364928, owner_viewer_id: 'PRIVATE_OWNER' }] } };
  await writeFile(source, JSON.stringify(raw));
  await run('python', [join(root, 'scripts/proxy/extract-file.py'), source, sanitized, '--endpoint', '/\x75mamusume/room_match/result'], { cwd: root, windowsHide: true, timeout: 15000 });
  const safe = await readFile(sanitized, 'utf8'); assert.ok(!safe.includes('PRIVATE_')); assert.ok(!safe.includes('917364928')); assert.ok(!safe.includes('team_id'));
  await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/import-race.ts'), sanitized, imported], { cwd: root, windowsHide: true, timeout: 15000 });
  const portable = JSON.parse(await readFile(join(imported, (await readdir(imported))[0]), 'utf8'));
  assert.equal(portable.runners[0].popularity, 2); assert.equal(portable.runners[1].popularity, null); assert.equal(portable.runners[0].teamGroup, 1); assert.equal(portable.runners[1].teamGroup, 1);
  assert.equal(portable.grade, 200); assert.equal(portable.conditions.timeOfDay, '4'); assert.equal(portable.conditionEvidence.grade, 'recorded'); assert.equal(portable.conditionEvidence.timeOfDay, 'recorded');
  const exportPath = join(folder, `portable-${name}.json`); await writeFile(exportPath, JSON.stringify(portable));
  await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/import-race.ts'), exportPath, again], { cwd: root, windowsHide: true, timeout: 15000 });
  const restored = JSON.parse(await readFile(join(again, (await readdir(again))[0]), 'utf8'));
  for (const field of ['grade', 'conditions', 'conditionEvidence', 'runners', 'events']) assert.deepEqual(restored[field], portable[field]);
  const { start_time_type: _time, race_grade: _grade, ...withoutContext } = raw.data;
  await writeFile(source, JSON.stringify({ data: withoutContext }));
  await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/import-race.ts'), source, join(folder, `joined-${name}`)], { cwd: root, windowsHide: true, timeout: 15000 });
  const joined = JSON.parse(await readFile(join(folder, `joined-${name}`, (await readdir(join(folder, `joined-${name}`)))[0]), 'utf8'));
  assert.equal(joined.grade, 100); assert.equal(joined.conditions.timeOfDay, '2'); assert.equal(joined.conditionEvidence.grade, 'race-instance');
}
console.log(JSON.stringify({ globalSkills: coverage.skills, globalBranches: coverage.branches, predicateKeys: coverage.predicateKeys, understoodKeys: coverage.understoodKeys, partialKeys: coverage.partialKeys,
  syntaxCoverage: 'complete', observedHistory: 'passed', randomWindowSeparation: 'passed', lotteryCauseSeparation: 'passed', spatialProxies: 'passed', rankContinuity: 'passed', eventOrder: 'passed', captureContext: 'passed', privacy: 'passed', portable: 'passed' }));
