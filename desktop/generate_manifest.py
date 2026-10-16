"""Run after reference data changes and before the frontend production build."""
import hashlib
import json
import argparse
from pathlib import Path
from reference_data import FILES

folder = Path(__file__).resolve().parent.parent / 'public' / 'data'
parser = argparse.ArgumentParser()
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
files = {}
for name, limit in FILES.items():
    raw = (folder / name).read_bytes()
    if not 0 < len(raw) <= limit:
        raise ValueError('Reference file exceeds its packaging bound: ' + name)
    files[name] = {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
output = (json.dumps({'schemaVersion': 1, 'files': files}, indent=2) + '\n').encode('utf-8')
manifest = folder / 'update-manifest.json'
if args.check:
    if manifest.read_bytes() != output:
        raise SystemExit('Reference manifest is stale. Run python desktop/generate_manifest.py.')
elif not manifest.exists() or manifest.read_bytes() != output:
    # Keep the signed data digest identical on Windows and Linux, and avoid
    # rebuilding consumers when the reference files have not changed.
    manifest.write_bytes(output)
