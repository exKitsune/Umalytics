"""Bounded copy of race-adjacent objects. Auth/session envelopes are never serialized."""
import base64
import json
import math
import struct
import zlib

MAX_RACES = 100
MAX_SCENARIO_CHARS = 16 * 1024 * 1024
CATEGORIES = ('career', 'team-trials', 'practice', 'champions-meeting', 'other')
RACE_NUMBERS = ('distance', 'race_distance', 'lane_distance_max', 'race_course_id', 'course_id', 'race_instance_id', 'random_seed', 'race_grade', 'start_time_type')
CONDITIONS = ('season', 'weather', 'ground_condition')
TRAINED_KEYS = ('trained_chara_array', 'trainedCharaArray', 'trained_chara_data_array')
ENVELOPE = frozenset(('auth', 'auth_data', 'auth_key', 'authentication', 'headers', 'request', 'requests',
    'request_headers', 'request_body', 'session', 'device', 'user_info', 'trainer_info'))
EXCLUDED_BRANCHES = ENVELOPE | frozenset(('chara_info', 'race_horse_data', 'race_horse_data_array', 'skill_array',
    'race_course_set', *TRAINED_KEYS))


def collection_settings(value):
    categories = value.get('categories', {}) if isinstance(value, dict) else {}
    if not isinstance(categories, dict):
        categories = {}
    return {key: categories.get(key) is not False for key in CATEGORIES}


def classify_race(endpoint='', content=None):
    """Only finite group names survive; never raw route/query/identifiers."""
    parts = endpoint.split('?', 1)[0].split('/')
    group = parts[2] if len(parts) > 2 and parts[1] == '\x75mamusume' else ''
    known = {'single_mode': 'career', 'single_mode_free': 'career',
        'team_stadium': 'team-trials', 'team_race': 'team-trials',
        'room_match': 'practice', 'practice': 'practice', 'practice_race': 'practice',
        'champions': 'champions-meeting', 'champions_meeting': 'champions-meeting'}
    if group in known:
        return known[group], 'endpoint'
    content = content if isinstance(content, dict) else {}
    race_type = content.get('race_type', content.get('race_category'))
    names = {**known, **{key: key for key in CATEGORIES},
        'team_trial': 'team-trials', 'team_trials': 'team-trials'}
    if isinstance(race_type, str) and race_type.lower() in names:
        return names[race_type.lower()], 'content'
    if isinstance(content.get('race_start_params_array'), list) and isinstance(content.get('race_result_array'), list):
        return 'team-trials', 'content'
    return 'other', 'unknown'


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if -9007199254740991 <= value <= 9007199254740991 and math.isfinite(value) else None


def _scenario_runner_count(scenario):
    """Read only the bounded Global header; never parse or retain unknown bytes."""
    try:
        raw = base64.b64decode(''.join(scenario.split()), validate=True)
        header = zlib.decompressobj(47).decompress(raw, 4120)
        if len(header) < 4:
            return None
        header_size = struct.unpack_from('<i', header, 0)[0]
        if not 4 <= header_size <= 4096 or len(header) < header_size + 12:
            return None
        count = struct.unpack_from('<i', header, header_size + 8)[0]
        return count if 1 <= count <= 64 else None
    except (ValueError, zlib.error, struct.error):
        return None


def _copy(value, depth=0, visits=None):
    """Keep the race object graph horseACT would serialize from the same response."""
    if visits is None:
        visits = [0]
    visits[0] += 1
    if visits[0] > 50000 or depth > 16:
        raise ValueError('envelope_limit')
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value if _number(value) is not None else None
    if isinstance(value, str):
        if len(value) > MAX_SCENARIO_CHARS:
            raise ValueError('race_limit')
        return value
    if isinstance(value, list):
        if len(value) > 2000:
            raise ValueError('array_limit')
        return [_copy(item, depth + 1, visits) for item in value]
    if isinstance(value, dict):
        if len(value) > 1000:
            raise ValueError('saved_result_limit')
        return {key: _copy(child, depth + 1, visits) for key, child in value.items() if key not in ENVELOPE}
    return None


def _trained_id(value):
    if not isinstance(value, dict):
        return None
    for key in ('trained_chara_id', 'trainedCharaId', 'id'):
        n = _number(value.get(key))
        if type(n) is int and n > 0:
            return n
    return None


def _attach_trained(horses, trained):
    by_id = {}
    for item in trained:
        tid = _trained_id(item)
        if tid is not None:
            by_id[tid] = item
    for horse in horses:
        if not isinstance(horse, dict) or horse.get('trained_chara_data') or horse.get('trainedCharaData'):
            continue
        nested = horse.get('responseHorseData') if isinstance(horse.get('responseHorseData'), dict) else {}
        tid = _trained_id(horse) or _trained_id(nested)
        if tid in by_id:
            horse['trained_chara_data'] = by_id[tid]
    return horses


