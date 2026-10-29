"""Generate public skill/course JSON offline from explicitly selected game inputs.

SQLite is read-only. Cached CourseParamTable assets supply event distances;
--course-events accepts previously decoded courseParams JSON instead. No game,
network, account database or source bundle is executed, copied or published.
"""
import argparse
import hashlib
import json
from public_json import public_json
import math
from pathlib import Path
import re
import runpy
import sqlite3
import subprocess
import sys

SCRIPT = Path(__file__).resolve().parent
EXCLUDED = {11201: 'Incomplete Longchamp event definition', 11202: 'Missing Longchamp event definition'}
EVENT_NAME = re.compile(r'^race/courseeventparam/(\d+)/pfb_prm_race\1$')


def file_sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def outside(output, source):
    if output == source or source in output.parents:
        raise ValueError('Output must stay outside the selected source directories.')


def finite(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Invalid course event number.')
    return value


def event_segments(tree, distance):
    events = tree.get('courseParams')
    if not isinstance(events, list) or len(events) > 10000:
        raise ValueError('Missing/excessive courseParams.')
    corners, straights, slopes, pending = [], [], [], None
    for event in events:
        if not isinstance(event, dict):
            raise ValueError('Invalid course event.')
        kind = finite(event.get('_paramType'))
        if kind not in (0, 2, 11):
            continue
        position = round(finite(event.get('_distance')), 2)
        values = event.get('_values')
        if position < 0 or position > 100000 or not isinstance(values, list) or len(values) < 2:
            raise ValueError('Invalid course event position/values.')
        first, length = finite(values[0]), finite(values[1])
        if kind == 0:
            if length <= 0 or length > 100000:
                raise ValueError('Invalid corner extent.')
            corners.append({'start': position, 'length': length})
        elif kind == 2:
            if first == 1 and pending is None:
                pending = {'start': position, 'frontType': length}
            elif first == 2 and pending is not None and position > pending['start']:
                straights.append({**pending, 'end': position})
                pending = None
            else:
                raise ValueError('Unpaired course straight events.')
        else:
            if length <= 0 or length > 100000:
                raise ValueError('Invalid slope extent.')
            slopes.append({'start': position, 'length': length, 'slope': first})
    if pending is not None:
        raise ValueError('Unclosed course straight.')
    return {'corners': sorted(corners, key=lambda v: v['start']),
            'straights': sorted(straights, key=lambda v: v['start']),
            'slopes': sorted(slopes, key=lambda v: v['start'])}


def cached_reader(cache):
    # Reuse the already documented public static catalog/bundle transforms.
    helpers = runpy.run_path(str(SCRIPT / 'extract-course-geometry.py'))
    apsw, unity = helpers['apsw'], helpers['UnityPy']
    catalog = apsw.Connection(str(cache / 'meta'), flags=apsw.SQLITE_OPEN_READONLY)
    catalog.execute("PRAGMA cipher='chacha20'")
    catalog.execute("PRAGMA hexkey='" + helpers['META_KEY'] + "'")
    catalog.execute('PRAGMA query_only=ON')
    assets = {}
    for name, token, key in catalog.execute("SELECT n,h,e FROM a WHERE n LIKE 'race/courseeventparam/%/pfb_prm_race%'"):
        match = EVENT_NAME.fullmatch(name)
        if match:
            assets[int(match[1])] = (name, token, key)
    catalog.close()
    def read(course_id):
        name, token, key = assets[course_id]
        if not re.fullmatch(r'[A-Z2-7]{32}', token):
            raise ValueError('Invalid course asset catalog token.')
        path = cache / 'dat' / token[:2] / token
        if path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError('Course asset exceeds size limit.')
        raw = path.read_bytes()
        env = unity.load(helpers['decrypt_bundle'](raw, key))
        scripts = {o.path_id: o.read_typetree() for o in env.objects if o.type.name == 'MonoScript'}
        trees = []
        for obj in env.objects:
            if obj.type.name != 'MonoBehaviour':
                continue
            tree = obj.read_typetree()
            script = scripts.get(tree.get('m_Script', {}).get('m_PathID'), {})
            if script.get('m_ClassName') == 'CourseParamTable' and 'courseParams' in tree:
                trees.append((tree, script.get('m_ClassName')))
        if len(trees) != 1:
            raise ValueError('Expected one course event parameter object.')
        return trees[0][0], {'logicalName': name, 'assetHash': token,
            'sha256': hashlib.sha256(raw).hexdigest(), 'className': trees[0][1]}
    return read, {'catalogSha256': file_sha(cache / 'meta'), 'unityPyVersion': unity.__version__}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--master', type=Path, required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--cache', type=Path)
    source.add_argument('--course-events', type=Path)
    parser.add_argument('--output', type=Path, default=SCRIPT.parent / 'research/generated-reference')
    args = parser.parse_args()
    master, output = args.master.resolve(strict=True), args.output.resolve()
    outside(output, master.parent)
    input_dir = (args.cache or args.course_events).resolve(strict=True)
    outside(output, input_dir)
    if args.cache:
        read_events, asset_source = cached_reader(input_dir)
    else:
        def read_events(course_id):
            path = input_dir / f'{course_id}.json'
            if path.stat().st_size > 8 * 1024 * 1024:
                raise ValueError('Course event JSON exceeds size limit.')
            return json.loads(path.read_text(encoding='utf-8-sig')), {'sha256': file_sha(path)}
        asset_source = {'kind': 'Explicit decoded course event JSON'}
    db = sqlite3.connect(master.as_uri() + '?mode=ro&immutable=1', uri=True)
    db.row_factory = sqlite3.Row
    statuses = {r[0]: [v for v in r[1:] if v] for r in db.execute(
        'SELECT course_set_status_id,target_status_1,target_status_2 FROM race_course_set_status')}
    courses, assets = {}, {}
    rows = list(db.execute('SELECT id,race_track_id,distance,ground,inout,turn,float_lane_max,course_set_status_id,finish_time_min,finish_time_max FROM race_course_set ORDER BY id'))
    for row in rows:
        course_id, distance = row['id'], row['distance']
        if course_id in EXCLUDED:
            continue
        tree, identity = read_events(course_id)
        courses[str(course_id)] = {'raceTrackId': row['race_track_id'], 'distance': distance,
            'distanceType': 1 if distance <= 1400 else 2 if distance <= 1800 else 3 if distance < 2500 else 4,
            'surface': row['ground'], 'turn': row['turn'], 'course': row['inout'], 'laneMax': row['float_lane_max'],
            'finishTimeMin': row['finish_time_min'], 'finishTimeMax': row['finish_time_max'],
            'courseSetStatus': statuses.get(row['course_set_status_id'], []), **event_segments(tree, distance)}
        assets[str(course_id)] = identity
    db.close()
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, str(SCRIPT / 'extract-reference-metadata.py'), str(master),
        '--output', str(output / 'metadata.json'), '--identity-output', str(output / 'course-identities.json')], check=True)
    source = {'name': 'Direct installed Global master and CourseParamTable reference',
        'revision': file_sha(master), 'url': 'https://\x75mamusume.com/', 'license': 'Game metadata © the UM:PD rights holders',
        'tables': ['text_data', 'skill_data', 'race_instance', 'race', 'race_course_set', 'race_course_set_status', 'single_mode_program'],
        'eventTransforms': {'0': 'Corner start/length', '2': 'Paired straight boundaries/frontType', '11': 'Slope start/length/grade'},
        'distanceDecimals': 2, 'excludedCourses': {str(k): v for k, v in EXCLUDED.items()},
        'notes': ['Reference definitions, not a generated observed replay or simulator compatibility list.',
            'Serialized event ranges may extend beyond the finish; retained without truncation.',
            'No source database, asset bundle, account data or original source path is included.'], **asset_source}
    for name, data in [('courses.json', courses), ('reference-source.json', source), ('course-event-source.json', assets)]:
        (output / name).write_text(public_json(json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)), encoding='utf8')
    print(json.dumps({'masterCourses': len(rows), 'generatedCourses': len(courses), 'excludedCourses': [r['id'] for r in rows if r['id'] in EXCLUDED]}, separators=(',', ':')))


if __name__ == '__main__':
    main()
