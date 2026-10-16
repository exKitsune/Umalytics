import type { Race } from './types';
import type { RaceAnalysis } from './analytics';
import type { ReferenceData } from './reference';
import { createRaceMotionEngine } from './race-motion';
import { statusHpFactor } from './mechanics-effects';
import { effectiveStrategyCode } from './skill-details';
import { atTime } from './effect-sampling';

export interface StatusModeImpact {
  kind: string; intervals: number; duration: number;
  reachableExtraDistance: number | null; reachableExtraTime: number | null; reachableExtraHp: number | null;
  assessedReachableExtraDistance: number | null; assessedReachableExtraTime: number | null; assessedReachableExtraHp: number | null;
  assessedDuration: number; coverage: number; carryoverDuration: number; complete: boolean;
  reachableRange: { distance: [number, number]; time: [number, number]; hp: [number, number] | null } | null;
  detail: string;
}
const kinds = new Set(['pace-up', 'pace-down', 'speed-up', 'overtake', 'downhill-mode']);
const cache = new WeakMap<RaceAnalysis, Map<number, { engine: ReturnType<typeof createRaceMotionEngine>; values: Map<string, StatusModeImpact[]> }>>();
/** Lazy all-runner result data: one shared-engine excluded path per mode kind,
 * never one trajectory per episode and never an eager analyzeRace recursion. */
export function modeImpactsFor(race: Race, reference: ReferenceData | null, analysis: RaceAnalysis, runnerId: string, courseId?: number | null): StatusModeImpact[] {
  const id = courseId ?? race.courseId ?? -1;
  let courses = cache.get(analysis); if (!courses) cache.set(analysis, courses = new Map());
  let entry = courses.get(id); if (!entry) courses.set(id, entry = { engine: createRaceMotionEngine(race, reference, id, analysis), values: new Map() });
  const cached = entry.values.get(runnerId); if (cached) return cached;
  const runner = race.runners.find(r => r.id === runnerId), detail = analysis.runners[runnerId], course = reference?.courses[id];
  if (!runner || !detail) return [];
  const full = entry.engine.build({ runnerId, applyInferredModes: true }).runners[runnerId], style = effectiveStrategyCode(runner, detail.skillRows), result: StatusModeImpact[] = [];
  for (const kind of kinds) {
    const windows = detail.intervals.filter(i => i.kind === `${kind}-model` && i.end != null && i.end > i.start);
    if (!windows.length) continue;
    const ordered = windows.map(i => [i.start, i.end!] as [number, number]).sort((a, b) => a[0] - b[0]), union: [number, number][] = [];
    for (const window of ordered) { const last = union.at(-1); if (last && window[0] <= last[1]) last[1] = Math.max(last[1], window[1]); else union.push([...window]); }
    const duration = union.reduce((n, w) => n + w[1] - w[0], 0), without = entry.engine.build({ runnerId, applyInferredModes: true, excludeStatusKey: `kind:${kind}` }).runners[runnerId];
    const totals = [0, 1, 2].map(() => ({ distance: 0, time: 0, hp: 0 })), channels = ['min', 'mid', 'max'] as const;
    let assessed = 0, carryover = 0, any = false, complete = true, hpKnown = Boolean(course && race.distance === course.distance && [1, 2, 3, 4].includes(Number(race.conditions?.ground)) && full.initialStats.guts), tail = false;
    const other = new Map(without.samples.map(s => [s.time, s]));
    for (let i = 1; i < full.samples.length; i++) {
      const a = full.samples[i - 1], b = full.samples[i], u = other.get(a.time), v = other.get(b.time), dt = b.time - a.time, mid = (a.time + b.time) / 2;
      const active = union.some(w => mid >= w[0] && mid < w[1]);
      if (!active && !tail) continue;
      const valid = dt > 0 && dt <= 2 && a.constrained && b.constrained && u?.constrained && v?.constrained;
      if (!valid) { complete = false; tail = false; continue; }
      const magnitude = Math.max(...channels.map(c => Math.abs(b.constrained![c] - v!.constrained![c])));
      if (active) assessed += dt; else carryover += dt;
      any = true;
      const sample = atTime(race, runnerId, mid), ground = Number(race.conditions?.ground), totalDistance = race.distance ?? 0, base = 20 - (totalDistance - 2000) / 1000;
      const factor = ground === 4 ? 1.02 : ground === 3 ? course?.surface === 1 ? 1.02 : 1.01 : 1;
      const fullHp = statusHpFactor(detail.intervals, mid, style), withoutHp = statusHpFactor(detail.intervals, mid, style, kind);
      if(a.selfActual===null||b.selfActual===null||u!.selfActual===null||v!.selfActual===null)hpKnown=false;
      for (const [scenario, c] of channels.entries()) {
        const withVelocity = (a.constrained![c] + b.constrained![c]) / 2, withoutVelocity = (u!.constrained![c] + v!.constrained![c]) / 2, distance = (withVelocity - withoutVelocity) * dt;
        totals[scenario].distance += distance; totals[scenario].time += distance / Math.max(.001, withVelocity);
        if (hpKnown && sample?.hp != null && sample.distance != null) {
          const guts = full.initialStats.guts![c], late = sample.distance >= totalDistance * 2 / 3 ? 1 + 200 / Math.sqrt(600 * guts) : 1;
          const hp = (velocity: number) => sample.hp! <= 0 ? 0 : 20 * Math.max(0, velocity - base + 12) ** 2 / 144 * factor * late;
          const direct = (a.currentSpeedDelta + b.currentSpeedDelta) / 2, directWithout = (u!.currentSpeedDelta + v!.currentSpeedDelta) / 2;
          totals[scenario].hp += (hp(Math.max(0, withVelocity - direct)) * fullHp - hp(Math.max(0, withoutVelocity - directWithout)) * withoutHp) * dt;
        } else hpKnown = false;
      }
      tail = magnitude > .001;
    }
    const range = (key: 'distance' | 'time' | 'hp'): [number, number] => [Math.min(...totals.map(v => v[key])), Math.max(...totals.map(v => v[key]))];
    complete &&= Math.abs(assessed - duration) < .0001;
    result.push({ kind, intervals: windows.length, duration, assessedDuration: assessed, coverage: Math.min(1, assessed / duration), carryoverDuration: carryover, complete,
      reachableExtraDistance: complete && any ? totals[1].distance : null, reachableExtraTime: complete && any ? totals[1].time : null, reachableExtraHp: complete && any && hpKnown ? totals[1].hp : null,
      assessedReachableExtraDistance: any ? totals[1].distance : null, assessedReachableExtraTime: any ? totals[1].time : null, assessedReachableExtraHp: any && hpKnown ? totals[1].hp : null,
      reachableRange: complete && any ? { distance: range('distance'), time: range('time'), hp: hpKnown ? range('hp') : null } : null,
      detail: 'Shared ideal-engine comparison removes all episodes of this inferred mode together, preserving the full-path calibrated section quantile and every resolved skill/status/field schedule. Actual acceleration/deceleration and neighborhood caps limit reachable gain; this is not target-ceiling area. Assessed carryover continues only while paired paths remain different and known; unknown gaps are not bridged. Coverage measures active candidate windows; complete also requires a known recovery tail. Positive distance/time means gained reference travel/equivalent local time, negative means lost; HP is extra spent, negative means saved. Endpoint ranges are conditional common scenarios, not guaranteed bounds. Recorded progress, HP and field schedules remain fixed: this is a reference comparison, not causal finish-time gain, and different mode/skill totals are not independent additive credits.' });
  }
  entry.values.set(runnerId, result); return result;
}
