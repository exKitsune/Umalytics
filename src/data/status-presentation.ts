import type { StatusInterval } from './analytics';
import type { MotionSample } from './race-motion';
const labels: Record<string, [string, string]> = {
  'pace-up': ['Pace up', 'PU'], 'pace-down': ['Pace down', 'PD'],
  'speed-up': ['Speed up', 'SU'], overtake: ['Overtake', 'OT'],
  'spot-struggle': ['Spot struggle', 'SS'], 'downhill-mode': ['Downhill mode', 'DH'],
  dueling: ['Dueling', 'Dueling'], rushed: ['Rushed', 'RUSH'], 'rushed-boost': ['Rushed boost', 'BOOST'],
  'front-block': ['Blocked', 'Blocked'], 'near-slowdown': ['Near', 'Near'], 'lane-bonus': ['Lane bonus', 'Lane'], 'last-spurt': ['Last spurt', 'SPURT'],
  'hp-empty': ['Exhausted', 'Exhausted'], 'downhill-section': ['Downhill section', 'GRADE'],
};
const baseKind = (kind: string) => kind.replace(/-model$/, '');
export function statusLabel(kind: string): string {
  return labels[baseKind(kind)]?.[0] ?? baseKind(kind).replaceAll('-', ' ').replace(/^./, c => c.toUpperCase());
}
export function statusShortLabel(kind: string): string {
  return labels[baseKind(kind)]?.[1] ?? statusLabel(kind);
}
const substantialDeficit = 0.15;
const explainedSlowdown = new Set(['front-block', 'hp-empty']);
/** Use the target including inferred modes and resolved skills/debuffs. Near
 * can coexist with a pace or downhill mode: traffic can hide its speed gain. */
export function substantialNearIntervals(intervals: StatusInterval[], samples: (Pick<MotionSample, 'time' | 'actual' | 'targetActive' | 'hpEmpty' | 'startDash'> & Partial<Pick<MotionSample,'currentSpeedDelta'>>)[]): StatusInterval[] {
  const ordered = [...samples].sort((a, b) => a.time - b.time);
  const explained = (time: number) => intervals.some(interval => explainedSlowdown.has(baseKind(interval.kind)) && time >= interval.start && time < (interval.end ?? interval.observedUntil ?? Number.POSITIVE_INFINITY));
  return intervals.flatMap(interval => {
    if (baseKind(interval.kind) !== 'near-slowdown') return [interval];
    const end = interval.end ?? interval.observedUntil ?? interval.start;
    const hits = ordered.filter(sample => sample.time >= interval.start - 1e-6 && sample.time < end - 1e-9 && sample.actual != null && sample.targetActive != null && sample.hpEmpty !== true && sample.startDash !== true && sample.targetActive.mid + (sample.currentSpeedDelta??0) - sample.actual > substantialDeficit + 1e-9 && !explained(sample.time));
    if (!hits.length) return [];
    const groups: typeof hits[] = [];
    for (const hit of hits) {
      const last = groups.at(-1);
      if (!last || hit.time - last.at(-1)!.time > .25) groups.push([hit]);
      else last.push(hit);
    }
    return groups.flatMap(group => {
      const start = group[0].time, last = group.at(-1)!.time;
      const following = ordered.find(sample => sample.time > last + 1e-9);
      const stop = Math.min(end, following?.time ?? end);
      if (stop <= start) return [];
      return [{ ...interval, start, end: stop, detail: `${interval.detail} Speed is more than 0.15 m/s below the target including active modes, skills and debuffs.` }];
    });
  });
}
/** Presentation only: original analytics keeps recorded and modeled evidence separate. */
export function combinedStatusIntervals(intervals: StatusInterval[], options: { includeModels?: boolean } = {}): StatusInterval[] {
  const includeModels = options.includeModels ?? true;
  const models = includeModels ? intervals.filter(i => i.kind.endsWith('-model')) : [];
  return intervals.filter(i => includeModels || i.evidence !== 'estimated')
    .filter(i => !includeModels || i.kind.endsWith('-model') || !models.some(m => baseKind(m.kind) === i.kind && m.start === i.start))
    .map(i => ({ ...i, kind: baseKind(i.kind), label: statusLabel(i.kind) }))
    .sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind));
}
