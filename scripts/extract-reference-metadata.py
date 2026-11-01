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
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
import master_metadata

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

extracted = master_metadata.metadata(db)
names, outfits, skill_names, skills = (extracted[key] for key in ('characters', 'outfits', 'skillNames', 'skills'))
records = {
    'schemaVersion': 1, 'characters': names, 'outfits': outfits,
    'trackNames': extracted['trackNames'], 'skillNames': skill_names, 'skills': skills,
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
