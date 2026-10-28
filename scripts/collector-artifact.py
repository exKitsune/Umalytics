"""Reuse byte-identical collector builds when every packaged input is unchanged."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import importlib.metadata
import sys

ROOT = Path(__file__).resolve().parents[1]


def fingerprint():
    paths = []
    for folder in ('desktop', 'scripts/proxy', 'simulation/analysis', 'simulation/bundles', 'public/data',
                   '.cache/analysis-runtime', '.cache/desktop-licenses'):
        paths.extend(p for p in (ROOT / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts
                     and p.suffix != '.pyc' and p.name != 'build-info.json')
    paths.extend(ROOT / p for p in ('simulation/engine-registry.json', 'simulation/installed-bundles.json',
                                   'scripts/collector-artifact.py', 'src-tauri/icons/icon.ico'))
    digest = hashlib.sha256()
    digest.update(sys.version.encode())
    for distribution in sorted(importlib.metadata.distributions(), key=lambda d: d.metadata.get('Name', '')):
        digest.update((distribution.metadata.get('Name', '') + '==' + distribution.version).encode())
    for path in sorted(set(paths)):
        digest.update(path.relative_to(ROOT).as_posix().encode() + b'\0')
        with path.open('rb') as stream:
            digest.update(hashlib.file_digest(stream, 'sha256').digest())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['restore', 'save', 'stamp'])
    args = parser.parse_args()
    artifact = ROOT / '.cache/desktop-service/UmaTraceService.exe'
    cache = ROOT / '.cache/collector-artifacts'
    if args.action == 'stamp':
        import sys
        sys.path.insert(0, str(ROOT / 'desktop'))
        from app_components import append_components
        info = json.loads((ROOT / 'desktop/build-info.json').read_bytes())
        with artifact.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        append_components(ROOT / '.cache/dist/Umalytics.exe', digest, info)
        return
    key = fingerprint()
    cache.mkdir(parents=True, exist_ok=True)
    cached = cache / 'collector.exe'
    record = cache / 'identity.json'
    if args.action == 'restore':
        build = ROOT / '.cache/collector-build'
        build.mkdir(parents=True, exist_ok=True)
        (build / 'build-info.json').write_text(json.dumps({'schemaVersion': 1, 'version': '0.2.0', 'buildNumber': 0, 'commit': '0' * 40}))
        (build / 'inputs.txt').write_text(key)
        try:
            identity = json.loads(record.read_bytes())
            with cached.open('rb') as stream:
                valid = hashlib.file_digest(stream, 'sha256').hexdigest() == identity['sha256']
            if identity['inputs'] == key and valid:
                artifact.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(cached, artifact)
                print('Reused byte-identical collector artifact.')
                return
        except (OSError, ValueError, KeyError):
            pass
        raise SystemExit(2)  # An ordinary cache miss; caller builds the collector.
    if (ROOT / '.cache/collector-build/inputs.txt').read_text() != key:
        raise ValueError('Collector inputs changed during packaging; rebuild before caching.')
    shutil.copyfile(artifact, cached)
    with cached.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    record.write_text(json.dumps({'inputs': key, 'sha256': digest}))


if __name__ == '__main__':
    main()
