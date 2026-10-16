import type { StatusInterval } from './analytics';
import type { MotionSample } from './race-motion';
import type { CourseReference } from './reference';

const threshold = 0.12;
const kind = (interval: StatusInterval) => interval.kind.replace(/-model$/, '');
function activeAt(intervals: StatusInterval[], time: number) {
  return intervals.filter(interval => time >= interval.start - 1e-6 && time < (interval.end ?? interval.observedUntil ?? interval.start) + 1e-6);
}

/** Why recorded speed is off the simulated line. Pace and downhill stay off that line on purpose. */
export function speedGapNote(sample: MotionSample | undefined, intervals: StatusInterval[], course: CourseReference | null, recordedSpeed?: number | null): { label: string; detail: string; unexplained: boolean } | null {
  const actual = recordedSpeed ?? sample?.actual;
  if (!sample?.free || actual == null) return null;
  const delta = actual - sample.free.mid;
  if (Math.abs(delta) < threshold) return null;
  const faster = delta > 0;
  const present = new Set(activeAt(intervals, sample.time).map(kind));
  const reasons: string[] = [];
  if (!faster && (present.has('front-block') || sample.constraint.kind === 'recorded-block' || sample.constraint.kind === 'geometry-block')) reasons.push('Blocked');
  if (!faster && present.has('near-slowdown')) reasons.push('Near');
  if (!faster && sample.hpEmpty) reasons.push('Exhausted');
  if (sample.startDash) reasons.push('Start dash');
  if (faster && present.has('overtake')) reasons.push('Overtake');
  else if (faster && present.has('speed-up')) reasons.push('Speed up');
  else if (faster && present.has('pace-up')) reasons.push('Pace up');
  if (!faster && present.has('pace-down')) reasons.push('Pace down');
  if (faster && present.has('downhill-mode')) reasons.push('Downhill');
  if (faster && present.has('lane-bonus')) reasons.push('Lane bonus');
  if (faster && present.has('dueling')) reasons.push('Dueling');
  if (faster && present.has('spot-struggle')) reasons.push('Spot struggle');
  if (present.has('rushed') || present.has('rushed-boost')) reasons.push('Rushed');
  const recent = (names: string[], window = 1.5) => intervals.some(interval => names.includes(kind(interval)) && interval.end != null && sample.time >= interval.end && sample.time - interval.end <= window);
  const target = sample.targetActive?.mid;
  if (faster && !reasons.length && recent(['pace-up'], 4) && (target == null || actual <= target + .9)) reasons.push('Pace up');
  if (!faster && !reasons.length && recent(['pace-down'], 4) && (target == null || actual < target - .02)) reasons.push('Pace down');
  // Leaving an overtake or speed-up ceiling uses the reference deceleration, so the
  // surplus can outlast the 1.5s carry. Keep the mode while that surplus is still closing.
  if (faster && !reasons.length && (target == null || actual <= target + .7)) {
    const name = (['overtake', 'speed-up'] as const).find(item => recent([item], 3.2));
    if (name) reasons.push(name === 'speed-up' ? 'Speed up' : 'Overtake');
  }
  if (faster && !reasons.length && recent(['pace-up', 'speed-up', 'overtake', 'downhill-mode', 'lane-bonus', 'dueling', 'spot-struggle'])) {
    const name = ['overtake', 'speed-up', 'pace-up', 'downhill-mode', 'lane-bonus', 'dueling', 'spot-struggle'].find(item => recent([item]));
    if (name) reasons.push(name === 'downhill-mode' ? 'Downhill' : name === 'pace-up' ? 'Pace up' : name === 'speed-up' ? 'Speed up' : name === 'lane-bonus' ? 'Lane bonus' : name === 'spot-struggle' ? 'Spot struggle' : name[0].toUpperCase() + name.slice(1));
  }
  const upcoming = (names: string[], window = 1.2) => intervals.some(interval => names.includes(kind(interval)) && interval.start - sample.time > 1e-6 && interval.start - sample.time <= window);
  if (faster && !reasons.length && upcoming(['rushed', 'rushed-boost'])) reasons.push('Rushed');
  if (faster && !reasons.length) {
    const name = ['overtake', 'speed-up', 'pace-up'].find(item => upcoming([item]));
    if (name) reasons.push(name === 'pace-up' ? 'Pace up' : name === 'speed-up' ? 'Speed up' : 'Overtake');
  }
  if (!faster && !reasons.length && recent(['pace-down', 'front-block', 'near-slowdown', 'rushed'])) {
    const name = ['front-block', 'near-slowdown', 'pace-down', 'rushed'].find(item => recent([item]));
    if (name) reasons.push(name === 'front-block' ? 'Blocked' : name === 'near-slowdown' ? 'Near' : name === 'pace-down' ? 'Pace down' : 'Rushed');
  }
  if (!faster && !reasons.length) {
    const duel = intervals.find(interval => kind(interval) === 'dueling' && interval.model?.speedDelta != null && interval.end != null && sample.time + 1e-6 >= interval.end && sample.time - interval.end <= 1.2);
    const bonus = duel?.model?.speedDelta;
    if (bonus != null && Math.abs(-delta - bonus) <= .12) reasons.push('Dueling');
  }
  if (present.has('last-spurt') && !reasons.length) reasons.push('Last spurt');
  const slope = course && sample.distance != null ? course.slopes.find(entry => sample.distance! >= entry.start && sample.distance! < entry.start + entry.length) : null;
  if (slope && slope.slopePercent > 0.2 && !faster && !reasons.length) reasons.push('Uphill');
  if (target != null && Math.abs(actual - target) <= threshold && !reasons.length) reasons.push(faster ? 'Simulated line still climbing' : 'Simulated line still slowing');
  if (!reasons.length && sample.pace !== 'normal-reference' && sample.pace !== 'unknown') {
    const paceFaster = sample.pace !== 'pace-down';
    if (faster === paceFaster) reasons.push(sample.pace.replaceAll('-', ' '));
  }
  const unexplained = reasons.length === 0;
  if (unexplained) reasons.push('Unexplained');
  const signed = `${delta > 0 ? '+' : ''}${delta.toFixed(2)} m/s`;
  return {
    label: `${signed} · ${reasons.join(' · ')}`,
    unexplained,
    detail: unexplained
      ? 'Recorded speed and the simulated line differ. No active status, slope, or block accounts for it.'
      : `Recorded speed is ${signed} against the simulated line because of ${reasons.join(', ')}.`,
  };
}
