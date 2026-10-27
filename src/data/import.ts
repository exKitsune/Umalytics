import {raceTimestamp} from './race-time';
/* Key mappings informed by SSHZ.ORG replay reference (MIT). See THIRD_PARTY_LICENSE.txt. */
import { decode } from '@msgpack/msgpack';
import { base64Bytes, MAX_FILE_BYTES, MAX_FRAMES, MAX_RUNNERS, MAX_SAMPLES, parseScenario } from './binary';
import { courseDistance, finishDistance, instanceCourse, instanceConditions } from './course-detection';
import { careerForHorse, parseCareer } from './career';
import { extractSanitizedRaw, copyOriginalRace } from './raw-export';
import { attachTeamStatTotals } from './race-teams';
import { runnerBySlot, type Frame, type Race, type RaceCategory, type RaceEvent, type Runner, type RunnerAptitudes, type RunnerSample, type RunnerSkill, type RunnerStats } from './types';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array) ? value as RecordValue : {};
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const string = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const trainerIdentity = (value: unknown): string | null => {
  const parsed = number(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? String(parsed) : string(value);
};
const pick = (obj: RecordValue, ...keys: string[]): unknown => { for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) return obj[key]; return undefined; };
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const strategyNames: Record<number, string> = { 1: 'Front Runner', 2: 'Pace Chaser', 3: 'Late Surger', 4: 'End Closer', 5: 'Runaway' };
const emptySample = (runnerId: string): RunnerSample => ({ runnerId, distance: null, speed: null, hp: null, lane: null });
const nextId = (index: number) => `race-${index + 1}`;
function boundedInteger(raw: unknown, min: number, max: number): number | null { const n = number(raw); return n !== null && Number.isSafeInteger(n) && n >= min && n <= max ? n : null; }
function npcClass(member: RecordValue): boolean | null {
  const explicit = pick(member, 'is_npc', 'isNpc', 'IsNpc');
  if (typeof explicit === 'boolean') return explicit;
  // Installed RaceDefine.RaceNpcType constants. Ghost/Follow classification is
  // deliberately unresolved; chara_id/mob_id and viewer IDs are not substitutes.
  const code = pick(member, 'npc_type', 'npcType', 'NpcType');
  return code === 0 || code === 3 ? true : code === 11 || code === 20 ? false : null;
}
/** Team identifiers are discarded after assigning stable within-race ordinals. */
function teamGroups(members: RecordValue[], fieldCount: number, normalized = false): Map<RecordValue, number> {
  const groups = new Map<string, number>(), result = new Map<RecordValue, number>();
  for (const member of members) {
    const anonymous = boundedInteger(pick(member, normalized ? 'teamGroup' : 'team_group', 'teamGroup'), 1, fieldCount);
    if (anonymous !== null) {
      if (normalized) result.set(member, anonymous);
      else { const key = `anonymous:${anonymous}`; if (!groups.has(key)) groups.set(key, groups.size + 1); result.set(member, groups.get(key)!); }
      continue;
    }
    if (normalized) continue;
    const raw = boundedInteger(pick(member, 'team_id', 'teamId', 'TeamId'), 1, Number.MAX_SAFE_INTEGER);
    if (raw === null) continue;
    const key = `raw:${raw}`; if (!groups.has(key)) groups.set(key, groups.size + 1);
    result.set(member, groups.get(key)!);
  }
  return result;
}
const categories: RaceCategory[] = ['career', 'team-trials', 'practice', 'champions-meeting', 'league-of-heroes', 'other'];
const category = (value: unknown): RaceCategory | undefined => categories.includes(value as RaceCategory) ? value as RaceCategory : undefined;
const aptitudeFields: Record<keyof RunnerAptitudes, string> = {
  turf: 'proper_ground_turf', dirt: 'proper_ground_dirt', short: 'proper_distance_short',
  mile: 'proper_distance_mile', middle: 'proper_distance_middle', long: 'proper_distance_long',
  front: 'proper_running_style_nige', pace: 'proper_running_style_senko',
  late: 'proper_running_style_sashi', end: 'proper_running_style_oikomi',
};

function parseAptitudes(obj: RecordValue, normalized = false): RunnerAptitudes | undefined {
  const values = Object.entries(aptitudeFields).flatMap<[string, number | string | null]>(([key, rawKey]) => {
    const value = obj[normalized ? key : rawKey];
    const rank = number(value) ?? (typeof value === 'string' && /^[SABCDEFG]$/.test(value) ? value : null);
    return value === null ? [[key, null]] : rank !== null ? [[key, rank]] : [];
  });
  return values.length ? Object.fromEntries(values) : undefined;
}

function raceClock(value: unknown) {
  const text = string(value);
  if (!text || text.length > 40) return undefined;
  const clock=text.replace(' ','T');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(clock)&&Number.isFinite(raceTimestamp(clock).getTime())?clock:undefined;
}

function raceDesignation(mode: unknown, saved: boolean, explicit: unknown): Race['raceDesignation'] {
  const named = explicit === 'practice-live' || explicit === 'practice-saved' || explicit === 'room-live' || explicit === 'room-saved' ? explicit : undefined;
  if (named) return named;
  if (mode === 'practice') return saved ? 'practice-saved' : 'practice-live';
  if (mode === 'room') return saved ? 'room-saved' : 'room-live';
  return undefined;
}

