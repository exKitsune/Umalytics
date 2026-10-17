/** Offline helpers for racing-team totals, observed skill branches, and trainer grouping. */
import assert from 'node:assert/strict';
import { attachTeamStatTotals, finishPlace, raceTeams, teamColors } from '../src/data/race-teams';
import { displayedSkillBranches, effectText, skillBranchNodes, usedBranchIndexes } from '../src/data/skill-details';
import { effectValue } from '../src/data/effect-value';
import type { Runner } from '../src/data/types';
import type { SkillRow } from '../src/data/analytics';
import type { SkillReference } from '../src/data/reference';

const runner = (index: number, extras: Partial<Runner> = {}): Runner => ({
  id: `runner-${index + 1}`, index, gate: index + 1, name: `Synthetic ${index + 1}`,
  charaId: 1001 + index, cardId: 100101 + index, trainer: extras.trainer ?? `Trainer ${Math.floor(index / 3) + 1}`,
  trainerId: extras.trainerId ?? String(1000 + Math.floor(index / 3)), strategy: 'Pace Chaser',
  finishOrder: index + 1, finishTime: 100 + index, teamGroup: extras.teamGroup ?? Math.floor(index / 3) + 1,
  stats: extras.stats ?? { speed: 1000 - index * 50, stamina: 800, power: 900, guts: 400, wisdom: 700 },
  ...extras,
});

const skill: SkillReference = {
  name: 'Synthetic branch skill', rarity: 5, activateLot: 0,
  branches: [
    { branchIndex: 0, precondition: 'track_id==10005', condition: 'phase>=2&is_finalcorner==1', rawDuration: 50000, durationUsage: 1, effects: [{ type: 27, rawValue: 4500, valueUsage: 1, levelUsage: 1, targetType: 1 }] },
    { branchIndex: 1, precondition: '', condition: 'phase>=2&is_finalcorner==1', rawDuration: 50000, durationUsage: 1, effects: [{ type: 27, rawValue: 2500, valueUsage: 1, levelUsage: 1, targetType: 1 }] },
  ],
};
const row: SkillRow = {
  skillId: 120011, equipped: true, activationCount: 1,
  activations: [{ skillId: 120011, start: 101.7, end: 114.2, duration: 12.5, effectiveDuration: 12.5, effectiveEnd: 114.2, timingKind: 'reported', timingReason: '', durationEvidence: 'recorded', effectBranch: 0, effects: skill.branches[0].effects, detail: '', targetRunnerIds: [] }],
  nonProcReason: '', evidence: 'recorded', activationStatus: 'recorded', effectiveActive: true,
  conditionEvaluation: null, inferredBranches: [],
};

const field = attachTeamStatTotals(Array.from({ length: 9 }, (_, index) => runner(index)));
assert.equal(field[0].teamStatTotals?.speed, 2850);
assert.equal(effectValue(field[0], 210011, { type: 27, rawValue: 3500, valueUsage: 3, levelUsage: 1, targetType: 1 }), 0.35 * 1.1);
assert.equal(effectValue({ ...field[0], teamStatTotals: undefined }, 210011, { type: 27, rawValue: 3500, valueUsage: 3, levelUsage: 1, targetType: 1 }), null);
assert.match(effectText({ type: 27, rawValue: 3500, valueUsage: 3, levelUsage: 1, targetType: 1 }), /racing-team Speed/);

const teams = raceTeams({ runners: field } as any);
assert.equal(teamColors.length, 18);
assert.equal(teams.length, 3);
assert.equal(teams[0].trainer, 'Trainer 1');
assert.equal(teams[0].trainerId, '1000');
assert.equal(teams[0].runners.length, 3);
assert.equal(finishPlace(1), '1st');
assert.equal(finishPlace(2), '2nd');
assert.equal(finishPlace(3), '3rd');
assert.equal(finishPlace(11), '11th');

assert.deepEqual(usedBranchIndexes(row), [0]);
assert.equal(displayedSkillBranches(skill, row).length, 1);
assert.equal(displayedSkillBranches(skill, row)[0].effects[0].rawValue, 4500);
assert.equal(displayedSkillBranches(skill, null).length, 2);
const nodes = skillBranchNodes(skill, row);
assert.equal(nodes[0].taken, true);
assert.equal(nodes[1].taken, false);
assert.equal(nodes[0].state, 'met');
assert.equal(nodes[0].label, 'If');
assert.equal(nodes[1].label, 'Otherwise');
console.log(JSON.stringify({ racingTeamScale: 'passed', trainerTeams: 'passed', observedBranch: 'passed' }));
