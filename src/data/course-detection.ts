import identities from './course-identities.json';
import type { Race } from './types';
import type { ReferenceData } from './reference';

export function courseDistance(id: number | null): number | null {
  return id === null ? null : (identities.distances as Record<string, number>)[id] ?? null;
}
export function instanceCourse(id: number | null, reference?:ReferenceData|null): number | null {
  if(id===null||!Number.isSafeInteger(id)||id<=0)return null;
  const active=reference?.metadata.raceInstances?.[id];
  if(typeof active==='number'&&Number.isSafeInteger(active)&&active>0)return active;
  return (identities.raceInstances as Record<string, number>)[id] ?? null;
}
export function instanceConditions(id: number | null, reference?: ReferenceData | null): { grade?: number; time?: number } | null {
  if (id === null || !Number.isSafeInteger(id) || id <= 0) return null;
  const compiled = (identities as unknown as { raceInstanceConditions?: Record<string, { grade?: number; time?: number }> }).raceInstanceConditions;
  return reference?.metadata.raceInstanceConditions?.[id] ?? compiled?.[id] ?? null;
}
/** Public master joins supply only missing context; explicit captured values win. */
export function resolveRaceContext(race: Race, reference: ReferenceData | null): Race {
  const context = instanceConditions(race.courseIdentity?.raceInstanceId ?? null, reference);
  if (!context) return race;
  const grade = race.grade ?? context.grade, time = race.conditions?.timeOfDay ?? (context.time != null ? String(context.time) : null);
  if (grade === race.grade && time === race.conditions?.timeOfDay) return race;
  return { ...race, ...(grade != null ? { grade } : {}),
    ...(time != null ? { conditions: { weather: null, ground: null, season: null, ...race.conditions, timeOfDay: time } } : {}),
    conditionEvidence: { ...race.conditionEvidence, ...(race.grade == null && grade != null ? { grade: 'race-instance' as const } : {}), ...(race.conditions?.timeOfDay == null && time != null ? { timeOfDay: 'race-instance' as const } : {}) } };
}
/** Refresh a preserved public instance ID against active data without rewriting capture data. */
export function resolveCourseIdentity(race:Race,reference:ReferenceData|null):Race {
  race = resolveRaceContext(race, reference);
  if(race.courseId!==null)return race;
  const instance=race.courseIdentity?.raceInstanceId??null;
  const courseId=instanceCourse(instance,reference);
  if(courseId===null)return race;
  const distance=race.distance??reference?.courses[courseId]?.distance??courseDistance(courseId);
  return {...race,courseId,distance,
    courseIdentity:{...race.courseIdentity,source:race.courseIdentity?.source==='filename-race-instance'?'filename-race-instance':'race-instance'},
    ...(race.distance===null&&distance!==null?{distanceEvidence:'course-reference' as const}:{})};
}
/** Infer only the finish distance, never a venue. Replays continue after the finish. */
export function finishDistance(race: Pick<Race, 'runners' | 'frames'>): number | null {
  const distances = race.runners.flatMap(r => {
    const time = r.finishTimeRaw;
    if (time == null || time <= 0) return [];
    const index = race.frames.findIndex(f => f.time >= time);
    if (index < 1) return [];
    const a = race.frames[index - 1], b = race.frames[index];
    const da = a.runners.find(s => s.runnerId === r.id)?.distance;
    const db = b.runners.find(s => s.runnerId === r.id)?.distance;
    if (da == null || db == null) return [];
    const distance = da + (db - da) * (time - a.time) / (b.time - a.time);
    return Number.isFinite(distance) ? [distance] : [];
  }).sort((a, b) => a - b);
  if (!distances.length) return null;
  const median = distances[Math.floor(distances.length / 2)], rounded = Math.round(median / 100) * 100;
  return rounded >= 100 && rounded <= 10000 && distances.every(d => Math.abs(d - rounded) <= 5) ? rounded : null;
}