function captureFields(obj: RecordValue): Pick<Race, 'category' | 'capturedAt' | 'racedAt' | 'racedAtSource' | 'savedReplay' | 'raceMode' | 'raceDesignation' | 'capture' | 'originalRace'> {
  const provenance = record(obj.capture ?? record(obj.metadata).umaTrace);
  const endpointGroup = category(provenance.endpointGroup);
  const categorySource = provenance.categorySource;
  const capturedAt = string(obj.capturedAt ?? obj.captured_at);
  const racedAt = raceClock(obj.racedAt ?? obj.raced_at);
  const racedAtSource = obj.racedAtSource ?? obj.raced_at_source;
  const raceMode = obj.raceMode ?? obj.race_mode;
  const savedReplay = obj.savedReplay === true || obj.saved_replay === true;
  const designation = raceDesignation(raceMode, savedReplay, obj.raceDesignation ?? obj.race_designation);
  return {
    ...(category(obj.category ?? obj.race_category) ? { category: category(obj.category ?? obj.race_category) } : {}),
    ...(capturedAt && capturedAt.length <= 64 && /^\d{4}-\d\d-\d\dT/.test(capturedAt) && Number.isFinite(Date.parse(capturedAt)) ? { capturedAt } : {}),
    ...(racedAt ? { racedAt } : {}),
    ...(racedAtSource === 'game' || racedAtSource === 'capture' ? { racedAtSource } : {}),
    ...(savedReplay || designation ? { savedReplay } : {}),
    ...(raceMode === 'practice' || raceMode === 'room' ? { raceMode } : {}),
    ...(designation ? { raceDesignation: designation } : {}),
    originalRace: copyOriginalRace(obj.originalRace ?? obj.original_race),
    capture: { ...(endpointGroup ? {endpointGroup} : {}),
      ...(categorySource === 'endpoint' || categorySource === 'content' || categorySource === 'unknown' ? {categorySource} : {}),
      ...(provenance.courseSource === 'room-response' ? {courseSource: 'room-response' as const} : {}) },
  };
}

function importCategory(obj: RecordValue, endpoint?: unknown): RaceCategory | undefined {
  const explicit = category(obj.category ?? obj.race_category);
  if (explicit) return explicit;
  const groups: Record<string, RaceCategory> = { single_mode: 'career', single_mode_free: 'career',
    team_stadium: 'team-trials', team_race: 'team-trials', room_match: 'practice', practice: 'practice',
    practice_race: 'practice', champions: 'champions-meeting', champions_meeting: 'champions-meeting', heroes: 'league-of-heroes', league_of_heroes: 'league-of-heroes', LeagueOfHeroes: 'league-of-heroes' };
  const path = typeof endpoint === 'string' ? endpoint.split('?')[0].replace(/^\/\x75mamusume\//, '').replace(/^\//, '') : '';
  return groups[path.split('/')[0]] ?? (typeof obj.race_type === 'string' ? category(obj.race_type) ?? groups[obj.race_type] : undefined);
}

function parseStats(obj: RecordValue): RunnerStats | undefined {
  const stats: RunnerStats = { speed: number(obj.speed), stamina: number(obj.stamina), power: number(obj.power ?? obj.pow), guts: number(obj.guts), wisdom: number(obj.wisdom ?? obj.wiz) };
  return Object.values(stats).some(n => n !== null) ? stats : undefined;
}

function parseSkills(value: unknown): RunnerSkill[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length > 1000) throw new Error('Runner skill list exceeds the 1,000 skill limit.');
  return value.flatMap(item => {
    const obj = record(item);
    const id = number(typeof item === 'number' ? item : pick(obj, 'id', 'skill_id', 'skillId'));
    if (id === null || !Number.isSafeInteger(id) || id <= 0) return [];
    const level = number(obj.level);
    return [{ id, level: level !== null && level > 0 ? level : null }];
  });
}

function conditionText(value: unknown): string | null {
  return string(value) ?? (number(value) === null ? null : String(value));
}

/** Numeric context from the declared saved-room sibling, never room/player or runner fields. */
function savedRaceMetadata(value: unknown): RecordValue {
  const saved = record(value);
  if (Object.keys(saved).length > 1000) throw new Error('Saved-room result exceeds the 1,000 field limit.');
  const fields: Record<string, string[]> = {
    race_instance_id: ['race_instance_id', 'raceInstanceId', 'RaceInstanceId'],
    race_course_id: ['race_course_id', 'raceCourseId'], course_id: ['course_id', 'courseId', 'CourseId'],
    distance: ['distance'], race_distance: ['race_distance', 'raceDistance'],
    lane_distance_max: ['lane_distance_max', 'laneDistanceMax'], random_seed: ['random_seed', 'randomSeed'],
    season: ['season'], weather: ['weather'], ground_condition: ['ground_condition'],
    race_grade: ['race_grade', 'raceGrade', 'RaceGrade'], start_time_type: ['start_time_type', 'startTimeType', 'StartTimeType'],
  };
  return Object.fromEntries(Object.entries(fields).flatMap(([key, aliases]) => {
    const raw = pick(saved, ...aliases);
    if (typeof raw !== 'number' || !Number.isFinite(raw) || Math.abs(raw) > Number.MAX_SAFE_INTEGER) return [];
    if (key.endsWith('_id') && (!Number.isSafeInteger(raw) || raw <= 0)) return [];
    return [[key, raw]];
  }));
}

