"""Collect complete dependency notices into one deterministic UTF-8 document."""
import base64
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import sys
import tomllib

root = Path(__file__).resolve().parent.parent
output = root / '.cache' / 'desktop-licenses' / 'THIRD-PARTY-NOTICES.txt'
inventory = []
documents = {}


def add_notice(source, label):
    raw = source.read_bytes()
    # Deduplicate identical registry copies without overwriting differing text.
    if label in documents and documents[label] != raw:
        raise ValueError(f'Conflicting dependency notice: {label}')
    documents[label] = raw


def notices(source, label):
    for path in sorted(source.iterdir()):
        if path.is_file() and re.match(r'^(LICENSE|LICENCE|COPYING|NOTICE)', path.name, re.I):
            add_notice(path, label + '/' + path.name)


node_license = root / '.cache/analysis-runtime/LICENSE'
if node_license.is_file():
    add_notice(node_license, 'Node.js-LICENSE')
    inventory.append('Node.js 22 — MIT and bundled dependency licenses; headless analysis runtime')

python_license = Path(sys.base_prefix) / 'LICENSE.txt'
add_notice(python_license, 'Python-LICENSE.txt')
inventory.append(f'Python {sys.version.split()[0]} — PSF license; includes Windows runtime')
for distribution in importlib.metadata.distributions():
    name = distribution.metadata.get('Name', 'unknown')
    slug = re.sub(r'[^A-Za-z0-9_.-]', '_', name + '-' + distribution.version)
    inventory.append(f'Python package {name} {distribution.version}: {distribution.metadata.get("License-Expression") or distribution.metadata.get("License") or "see package notice"}')
    for file in distribution.files or []:
        if re.match(r'^(LICENSE|LICENCE|COPYING|NOTICE)', Path(str(file)).name, re.I):
            source = Path(distribution.locate_file(file))
            if source.is_file():
                add_notice(source, 'python/' + slug + '/' + str(file).replace('\\', '/'))

for name in ('svelte', 'pako', '@msgpack/msgpack'):
    source = root / 'node_modules' / name
    if source.exists():
        notices(source, 'frontend/' + name)
        package = json.loads((source / 'package.json').read_text(encoding='utf-8'))
        inventory.append(f'Frontend {name} {package["version"]}: {package.get("license", "see package notice")}')

# A restored Cargo cache can contain older dependency versions. Include only
# packages in this build's lockfile so the bundled notices do not keep growing.
locked = {(package['name'], package['version'])
          for package in tomllib.loads((root / 'src-tauri/Cargo.lock').read_text(encoding='utf-8'))['package']
          if package.get('source', '').startswith('registry+')}
found = set()
registry = root / '.cache' / 'cargo' / 'registry' / 'src'
for cargo_toml in sorted(registry.glob('*/*/Cargo.toml')):
    package = tomllib.loads(cargo_toml.read_text(encoding='utf-8'))['package']
    identity = (package['name'], package['version'])
    if identity not in locked:
        continue
    found.add(identity)
    name = package['name'] + '-' + package['version']
    notices(cargo_toml.parent, 'rust/' + name)
    inventory.append(f'Rust crate {name}: {package.get("license", "see package notice")}')
if missing := locked - found:
    raise ValueError('Missing locked Rust dependency notices; run cargo fetch --locked: ' + ', '.join('-'.join(identity) for identity in sorted(missing)))

# Build only from current sources, never from stale generated notice trees.
chunks = [b'Umalytics third-party dependency notices\n\n',
          b'Complete source notices follow the dependency inventory. Each section\n'
          b'records its original byte length and SHA-256. UTF-8 content is copied\n'
          b'verbatim; any other encoding is preserved losslessly as Base64.\n\n',
          ('\n'.join(sorted(set(inventory))) + '\n').encode('utf-8')]
for label, raw in sorted(documents.items()):
    try:
        raw.decode('utf-8')
        encoding, content = 'UTF-8 (verbatim)', raw
    except UnicodeDecodeError:
        encoding, content = 'Base64 (decode to recover original bytes)', base64.encodebytes(raw)
    header = (f'\n===== BEGIN NOTICE: {label} =====\n'
              f'Original bytes: {len(raw)}\nSHA-256: {hashlib.sha256(raw).hexdigest()}\n'
              f'Content encoding: {encoding}\n\n').encode('utf-8')
    chunks.extend((header, content, f'\n===== END NOTICE: {label} =====\n'.encode('utf-8')))
combined = b''.join(chunks)
output.parent.mkdir(parents=True, exist_ok=True)
if not output.is_file() or output.read_bytes() != combined:
    temporary = output.with_suffix('.partial')
    temporary.write_bytes(combined)
    temporary.replace(output)