def _horse(value, runner_count=None, team_groups=None):
    if not isinstance(value, dict):
        return {}
    result = _copy(value)
    if not isinstance(result, dict):
        return {}
    explicit_npc = value.get('is_npc', value.get('isNpc'))
    npc_type = value.get('npc_type', value.get('NpcType'))
    if type(explicit_npc) is bool:
        result['is_npc'] = explicit_npc
    elif type(npc_type) is int and npc_type in (0, 3, 11, 20):
        result['is_npc'] = npc_type in (0, 3)
    popularity = value.get('popularity', value.get('Popularity'))
    if runner_count is not None and type(popularity) is int and 1 <= popularity <= runner_count:
        result['popularity'] = popularity
    raw_team = _number(value.get('team_id', value.get('TeamId')))
    if team_groups is not None and raw_team is not None and type(raw_team) is int and raw_team > 0:
        if raw_team not in team_groups:
            team_groups[raw_team] = len(team_groups) + 1
        result['team_group'] = team_groups[raw_team]
    return result


def _metadata(value):
    value = dict(value)
    aliases = {'raceInstanceId': 'race_instance_id', 'RaceInstanceId': 'race_instance_id',
        'raceCourseId': 'race_course_id', 'courseId': 'course_id', 'CourseId': 'course_id',
        'raceCourseSet': 'race_course_set', 'RaceCourseSet': 'race_course_set',
        'raceDistance': 'race_distance', 'randomSeed': 'random_seed',
        'raceGrade': 'race_grade', 'RaceGrade': 'race_grade',
        'startTimeType': 'start_time_type', 'StartTimeType': 'start_time_type'}
    for key, canonical in aliases.items():
        if key in value and canonical not in value:
            value[canonical] = value[key]
    result = {key: value[key] for key in (*RACE_NUMBERS, *CONDITIONS, *TRAINED_KEYS, 'race_type',
        'race_category', 'race_course_set', 'race_horse_data_array', 'race_horse_data') if key in value}
    for key in ('race_start_info', 'room_info'):
        start = value.get(key)
        if not isinstance(start, dict):
            continue
        start = dict(start)
        for alias, canonical in aliases.items():
            if alias in start and canonical not in start:
                start[canonical] = start[alias]
        # Do not recursively inspect hostile nested start-info objects.
        result.update({key: start[key] for key in (*RACE_NUMBERS, *CONDITIONS, *TRAINED_KEYS,
            'race_course_set', 'race_horse_data_array', 'race_horse_data') if key in start and key not in result})
    # RoomMatchGetSavedRaceResultResponse puts its replay and saved-room
    # definition beside each other. Lift only numeric race metadata from this
    # literal sibling; never inherit room/player identity or runner arrays.
    saved = value.get('race_result')
    if isinstance(value.get('race_scenario'), str) and value['race_scenario'] and isinstance(saved, dict):
        if len(saved) > 1000:
            raise ValueError('saved_result_limit')
        for key in (*RACE_NUMBERS, *CONDITIONS):
            if key in result:
                continue
            candidate = saved.get(key)
            if candidate is None:
                candidate = next((saved[alias] for alias, canonical in aliases.items()
                    if canonical == key and alias in saved), None)
            numeric = _number(candidate)
            if numeric is not None:
                result[key] = numeric
    return result


def _int(value):
    number = _number(value)
    return number if type(number) is int else None


def _join_keys(value):
    """Public room/race identifiers only. Player and viewer ids are never keys."""
    if not isinstance(value, dict):
        return {}
    aliases = {'savedRoomId': 'saved_room_id', 'registerId': 'register_id', 'roomId': 'room_id', 'randomSeed': 'random_seed'}
    keys = {}
    sources = [value]
    for name in ('room_info', 'race_start_info', 'race_result'):
        child = value.get(name)
        if isinstance(child, dict):
            sources.append(child)
    for source in sources:
        for key in ('saved_room_id', 'register_id', 'room_id', 'random_seed'):
            if key in keys:
                continue
            raw = source.get(key)
            if raw is None:
                raw = next((source[alias] for alias, canonical in aliases.items() if canonical == key and alias in source), None)
            number = _int(raw)
            if number is None or number <= 0:
                continue
            keys[key] = number
    return keys