function explicitDistance(obj: RecordValue, course: RecordValue): number | null {
  const value = number(pick(course, 'distance', 'Distance', '<Distance>k__BackingField') ?? pick(obj, 'distance', 'race_distance', 'raceDistance'));
  return value !== null && value > 0 ? value : null;
}

function parseExport(obj: RecordValue, scenario: string, index: number): Race {
  // Some decoded responses put replay bytes on data and runner metadata on
  // data.race_start_info.race_horse_data. Only allowlisted fields reach Race.
  obj = { ...record(pick(obj, 'race_start_info', 'raceStartInfo')), ...obj };
  const binary = parseScenario(scenario);
  const actHorses = pick(obj, '<RaceHorse>k__BackingField', 'raceHorse');
  const isAct = Array.isArray(actHorses) || obj.simDataBase64 !== undefined || obj['<SimDataBase64>k__BackingField'] !== undefined;
  const members = isAct ? array(actHorses) : array(pick(obj, 'race_horse_data_array', 'raceHorseDataArray', 'race_horse_data', 'raceHorseData'));
  const warnings = [...binary.warnings];
  const byIndex = new Map<number, RecordValue>();
  const careerByIndex = new Map<number, ReturnType<typeof parseCareer>>();
  let missingOrder = false;
  for (const value of members) {
    const member = record(value);
    const meta = isAct ? { ...record(pick(member, '_responseHorseData', 'responseHorseData')), chara_name: pick(member, 'charaName', 'chara_name') ?? pick(record(pick(member, '_responseHorseData', 'responseHorseData')), 'chara_name', 'charaName') } : member;
    const frameOrder = number(pick(meta, 'frame_order', 'frameOrder'));
    // Do not infer metadata order when the frame mapping is absent.
    if (frameOrder === null || !Number.isInteger(frameOrder) || frameOrder < 1 || frameOrder > binary.runnerCount) { missingOrder = true; continue; }
    if (byIndex.has(frameOrder - 1)) throw new Error(`Duplicate runner frame_order ${frameOrder}; telemetry cannot be matched safely.`);
    byIndex.set(frameOrder - 1, meta);
    careerByIndex.set(frameOrder - 1, careerForHorse(meta,obj,member));
  }
  if (missingOrder) warnings.push('Some runner metadata lacked a valid frame_order and was not assigned to telemetry.');
  if (byIndex.size < binary.runnerCount) warnings.push('Some runner names/metadata are unavailable; numbered placeholders identify their simulation slots.');
  const teams = teamGroups([...byIndex.values()], binary.runnerCount);
  if (byIndex.size < binary.runnerCount && ('race_history_chara_result_array' in obj || ('race_num' in obj && 'room_info' in obj))) {
    warnings.push('Champions Meeting history lacks complete chart metadata. Unmapped runners remain numbered simulation slots; separate chart responses are not matched automatically.');
  }
  const runners: Runner[] = attachTeamStatTotals(Array.from({ length: binary.runnerCount }, (_, runnerIndex) => {
    const meta = byIndex.get(runnerIndex) ?? {};
    const career = careerByIndex.get(runnerIndex);
    const result = binary.results[runnerIndex];
    const charaId = number(pick(meta, 'chara_id', 'charaId'));
    return {
      id: `runner-${runnerIndex + 1}`, index: runnerIndex,
      gate: number(pick(meta, 'frame_order', 'frameOrder')),
      name: string(pick(meta, 'chara_name', 'charaName', 'name')) ?? (charaId === null ? `Runner ${runnerIndex + 1}` : `Character ${charaId}`),
      charaId, cardId: number(pick(meta, 'card_id', 'cardId')),
      trainer: string(pick(meta, 'trainer_name', 'trainerName', 'user_name', 'userName')),
      trainerId: trainerIdentity(pick(meta, 'viewer_id', 'viewerId')),
      strategy: strategyNames[number(pick(meta, 'running_style', 'runningStyle')) ?? result.strategy] ?? null,
      finishOrder: result.finishOrder, finishTime: result.finishTime,
      finishTimeRaw: result.finishTimeRaw, startDelay: result.startDelay, finishGap: result.finishGap, lastSpurtDistance: result.lastSpurtDistance,
      gutsOrder: result.gutsOrder, wisdomOrder: result.wisdomOrder, defeatFlags: result.defeatFlags,
      stats: parseStats(meta), skills: parseSkills(pick(meta, 'skill_array', 'skillArray', 'skills')),
      aptitudes: parseAptitudes(meta), strategyCode: number(pick(meta, 'running_style', 'runningStyle')) ?? result.strategy,
      popularity: boundedInteger(pick(meta, 'popularity', 'Popularity'), 1, binary.runnerCount),
      isNpc: npcClass(meta),
      ...(teams.has(meta) ? { teamGroup: teams.get(meta)! } : {}),
      mood: number(meta.motivation), raceWinCount: number(meta.single_mode_win_count), fanCount: number(meta.fan_count),
      starCount: number(meta.rarity) ?? career?.stars, rankScore: number(meta.rank_score) ?? career?.score,
      ...(career ? {career} : {}),
    };
  }));
  const frames: Frame[] = binary.frames.map(frame => ({ time: frame.time, runners: frame.samples.map((sample, runnerIndex) => ({ runnerId: runners[runnerIndex].id, ...sample })) }));
  const events: RaceEvent[] = binary.events.map(event => {
    // SKILL=3: param[0] is the zero-based frame slot; param[1] is the skill ID.
    // Recorded runner-local enum events 4–10 use the same zero-based slot.
    const isSkill = event.type === 3;
    const skillId = isSkill && Number.isInteger(event.params[1]) ? event.params[1] : null;
    return { ...event, runnerId: isSkill || (event.type >= 4 && event.type <= 10) ? runnerBySlot(runners, event.params[0])?.id ?? null : null, skillId, label: isSkill ? `Skill ${skillId ?? 'unknown'}` : `Event type ${event.type}` };
  }).sort((a, b) => a.time - b.time);
  const courseValue = pick(obj, '<RaceCourseSet>k__BackingField', 'raceCourseSet', 'RaceCourseSet', 'race_course_set');
  const course = record(courseValue);
  const raceInstanceId = number(pick(obj, 'race_instance_id', 'raceInstanceId', 'RaceInstanceId'));
  const recordedCourse = number(pick(course, 'id', 'Id', 'course_id', 'courseId', '<Id>k__BackingField') ?? pick(obj, 'race_course_id', 'raceCourseId', 'course_id', 'courseId', 'CourseId') ?? (typeof courseValue === 'number' || typeof courseValue === 'string' ? courseValue : null));
  const courseId = recordedCourse ?? instanceCourse(raceInstanceId);
  const context = instanceConditions(raceInstanceId);
  const recordedGrade = boundedInteger(pick(obj, 'race_grade', 'raceGrade', 'RaceGrade', '<RaceGrade>k__BackingField'), 0, 10000);
  const recordedTime = boundedInteger(pick(obj, 'start_time_type', 'startTimeType', 'StartTimeType', '<StartTimeType>k__BackingField'), 1, 4);
  const grade = recordedGrade ?? context?.grade ?? null, timeOfDay = recordedTime ?? context?.time ?? null;
  const recordedDistance = explicitDistance(obj, course);
  const referenceDistance = courseDistance(courseId);
  const derivedDistance = finishDistance({ runners, frames });
  const distance = recordedDistance ?? referenceDistance ?? derivedDistance;
  if (recordedDistance !== null && referenceDistance !== null && recordedDistance !== referenceDistance) warnings.push('Recorded course ID and distance disagree; select the correct course before using course-dependent analysis.');
  if (distance === null) warnings.push('Official course distance is absent; the chart uses the observed distance extent.');
  const raw = extractSanitizedRaw(obj, scenario, {
    horseact: isAct, horses: members, course: courseValue, results: binary.results,
    category: captureFields(obj).category ?? importCategory(obj),
  });
  return {
    id: nextId(index), title: string(pick(obj, 'title', 'race_name', 'raceName')) ?? `Imported race ${index + 1}`,
    source: isAct ? 'horseact' : 'response', sourceLabel: isAct ? 'horseACT export' : 'Decoded response',
    distance, duration: frames[frames.length - 1].time,
    courseId,
    courseIdentity: { source: recordedCourse !== null ? 'recorded' : courseId !== null ? 'race-instance' : 'unknown', ...(raceInstanceId !== null && Number.isSafeInteger(raceInstanceId) ? { raceInstanceId } : {}) },
    ...(distance !== null ? { distanceEvidence: recordedDistance !== null ? 'recorded' as const : referenceDistance !== null ? 'course-reference' as const : 'finish-derived' as const } : {}),
    ...(number(pick(obj, 'random_seed', 'randomSeed', 'RandomSeed', '<RandomSeed>k__BackingField')) !== null ? { randomSeed: number(pick(obj, 'random_seed', 'randomSeed', 'RandomSeed', '<RandomSeed>k__BackingField'))! } : {}),
    runners, frames, events, warnings, synthetic: false,
    ...(grade !== null ? { grade } : {}),
    conditionEvidence: { ...(grade !== null ? { grade: recordedGrade !== null ? 'recorded' as const : 'race-instance' as const } : {}), ...(timeOfDay !== null ? { timeOfDay: recordedTime !== null ? 'recorded' as const : 'race-instance' as const } : {}) },
    ...captureFields(obj),
    laneDistanceMax: number(pick(course, 'lane_distance_max', 'laneDistanceMax', 'LaneDistanceMax', '<LaneDistanceMax>k__BackingField') ?? pick(obj, 'lane_distance_max', 'laneDistanceMax', 'LaneDistanceMax', '<LaneDistanceMax>k__BackingField')),
    conditions: {
      weather: conditionText(pick(obj, 'weather', 'Weather', '<Weather>k__BackingField')),
      ground: conditionText(pick(obj, 'ground_condition', 'groundCondition', 'GroundCondition', '<GroundCondition>k__BackingField')),
      season: conditionText(pick(obj, 'season', 'Season', '<Season>k__BackingField')),
      ...(timeOfDay !== null ? { timeOfDay: String(timeOfDay) } : {}),
    },
    ...(raw ? { raw } : {}),
  };
}

