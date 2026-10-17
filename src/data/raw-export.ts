import type { Race, RaceCategory, RaceRaw } from './types';

const MAX_SCENARIO_CHARS = 16 * 1024 * 1024;
const MAX_DEPTH = 16;
const MAX_VISITS = 50_000;
const MAX_ARRAY = 2_000;
const MAX_HORSES = 64;
const categoryRaceType: Partial<Record<RaceCategory, string>> = {
  career: 'Single', 'team-trials': 'TeamStadium', practice: 'RoomMatch', 'champions-meeting': 'Champions',
};
const ENVELOPE = new Set([
  'auth', 'auth_data', 'auth_key', 'authentication', 'headers', 'request', 'requests',
  'request_headers', 'request_body', 'session', 'device', 'user_info', 'trainer_info',
]);
const RAW_KEYS = [
  'randomSeed', 'weather', 'groundCondition', 'season', 'raceType', 'raceGrade',
  'startTimeType', 'raceInstanceId', 'distance', 'laneDistanceMax', 'horseACT_version',
] as const;

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const string = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const pick = (obj: RecordValue, ...keys: string[]): unknown => { for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) return obj[key]; return undefined; };

export interface RawFinish {
  finishOrder: number | null;
  finishTime: number | null;
  finishTimeRaw: number | null;
  startDelay: number | null;
  lastSpurtDistance: number | null;
}

function copyValue(value: unknown, depth: number, visits: { count: number }): unknown {
  if (++visits.count > MAX_VISITS || depth > MAX_DEPTH) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.length <= MAX_SCENARIO_CHARS ? value : undefined;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) return undefined;
    return value.map(item => copyValue(item, depth + 1, visits)).filter(item => item !== undefined);
  }
  const obj = record(value);
  if (!Object.keys(obj).length) return undefined;
  const result: RecordValue = {};
  for (const [key, child] of Object.entries(obj)) {
    if (ENVELOPE.has(key)) continue;
    const copied = copyValue(child, depth + 1, visits);
    if (copied !== undefined) result[key] = copied;
  }
  return Object.keys(result).length ? result : undefined;
}

function trainedId(value: RecordValue): number | null {
  for (const key of ['trained_chara_id', 'trainedCharaId', 'id']) {
    const raw = number(value[key]);
    if (raw !== null && Number.isSafeInteger(raw) && raw > 0) return raw;
  }
  return null;
}

function attachTrained(horses: unknown[], trained: unknown[]): unknown[] {
  const byId = new Map<number, unknown>();
  for (const item of trained) {
    const obj = record(item);
    const id = trainedId(obj);
    if (id !== null) byId.set(id, item);
  }
  return horses.map(member => {
    const horse = record(member);
    if (horse.trained_chara_data || horse.trainedCharaData) return member;
    const nested = record(horse.responseHorseData);
    const id = trainedId(horse) ?? trainedId(nested);
    return id !== null && byId.has(id) ? { ...horse, trained_chara_data: byId.get(id) } : member;
  });
}

function writeRaw(target: RaceRaw): RecordValue {
  return target as unknown as RecordValue;
}

function copyScalar(target: RaceRaw, obj: RecordValue, key: keyof RaceRaw, ...aliases: string[]) {
  const raw = pick(obj, key, ...aliases);
  if (raw === undefined) return;
  if (key === 'weather' || key === 'groundCondition' || key === 'season' || key === 'raceType' || key === 'horseACT_version') {
    const text = string(raw) ?? (number(raw) === null ? null : String(raw));
    if (text && text.length <= 64) writeRaw(target)[key] = text;
    return;
  }
  const n = number(raw);
  if (n !== null) writeRaw(target)[key] = n;
}

function wrapHorse(member: unknown, result?: RawFinish): RecordValue {
  const obj = record(member);
  const name = string(pick(obj, 'charaName', 'chara_name', 'name'));
  const trained = pick(obj, 'trained_chara_data', 'trainedCharaData');
  return {
    ...(name ? { charaName: name } : {}),
    ...(result?.finishOrder != null ? { finishOrder: result.finishOrder - 1 } : {}),
    ...(result?.finishTime != null ? { finishTime: result.finishTime } : {}),
    ...(result?.finishTimeRaw != null ? { finishTimeRaw: result.finishTimeRaw } : {}),
    ...(result?.startDelay != null ? { startDelay: result.startDelay } : {}),
    ...(result?.lastSpurtDistance != null ? { lastSpurtDistance: result.lastSpurtDistance } : {}),
    responseHorseData: obj,
    ...(trained !== undefined ? { trained_chara_data: trained } : {}),
  };
}

