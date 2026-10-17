import type { Race, Runner, RunnerStats } from './types';

/** Soft stationery pastels, distinct enough for an 18-runner field. */
export const teamColors = [
  '#f7b6c2', '#f8c9a9', '#f6e3a1', '#c8e6c0', '#b5d8f0', '#d2c2f0',
  '#f5c6d6', '#b8e0d4', '#e8d4b8', '#d7c4f0', '#f4cfa0', '#c5dff0',
  '#e8c4bc', '#cde4b4', '#f3b8d0', '#b4e0dc', '#f5d9a8', '#c9bfe8',
];
const statKeys = ['speed', 'stamina', 'power', 'guts', 'wisdom'] as const;

export interface RaceTeam {
  id: string;
  ordinal: number;
  color: string;
  trainer: string | null;
  trainerId: string | null;
  runners: Runner[];
}

function teamKey(runner: Runner, useGroups: boolean): string | null {
  if (useGroups) return runner.teamGroup == null ? null : `team:${runner.teamGroup}`;
  if (runner.trainerId) return `trainer:${runner.trainerId}`;
  if (runner.trainer) return `name:${runner.trainer}`;
  return runner.isNpc === true ? 'npc' : null;
}

function sumTeamStats(members: Runner[]): RunnerStats | undefined {
  if (!members.length) return undefined;
  const totals: RunnerStats = { speed: null, stamina: null, power: null, guts: null, wisdom: null };
  for (const key of statKeys) {
    const values = members.map(member => member.stats?.[key] ?? null);
    totals[key] = values.some(value => value == null || !Number.isFinite(value)) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  }
  return totals;
}

/** Same-team raw stat sums for Spirit / valueUsage 3–7. Missing membership stays unset. */
export function attachTeamStatTotals(runners: Runner[]): Runner[] {
  const useGroups = runners.some(runner => runner.teamGroup != null);
  const buckets = new Map<string, Runner[]>();
  for (const runner of runners) {
    const key = teamKey(runner, useGroups);
    if (!key) continue;
    const bucket = buckets.get(key) ?? [];
    bucket.push(runner);
    buckets.set(key, bucket);
  }
  return runners.map(runner => {
    const key = teamKey(runner, useGroups);
    const mates = key ? buckets.get(key) : undefined;
    if (!mates?.length) return { ...runner, teamStatTotals: undefined };
    return { ...runner, teamStatTotals: sumTeamStats(mates) };
  });
}

function trainerFor(members: Runner[]): { trainer: string | null; trainerId: string | null } {
  const preferred = members.find(member => member.isNpc === false) ?? members[0];
  return { trainer: preferred?.trainer ?? null, trainerId: preferred?.trainerId ?? null };
}

export function finishPlace(order: number | null | undefined): string | null {
  if (order == null || !Number.isInteger(order) || order < 1) return null;
  const suffix = order % 100 >= 11 && order % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[order % 10] ?? 'th';
  return `${order}${suffix}`;
}

export function raceTeams(race: Race): RaceTeam[] {
  const useGroups = race.runners.some(runner => runner.teamGroup != null);
  const buckets = new Map<string, Runner[]>();
  for (const runner of [...race.runners].sort((a, b) => (a.gate ?? a.index) - (b.gate ?? b.index))) {
    const key = teamKey(runner, useGroups) ?? `solo:${runner.id}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(runner);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].map(([id, runners], index) => {
    const named = trainerFor(runners);
    return { id, ordinal: index + 1, color: teamColors[index % teamColors.length], trainer: named.trainer, trainerId: named.trainerId, runners };
  }).sort((a, b) => {
    const left = Math.min(...a.runners.map(runner => runner.teamGroup ?? runner.gate ?? runner.index));
    const right = Math.min(...b.runners.map(runner => runner.teamGroup ?? runner.gate ?? runner.index));
    return left - right || a.ordinal - b.ordinal;
  }).map((team, index) => ({ ...team, ordinal: index + 1, color: teamColors[index % teamColors.length] }));
}