function parseNormalized(obj: RecordValue, index: number): Race {
  if (obj.schemaVersion !== undefined && obj.schemaVersion !== 1) throw new Error('Unsupported normalized schemaVersion. This viewer supports version 1.');
  const rawRunners = array(obj.runners);
  const rawFrames = array(obj.frames);
  if (!rawRunners.length || rawRunners.length > MAX_RUNNERS) throw new Error(`Normalized race needs 1–${MAX_RUNNERS} runners.`);
  if (!rawFrames.length || rawFrames.length > MAX_FRAMES || rawFrames.length * rawRunners.length > MAX_SAMPLES) throw new Error('Normalized race contains no frames or exceeds the frame/sample limit.');
  const normalizedMembers = rawRunners.map(record), normalizedTeams = teamGroups(normalizedMembers, rawRunners.length, true);
  const runners: Runner[] = attachTeamStatTotals(normalizedMembers.map((runner, runnerIndex) => {
    const finishOrder = number(runner.finishOrder);
    const finishTime = number(runner.finishTime);
    const finishTimeRaw = number(runner.finishTimeRaw);
    const frameOrder=number(runner.gate)??runnerIndex+1;
    const horses=array(pick(obj,'raceHorse','<RaceHorse>k__BackingField'));
    const member=horses.map(record).find(h=>number(pick(record(pick(h,'responseHorseData','_responseHorseData')),'frame_order','frameOrder'))===frameOrder);
    const career=runner.career!==undefined?parseCareer(runner.career):member?careerForHorse(record(pick(member,'responseHorseData','_responseHorseData')),obj,member):undefined;
    return {
      id: string(runner.id) ?? `runner-${runnerIndex + 1}`, index: runnerIndex,
      gate: number(runner.gate), name: string(runner.name) ?? `Runner ${runnerIndex + 1}`,
      charaId: number(runner.charaId), cardId: number(runner.cardId), trainer: string(runner.trainer),
      ...(career ? {career} : {}),
      ...(runner.trainerId !== undefined ? { trainerId: trainerIdentity(runner.trainerId) } : {}),
      strategy: string(runner.strategy),
      finishOrder: finishOrder !== null && Number.isInteger(finishOrder) && finishOrder > 0 && finishOrder <= rawRunners.length ? finishOrder : null,
      finishTime: finishTime !== null && finishTime >= 0 && finishTime <= 3600 ? finishTime : null,
      ...(runner.finishTimeRaw !== undefined ? { finishTimeRaw: finishTimeRaw !== null && finishTimeRaw >= 0 && finishTimeRaw <= 3600 ? finishTimeRaw : null } : {}),
      ...(runner.startDelay !== undefined ? { startDelay: number(runner.startDelay) } : {}),
      ...(runner.finishGap !== undefined ? { finishGap: number(runner.finishGap) } : {}),
      ...(runner.lastSpurtDistance !== undefined ? { lastSpurtDistance: number(runner.lastSpurtDistance) } : {}),
      ...(runner.stats !== undefined ? { stats: parseStats(record(runner.stats)) } : {}),
      ...(runner.skills !== undefined ? { skills: parseSkills(runner.skills) } : {}),
      ...(runner.aptitudes !== undefined ? { aptitudes: parseAptitudes(record(runner.aptitudes), true) } : {}),
      ...(runner.popularity !== undefined ? { popularity: boundedInteger(runner.popularity, 1, rawRunners.length) } : {}),
      ...(runner.isNpc !== undefined ? { isNpc: typeof runner.isNpc === 'boolean' ? runner.isNpc : null } : {}),
      ...(normalizedTeams.has(runner) ? { teamGroup: normalizedTeams.get(runner)! } : {}),
      ...Object.fromEntries(['strategyCode', 'mood', 'raceWinCount', 'fanCount', 'starCount', 'rankScore', 'gutsOrder', 'wisdomOrder', 'defeatFlags'].filter(key => runner[key] !== undefined).map(key => [key, number(runner[key])])),
      ...(career?.score!=null&&runner.rankScore==null?{rankScore:career.score}:{}),
    };
  }));
  const ids = new Set(runners.map(r => r.id));
  if (ids.size !== runners.length) throw new Error('Normalized runner IDs must be unique.');
  let previous = -Infinity;
  const frames: Frame[] = rawFrames.map((value, frameIndex) => {
    const frame = record(value);
    const time = number(frame.time);
    if (time === null || time < 0 || time > 3600 || time <= previous) throw new Error(`Frame ${frameIndex + 1}: time must be nonnegative, at most 3600 s, and strictly increasing.`);
    previous = time;
    if (!Array.isArray(frame.runners)) throw new Error(`Frame ${frameIndex + 1}: missing runners array.`);
    const samples = new Map<string, RunnerSample>();
    for (const value of frame.runners) {
      const sample = record(value);
      const runnerId = string(sample.runnerId);
      if (runnerId === null || !ids.has(runnerId) || samples.has(runnerId)) throw new Error(`Frame ${frameIndex + 1}: unknown or repeated runnerId.`);
      const fields = ['distance', 'speed', 'hp', 'lane'] as const;
      const normalized = emptySample(runnerId);
      for (const field of fields) {
        const raw = sample[field];
        if (raw !== null && raw !== undefined && number(raw) === null) throw new Error(`Frame ${frameIndex + 1}: ${field} must be numeric or null.`);
        normalized[field] = number(raw);
        if (normalized[field] !== null && Math.abs(normalized[field]) > 1_000_000_000) throw new Error(`Frame ${frameIndex + 1}: ${field} exceeds the normalized telemetry limit (absolute value 1 billion).`);
      }
      if (sample.temptationMode !== undefined) {
        const mode = number(sample.temptationMode);
        if (mode !== null && (!Number.isInteger(mode) || mode < -128 || mode > 127)) throw new Error(`Frame ${frameIndex + 1}: invalid temptationMode.`);
        normalized.temptationMode = mode;
      }
      if (sample.blockFrontRunnerIndex !== undefined) {
        const blocker = number(sample.blockFrontRunnerIndex);
        if (blocker !== null && (!Number.isInteger(blocker) || blocker < -1 || blocker >= runners.length)) throw new Error(`Frame ${frameIndex + 1}: invalid blockFrontRunnerIndex.`);
        normalized.blockFrontRunnerIndex = blocker;
      }
      samples.set(runnerId, normalized);
    }
    return { time, runners: runners.map(r => samples.get(r.id) ?? emptySample(r.id)) };
  });
  const rawEvents = array(obj.events);
  if (rawEvents.length > 100_000) throw new Error('Normalized race exceeds the 100,000 event limit.');
  const events: RaceEvent[] = rawEvents.map((value, eventIndex) => {
    const event = record(value);
    const time = number(event.time);
    if (time === null || time < 0 || time > 3600) throw new Error(`Event ${eventIndex + 1}: invalid time.`);
    const runnerId = string(event.runnerId);
    if (runnerId !== null && !ids.has(runnerId)) throw new Error(`Event ${eventIndex + 1}: unknown runnerId.`);
    const params = array(event.params).map(number);
    if (params.length > 127 || params.some(value => value === null)) throw new Error(`Event ${eventIndex + 1}: params must contain at most 127 finite numbers.`);
    return { time, type: typeof event.type === 'number' || typeof event.type === 'string' ? event.type : 'unknown', runnerId, skillId: number(event.skillId), label: string(event.label) ?? 'Recorded event', params: params as number[] };
  }).sort((a, b) => a.time - b.time);
  const identity = record(obj.courseIdentity);
  const rawInstanceId = number(identity.raceInstanceId ?? pick(obj, 'race_instance_id', 'raceInstanceId', 'RaceInstanceId'));
  const normalizedInstanceId = rawInstanceId!==null&&Number.isSafeInteger(rawInstanceId)&&rawInstanceId>0?rawInstanceId:null;
  const explicitCourseId = number(obj.courseId);
  const normalizedCourseId = explicitCourseId ?? instanceCourse(normalizedInstanceId);
  const explicitNormalizedDistance = number(obj.distance);
  const normalizedReferenceDistance = courseDistance(normalizedCourseId);
  const distance = explicitNormalizedDistance ?? normalizedReferenceDistance ?? finishDistance({ runners, frames });
  const synthetic = obj.synthetic === true;
  const warnings = array(obj.warnings).filter((v): v is string => typeof v === 'string');
  if (!synthetic && runners.some(r => r.finishTimeRaw === undefined && r.finishTime !== null)) warnings.push('Legacy normalized finishTime is assumed to use replay seconds when finishTimeRaw is absent; older exports may instead contain a game-scaled display time.');
  const conditions = record(obj.conditions);
  const context = instanceConditions(normalizedInstanceId), recordedGrade = boundedInteger(obj.grade, 0, 10000), recordedTime = boundedInteger(conditions.timeOfDay, 1, 4);
  const grade = recordedGrade ?? context?.grade ?? null, timeOfDay = recordedTime ?? context?.time ?? null, conditionEvidence = record(obj.conditionEvidence);
  const identitySource = explicitCourseId===null&&normalizedCourseId!==null?'race-instance':identity.source;
  const raw = typeof obj.simDataBase64 === 'string' ? extractSanitizedRaw(obj, obj.simDataBase64, {
    normalized: true,
    horseact: Array.isArray(obj.raceHorse), horses: array(obj.raceHorse), course: obj.raceCourseSet,
    category: category(obj.category),
  }) : undefined;
  return {
    id: string(obj.id) ?? nextId(index), title: string(obj.title) ?? `Imported race ${index + 1}`,
    source: synthetic ? 'demo' : 'normalized', sourceLabel: synthetic ? 'Synthetic demonstration' : 'Normalized JSON',
    distance: distance !== null && distance > 0 ? distance : null, duration: frames[frames.length - 1].time,
    courseId: normalizedCourseId, runners, frames, events,
    warnings, synthetic,
    ...captureFields(obj),
    ...(obj.conditions !== undefined || timeOfDay !== null ? { conditions: { weather: conditionText(conditions.weather), ground: conditionText(conditions.ground), season: conditionText(conditions.season), ...(timeOfDay !== null ? { timeOfDay: String(timeOfDay) } : {}) } } : {}),
    ...(grade !== null ? { grade } : {}),
    ...(grade !== null || timeOfDay !== null ? { conditionEvidence: {
      ...(grade !== null ? { grade: recordedGrade === null || conditionEvidence.grade === 'race-instance' ? 'race-instance' as const : 'recorded' as const } : {}),
      ...(timeOfDay !== null ? { timeOfDay: recordedTime === null || conditionEvidence.timeOfDay === 'race-instance' ? 'race-instance' as const : 'recorded' as const } : {}),
    } } : {}),
    ...(obj.laneDistanceMax !== undefined ? { laneDistanceMax: number(obj.laneDistanceMax) } : {}),
    courseIdentity: { source: ['recorded', 'race-instance', 'filename-race-instance', 'manual', 'skill-conditions', 'unknown'].includes(String(identitySource)) ? identitySource as NonNullable<Race['courseIdentity']>['source'] : normalizedCourseId !== null ? 'recorded' as const : 'unknown' as const, ...(normalizedInstanceId!==null?{raceInstanceId:normalizedInstanceId}:{}) },
    ...(['recorded', 'course-reference', 'finish-derived'].includes(String(obj.distanceEvidence)) ? { distanceEvidence: obj.distanceEvidence as Race['distanceEvidence'] } : distance !== null ? { distanceEvidence: explicitNormalizedDistance !== null ? 'recorded' as const : normalizedReferenceDistance !== null ? 'course-reference' as const : 'finish-derived' as const } : {}),
    ...(number(obj.randomSeed) !== null ? { randomSeed: number(obj.randomSeed)! } : {}),
    ...(raw ? { raw } : {}),
  };
}

