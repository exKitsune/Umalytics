/** Whole-file CLI import/reference/analysis/portable checks; synthetic only. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile), root = resolve(import.meta.dirname, '..'), folder = resolve(process.argv[2]);
await mkdir(folder, { recursive: true }); const reference = join(folder, 'reference'); await mkdir(reference);
for (const name of ['metadata.json', 'reference-source.json', 'simulator-skill-ids.json']) await writeFile(join(reference, name), await readFile(join(root, 'public/data', name)));
const radius = 200 / (Math.PI / 2), points = Array.from({ length: 1001 }, (_, d): [number, number, number] => d < 100 ? [d, 0, 0]
  : d <= 300 ? [100 + radius * Math.sin((d - 100) / radius), 0, radius * (Math.cos((d - 100) / radius) - 1)]
    : [100 + radius, 0, -radius - (d - 300)]);
let courses: any, geometry: any;
const setup = async (left = false, straight = false) => {
  courses = { 99993: { distance: 1000, raceTrackId: 10006, surface: 1, turn: left ? 2 : 1, course: 1, laneMax: 15000,
    courseSetStatus: [], corners: straight ? [] : [{ start: 100, length: 200 }], straights: [], slopes: [] } };
  geometry = { schemaVersion: 1, courses: { 99993: { path: 'synthetic-quarter' } }, paths: { 'synthetic-quarter': { distance: 1000,
    points: points.map(([x,y,z]) => [x,y,left ? -z : z]), assetHash: 'synthetic', sha256: 'synthetic' } } };
  await writeFile(join(reference, 'courses.json'), JSON.stringify(courses)); await writeFile(join(reference, 'course-geometry.json'), JSON.stringify(geometry));
};
const base = (): any => ({ schemaVersion: 1, synthetic: true, title: 'Synthetic corner path', courseId: 99993, distance: 1000, category: 'practice',
  runners: [{ id: 'fixture-1', name: 'Synthetic runner', gate: 1, strategyCode: 1, finishTime: 50, finishTimeRaw: 50, skills: [] }],
  frames: Array.from({ length: 51 }, (_, time) => ({ time, runners: [{ runnerId: 'fixture-1', distance: time * 20, speed: 20, hp: 1000 - time, lane: 1 / 18, temptationMode: 0, blockFrontRunnerIndex: -1 }] })), events: [], warnings: [] });
let cases = 0;
async function analyze(name: string, race: any) {
  const input = join(folder, `${name}.json`), output = join(folder, `${name}-analysis.json`); await writeFile(input, JSON.stringify(race));
  await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/analyze-race.ts'), input, output, '--reference-dir', reference], { cwd: root, windowsHide: true, timeout: 30000 }); cases++;
  return Object.values<any>(JSON.parse(await readFile(output, 'utf8'))[0].analysis.runners)[0].cornerPath;
}
const near = (a: number, b: number, tolerance = .005) => assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);
await setup(); let race = base(), result = await analyze('one-horse-lane', race), expected = .625 * Math.PI / 2;
near(result.extraDistance, expected); near(result.equivalentTime, result.extraDistance / 20, 1e-7); assert.equal(result.coverage, 1); assert.equal(result.evidence, 'estimated');
assert.match(result.detail, /11\.25/); assert.match(result.detail, /not causal finish-time loss/);
race = base(); for (const f of race.frames) f.runners[0].lane = 0; result = await analyze('reference-lane-zero', race); assert.equal(result.extraDistance, 0); assert.equal(result.equivalentTime, 0);
race = base(); for (const f of race.frames) f.runners[0].lane = 2 / 18; result = await analyze('two-horse-lanes', race); near(result.extraDistance, expected * 2, .01);
await setup(true); result = await analyze('left-turn-same-offset', base()); near(result.extraDistance, expected);
await setup(false, true); result = await analyze('straight-excludes-all-heading', base()); assert.equal(result.extraDistance, 0); assert.equal(result.equivalentTime, 0);
await setup(); race = base(); race.frames[10].runners[0].lane = null; result = await analyze('missing-lane', race); assert.equal(result.extraDistance, null); assert.ok(result.assessedExtraDistance > 0); assert.ok(result.coverage < 1);
courses[99993].laneMax = 22500; await writeFile(join(reference, 'courses.json'), JSON.stringify(courses)); result = await analyze('width-does-not-renormalize-lane', base()); near(result.extraDistance, expected);
await setup(); geometry.paths['synthetic-quarter'].points = geometry.paths['synthetic-quarter'].points.map(([x,y,z]: number[]) => [x * .625,y,z * .625]); await writeFile(join(reference, 'course-geometry.json'), JSON.stringify(geometry)); result = await analyze('uniform-world-scale-does-not-change-heading', base()); near(result.extraDistance, expected);
await setup(); for (let i = 420; i < 680; i++) geometry.paths['synthetic-quarter'].points[i][0] += Math.sin(i) * .01; await writeFile(join(reference, 'course-geometry.json'), JSON.stringify(geometry)); result = await analyze('straight-heading-noise-excluded', base()); near(result.extraDistance, expected);
await setup();
race = base(); race.frames[10].runners[0].speed = null; result = await analyze('missing-speed-keeps-distance', race); near(result.extraDistance, expected); assert.equal(result.equivalentTime, null); assert.ok(result.assessedEquivalentTime > 0); assert.equal(result.coverage, 1); assert.ok(result.timeCoverage < 1);
race = base(); race.frames[10].runners[0].speed = 0; result = await analyze('zero-speed-no-time-division', race); near(result.extraDistance, expected); assert.equal(result.equivalentTime, null);
race = base(); race.frames = race.frames.filter((f: any) => f.time < 8 || f.time > 12); result = await analyze('large-observation-gap', race); assert.equal(result.extraDistance, null); assert.ok(result.coverage < 1);
race = base(); race.frames[10].runners[0].lane = 1.6; result = await analyze('outside-master-lane-bound', race); assert.equal(result.extraDistance, null);
race = base(); race.frames[10].runners[0].distance = 150; result = await analyze('regressing-distance-not-double-counted', race); assert.equal(result.extraDistance, null); assert.equal(result.assessedExtraDistance, null);
race = base(); race.runners[0].finishTime = 12; race.runners[0].finishTimeRaw = 12; result = await analyze('finish-before-corner-end', race); assert.equal(result.extraDistance, null); assert.ok(result.coverage < 1);
// The full corner schedule, not whatever samples remain, is the denominator.
race = base(); race.frames = race.frames.filter((f: any) => f.time > 6); result = await analyze('missing-corner-prefix', race); assert.equal(result.extraDistance, null); assert.ok(result.coverage < 1);
const saved = geometry; geometry = { schemaVersion: 1, paths: {}, courses: {} }; await writeFile(join(reference, 'course-geometry.json'), JSON.stringify(geometry)); result = await analyze('missing-path', base()); assert.equal(result.extraDistance, null); assert.equal(result.evidence, 'unknown');
geometry = saved; await writeFile(join(reference, 'course-geometry.json'), JSON.stringify(geometry));
// A portable normalized file must preserve the original decoded lane value.
const input = join(folder, 'portable-input.json'), out = join(folder, 'portable'); await mkdir(out); await writeFile(input, JSON.stringify(base()));
await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/import-race.ts'), input, out], { cwd: root, windowsHide: true, timeout: 30000 });
const { readdir } = await import('node:fs/promises'); const portable = JSON.parse(await readFile(join(out, (await readdir(out))[0]), 'utf8'));
assert.equal(portable.frames[10].runners[0].lane, 1 / 18); result = await analyze('portable-roundtrip', portable); near(result.extraDistance, expected);
console.log(JSON.stringify({ cases, laneScale: 'passed', canonicalHeading: 'passed', referenceLane: 'passed', straightExclusion: 'passed',
  missingTotalsWithheld: 'passed', partialCoverage: 'passed', portable: 'passed', evidence: 'reference-path-only' }));
