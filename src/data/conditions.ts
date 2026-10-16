import type { Race } from './types';
import type { ReferenceData } from './reference';
/** Global API numeric enums; legacy horseACT string labels stay unchanged. */
export function conditionLabels(race: Race): { weather: string; ground: string; season: string } {
  const label = (raw: string | null | undefined, names: Record<string, string>, fallback: string) => raw == null ? fallback : names[raw] ?? raw;
  return {
    weather: label(race.conditions?.weather, { 1: 'Sunny', 2: 'Cloudy', 3: 'Rainy', 4: 'Snowy' }, 'Unknown weather'),
    ground: label(race.conditions?.ground, { 1: 'Firm', 2: 'Good', 3: 'Soft', 4: 'Heavy' }, 'Unknown ground'),
    season: label(race.conditions?.season, { 1: 'Spring', 2: 'Summer', 3: 'Autumn', 4: 'Winter', 5: 'Spring' }, 'Unknown season'),
  };
}
export function raceTitle(race: Race, reference: ReferenceData | null): string {
  const course = race.courseId === null ? null : reference?.courses[race.courseId];
  return course ? course.name : race.distance === null ? 'Unknown course' : `${race.distance} m · Course unknown`;
}
