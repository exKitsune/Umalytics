"""Collect pinned, hash-verified dependency source archives for release recipients."""
import base64
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import tomllib
import urllib.request


def download(url, cache, algorithm='sha256', expected=None):
    if not url.startswith('https://'):
        raise ValueError('Dependency source URLs must use HTTPS')
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / hashlib.sha256(url.encode()).hexdigest()
    if not path.exists():
        with urllib.request.urlopen(url, timeout=60) as response:
            raw = response.read()
        if expected and hashlib.new(algorithm, raw).digest() != expected:
            raise ValueError('Dependency source checksum mismatch: ' + url)
        path.write_bytes(raw)
    if expected and hashlib.new(algorithm, path.read_bytes()).digest() != expected:
        raise ValueError('Cached dependency source checksum mismatch: ' + url)
    return path


def collect(root):
    cache = root / '.cache/dependency-sources'
    records = []
    files = {}
    def add(kind, name, version, url, path):
        filename = re.sub(r'[^A-Za-z0-9_.-]', '_', f'{name}-{version}')
        suffix = '.crate' if kind == 'rust' else '.zip' if url.endswith('.zip') else '.tar.gz'
        target = f'dependency-sources/{kind}/{filename}{suffix}'
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if target in files and files[target].read_bytes() != path.read_bytes():
            raise ValueError('Conflicting dependency source: ' + target)
        files[target] = path
        records.append(dict(kind=kind, name=name, version=version, url=url,
                            file=target, sha256=digest))

    cargo_home = Path(os.environ.get('CARGO_HOME', root / '.cache/cargo'))
    crates = {}
    for name in ('src-tauri/Cargo.lock', 'simulation/simulator-worker/Cargo.lock'):
        for package in tomllib.loads((root / name).read_text(encoding='utf-8'))['package']:
            if not package.get('source'):
                continue
            if package['source'] != 'registry+https://github.com/rust-lang/crates.io-index':
                raise ValueError('Add a pinned source export for Cargo dependency: ' + package['name'])
            crates[package['name'], package['version']] = package['checksum']
    for (name, version), checksum in sorted(crates.items()):
        filename = f'{name}-{version}.crate'
        url = f'https://static.crates.io/crates/{name}/{filename}'
        candidates = list((cargo_home / 'registry/cache').glob('*/' + filename))
        path = candidates[0] if candidates else download(url, cache, expected=bytes.fromhex(checksum))
        if hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
            raise ValueError('Cargo source checksum mismatch: ' + filename)
        add('rust', name, version, url, path)

    # Include runtime npm packages. General-purpose build tools are identified
    # by package-lock.json and remain available through npm ci.
    for key, package in sorted(json.loads((root / 'package-lock.json').read_bytes())['packages'].items()):
        if not key or package.get('dev'):
            continue
        name = key.rsplit('node_modules/', 1)[-1]
        algorithm, checksum = package['integrity'].split('-', 1)
        path = download(package['resolved'], cache, algorithm, base64.b64decode(checksum))
        add('npm', name, package['version'], package['resolved'], path)

    overrides = json.loads((root / 'scripts/data/dependency-source-overrides.json').read_bytes())
    for distribution in sorted(importlib.metadata.distributions(), key=lambda d: d.metadata['Name'].lower()):
        name, version = distribution.metadata['Name'], distribution.version
        with urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json', timeout=30) as response:
            release = json.load(response)
        sources = [item for item in release['urls'] if item['packagetype'] == 'sdist']
        if sources:
            source = sources[0]
            url, checksum = source['url'], source['digests']['sha256']
        else:
            key = re.sub(r'[-_.]+', '-', name).lower() + '==' + version
            if key not in overrides:
                raise ValueError('No pinned source distribution for ' + key)
            url, checksum = overrides[key]['url'], overrides[key]['sha256']
        path = download(url, cache, expected=bytes.fromhex(checksum))
        add('python', name, version, url, path)
    return files, records
