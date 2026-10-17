/** Whole-file importer/helper child processes and real Python sanitizer. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { importRace } from '../src/data/import';
import { assembleReferenceData } from '../src/data/reference';
import { createLastSpurtCondition } from '../src/data/condition-spurt';

const root = resolve(import.meta.dirname, '..'), run = promisify(execFile);
if (process.argv[2] === '--child') {
  const request = JSON.parse(await readFile(process.argv[3], 'utf8'));
  const race = (await importRace(JSON.stringify(request.race), 'whole-file-spurt.json'))[0];
  const metadata = JSON.parse(await readFile(join(root, 'public/data/metadata.json'), 'utf8'));
  Object.assign(metadata.skills, request.definitions ?? {});
  const course = { distance: 2000, raceTrackId: 10006, surface: 1, turn: 1, course: 1, laneMax: 10000, courseSetStatus: [], corners: [], straights: [], slopes: [] };
  const reference = assembleReferenceData(metadata, { '96321': course }, { name: 'Synthetic public workflow', revision: '1', url: '' }, []);
  const evaluate = createLastSpurtCondition(race, race.runners[0], reference.courses['96321'], reference, request.staticValues);
  const results = request.times.map((time: number) => evaluate({ time, runners: race.frames.find(f => f.time === time)?.runners ?? [] }));
  await writeFile(process.argv[4], JSON.stringify({ results, runners: race.runners }));
} else {
  const folder = resolve(process.argv[2]); await mkdir(folder, { recursive: true }); let cases = 0;
  const runner = { id: 'runner-1', index: 0, gate: 1, name: 'Synthetic runner', charaId: 1001, cardId: 100101, trainer: null, strategy: 'Late Surger', strategyCode: 3,
    finishOrder: 1, finishTime: 70, lastSpurtDistance: 1400, mood: 3, stats: { speed: 1000, stamina: 1000, power: 1000, guts: 600, wisdom: 600 },
    aptitudes: { middle: 7, turf: 7, late: 7 }, skills: [] as { id: number; level: number }[] };
  const base = { schemaVersion: 1, title: 'Synthetic spurt decision workflow', synthetic: true, distance: 2000, courseId: 96321, category: 'practice',
    conditions: { ground: '1', weather: '1', season: '1' }, runners: [runner],
    frames: [[0, 0, 2800], [39.9, 1330, 5000], [40.1, 1336, 5000], [49, 1580, 100], [50, 1600, 100], [50.15, 1603, 5000], [60, 1800, 0], [70, 2000, 0]].map(([time, distance, hp]) => ({ time, runners: [{ runnerId: runner.id, distance, speed: 22, hp, lane: .1 }] })), events: [] as any[] };
  async function check(name: string, race: any = base, times = [39, 41, 60], definitions: any = {}, staticValues: any = {}) {
    const input = join(folder, `${name}.json`), output = join(folder, `${name}-result.json`);
    await writeFile(input, JSON.stringify({ race, times, definitions, staticValues }));
    await run(process.execPath, ['--import', 'tsx', import.meta.filename, '--child', input, output], { cwd: root, windowsHide: true, timeout: 20000 });
    cases++; return JSON.parse(await readFile(output, 'utf8'));
  }
  const full = await check('full'); assert.equal(full.results[0].value, null); assert.equal(full.results[1].value, 2); assert.equal(full.results[2].value, 2);
  assert.equal(full.results[1].confidence, 'proxy'); assert.ok(full.results[1].decisionTime < 40.1); assert.match(full.results[1].reason, /60 m/);
  const low = structuredClone(base); low.frames[1].runners[0].hp = low.frames[2].runners[0].hp = 100;
  assert.equal((await check('insufficient', low)).results[1].value, 0);
  const middle = structuredClone(base), hp = (full.results[1].baseHpNeeded + full.results[1].maxHpNeeded) / 2;
  middle.frames[1].runners[0].hp = middle.frames[2].runners[0].hp = hp;
  assert.equal((await check('intermediate', middle)).results[1].value, 1);
  const heal = { name: 'Synthetic recovery', activateLot: 0, branches: [{ condition: 'always==1', rawDuration: 0, durationUsage: 1, effects: [{ type: 9, rawValue: 550, valueUsage: 1, levelUsage: 1, targetType: 1 }] }] };
  const recovered = structuredClone(low); recovered.events = [{ time: 50.05, type: 3, runnerId: runner.id, skillId: 830001, params: [0, 830001, 0, 0] }];
  const recovery = (await check('recovery', recovered, [49, 50.06, 50.15, 60], { 830001: heal })).results;
  assert.deepEqual(recovery.map((v: any) => v.value), [0, null, 2, 2]); assert.equal(recovery[2].decisionTime, 50.05);
  const missingRecovery = structuredClone(recovered); missingRecovery.frames = missingRecovery.frames.filter(f => f.time !== 50.15);
  assert.equal((await check('missing-recovery-sample', missingRecovery, [60], { 830001: heal })).results[0].value, null);
  const debuffed = structuredClone(low); debuffed.events = [{ time: 50.05, type: 3, runnerId: runner.id, skillId: 830002, params: [0, 830002, 0, 0] }];
  const debuff = structuredClone(heal); debuff.branches[0].effects[0].rawValue = -550;
  assert.equal((await check('debuff-no-recalculation', debuffed, [60], { 830002: debuff })).results[0].value, 0);
  const passive = { name: 'Synthetic stat passive', activateLot: 0, branches: [{ condition: 'always==1', rawDuration: -1, durationUsage: 1, effects: [{ type: 1, rawValue: 600000, valueUsage: 1, levelUsage: 1, targetType: 1 }] }] };
  const green = structuredClone(base); green.runners[0].skills = [{ id: 830003, level: 1 }];
  const greenResult = (await check('guaranteed-green', green, [41], { 830003: passive })).results[0]; assert.equal(greenResult.value, 2); assert.ok(greenResult.maxHpNeeded > full.results[1].maxHpNeeded);
  const loneWolf = structuredClone(passive); loneWolf.branches[0].condition = 'same_skill_horse_count==1';
  assert.equal((await check('lone-wolf-full-inventory', green, [41], { 830003: loneWolf })).results[0].maxHpNeeded, greenResult.maxHpNeeded);
  const duplicate = structuredClone(green); duplicate.runners.push({ ...structuredClone(green.runners[0]), id: 'runner-2' });
  assert.equal((await check('lone-wolf-duplicate', duplicate, [41], { 830003: loneWolf })).results[0].maxHpNeeded, full.results[1].maxHpNeeded);
  const partialInventory = structuredClone(duplicate); (partialInventory.runners[1] as any).skills = undefined;
  assert.equal((await check('lone-wolf-unknown-inventory', partialInventory, [41], { 830003: loneWolf })).results[0].value, null);
  const boundedCount = structuredClone(loneWolf); boundedCount.branches[0].condition = 'same_skill_horse_count<=2';
  assert.equal((await check('bounded-count-always-met', partialInventory, [41], { 830003: boundedCount })).results[0].maxHpNeeded, greenResult.maxHpNeeded);
  boundedCount.branches[0].condition = 'same_skill_horse_count>=3';
  assert.equal((await check('bounded-count-excluded', partialInventory, [41], { 830003: boundedCount })).results[0].maxHpNeeded, full.results[1].maxHpNeeded);
  const character = structuredClone(passive); character.branches[0].condition = 'is_exist_chara_id==1001';
  const partialCharacter = structuredClone(duplicate); partialCharacter.runners[1].charaId = null as any;
  assert.equal((await check('character-present-partial-field', partialCharacter, [41], { 830003: character })).results[0].maxHpNeeded, greenResult.maxHpNeeded);
  character.branches[0].condition = 'is_exist_chara_id==1002';
  assert.equal((await check('character-absence-unresolved', partialCharacter, [41], { 830003: character })).results[0].value, null);
  assert.equal((await check('character-known-absent', green, [41], { 830003: character })).results[0].maxHpNeeded, full.results[1].maxHpNeeded);
  const unknown = structuredClone(passive); unknown.branches[0].condition = 'popularity<=3';
  assert.equal((await check('unresolved-green', green, [41], { 830003: unknown })).results[0].value, null);
  const excluded = (await check('excluded-green', green, [41], { 830003: unknown }, { popularity: { value: 9 } })).results[0]; assert.equal(excluded.maxHpNeeded, full.results[1].maxHpNeeded);
  const guts = structuredClone(unknown); guts.branches[0].effects[0].type = 4;
  assert.equal((await check('unresolved-guts', green, [41], { 830003: guts })).results[0].value, null);
  const movement = structuredClone(unknown); movement.branches[0].rawDuration = 30000; movement.branches[0].effects[0].type = 27;
  assert.equal((await check('unrelated-timed-skill', green, [41], { 830003: movement })).results[0].value, 2);
  const missing = structuredClone(base); (missing.runners[0] as any).skills = undefined;
  assert.equal((await check('missing-inventory', missing)).results[1].value, null);
  const long = structuredClone(base); long.frames[1].time = 30;
  assert.equal((await check('long-entry-gap', long)).results[1].value, null);
  const hpEvent = structuredClone(base); hpEvent.events = [{ time: 40, type: 3, runnerId: runner.id, skillId: 830001, params: [0, 830001, 0, 0] }];
  assert.equal((await check('entry-hp-event', hpEvent, [40.01], { 830001: heal })).results[0].value, null);
  const runaway = structuredClone(base); runaway.runners[0].strategyCode = 5;
  assert.ok((await check('runaway', runaway, [41])).results[0].maxHpNeeded < full.results[1].maxHpNeeded);
  const heavy = structuredClone(base); heavy.conditions.ground = '4';
  assert.ok((await check('ground-penalty', heavy, [41])).results[0].maxHpNeeded > full.results[1].maxHpNeeded);

  // Real bounded binary replay through sanitizer, raw/portable import and reimport.
  const chunks: Buffer[] = [], int = (n: number) => { const b = Buffer.alloc(4); b.writeInt32LE(n); chunks.push(b); }, float = (n: number) => { const b = Buffer.alloc(4); b.writeFloatLE(n); chunks.push(b); };
  int(8); int(100000002); int(0); float(2); int(6); int(12); int(31); int(0); int(2); int(76);
  for (let t = 0; t < 2; t++) { float(t); for (let i = 0; i < 6; i++) { const b = Buffer.alloc(12); b.writeFloatLE(t * 100, 0); b.writeUInt16LE(1000, 4); b.writeUInt16LE(2000, 6); b.writeUInt16LE(1000, 8); b.writeInt8(-1, 11); chunks.push(b); } }
  int(0); for (let i = 0; i < 6; i++) { const b = Buffer.alloc(31); b.writeInt32LE(i, 0); b.writeFloatLE(1, 4); b.writeFloatLE(.05, 12); b.writeFloatLE(-1, 18); b.writeUInt8(3, 22); b.writeFloatLE(1, 27); chunks.push(b); } int(0); int(0);
  const source = join(folder, 'raw-npc.json'), safePath = join(folder, 'safe-npc.json'), imported = join(folder, 'portable'), again = join(folder, 'again');
  await writeFile(source, JSON.stringify({ data: { race_scenario: gzipSync(Buffer.concat(chunks)).toString('base64'), auth: { token: 'PRIVATE_TOKEN' },
    race_horse_data_array: [0, 3, 11, 20, 21, 22].map((npc_type, i) => ({ frame_order: i + 1, npc_type, viewer_id: 'PRIVATE_VIEWER', owner_viewer_id: 'PRIVATE_OWNER' })) } }));
  await run('python', [join(root, 'scripts/proxy/extract-file.py'), source, safePath], { cwd: root, windowsHide: true, timeout: 15000 });
  const safe = await readFile(safePath, 'utf8'); assert.ok(!safe.includes('PRIVATE_TOKEN')); assert.ok(!safe.includes('"auth"'));
  assert.ok(safe.includes('PRIVATE_VIEWER')); assert.ok(safe.includes('viewer_id')); assert.ok(safe.includes('npc_type'));
  await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/import-race.ts'), safePath, imported], { cwd: root, windowsHide: true, timeout: 15000 });
  const portable = JSON.parse(await readFile(join(imported, (await readdir(imported))[0]), 'utf8'));
  assert.deepEqual(portable.runners.map((r: any) => r.isNpc), [true, true, false, false, null, null]);
  const rawRace = (await importRace(await readFile(source, 'utf8'), 'raw-npc.json'))[0]; assert.deepEqual(rawRace.runners.map(r => r.isNpc), portable.runners.map((r: any) => r.isNpc));
  const exportPath = join(folder, 'portable.json'); await writeFile(exportPath, JSON.stringify(portable));
  await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/import-race.ts'), exportPath, again], { cwd: root, windowsHide: true, timeout: 15000 });
  assert.deepEqual(JSON.parse(await readFile(join(again, (await readdir(again))[0]), 'utf8')).runners, portable.runners); cases++;
  console.log(JSON.stringify({ cases, spurtCategories: 'passed', decisionHistory: 'passed', recoveryRecalculation: 'passed', noFutureHp: 'passed', unresolvedGreens: 'passed', perSkillCounts: 'passed', boundedCounts: 'passed', characterPresence: 'passed', npcClass: 'passed', privacy: 'passed', portable: 'passed' }));
}
