import { runnerBySlot, type Race, type RaceEvent } from './types';
import type { CourseReference, ReferenceData, SkillReference } from './reference';

export interface CourseInference {
  courseId: number | null;
  trackId: number | null;
  candidateCourseIds: number[];
  evidence: string[];
}
type Truth = boolean | null;
type Bounds = { low: number; high: number };
const cache = new WeakMap<Race, WeakMap<ReferenceData, CourseInference | null>>();
const margin = 2; // Leave boundary-adjacent observations unresolved.
function boundsAt(race: Race, event: RaceEvent): Bounds | null {
  const id = event.runnerId ?? runnerBySlot(race.runners, event.params[0])?.id;
  if (!id) return null;
  const index = race.frames.findIndex(f => f.time >= event.time);
  if (index < 0) return null;
  const b = race.frames[index], db = b.runners.find(s => s.runnerId === id)?.distance;
  if (db == null) return null;
  if (b.time === event.time) return { low: db, high: db };
  if (index === 0) return null;
  const a = race.frames[index - 1], da = a.runners.find(s => s.runnerId === id)?.distance;
  if (da == null || db < da) return null;
  // Use the entire recorded bracket, not an exact interpolated position.
  return { low: da, high: db };
}
function compare(a: number, op: string, b: number): boolean {
  return ({ '==': a === b, '!=': a !== b, '>': a > b, '<': a < b, '>=': a >= b, '<=': a <= b } as Record<string, boolean>)[op];
}
function region(bounds: Bounds | null, zones: { start: number; end: number }[]): Truth {
  if (!bounds) return null;
  if (!zones.some(z => bounds.high >= z.start - margin && bounds.low <= z.end + margin)) return false;
  if (zones.some(z => bounds.low >= z.start + margin && bounds.high <= z.end - margin)) return true;
  return null;
}
function atom(text: string, course: CourseReference, bounds: Bounds | null, useGeometry: boolean): Truth {
  const m = text.trim().match(/^(\w+)(==|!=|>=|<=|>|<)(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const [, key, op, raw] = m, value = Number(raw);
  const staticValues: Record<string, number> = { track_id: course.raceTrackId, rotation: course.turn, ground_type: course.surface, distance: course.distance };
  if (key in staticValues) return compare(staticValues[key], op, value);
  if (!useGeometry) return null;
  const corners = course.corners.map(c => ({ start: c.start, end: c.start + c.length }));
  const last = corners[corners.length - 1];
  if (op === '==' && value === 1 && ['all_corner_random', 'corner_random'].includes(key)) return region(bounds, corners);
  if (key === 'is_finalcorner_random' && op === '==' && value === 1) return region(bounds, last ? [last] : []);
  if (key === 'is_finalcorner' && op === '==' && value === 1) return region(bounds, last ? [{ start: last.start, end: course.distance }] : []);
  if (key === 'corner' && value === 0 && (op === '==' || op === '!=')) {
    const inCorner = region(bounds, corners);
    return inCorner === null ? null : op === '!=' ? inCorner : !inCorner;
  }
  return null;
}
function condition(text: string, course: CourseReference, bounds: Bounds | null, useGeometry: boolean): Truth {
  if (!text.trim()) return true;
  const alternatives = text.split('@').map(group => {
    const terms = group.split('&').map(term => atom(term, course, bounds, useGeometry));
    return terms.includes(false) ? false : terms.every(v => v === true) ? true : null;
  });
  return alternatives.includes(true) ? true : alternatives.every(v => v === false) ? false : null;
}
function selectedBranch(skill: SkillReference, index: number) {
  return skill.branches.find((b, i) => (b.branchIndex ?? i) === index);
}
/** An optional inference from successful, branch-selected procs; never a decoded ID. */
export function inferCourse(race: Race, reference: ReferenceData | null): CourseInference | null {
  if (!reference || race.courseId !== null || race.distance === null || race.distance <= 0) return null;
  let byReference = cache.get(race);
  if (!byReference) { byReference = new WeakMap(); cache.set(race, byReference); }
  if (byReference.has(reference)) return byReference.get(reference)!;
  let candidates = Object.values(reference.courses).filter(c => c.distance === race.distance);
  const evidence: string[] = [];
  for (const event of race.events) {
    if ((event.type !== 3 && event.type !== 'skill') || event.params[2] === -1 && event.time !== 0) continue;
    const id = event.skillId ?? event.params[1], index = event.params[3];
    if (!Number.isInteger(id) || !Number.isInteger(index) || index < 0) continue;
    const skill = reference.metadata.skills[id], branch = skill && selectedBranch(skill, index);
    if (!branch) continue;
    const bounds = boundsAt(race, event);
    // Geometric conditions apply only to ordinary self effects, with a recorded
    // positive duration. Unknown recipient/special-effect semantics stay unknown.
    const useGeometry = event.time > 0 && event.params[2] > 0 && branch.effects.length > 0 && branch.effects.every(e => e.targetType === 1);
    const kept = candidates.filter(c => condition(branch.precondition ?? '', c, bounds, false) !== false
      && condition(branch.condition, c, bounds, useGeometry) !== false);
    if (kept.length === candidates.length) continue;
    const reason = `Recorded skill ${id}, branch ${index}, at ${event.time.toFixed(2)} s rules out incompatible course conditions${useGeometry && bounds ? ` using the full ${bounds.low.toFixed(1)}–${bounds.high.toFixed(1)} m observation bracket` : ''}.`;
    evidence.push(reason);
    candidates = kept;
    if (!candidates.length) { evidence.push('Recorded skill evidence conflicts with the reference candidates; no course is inferred.'); break; }
  }
  const tracks = new Set(candidates.map(c => c.raceTrackId));
  const result: CourseInference | null = evidence.length ? {
    courseId: candidates.length === 1 ? candidates[0].id : null,
    trackId: tracks.size === 1 ? candidates[0].raceTrackId : null,
    candidateCourseIds: candidates.map(c => c.id).sort((a, b) => a - b), evidence,
  } : null;
  byReference.set(reference, result);
  return result;
}