def _course_fields(value):
    if not isinstance(value, dict):
        return {}
    meta = _metadata(value)
    course = {}
    instance = _int(meta.get('race_instance_id'))
    if instance is not None and instance > 0:
        course['race_instance_id'] = instance
    raw_course = meta.get('race_course_set')
    if isinstance(raw_course, dict) or _int(raw_course) is not None:
        course['race_course_set'] = raw_course
    for key in ('distance', 'race_distance'):
        number = _int(meta.get(key))
        if number is not None and number > 0 and 'distance' not in course:
            course['distance'] = number
    for key in CONDITIONS:
        condition = meta.get(key)
        if _number(condition) is not None or isinstance(condition, str) and len(condition) <= 32:
            course[key] = condition
    return course


def collect_room_bindings(payload):
    """Course context from a room or race-start response, keyed by an explicit shared id."""
    found = []
    visits = 0

    def walk(value, depth=0):
        nonlocal visits
        visits += 1
        if visits > 10000 or depth > 16:
            raise ValueError('envelope_limit')
        if isinstance(value, list):
            if len(value) > 1000:
                raise ValueError('array_limit')
            for item in value:
                walk(item, depth + 1)
            return
        if not isinstance(value, dict):
            return
        course = _course_fields(value)
        join = _join_keys(value)
        if 'race_instance_id' not in course and 'race_course_set' not in course:
            join.pop('random_seed', None)
        elif 'random_seed' not in join:
            seed = _int(value.get('random_seed', value.get('randomSeed')))
            if seed is not None and seed > 0:
                join['random_seed'] = seed
        if join and ('race_instance_id' in course or 'race_course_set' in course):
            found.append({'join': join, 'course': {key: course[key] for key in course if key in ('race_instance_id', 'race_course_set', 'distance', *CONDITIONS)}})
        for key, nested in value.items():
            if key in ENVELOPE:
                continue
            if isinstance(nested, (dict, list)):
                walk(nested, depth + 1)

    walk(payload)
    return found


def _binding_matches(race, binding):
    join = race.get('_room_join') or {}
    other = binding['join']
    course = binding['course']
    if 'random_seed' in join and 'random_seed' in other and join['random_seed'] != other['random_seed']:
        return False
    for key in ('saved_room_id', 'register_id', 'room_id'):
        if key in join and key in other and join[key] != other[key]:
            return False
    for key in CONDITIONS:
        if key in race and key in course and race[key] != course[key]:
            return False
    for key in ('saved_room_id', 'register_id', 'room_id'):
        if key in join and key in other and join[key] == other[key]:
            return True
    return 'random_seed' in join and join['random_seed'] == other.get('random_seed')


def remember_room_bindings(memory, bindings, limit=64):
    for binding in bindings:
        instance = binding['course'].get('race_instance_id')
        memory[:] = [item for item in memory if item['course'].get('race_instance_id') != instance or not any(item['join'].get(key) == binding['join'].get(key) for key in ('saved_room_id', 'register_id', 'room_id', 'random_seed') if key in item['join'] and key in binding['join'])]
        memory.append(binding)
    if len(memory) > limit:
        del memory[:-limit]


def apply_room_bindings(races, memory):
    """Copy course fields from a room response that shares a room id or random seed."""
    for race in races:
        if race.get('race_instance_id') or race.get('race_course_set'):
            race.pop('_room_join', None)
            continue
        matches = [binding for binding in memory if _binding_matches(race, binding)]
        race.pop('_room_join', None)
        instances = {binding['course'].get('race_instance_id') for binding in matches if binding['course'].get('race_instance_id')}
        courses = {json.dumps(binding['course'].get('race_course_set'), sort_keys=True) for binding in matches if binding['course'].get('race_course_set') is not None}
        if len(instances) > 1 or len(courses) > 1 or not matches:
            continue
        course = matches[-1]['course']
        copied = False
        if 'race_instance_id' not in race and course.get('race_instance_id'):
            race['race_instance_id'] = course['race_instance_id']
            copied = True
        if 'race_course_set' not in race and course.get('race_course_set') is not None:
            race['race_course_set'] = course['race_course_set']
            copied = True
        if 'distance' not in race and course.get('distance'):
            race['distance'] = course['distance']
            copied = True
        for key in CONDITIONS:
            if key not in race and key in course:
                race[key] = course[key]
                copied = True
        if copied:
            race.setdefault('metadata', {}).setdefault('umaTrace', {})['courseSource'] = 'room-response'


