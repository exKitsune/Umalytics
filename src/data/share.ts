import type { Race } from './types';
import { portableRawFields } from './raw-export';

/** Construct a race-only document. Never spread API/log objects into an export. */
export function toShareableRace(race: Race) {
  const ids = new Map(race.runners.map((runner, index) => [runner.id, `runner-${index + 1}`]));
  return {
    schemaVersion: 1,
    id: 'shared-race',
    title: race.synthetic ? 'Synthetic demonstration' : 'Shared race',
    synthetic: race.synthetic,
    distance: race.distance,
    courseId: race.courseId,
    conditions: race.conditions ? {
      weather: race.conditions.weather, ground: race.conditions.ground, season: race.conditions.season,
      timeOfDay: race.conditions.timeOfDay,
    } : undefined,
    laneDistanceMax: race.laneDistanceMax,
    runners: race.runners.map(r => ({
      id: ids.get(r.id), gate: r.gate, name: r.name, charaId: r.charaId, cardId: r.cardId,
      strategy: r.strategy, finishOrder: r.finishOrder, finishTime: r.finishTime,
      finishTimeRaw: r.finishTimeRaw, startDelay: r.startDelay, finishGap: r.finishGap,
      lastSpurtDistance: r.lastSpurtDistance,
      stats: r.stats ? { speed: r.stats.speed, stamina: r.stats.stamina, power: r.stats.power, guts: r.stats.guts, wisdom: r.stats.wisdom } : undefined,
      skills: r.skills?.map(s => ({ id: s.id, level: s.level })),
      aptitudes: r.aptitudes ? {
        turf: r.aptitudes.turf, dirt: r.aptitudes.dirt, short: r.aptitudes.short, mile: r.aptitudes.mile,
        middle: r.aptitudes.middle, long: r.aptitudes.long, front: r.aptitudes.front,
        pace: r.aptitudes.pace, late: r.aptitudes.late, end: r.aptitudes.end,
      } : undefined,
      strategyCode: r.strategyCode, mood: r.mood, raceWinCount: r.raceWinCount,
      fanCount: r.fanCount, starCount: r.starCount, rankScore: r.rankScore,
      gutsOrder: r.gutsOrder, wisdomOrder: r.wisdomOrder, defeatFlags: r.defeatFlags,
      popularity: r.popularity, teamGroup: r.teamGroup, isNpc: r.isNpc,
    })),
    frames: race.frames.map(f => ({ time: f.time, runners: f.runners.map(s => ({
      runnerId: ids.get(s.runnerId), distance: s.distance, speed: s.speed, hp: s.hp, lane: s.lane,
      temptationMode: s.temptationMode, blockFrontRunnerIndex: s.blockFrontRunnerIndex,
    })) })),
    events: race.events.map(e => ({ time: e.time, type: e.type,
      runnerId: e.runnerId ? ids.get(e.runnerId) : null,
      skillId: e.skillId, label: e.label, params: [],
    })),
    warnings: ['Shared export: trainer fields and original identifiers omitted.'],
    category: race.category,
    capturedAt: race.capturedAt,
    racedAt: race.racedAt,
    racedAtSource: race.racedAtSource,
    savedReplay: race.raceDesignation ? race.savedReplay === true : race.savedReplay,
    raceMode: race.raceMode,
    raceDesignation: race.raceDesignation,
    courseIdentity: race.courseIdentity ? { source: race.courseIdentity.source, raceInstanceId: race.courseIdentity.raceInstanceId } : undefined,
    distanceEvidence: race.distanceEvidence,
    grade: race.grade, conditionEvidence: race.conditionEvidence ? { grade: race.conditionEvidence.grade, timeOfDay: race.conditionEvidence.timeOfDay } : undefined,
    capture: race.capture ? { endpointGroup: race.capture.endpointGroup, categorySource: race.capture.categorySource } : undefined,
  };
}

/** Portable normalized race document retaining all supported telemetry and metadata. */
export function toPortableRace(race: Race) {
  const shared = toShareableRace(race);
  return {
    ...shared,
    title: race.title,
    randomSeed: race.randomSeed,
    events: race.events.map(e => ({ time: e.time, type: e.type,
      runnerId: e.runnerId ? `runner-${race.runners.findIndex(r => r.id === e.runnerId) + 1}` : null,
      skillId: e.skillId, label: e.label, params: e.params.slice(),
    })),
    warnings: race.warnings.slice(),
    runners: race.runners.map((r, index) => ({
      ...shared.runners[index],
      trainer: r.trainer,
      trainerId: r.trainerId,
    })),
    ...portableRawFields(race),
  };
}

export function toPortableRaces(races: Race[]) {
  return { schemaVersion: 1, races: races.map(toPortableRace) };
}
