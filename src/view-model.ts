import type { Race, Runner, RunnerSample } from './data';

/** New exports distinguish actual simulation time from the game's scaled finishTime.
 * Older normalized exports only provided finishTime; retain that assumption for compatibility.
 * Explicit null means unknown and must not silently fall back to a scaled time. */
export function replayFinishTime(runner: Runner): number | null {
  return runner.finishTimeRaw === undefined ? runner.finishTime : runner.finishTimeRaw;
}

/** Positive behind first; negative ahead of second. Missing rivals stay unknown. */
export function runnerGap(race: Race, samples: RunnerSample[], runnerId: string): number | null {
  const positions = new Map(samples.map(sample => [sample.runnerId, sample.distance]));
  const own = positions.get(runnerId);
  if (own == null || !Number.isFinite(own) || race.runners.length < 2) return null;
  const clamp = (distance: number) => race.distance == null ? distance : Math.min(race.distance, distance);
  let opponent = -Infinity;
  for (const runner of race.runners) {
    if (runner.id === runnerId) continue;
    const distance = positions.get(runner.id);
    if (distance == null || !Number.isFinite(distance)) return null;
    opponent = Math.max(opponent, clamp(distance));
  }
  return opponent - clamp(own);
}

/** One unique place per runner. After a runner's recorded finish time, sort by
 * finishOrder (1 is the winner). Before that, sort by distance. Exact distance
 * matches keep runner order instead of inventing a dead heat. */
export function rankSamples(race: Race, samples: RunnerSample[], time: number): Map<string, number> {
  const finished = new Map(race.runners
    .filter(r => replayFinishTime(r) !== null && time >= replayFinishTime(r)! && r.finishOrder !== null)
    .map(r => [r.id, r.finishOrder!]));
  const known = samples.filter(s => s.distance !== null || finished.has(s.runnerId));
  known.sort((a, b) => {
    const af = finished.get(a.runnerId), bf = finished.get(b.runnerId);
    if (af !== undefined && bf !== undefined) return af - bf;
    if (af !== undefined) return -1;
    if (bf !== undefined) return 1;
    return (b.distance ?? -Infinity) - (a.distance ?? -Infinity);
  });
  return new Map(known.map((s, i) => [s.runnerId, i + 1]));
}
