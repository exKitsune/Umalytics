import type { Race, Runner, RunnerAptitudes } from './types';
import { getCourse, type ReferenceData } from './reference';

export const UMALATOR_URL = 'https://umalator.app/umalator-global/';
export const UMALATOR_SCHEMA_SOURCE = 'https://github.com/TheCing/uma-tools/blob/5ce95905fef753a33f7519b5559a86e92f5d56cc/umalator-global/v2/storage.ts';
export interface UmalatorUma {
  outfitId: string; starCount: number; uniqueLv?: number;
  speed: number; stamina: number; power: number; guts: number; wisdom: number;
  strategy: string; distanceAptitude: string; surfaceAptitude: string;
  strategyAptitude: string; mood: number; skills: string[];
  forcedSkillPositions: Record<string, string>;
}
export interface UmalatorExport { payload: UmalatorUma | null; json: string | null; missing: string[]; warnings: string[] }
const rankLetters = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];
export function aptitudeLetter(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value)) return rankLetters[value - 1] ?? null;
  if (typeof value === 'string') {
    const upper = value.trim().toUpperCase();
    if (rankLetters.includes(upper)) return upper;
    if (/^[1-8]$/.test(upper)) return rankLetters[Number(upper) - 1];
  }
  return null;
}
const strategies: Record<string, { name: string; key: keyof RunnerAptitudes }> = {
  '1': { name: 'Nige', key: 'front' }, '2': { name: 'Senkou', key: 'pace' },
  '3': { name: 'Sasi', key: 'late' }, '4': { name: 'Oikomi', key: 'end' },
  Nige: { name: 'Nige', key: 'front' }, Senkou: { name: 'Senkou', key: 'pace' },
  Sasi: { name: 'Sasi', key: 'late' }, Oikomi: { name: 'Oikomi', key: 'end' },
  Oonige: { name: 'Oonige', key: 'front' },
  'Front Runner': { name: 'Nige', key: 'front' }, 'Pace Chaser': { name: 'Senkou', key: 'pace' },
  'Late Surger': { name: 'Sasi', key: 'late' }, 'End Closer': { name: 'Oikomi', key: 'end' },
};
/** Course-specific aptitudes are selected from the recorded grades. No best-grade,
 * neutral mood, default stats or default unique level is substituted. */
export function buildUmalatorExport(runner: Runner, race: Race, reference: ReferenceData | null): UmalatorExport {
  const missing: string[] = [], warnings: string[] = [];
  const course = getCourse(reference, race.courseId);
  const strategy = strategies[String(runner.strategyCode ?? runner.strategy ?? '')];
  if (!strategy) missing.push('running style');
  if (!course) missing.push('course');
  if (course && race.distance !== null && course.distance !== race.distance) missing.push('matching course distance');
  const distance = course?.distance;
  const distanceKey: keyof RunnerAptitudes | null = distance === undefined ? null :
    distance <= 1400 ? 'short' : distance <= 1800 ? 'mile' : distance < 2500 ? 'middle' : 'long';
  const surfaceKey: keyof RunnerAptitudes | null = course?.surface === 1 ? 'turf' : course?.surface === 2 ? 'dirt' : null;
  const distanceAptitude = distanceKey ? aptitudeLetter(runner.aptitudes?.[distanceKey]) : null;
  const surfaceAptitude = surfaceKey ? aptitudeLetter(runner.aptitudes?.[surfaceKey]) : null;
  const strategyAptitude = strategy ? aptitudeLetter(runner.aptitudes?.[strategy.key]) : null;
  if (!distanceAptitude) missing.push(`${distanceKey ?? 'distance'} aptitude`);
  if (!surfaceAptitude) missing.push(`${surfaceKey ?? 'surface'} aptitude`);
  if (!strategyAptitude) missing.push(`${strategy?.key ?? 'strategy'} aptitude`);
  for (const key of ['speed', 'stamina', 'power', 'guts', 'wisdom'] as const) {
    const value = runner.stats?.[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 2000)
      missing.push(`${key} stat in the simulator's supported 1–2000 range`);
  }
  const mood = runner.mood;
  if (typeof mood !== 'number' || !Number.isInteger(mood) || mood < 1 || mood > 5) missing.push('mood');
  if (!Array.isArray(runner.skills)) missing.push('owned skills');
  if (runner.cardId === null || !Number.isInteger(runner.cardId) || runner.cardId <= 0) missing.push('outfit/card ID');
  if (typeof runner.starCount !== 'number' || !Number.isInteger(runner.starCount) || runner.starCount < 1 || runner.starCount > 5)
    missing.push('star count');
  const outfitId = runner.cardId === null ? '' : String(runner.cardId);
  const card = outfitId;
  const uniqueId = String(10000 * (1 + 9 * Number((runner.starCount ?? 0) > 2)) +
    10000 * (Number(card.slice(-2)) - 1) + Number(card.slice(1, -2)) * 10 + 1);
  const unique = runner.skills?.find(s => String(s.id) === uniqueId);
  let uniqueLv: number | undefined;
  if (reference?.simulatorSkillIds.has(uniqueId)) {
    if (!unique || unique.level === null || !Number.isInteger(unique.level) || unique.level < 1 || unique.level > 6)
      missing.push('unique skill level');
    else uniqueLv = unique.level;
  }
  const skills = runner.skills?.map(s => String(s.id)) ?? [];
  const unsupported = reference ? skills.filter(id => !reference.simulatorSkillIds.has(id)) : [];
  if (unsupported.length) warnings.push(`Umalator will skip these skill IDs: ${unsupported.join(', ')}.`);
  if (runner.skills?.some(s => s.level !== null && s.level > 1 && String(s.id) !== uniqueId))
    warnings.push('Umalator keeps the outfit unique level. Copy Uma JSON to keep all skill levels.');
  warnings.push('Set the course and conditions in Umalator.');
  if (missing.length) return { payload: null, json: null, missing, warnings };
  const payload: UmalatorUma = { outfitId, starCount: runner.starCount!,
    ...(uniqueLv === undefined ? {} : { uniqueLv }),
    speed: runner.stats!.speed!, stamina: runner.stats!.stamina!, power: runner.stats!.power!,
    guts: runner.stats!.guts!, wisdom: runner.stats!.wisdom!,
    strategy: strategy.name, distanceAptitude: distanceAptitude!, surfaceAptitude: surfaceAptitude!,
    strategyAptitude: strategyAptitude!, mood: mood! - 3, skills, forcedSkillPositions: {} };
  return { payload, json: JSON.stringify(payload, null, 2), missing, warnings };
}
/** Lossless runner build transfer independent of any simulator's narrower schema.
 * Account/trainer identity and recorded race samples are deliberately excluded. */
export function portableUmaJson(runner: Runner, race: Race): string {
  return JSON.stringify({ format: 'umatrace-uma', version: 1,
    charaId: runner.charaId, cardId: runner.cardId, name: runner.name,
    strategy: runner.strategy, strategyCode: runner.strategyCode ?? null,
    stats: runner.stats ?? null, skills: runner.skills ?? null,
    aptitudes: runner.aptitudes ?? null, motivation: runner.mood ?? null,
    starCount: runner.starCount ?? null, raceWinCount: runner.raceWinCount ?? null,
    fanCount: runner.fanCount ?? null, courseId: race.courseId,
    conditions: race.conditions ?? null,
    missing: ['stats', 'skills', 'aptitudes', 'mood', 'starCount'].filter(key =>
      runner[key as keyof Runner] === undefined || runner[key as keyof Runner] === null),
  }, null, 2);
}

