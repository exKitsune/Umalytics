import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { explainFieldRankCondition } from '../src/data/condition-mechanics';
const run = promisify(execFile), root = resolve(import.meta.dirname, '..'), folder = resolve(process.argv[2]);
await mkdir(folder, { recursive: true });
const reference = join(folder, 'reference'); await mkdir(reference);
const metadata = JSON.parse(await readFile(join(root, 'public/data/metadata.json'), 'utf8'));
for (const name of ['courses.json', 'reference-source.json', 'simulator-skill-ids.json']) await writeFile(join(reference, name), await readFile(join(root, 'public/data', name)));
const rules = ['phase==1&order==5', 'phase==1&order_rate<=50', 'phase==1&order_rate>50', 'phase==1&order_rate>=50',
  'phase==1&order_rate==50', 'phase==1&order_rate!=50', 'phase_random==1&order_rate<=50', 'phase==1&order<=2',
  'phase==1&order==1', 'phase==1&order_rate<50'];
rules.push('phase==1&order==6', 'phase==1&order==6&order==5');
for (const [index, condition] of rules.entries()) metadata.skills[810001 + index] = { name: `Synthetic field-rank rule ${index + 1}`, rarity: 1,
  groupId: 81000 + index, activateLot: 1, branches: [{ branchIndex: 0, condition, precondition: '', rawDuration: 30000, durationUsage: 1,
    effects: [{ type: 27, rawValue: 1500, valueUsage: 1, levelUsage: 1, targetType: 1 }] }] };
