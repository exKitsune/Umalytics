"""Copy a stopped legacy installation into the portable layout, verifying every byte."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('destination', type=Path, help='New installation folder; must not exist.')
args = parser.parse_args()
source, destination = args.source.resolve(strict=True), args.destination.resolve()
if destination.exists() or source == destination or source in destination.parents or destination in source.parents:
    raise SystemExit('Choose a new destination outside the source installation.')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from reference_data import FILES, validate_snapshot

active = json.loads((source / 'data/active.json').read_text(encoding='utf-8'))
digest = active.get('manifestSha256', '')
if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
    raise SystemExit('Invalid active data identity.')
snapshot = source / 'data' / digest
manifest = (snapshot / 'update-manifest.json').read_bytes()
contents = {name: (snapshot / name).read_bytes() for name in FILES}
validate_snapshot(manifest, contents)
if hashlib.sha256(manifest).hexdigest() != digest:
    raise SystemExit('Active reference data does not match its identity.')

mapping = []
for name in ('settings.json',):
    if (source / name).exists(): mapping.append((source / name, Path(name)))
for old, new in (('races', 'races'), ('exports', 'exports'), ('webview', 'cache/webview')):
    folder = source / old
    if not folder.exists(): continue
    for path in sorted(folder.rglob('*')):
        if path.is_symlink() or path.is_junction():
            raise SystemExit('Backup refuses linked paths.')
        if path.is_file(): mapping.append((path, Path(new) / path.relative_to(folder)))
for name in (*FILES, 'update-manifest.json'):
    mapping.append((snapshot / name, Path('data') / name))
mapping.append((source / 'data/active.json', Path('data/active.json')))
for path in sorted((source / 'proxy').iterdir()):
    if path.is_symlink() or not path.is_file(): raise SystemExit('Unexpected capture-store entry.')
    name = path.name.replace('mitmproxy-', 'umalytics-', 1)
    mapping.append((path, Path('capture') / name))

destination.parent.mkdir(parents=True, exist_ok=True)
staging = destination.parent / ('.umalytics-backup-' + uuid.uuid4().hex)
staging.mkdir()
data = staging / 'Umalytics-data'
records = []
try:
    for original, relative in mapping:
        if original.is_symlink() or original.is_junction(): raise ValueError('Linked source refused.')
        before = original.read_bytes()
        target = data / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(before)
        checksum = hashlib.sha256(before).hexdigest()
        if hashlib.sha256(target.read_bytes()).hexdigest() != checksum: raise ValueError('Backup verification failed.')
        records.append({'source': original.relative_to(source).as_posix(), 'destination': relative.as_posix(),
                        'bytes': len(before), 'sha256': checksum})
    for row in records:
        if hashlib.sha256((source / row['source']).read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('Source changed during backup; leave it closed and retry.')
    record = data / 'cache/backup-manifest.json'
    record.parent.mkdir(parents=True, exist_ok=True)
    record.write_text(json.dumps({'schemaVersion': 1, 'verified': True, 'files': records,
        'regeneratedByExecutable': ['runtime', 'dependency notices'],
        'referenceSnapshots': 'Active verified snapshot only'}, indent=2), encoding='utf-8')
    staging.rename(destination)
except Exception:
    # Preserve incomplete copies for inspection; never remove the source.
    print('Incomplete backup retained at', staging, file=sys.stderr)
    raise
print(json.dumps({'destination': str(destination), 'files': len(records),
                  'bytes': sum(row['bytes'] for row in records), 'verified': True}))