function parseText(text: string, filename: string): unknown {
  text = text.replace(/^\uFEFF/, '');
  if (/\.(jsonl|ndjson)$/i.test(filename)) {
    const records: unknown[] = [];
    let cursor = 0, lineNumber = 0;
    while (cursor < text.length) {
      const newline = text.indexOf('\n', cursor);
      const end = newline === -1 ? text.length : newline;
      const line = text.slice(cursor, end).trim();
      cursor = end + 1;
      if (++lineNumber > 100_000) throw new Error('Trace exceeds the 100,000-line limit. Export a shorter interval.');
      if (!line) continue;
      let value: unknown;
      try { value = JSON.parse(line); }
      catch { throw new Error(`Malformed JSONL at line ${lineNumber}. Export a complete trace; no records were imported.`); }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`JSONL line ${lineNumber} must be a trace object.`);
      records.push(value);
    }
    return { api_calls: records };
  }
  try { return JSON.parse(text); }
  catch { throw new Error('Invalid JSON. Export the complete race response; use .jsonl or .ndjson for newline-delimited response traces.'); }
}

function decodeFileBytes(bytes: Uint8Array, filename: string): unknown {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('File exceeds the 64 MB import limit.');
  const beginning = new TextDecoder().decode(bytes.subarray(0, 200)).trimStart();
  if (/^[\[{]/.test(beginning) || /\.(json|har|jsonl|ndjson)$/i.test(filename)) {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('This file is not valid UTF-8. Export a complete JSON response or trace.'); }
    return parseText(text, filename);
  }
  try { return decode(bytes, { maxStrLength: MAX_FILE_BYTES, maxBinLength: MAX_FILE_BYTES, maxArrayLength: MAX_SAMPLES, maxMapLength: 100_000 }); }
  catch { throw new Error('Unrecognized file. Import JSON, HAR with decoded response bodies, or a decoded MessagePack body; encrypted traffic and packet captures are not supported.'); }
}

function ensureImportBudget(races: Race[]) {
  if (races.length > 100) throw new Error('A maximum of 100 races can be imported at once.');
  const sampleCount = races.reduce((total, race) => total + race.frames.length * race.runners.length, 0);
  if (sampleCount > MAX_SAMPLES) throw new Error('Combined races exceed the 1,000,000 sample import limit. Export a shorter interval.');
}

/** Find offline races in known response/trace containers. Request/auth branches are never walked. */
export function parseRaceJson(input: unknown): Race[] {
  const root = record(input);
  const entries = array(record(root.log).entries);
  if (entries.length) {
    const races: Race[] = [];
    let skipped = 0;
    for (const entry of entries) {
      const content = record(record(record(entry).response).content);
      if (typeof content.text !== 'string' || !content.text.trim()) { skipped++; continue; }
      try {
        const decoded = content.encoding === 'base64' ? decodeFileBytes(base64Bytes(content.text), 'response.bin') : JSON.parse(content.text);
        races.push(...parseRaceJson(decoded));
      } catch { skipped++; }
      ensureImportBudget(races);
    }
    if (!races.length) throw new Error('No supported race data in this HAR. Response bodies may be absent, encrypted, or use an unsupported format. A HAR alone does not decrypt game traffic.');
    for (const [index, race] of races.entries()) { race.id = nextId(index); if (skipped) race.warnings.push(`Skipped ${skipped} HAR entries without a supported decoded race body.`); }
    return races;
  }
  const races: Race[] = [];
  let visited = 0;
  let skippedTrace = 0;
  const add = (race: Race) => { races.push(race); ensureImportBudget(races); };
  const traceRecord = (value: unknown, depth: number) => {
    if (++visited > 100_000 || depth > 24) throw new Error('Trace envelope exceeds the record/depth limit. Export a shorter interval.');
    const entry = record(value);
    if (entry.direction !== 'RES') { skippedTrace++; return; }
    const before = races.length;
    walk(entry.data, depth + 1, { category: importCategory({}, entry.endpoint) });
    if (before === races.length) skippedTrace++;
  };
  const walk = (value: unknown, depth: number, inherited: RecordValue = {}, skipScenario = false) => {
    if (++visited > 100_000 || depth > 24) throw new Error('Input envelope is too large or deeply nested. Export only the race response body.');
    if (Array.isArray(value)) {
      if (value.length > 100_000) throw new Error('Input array exceeds the 100,000 record limit. Export a shorter interval.');
      const isTrace = value.some(item => { const entry = record(item); return 'direction' in entry || 'endpoint' in entry || 'req_id' in entry || 'dir' in entry; });
      for (const item of value) { if (isTrace) traceRecord(item, depth + 1); else walk(item, depth + 1, { category: inherited.category }); }
      return;
    }
    const obj = record(value);
    if (!Object.keys(obj).length) return;
    if ('direction' in obj || 'endpoint' in obj || 'req_id' in obj || 'dir' in obj) { traceRecord(obj, depth + 1); return; }
    if (Array.isArray(obj.turns)) {
      for (const turn of obj.turns) {
        if (++visited > 100_000) throw new Error('Career report exceeds the record limit. Export fewer turns.');
        for (const entry of array(record(turn).api_calls)) traceRecord(entry, depth + 1);
      }
      return;
    }
    if (Array.isArray(obj.api_calls)) { for (const entry of obj.api_calls) traceRecord(entry, depth + 1); return; }
    if (Array.isArray(obj.runners) && Array.isArray(obj.frames)) { add(parseNormalized(obj, races.length)); return; }
    const starts = array(obj.race_start_params_array);
    const results = array(obj.race_result_array);
    if (starts.length && results.length) {
      if (starts.length !== results.length) throw new Error('Team Trial export has mismatched start/result counts. Export the complete response.');
      for (let index = 0; index < starts.length; index++) walk({ ...record(starts[index]), ...record(results[index]), category: 'team-trials', title: `Team Trial ${index + 1}` }, depth + 1);
      return;
    }
    const context = { ...inherited, ...obj, category: importCategory(obj) ?? category(inherited.category) };
    const room = record(obj.room_info);
    const ownScenario = pick(obj, 'race_scenario', 'raceScenario', '<SimDataBase64>k__BackingField', 'simDataBase64');
    const scenario = ownScenario ?? pick(room, 'race_scenario', 'raceScenario');
    const hasScenario = typeof scenario === 'string';
    if (hasScenario && !skipScenario) {
      const saved = typeof ownScenario === 'string' && ownScenario ? savedRaceMetadata(obj.race_result) : {};
      add(parseExport({ ...saved, ...room, ...context }, scenario, races.length));
    }
    // Known envelopes often nest under data/room_info; race_scenario_info may itself be an object.
    // No proprietary byte layout is inferred from the name of an unknown field.
    for (const key of ['data', 'room_info', 'race_start_info', 'race_scenario_info', 'races', 'race_result', 'race_result_info', 'race_results', 'race_data', 'race_result_array', 'race_history_info_array']) {
      const nested = obj[key];
      const duplicateWrapper = hasScenario && ['room_info', 'race_start_info', 'race_scenario_info'].includes(key) && pick(record(nested), 'race_scenario', 'raceScenario') === scenario;
      if (nested !== null && typeof nested === 'object') walk(nested, depth + 1, !hasScenario && (key === 'data' || key === 'race_scenario_info') && !Array.isArray(nested) ? context : { category: context.category }, duplicateWrapper);
    }
  };
  walk(input, 0);
  if (!races.length) throw new Error('No race frames found. Expected a decoded RES trace with race_scenario, horseACT simDataBase64, or normalized runners/frames JSON. Requests, auth records, encrypted traffic and packet captures are not imported.');
  if (skippedTrace) for (const race of races) race.warnings.push(`Skipped ${skippedTrace} trace records without a supported RES race body.`);
  return races;
}

export async function importRace(input: ArrayBuffer | string, filename: string): Promise<Race[]> {
  let parsed: unknown;
  if (typeof input === 'string') {
    if (input.length > MAX_FILE_BYTES) throw new Error('File exceeds the 64 MB import limit.');
    parsed = parseText(input, filename);
  } else parsed = decodeFileBytes(new Uint8Array(input), filename);
  const races = parseRaceJson(parsed);
  const filenameInstance = number(filename.match(/^(\d+)_/)?.[1]);
  const filenameCourse = instanceCourse(filenameInstance);
  return races.map((race, index) => {
    if (race.courseId === null && filenameCourse !== null && races.length === 1) {
      const referenceDistance = courseDistance(filenameCourse);
      if (race.distance === null || race.distance === referenceDistance) {
        race.courseId = filenameCourse;
        race.courseIdentity = { source: 'filename-race-instance', raceInstanceId: filenameInstance! };
        if (race.distance === null && referenceDistance !== null) { race.distance = referenceDistance; race.distanceEvidence = 'course-reference'; }
        race.warnings.push('Course identified from the filename. Renaming the file can affect course detection.');
      }
    }
    return { ...race, id: `${filename}:${index}`, sourceLabel: `${race.sourceLabel} · ${filename}` };
  });
}
