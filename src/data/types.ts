/** All times are seconds, distances metres, speeds metres/second, lanes a raw/10000 fraction.
 * HP is the recorded simulation value, not a percentage. Missing observations remain null. */
export interface RunnerSample {
  runnerId: string;
  distance: number | null;
  speed: number | null;
  hp: number | null;
  lane: number | null;
  /** Discrete recorded state. 0 = no rushed mode; 1–4 follow the game's enum. */
  temptationMode?: number | null;
  /** Zero-based simulation slot; -1 = recorded no front block; null = unknown. */
  blockFrontRunnerIndex?: number | null;
}
export interface Frame { time: number; runners: RunnerSample[] }
export interface RunnerStats { speed: number | null; stamina: number | null; power: number | null; guts: number | null; wisdom: number | null }
export interface RunnerSkill { id: number; level: number | null }
export type RaceCategory = 'career' | 'team-trials' | 'practice' | 'champions-meeting' | 'other';
export interface RunnerAptitudes {
  turf?: number | string | null; dirt?: number | string | null;
  short?: number | string | null; mile?: number | string | null; middle?: number | string | null; long?: number | string | null;
  front?: number | string | null; pace?: number | string | null; late?: number | string | null; end?: number | string | null;
}
export interface Runner {
  id: string;
  index: number;
  gate: number | null;
  name: string;
  charaId: number | null;
  cardId: number | null;
  trainer: string | null;
  /** Account id captured on the horse; displayed with the trainer, never used as a secret. */
  trainerId?: string | null;
  strategy: string | null;
  /** One based, unlike the zero based value in the binary scenario. */
  finishOrder: number | null;
  finishTime: number | null;
  /** Actual simulation finish seconds. finishTime may be the game's scaled display time. */
  finishTimeRaw?: number | null;
  startDelay?: number | null;
  /** The recorded finishDiffTime field, in seconds; not a reconstructed distance gap. */
  finishGap?: number | null;
  /** Metres; -1 is the explicit no-spurt sentinel. */
  lastSpurtDistance?: number | null;
  stats?: RunnerStats;
  skills?: RunnerSkill[];
  /** Original aptitude rank codes or letters, with no inferred defaults. */
  aptitudes?: RunnerAptitudes;
  strategyCode?: number | null;
  /** Public pre-race popularity rank; never a trainer/account identifier. */
  popularity?: number | null;
  /** Anonymous within-race team ordinal, remapped from raw team membership. */
  teamGroup?: number | null;
  /** Sum of raw stats for the current racing team. Used by Spirit / valueUsage 3–7. */
  teamStatTotals?: RunnerStats;
  /** Explicit NPC/player class only; no viewer/owner identifier is retained. */
  isNpc?: boolean | null;
  /** Original game's motivation code, not a simulator mood conversion. */
  mood?: number | null;
  raceWinCount?: number | null;
  fanCount?: number | null;
  starCount?: number | null;
  rankScore?: number | null;
  gutsOrder?: number | null;
  wisdomOrder?: number | null;
  defeatFlags?: number | null;
}
export interface RaceEvent {
  time: number;
  type: number | string;
  runnerId: string | null;
  skillId: number | null;
  label: string;
  params: number[];
}
export interface Race {
  /** View projection only. Original captures never acquire this marker. */
  analysisSource?: 'simulation'|'recorded';
  id: string;
  title: string;
  source: 'horseact' | 'response' | 'normalized' | 'demo';
  sourceLabel: string;
  distance: number | null;
  duration: number;
  courseId: number | null;
  runners: Runner[];
  frames: Frame[];
  events: RaceEvent[];
  warnings: string[];
  synthetic: boolean;
  /** Original enum codes or strings, without guessing an enum mapping. */
  conditions?: { weather: string | null; ground: string | null; season: string | null; timeOfDay?: string | null };
  grade?: number | null;
  conditionEvidence?: { grade?: 'recorded' | 'race-instance'; timeOfDay?: 'recorded' | 'race-instance' };
  laneDistanceMax?: number | null;
  category?: RaceCategory;
  capturedAt?: string;
  /** When the race was run. Legacy game clocks omit their UTC suffix; local display converts them without changing the stored evidence. */
  racedAt?: string;
  racedAtSource?: 'game' | 'capture';
  savedReplay?: boolean;
  /** Practice and room matches share the practice analysis category. */
  raceMode?: 'practice' | 'room';
  raceDesignation?: 'practice-live' | 'practice-saved' | 'room-live' | 'room-saved';
  capture?: { endpointGroup?: RaceCategory; categorySource?: 'endpoint' | 'content' | 'unknown'; courseSource?: 'room-response' };
  /** Original values and provenance; display racedAt is never eligibility evidence. */
  originalRace?: Record<string, unknown>;
  courseIdentity?: { source: 'recorded' | 'race-instance' | 'filename-race-instance' | 'manual' | 'skill-conditions' | 'unknown'; raceInstanceId?: number };
  distanceEvidence?: 'recorded' | 'course-reference' | 'finish-derived';
  /** Simulation random seed, never an account/session identifier. */
  randomSeed?: number;
  /** horseACT-shaped start/result payload retained for re-export. */
  raw?: RaceRaw;
}

/** Live RaceInfo fields observed on the same race response. Auth/session envelopes are omitted. */
export interface RaceRaw {
  simDataBase64: string;
  raceDistance?: number;
  raceCourseAliases?: Record<string, unknown>;
  raceDistanceAliases?: Record<string, unknown>;
  raceHorse?: unknown[];
  raceCourseSet?: unknown;
  trainedCharaArray?: unknown[];
  randomSeed?: number;
  weather?: string;
  groundCondition?: string;
  season?: string;
  raceType?: string;
  raceGrade?: number;
  startTimeType?: number;
  raceInstanceId?: number;
  distance?: number;
  laneDistanceMax?: number;
  horseACT_version?: string;
}

/** Event param[0] and block indexes are simulation slots, stored on Runner.index.
 * Import assigns that slot from runner order, so it can differ from a later array position. */
export function runnerBySlot(runners: readonly Runner[], slot: number): Runner | undefined {
  if (!Number.isInteger(slot) || slot < 0) return undefined;
  return runners.find(runner => runner.index === slot);
}
