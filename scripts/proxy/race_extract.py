"""Bounded race-field allowlisting. Decoded responses are never serialized."""
import math
import base64
import struct
import zlib

MAX_RACES = 100
MAX_SCENARIO_CHARS = 16 * 1024 * 1024
CATEGORIES = ('career', 'team-trials', 'practice', 'champions-meeting', 'other')
APTITUDES = ('proper_ground_turf', 'proper_ground_dirt', 'proper_distance_short',
    'proper_distance_mile', 'proper_distance_middle', 'proper_distance_long',
    'proper_running_style_nige', 'proper_running_style_senko',
    'proper_running_style_sashi', 'proper_running_style_oikomi')
HORSE_NUMBERS = ('frame_order', 'chara_id', 'card_id', 'speed', 'stamina', 'power',
    'pow', 'guts', 'wisdom', 'wiz', 'running_style', 'motivation',
    'single_mode_win_count', 'fan_count', 'rank_score', 'rarity') + APTITUDES
RACE_NUMBERS = ('distance', 'race_distance', 'lane_distance_max', 'race_course_id', 'course_id', 'race_instance_id', 'random_seed', 'race_grade', 'start_time_type')
CONDITIONS = ('season', 'weather', 'ground_condition')
EXCLUDED_BRANCHES = frozenset(('auth', 'auth_data', 'auth_key', 'authentication', 'headers', 'request', 'requests',
    'request_headers', 'request_body', 'session', 'device', 'user_info', 'trainer_info',
    'chara_info', 'race_horse_data', 'race_horse_data_array', 'skill_array', 'race_course_set'))


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


def _horse(value, runner_count=None, team_groups=None):
    if not isinstance(value, dict):
        return {}
    result = {key: _number(value.get(key)) for key in HORSE_NUMBERS if _number(value.get(key)) is not None}
    # RaceDefine.RaceNpcType metadata: Normal=0, Boss=3, User=11,
    # UserOther=20. Ghost=21/Follow=22 do not establish player classification.
    # Keep only the boolean class, never the viewer/owner identifier.
    explicit_npc = value.get('is_npc', value.get('isNpc'))
    npc_type = value.get('npc_type', value.get('NpcType'))
    if type(explicit_npc) is bool:
        result['is_npc'] = explicit_npc
    elif type(npc_type) is int and npc_type in (0, 3, 11, 20):
        result['is_npc'] = npc_type in (0, 3)
    popularity = value.get('popularity', value.get('Popularity'))
    if runner_count is not None and type(popularity) is int and 1 <= popularity <= runner_count:
        result['popularity'] = popularity
    # Raw team IDs may resemble other identifiers. Only anonymous local ordinal
    # membership survives; viewer/owner/trainer fields are never consulted.
    raw_team = _number(value.get('team_id', value.get('TeamId')))
    if team_groups is not None and raw_team is not None and type(raw_team) is int and raw_team > 0:
        if raw_team not in team_groups:
            team_groups[raw_team] = len(team_groups) + 1
        result['team_group'] = team_groups[raw_team]
    name = value.get('chara_name')
    if isinstance(name, str) and len(name) <= 200:
        result['chara_name'] = name
    skills = value.get('skill_array')
    if isinstance(skills, list):
        if len(skills) > 1000:
            raise ValueError('skill_limit')
        result['skill_array'] = [{k: _number(s.get(k)) for k in ('id', 'skill_id', 'level')
            if _number(s.get(k)) is not None} if isinstance(s, dict) else {'id': s}
            for s in skills if isinstance(s, dict) or _number(s) is not None]
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
    result = {key: value[key] for key in (*RACE_NUMBERS, *CONDITIONS, 'race_type',
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
        result.update({key: start[key] for key in (*RACE_NUMBERS, *CONDITIONS,
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
                    aliases = {'id': ('Id', 'course_id', 'courseId', '<Id>k__BackingField'),
                        'distance': ('Distance', '<Distance>k__BackingField'),
                        'lane_distance_max': ('LaneDistanceMax', 'laneDistanceMax', '<LaneDistanceMax>k__BackingField')}
                    safe_course = {}
                    for key, names in aliases.items():
                        for name in (key, *names):
                            n = _number(course.get(name))
                            if n is not None:
                                safe_course[key] = n
                                break
                    race['race_course_set'] = safe_course
                elif _number(course) is not None:
                    race['race_course_set'] = {'id': course}
                horses = metadata.get('race_horse_data_array', metadata.get('race_horse_data'))
                if isinstance(horses, list):
                    if len(horses) > 64:
                        raise ValueError('runner_limit')
                    field_count = _scenario_runner_count(scenario)
                    teams = {}
                    race['race_horse_data_array'] = [_horse(h, field_count, teams) for h in horses]
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