def extract_races(payload, endpoint='', captured_at=None, settings=None):
    """Keep local metadata only. No cross-response or history/chart joins.

    Documented Team Trial parallel start/result arrays pair by index only with
    equal lengths. Other arrays never inherit parent runner metadata.
    """
    result = []
    visits = 0
    seen_scenarios = 0
    enabled = collection_settings(settings)
    endpoint_category, endpoint_source = classify_race(endpoint)

    def walk(value, depth=0, inherited=None, category_hint=None, skip_scenario=False):
        nonlocal visits, seen_scenarios
        visits += 1
        if visits > 10000 or depth > 16:
            raise ValueError('envelope_limit')
        if isinstance(value, list):
            if len(value) > 1000:
                raise ValueError('array_limit')
            for item in value:
                walk(item, depth + 1, category_hint=category_hint)
            return
        if not isinstance(value, dict):
            return
        metadata = {**(inherited or {}), **_metadata(value)}
        category, source = classify_race(endpoint, value)
        if source == 'unknown' and category_hint:
            category, source = category_hint
        room = value.get('room_info') if isinstance(value.get('room_info'), dict) else {}
        scenario = value.get('race_scenario')
        if not isinstance(scenario, str) and isinstance(room.get('race_scenario'), str):
            scenario = room['race_scenario']
            metadata = {**_metadata(room), **metadata}
        if source == 'unknown':
            local_category, local_source = classify_race(endpoint, metadata)
            if local_source != 'unknown':
                category, source = local_category, local_source
        if isinstance(scenario, str) and scenario and not skip_scenario:
            seen_scenarios += 1
            if len(scenario) > MAX_SCENARIO_CHARS or seen_scenarios > MAX_RACES:
                raise ValueError('race_limit')
            if enabled[category]:
                race = {'race_scenario': scenario, 'title': 'Observed game replay',
                    'race_category': category, 'metadata': {'umaTrace': {
                        'endpointGroup': endpoint_category, 'categorySource': source}}}
                join = _join_keys(value)
                if join:
                    race['_room_join'] = join
                if isinstance(captured_at, str) and len(captured_at) <= 64:
                    race['captured_at'] = captured_at
                for key in RACE_NUMBERS:
                    n = _number(metadata.get(key))
                    if key == 'race_grade' and (type(n) is not int or not 0 <= n <= 10000):
                        continue
                    if key == 'start_time_type' and (type(n) is not int or not 1 <= n <= 4):
                        continue
                    if n is not None:
                        race[key] = n
                for key in CONDITIONS:
                    condition = metadata.get(key)
                    if _number(condition) is not None or isinstance(condition, str) and len(condition) <= 32:
                        race[key] = condition
                course = metadata.get('race_course_set')
                if isinstance(course, dict):
                    race['race_course_set'] = _copy(course)
                elif _number(course) is not None:
                    race['race_course_set'] = {'id': course}
                horses = metadata.get('race_horse_data_array', metadata.get('race_horse_data'))
                trained = next((metadata[key] for key in TRAINED_KEYS if isinstance(metadata.get(key), list)), None)
                if isinstance(horses, list):
                    if len(horses) > 64:
                        raise ValueError('runner_limit')
                    field_count = _scenario_runner_count(scenario)
                    teams = {}
                    copied = [_horse(h, field_count, teams) for h in horses]
                    if isinstance(trained, list):
                        if len(trained) > 64:
                            raise ValueError('runner_limit')
                        trained = [_copy(item) for item in trained]
                        copied = _attach_trained(copied, trained)
                        race['trained_chara_array'] = trained
                    race['race_horse_data_array'] = copied
                elif isinstance(trained, list):
                    if len(trained) > 64:
                        raise ValueError('runner_limit')
                    race['trained_chara_array'] = [_copy(item) for item in trained]
                result.append(race)
        starts, results = value.get('race_start_params_array'), value.get('race_result_array')
        paired = isinstance(starts, list) and isinstance(results, list)
        if paired:
            if len(starts) != len(results) or len(starts) > 100:
                raise ValueError('team_trial_pair_limit')
            for start, end in zip(starts, results):
                if not isinstance(start, dict) or not isinstance(end, dict):
                    raise ValueError('team_trial_pair_invalid')
                walk({**start, **end}, depth + 1, category_hint=('team-trials', 'content'))
        for key, nested in value.items():
            if key in EXCLUDED_BRANCHES:
                continue
            if paired and key in ('race_start_params_array', 'race_result_array'):
                continue
            if isinstance(nested, (dict, list)):
                same_race = key in ('race_scenario_info', 'room_info') and isinstance(nested, dict) and not isinstance(scenario, str)
                duplicate_wrapper = key in ('room_info', 'race_start_info', 'race_scenario_info') and isinstance(nested, dict) and nested.get('race_scenario') == scenario and isinstance(scenario, str)
                walk(nested, depth + 1, metadata if same_race else None,
                    (category, source) if source != 'unknown' else category_hint,
                    skip_scenario=duplicate_wrapper)

    walk(payload, category_hint=(endpoint_category, endpoint_source))
    return result