export function sanitizeRaceRaw(raw: RaceRaw): RaceRaw | undefined {
  if (typeof raw.simDataBase64 !== 'string' || !raw.simDataBase64 || raw.simDataBase64.length > MAX_SCENARIO_CHARS) return undefined;
  const cleaned = copyValue({ ...raw, simDataBase64: raw.simDataBase64 }, 0, { count: 0 });
  const obj = record(cleaned);
  if (typeof obj.simDataBase64 !== 'string') return undefined;
  const result: RaceRaw = { simDataBase64: obj.simDataBase64 };
  if (Array.isArray(obj.raceHorse)) result.raceHorse = obj.raceHorse.slice(0, MAX_HORSES);
  if (obj.raceCourseSet !== undefined) result.raceCourseSet = obj.raceCourseSet;
  if (Array.isArray(obj.trainedCharaArray)) result.trainedCharaArray = obj.trainedCharaArray.slice(0, MAX_HORSES);
  for (const key of RAW_KEYS) {
    if (obj[key] !== undefined) writeRaw(result)[key] = obj[key];
  }
  return result;
}

export function extractSanitizedRaw(source: Record<string, unknown>, scenario: string, options: {
  horseact: boolean;
  horses: unknown[];
  course: unknown;
  results?: RawFinish[];
  category?: RaceCategory;
} ): RaceRaw | undefined {
  const obj = record(source);
  const horses = options.horses.slice(0, MAX_HORSES);
  const trained = [obj.trainedCharaArray, obj.trained_chara_array, obj.trained_chara_data_array]
    .find((value): value is unknown[] => Array.isArray(value))?.slice(0, MAX_HORSES) ?? [];
  let wrapped = options.horseact ? horses : horses.map(member => {
    const frameOrder = number(pick(record(member), 'frame_order', 'frameOrder'));
    const result = frameOrder !== null && options.results && frameOrder >= 1 && frameOrder <= options.results.length ? options.results[frameOrder - 1] : undefined;
    return wrapHorse(member, result);
  });
  if (trained.length) wrapped = attachTrained(wrapped, trained);
  const course = record(options.course);
  const courseId = number(pick(course, 'id', 'Id', 'course_id', 'courseId') ?? (typeof options.course === 'number' ? options.course : null));
  const draft: RaceRaw = { simDataBase64: scenario };
  if (wrapped.length) draft.raceHorse = wrapped;
  if (Object.keys(course).length) draft.raceCourseSet = course;
  else if (courseId !== null) draft.raceCourseSet = { id: courseId };
  if (trained.length) draft.trainedCharaArray = trained;
  copyScalar(draft, obj, 'randomSeed', 'random_seed', 'RandomSeed');
  copyScalar(draft, obj, 'weather', 'Weather');
  copyScalar(draft, obj, 'groundCondition', 'ground_condition', 'GroundCondition');
  copyScalar(draft, obj, 'season', 'Season');
  copyScalar(draft, obj, 'raceType', 'race_type');
  copyScalar(draft, obj, 'raceGrade', 'race_grade', 'RaceGrade');
  copyScalar(draft, obj, 'startTimeType', 'start_time_type', 'StartTimeType');
  copyScalar(draft, obj, 'raceInstanceId', 'race_instance_id', 'RaceInstanceId');
  copyScalar(draft, obj, 'distance', 'race_distance');
  copyScalar(draft, obj, 'laneDistanceMax', 'lane_distance_max', 'LaneDistanceMax');
  copyScalar(draft, obj, 'horseACT_version');
  if (!draft.raceType && options.category && categoryRaceType[options.category]) draft.raceType = categoryRaceType[options.category];
  if (typeof draft.raceCourseSet === 'object' && draft.raceCourseSet && draft.distance != null && number(record(draft.raceCourseSet).distance) === null) {
    (draft.raceCourseSet as RecordValue).distance = draft.distance;
  }
  return sanitizeRaceRaw(draft);
}

export function portableRawFields(race: Race): RaceRaw | undefined {
  return race.raw ? sanitizeRaceRaw(race.raw) : undefined;
}