metadata.skills[810011].branches[0].precondition = 'phase==1&order==5';
await writeFile(join(reference, 'metadata.json'), JSON.stringify(metadata));
let cases = 0;
async function analyze(name: string, count: number, positions: number[], change?: (race: any) => void) {
  const race: any = { schemaVersion: 1, title: 'Synthetic whole-field rank workflow', synthetic: true, distance: 2400, category: 'practice', courseId: 10606,
    runners: Array.from({ length: count }, (_, i) => ({ id: `fixture-${i}`, name: `Synthetic runner ${i + 1}`, cardId: 100101 + i * 100,
      // This runner leads its selected strategy and finishes first, while its
      // observed field position may be fifth/sixth. Neither substitutes for order.
      strategyCode: i === 0 ? 3 : 1, finishOrder: i + 1, finishTimeRaw: 120,
      skills: i === 0 ? rules.map((_, j) => ({ id: 810001 + j, level: 1 })) : [] })),
    frames: [0, 20, 40, 80, 120].map(time => ({ time, runners: positions.map((offset, i) => ({ runnerId: `fixture-${i}`,
      distance: time === 0 ? 0 : time * 20 + offset, speed: 20, hp: 1000, lane: .1 })) })), events: [], warnings: [] };
  change?.(race);
  const input = join(folder, `${name}.json`), output = join(folder, `${name}-analysis.json`); await writeFile(input, JSON.stringify(race));
  await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/analyze-race.ts'), input, output, '--reference-dir', reference], { cwd: root, windowsHide: true, timeout: 30000 });
  const analysis = JSON.parse(await readFile(output, 'utf8'))[0].analysis.runners['fixture-0']; cases++;
  return (id: number) => analysis.skillRows.find((r: any) => r.skillId === 810000 + id).conditionEvaluation;
}
const fifth = [0, 10, 20, 30, 40, -10, -20, -30, -40], sixth = [0, 10, 20, 30, 40, 50, -20, -30, -40];
let rows = await analyze('nine-fifth', 9, fifth);
for (const id of [1, 2, 4, 5]) assert.equal(rows(id).state, 'met');
for (const id of [3, 6, 8, 9, 10]) assert.equal(rows(id).eligibilityState, 'unresolved');
assert.equal(rows(7).eligibilityState, 'eligible'); assert.equal(rows(7).state, 'unknown'); assert.equal(rows(7).definitiveOpportunity, false);
const candidate = rows(7).branches[0].predicates;
assert.equal(candidate.find((p: any) => p.key === 'order_rate').state, 'met');
assert.equal(candidate.find((p: any) => p.key === 'order_rate').observed, 'Position 5 of 9.');
assert.equal(candidate.find((p: any) => p.key === 'order_rate').time, 20);
assert.equal(candidate.find((p: any) => p.key === 'phase_random').state, 'met');
assert.equal(candidate.find((p: any) => p.key === 'phase_random').time, 20);
assert.equal(rows(3).state, 'unmet');
assert.notEqual(rows(3).branches[0].predicates.find((p: any) => p.key === 'order_rate').state, 'met');
assert.equal(rows(2).branches[0].predicates.find((p: any) => p.key === 'order_rate').meaning, '1st–5th of 9 runners.');
assert.match(rows(2).branches[0].observations.join(' '), /position 5 of 9 \(satisfied\)/);
rows = await analyze('nine-sixth', 9, sixth); assert.equal(rows(3).state, 'met'); assert.equal(rows(2).eligibilityState, 'unresolved');
rows = await analyze('twelve-sixth', 12, [0, 10, 20, 30, 40, 50, -10, -20, -30, -40, -50, -60]);
assert.equal(rows(2).state, 'met'); assert.equal(rows(3).eligibilityState, 'unresolved'); assert.equal(rows(5).state, 'met');
rows = await analyze('missing-opponent', 9, [0, 10, -20, -30, -40, -50, -60, -70, -80], r => { for (const f of r.frames) f.runners = f.runners.filter((s: any) => s.runnerId !== 'fixture-1'); });
assert.equal(rows(8).state, 'met'); assert.equal(rows(9).state, 'unknown'); assert.equal(rows(9).definitiveOpportunity, false);
assert.match(rows(8).branches[0].observations.join(' '), /position 1–2 of 9/);
rows = await analyze('tie-across-cutoff', 9, [0, 10, 20, 30, 40, 0, -20, -30, -40]);
assert.equal(rows(2).state, 'unknown'); assert.equal(rows(3).state, 'unknown'); assert.equal(rows(4).state, 'met');
rows = await analyze('tie-inside-cutoff', 9, [0, 10, 20, 30, 0, -10, -20, -30, -40]); assert.equal(rows(2).state, 'met'); assert.equal(rows(1).state, 'unknown');
rows = await analyze('rank-crossing-event', 9, fifth, r => {
  r.frames = r.frames.filter((f: any) => [0, 20, 40].includes(f.time));
  r.frames[1].runners[5].distance = 390; r.frames[2].runners[5].distance = 810;
  r.events = [{ time: 30, type: 3, runnerId: 'fixture-0', skillId: 810001, params: [0, 810001, 30000, 0, 1], label: 'Synthetic event between retained frames' }];
});
assert.equal(rows(1).state, 'met'); assert.equal(rows(1).branches[0].proxies.length,0); // Explain the coherent sampled fifth-place candidate; unrelated later interpolation is not its evidence.
assert.equal(rows(1).branches[0].predicates.find((p:any)=>p.expression==='order==5').time,20);
const latched = rows(11).branches[0]; assert.equal(latched.state, 'met');
assert.equal(latched.predicates.find((p: any) => p.expression === 'order==5').role, 'precondition');
assert.equal(latched.predicates.find((p: any) => p.expression === 'order==5').time, 20);
const candidateSixth = latched.predicates.find((p: any) => p.expression === 'order==6');
assert.equal(candidateSixth.time, 40);
assert.equal(candidateSixth.state, 'met'); assert.equal(candidateSixth.observed, 'Position 6 of 9.');
assert.equal(latched.firstOpportunity, 30 + 1 / 15);
assert.equal(rows(12).eligibilityState, 'unresolved'); // Fifth and sixth observed at different times cannot form one conjunction.
assert.ok(rows(12).branches[0].predicates.every((p: any) => p.state === undefined));
rows = await analyze('only-interpolated-sixth', 9, fifth, r => {
  r.frames = r.frames.filter((f: any) => [0, 20, 40].includes(f.time));
  r.frames[1].runners[5].distance = 390; r.frames[2].runners[5].distance = 810;
  r.frames[1].runners[6].distance = 370; r.frames[2].runners[6].distance = 810;
  r.events = [{ time: 31, type: 3, runnerId: 'fixture-0', skillId: 810001, params: [0, 810001, 30000, 0, 1], label: 'Synthetic proxy-only sixth-place event' }];
});
const proxySixth = rows(11).branches[0].predicates.find((p: any) => p.expression === 'order==6');
assert.equal(proxySixth.state, 'unknown'); assert.equal(proxySixth.time, 31); assert.match(proxySixth.observed, /Interpolated position 6/);
assert.equal(explainFieldRankCondition('order_rate>50', 9), '6th–9th of 9 runners.');
assert.equal(explainFieldRankCondition('order_rate<=50', 12), '1st–6th of 12 runners.');
assert.equal(explainFieldRankCondition('order_rate>=40', 9), '4th–9th of 9 runners.');
assert.equal(explainFieldRankCondition('order_rate==50', 18), '9th of 18 runners.');
console.log(JSON.stringify({ cases, wholeFieldInsteadOfStrategyOrFinish: 'passed', roundedPercentBoundaries: 'passed', missingAndTiedRankBounds: 'passed', randomAndInterpolatedTriggerSeparation: 'passed' }));
