import type { Race, Runner, RunnerSample } from './types';
import type { CourseReference } from './reference';

export interface CornerPathAnalysis {
  extraDistance: number | null;
  equivalentTime: number | null;
  assessedExtraDistance: number | null;
  assessedEquivalentTime: number | null;
  cornerDistance: number | null;
  assessedCornerDistance: number;
  timedCornerDistance: number;
  coverage: number | null;
  timeCoverage: number | null;
  evidence: 'estimated' | 'unknown';
  detail: string;
}
const help = 'Reference-path comparison against lane 0, using decoded lane × 11.25 m and heading changes from this course’s game path, only within its corner ranges. Adjacent retained samples are interpolated; gaps over 2 s remain unassessed. Seconds divide extra path by recorded actual speed. This is curvature-only extra path, excluding lateral weaving, body clearance, blocking and changed race decisions; it is not causal finish-time loss. The native replay-to-world transform is unverified.';
interface Cell { start: number; end: number; curvature: number }
const cellsCache = new WeakMap<CourseReference, Cell[] | null>();
const angleDifference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
function cellsFor(course: CourseReference): Cell[] | null {
  if (cellsCache.has(course)) return cellsCache.get(course)!;
  const path = course.gameGeometry?.path, direction = course.turn === 1 ? -1 : course.turn === 2 ? 1 : null;
  if (!path || path.distance !== course.distance || path.points.length < 4 || direction === null) { cellsCache.set(course, null); return null; }
  const points = path.points, step = course.distance / (points.length - 1), headings: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    if (Math.hypot(b[0] - a[0], b[2] - a[2]) < 1e-6) { cellsCache.set(course, null); return null; }
    headings.push(Math.atan2(b[2] - a[2], b[0] - a[0]));
  }
  // Centered tangents reduce rounded-coordinate noise; extrapolate endpoint
  // tangents so a corner starting at the first point does not lose half a cell.
  headings[0] = headings[1] - angleDifference(headings[2], headings[1]);
  headings[headings.length - 1] = headings.at(-2)! + angleDifference(headings.at(-2)!, headings.at(-3)!);
  const cells = headings.slice(1).map((angle, i) => ({ start: i * step, end: (i + 1) * step,
    curvature: direction * angleDifference(angle, headings[i]) / step }));
  // Signed turn integration preserves small reverse bends instead of inflating
  // total turning by taking absolute values of every noisy sample. No heading
  // change outside the declared corner ranges contributes.
  cellsCache.set(course, cells); return cells;
}
function rangesFor(course: CourseReference): { start: number; end: number }[] {
  const ranges = course.corners.map(c => ({ start: Math.max(0, c.start), end: Math.min(course.distance, c.start + c.length) }))
    .filter(c => c.end > c.start).sort((a, b) => a.start - b.start), union: typeof ranges = [];
  for (const range of ranges) { const last = union.at(-1); if (last && range.start <= last.end) last.end = Math.max(last.end, range.end); else union.push({ ...range }); }
  return union;
}
export function cornerPathFor(race: Race, runner: Runner, course: CourseReference | null): CornerPathAnalysis {
  const result: CornerPathAnalysis = { extraDistance: null, equivalentTime: null, assessedExtraDistance: null, assessedEquivalentTime: null,
    cornerDistance: null, assessedCornerDistance: 0, timedCornerDistance: 0, coverage: null, timeCoverage: null, evidence: 'unknown', detail: help };
  if (!course || race.distance !== course.distance) return { ...result, detail: 'Course identity/distance unavailable. ' + help };
  const ranges = rangesFor(course), total = ranges.reduce((sum, range) => sum + range.end - range.start, 0); result.cornerDistance = total;
  if (total === 0) return { ...result, extraDistance: 0, equivalentTime: 0, assessedExtraDistance: 0, assessedEquivalentTime: 0, coverage: 1, timeCoverage: 1, evidence: 'estimated' };
  const cells = cellsFor(course), maximum = course.laneMax === null ? null : course.laneMax / 10000;
  if (!cells || maximum === null || maximum <= 0) return { ...result, detail: 'Game-path geometry or lane bounds unavailable. ' + help };
  const stop = runner.finishTimeRaw ?? null;
  if (stop === null) return { ...result, detail: 'Recorded simulation finish unavailable. ' + help };
  let metres = 0, seconds = 0;
  const sample = (frame: Race['frames'][number]) => frame.runners.find(s => s.runnerId === runner.id);
  let priorDistance = -Infinity;
  for (const frame of race.frames) {
    if (frame.time > stop) break;
    const distance = sample(frame)?.distance;
    if (distance == null) continue;
    if (!Number.isFinite(distance) || distance < priorDistance) return { ...result, detail: 'Runner distance history is invalid or reverses; repeated progress must not duplicate corner coverage. ' + help };
    priorDistance = distance;
  }
  const validLane = (s: RunnerSample) => s.lane !== null && Number.isFinite(s.lane) && s.lane >= 0 && s.lane <= maximum;
  for (let i = 1; i < race.frames.length; i++) {
    const fa = race.frames[i - 1], fb = race.frames[i], a = sample(fa), b = sample(fb), dt = fb.time - fa.time;
    if (fa.time >= stop || dt <= 0 || dt > 2 || !a || !b || a.distance === null || b.distance === null || b.distance <= a.distance || !validLane(a) || !validLane(b)) continue;
    const end = Math.min(course.distance, a.distance + (b.distance - a.distance) * Math.min(1, (stop - fa.time) / dt)), start = Math.max(0, a.distance);
    if (end <= start) continue;
    const interpolate = (av: number, bv: number, distance: number) => av + (bv - av) * (distance - a.distance!) / (b.distance! - a.distance!);
    const lane = (d: number) => interpolate(a.lane!, b.lane!, d) * 11.25;
    const knownSpeed = a.speed !== null && b.speed !== null && Number.isFinite(a.speed) && Number.isFinite(b.speed) && a.speed > 0 && b.speed > 0;
    for (const range of ranges) {
      const lo = Math.max(start, range.start), hi = Math.min(end, range.end); if (hi <= lo) continue;
      result.assessedCornerDistance += hi - lo; if (knownSpeed) result.timedCornerDistance += hi - lo;
      for (const cell of cells) {
        const left = Math.max(lo, cell.start), right = Math.min(hi, cell.end); if (right <= left) continue;
        const turning = cell.curvature * (right - left); metres += (lane(left) + lane(right)) / 2 * turning;
        if (knownSpeed) {
          const ratio = (d: number) => lane(d) / interpolate(a.speed!, b.speed!, d);
          seconds += turning / 6 * (ratio(left) + 4 * ratio((left + right) / 2) + ratio(right));
        }
      }
    }
  }
  result.coverage = Math.min(1, result.assessedCornerDistance / total); result.timeCoverage = Math.min(1, result.timedCornerDistance / total);
  if (metres < -.01 || seconds < -.001) return { ...result, detail: 'Path winding conflicts with the declared course direction. ' + help };
  result.assessedExtraDistance = result.assessedCornerDistance > 0 ? Math.max(0, metres) : null;
  result.assessedEquivalentTime = result.timedCornerDistance > 0 ? Math.max(0, seconds) : null;
  if (Math.abs(result.assessedCornerDistance - total) < .001) result.extraDistance = result.assessedExtraDistance;
  if (Math.abs(result.timedCornerDistance - total) < .001) result.equivalentTime = result.assessedEquivalentTime;
  result.evidence = result.assessedCornerDistance > 0 ? 'estimated' : 'unknown'; return result;
}
