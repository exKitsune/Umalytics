"""Extract the game's Veteran favorite markers from a supplied cache, read-only."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import runpy
from public_json import public_json

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--cache', type=Path, required=True)
parser.add_argument('--output', type=Path, default=Path('public/veterans'))
args = parser.parse_args()
cache, output = args.cache.resolve(), args.output.resolve()
if cache == output or cache in output.parents or output in cache.parents:
    parser.error('Output must be separate from the game cache.')
helpers = runpy.run_path(str(Path(__file__).with_name('extract-course-geometry.py')))
db = helpers['apsw'].Connection(str(cache / 'meta'), flags=helpers['apsw'].SQLITE_OPEN_READONLY)
db.execute("PRAGMA cipher='chacha20'")
db.execute("PRAGMA hexkey='" + helpers['META_KEY'] + "'")
db.execute('PRAGMA query_only=ON')
rows = list(db.execute("select n,h,e from a where n='atlas/common/common_tex'"))
db.close()
output.mkdir(parents=True, exist_ok=True)
records = []
for name, hashed, key in rows:
    if not re.fullmatch(r'[a-zA-Z0-9]{8,128}', hashed):
        raise ValueError('Invalid asset hash')
    raw = (cache / 'dat' / hashed[:2] / hashed).read_bytes()
    env = helpers['UnityPy'].load(helpers['decrypt_bundle'](raw, key))
    for obj in env.objects:
        if obj.type.name != 'Sprite':
            continue
        match = re.fullmatch(r'utx_ico_favorite_03_(\d+)', obj.peek_name() or '')
        if not match:
            continue
        filename = f'marker-{int(match[1])}.png'
        path = output / filename
        if path.resolve().parent != output:
            raise ValueError('Output symlink is outside the destination')
        image = obj.read().image
        image.save(path)
        records.append(dict(file=filename, sprite=obj.peek_name(), catalogName=name,
                            bundleSha256=hashlib.sha256(raw).hexdigest(),
                            sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
if len(records) != 16:
    raise ValueError(f'Expected 16 markers, found {len(records)}')
(output / 'source.json').write_text(public_json(json.dumps(dict(
    source='Installed game asset cache', copyright='UM:PD rights holders',
    decoder='UnityPy ' + helpers['UnityPy'].__version__, records=records), indent=2)) + '\n', encoding='utf-8')
print(f'Extracted {len(records)} Veteran markers.')
