"""Read only public game metadata from an explicitly selected local master SQLite.

No account, save or response database is accessed. The complete source database
is never copied. The output contains names, IDs and raw skill definitions only.
"""
import argparse
import hashlib
import json
from public_json import public_json
from pathlib import Path
import sqlite3

p = argparse.ArgumentParser()
p.add_argument('master', type=Path)
p.add_argument('--output', type=Path, default=Path('public/data/metadata.json'))
p.add_argument('--identity-output', type=Path, help='Course lookup output; custom metadata output defaults to the same directory.')
a = p.parse_args()
master = a.master.resolve(strict=True)
identity_output = a.identity_output or (Path('src/data/course-identities.json')
    if a.output == Path('public/data/metadata.json') else a.output.with_name('course-identities.json'))
for output in (a.output.resolve(), identity_output.resolve()):
    if output == master or master.parent == output.parent or master.parent in output.parents:
        p.error('Outputs must stay outside the source database directory.')
db = sqlite3.connect(master.as_uri() + '?mode=ro&immutable=1', uri=True)
db.row_factory = sqlite3.Row

def texts(category):
    return {str(row['index']): row['text'] for row in db.execute(
        'SELECT [index], text FROM text_data WHERE category = ?', (category,))}

names = texts(6)
outfits = texts(5)
skill_names = texts(47)
skill_descriptions = texts(48)
skills = {}
for row in db.execute('SELECT * FROM skill_data'):
    sid = str(row['id'])
    if sid not in skill_names:
        continue
    skills[sid] = {'name': skill_names[sid], 'rarity': row['rarity'],
        'groupId': row['group_id'], 'activateLot': row['activate_lot'],
        'iconId': row['icon_id'], 'description': skill_descriptions.get(sid),
        **({'tagIds': [int(tag) for tag in str(row['tag_id']).split('/') if tag.isdigit()]} if 'tag_id' in row.keys() else {}), 'branches': []}
    for branch in (1, 2):
        condition = row[f'condition_{branch}']
        effects = [{'type': row[f'ability_type_{branch}_{i}'],
            'rawValue': row[f'float_ability_value_{branch}_{i}'],
            'valueUsage': row[f'ability_value_usage_{branch}_{i}'],
            'levelUsage': row[f'ability_value_level_usage_{branch}_{i}'],
            'targetType': row[f'target_type_{branch}_{i}'], 'targetValue': row[f'target_value_{branch}_{i}'],
            'additionalActivateType': row[f'additional_activate_type_{branch}_{i}']} for i in (1, 2, 3)
            if row[f'ability_type_{branch}_{i}'] != 0]
        if condition or effects:
            skills[sid]['branches'].append({'condition': condition, 'branchIndex': branch - 1,
                'precondition': row[f'precondition_{branch}'], 'rawCooldown': row[f'float_cooldown_time_{branch}'],
                'rawDuration': row[f'float_ability_time_{branch}'],
                'durationUsage': row[f'ability_time_usage_{branch}'], 'effects': effects})
records = {
    'schemaVersion': 1, 'characters': names, 'outfits': outfits,
    'trackNames': texts(35), 'skillNames': skill_names, 'skills': skills,
    'raceInstances': {str(row[0]): row[1] for row in db.execute(
        'SELECT ri.id, r.course_set FROM race_instance ri JOIN race r ON r.id = ri.race_id')},
    'source': {'name': 'Local Global master SQLite public metadata',
        'revision': hashlib.sha256(master.read_bytes()).hexdigest(),
        'url': 'https://\x75mamusume.com/', 'license': 'Game metadata © the UM:PD rights holders',
        'modified': master.stat().st_mtime,
        'notes': 'Independently selected public metadata columns; no user/account data or artwork.'},
}
race_columns = {row[1] for row in db.execute('PRAGMA table_info(race)')}
if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='single_mode_program'").fetchone():
    records['racePrograms'] = {str(row[0]): row[1] for row in db.execute('SELECT id,race_instance_id FROM single_mode_program')}
instance_columns = {row[1] for row in db.execute('PRAGMA table_info(race_instance)')}
condition_columns = ([('grade', 'r.grade')] if 'grade' in race_columns else []) + ([('time', 'ri.time')] if 'time' in instance_columns else [])
if condition_columns:
    columns = ','.join(column for _, column in condition_columns)
    records['raceInstanceConditions'] = {str(row[0]): {key: row[i + 1] for i, (key, _) in enumerate(condition_columns)
        if type(row[i + 1]) is int and (row[i + 1] >= 0 if key == 'grade' else 1 <= row[i + 1] <= 4)} for row in db.execute(
        f'SELECT ri.id,{columns} FROM race_instance ri JOIN race r ON r.id=ri.race_id')}
a.output.parent.mkdir(parents=True, exist_ok=True)
a.output.write_text(public_json(json.dumps(records, ensure_ascii=False, separators=(',', ':'))), encoding='utf8')
identity_output.parent.mkdir(parents=True, exist_ok=True)
identity_output.write_text(public_json(json.dumps({'distances': {str(row[0]): row[1] for row in db.execute(
    'SELECT id, distance FROM race_course_set')}, 'raceInstances': records['raceInstances'],
    **({'racePrograms': records['racePrograms']} if 'racePrograms' in records else {}),
    **({'raceInstanceConditions': records['raceInstanceConditions']} if 'raceInstanceConditions' in records else {}),
    'source': {'masterSha256': records['source']['revision'], 'tables': 'race_instance JOIN race; race_course_set; single_mode_program (when present)'}},
    separators=(',', ':'))), encoding='utf8')
print(f'{len(names)} character names, {len(outfits)} outfit labels, {len(skill_names)} skill names, {len(skills)} skill records')
db.close()
