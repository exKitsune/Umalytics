"""Stamp a release build and sign its byte-exact manifest without exposing keys."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from desktop.updater import REPOSITORY, verify_manifest
from desktop.app_components import read_components
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def prepare(build, commit):
    if not 1 <= build <= 2147483647 or not re.fullmatch('[0-9a-f]{40}', commit):
        raise ValueError('A positive release run number and full commit are required.')
    version = f'0.2.{build}'
    write_json(ROOT / 'desktop/build-info.json', {'schemaVersion': 1, 'version': version, 'buildNumber': build, 'commit': commit})
    for name in ('package.json', 'package-lock.json', 'src-tauri/tauri.conf.json'):
        path = ROOT / name
        value = json.loads(path.read_text(encoding='utf-8'))
        value['version'] = version
        if name == 'package-lock.json':
            value['packages']['']['version'] = version
        write_json(path, value)
    cargo = ROOT / 'src-tauri/Cargo.toml'
    raw = cargo.read_text(encoding='utf-8')
    raw, count = re.subn(r'(?m)^version = "[^"]+"$', f'version = "{version}"', raw, count=1)
    if count != 1:
        raise ValueError('Cargo package version is missing.')
    cargo.write_text(raw, encoding='utf-8')
    lock = ROOT / 'src-tauri/Cargo.lock'
    raw = lock.read_text(encoding='utf-8')
    raw, count = re.subn(r'(\[\[package\]\]\nname = "umatrace"\nversion = ")[^"]+("\n)', rf'\g<1>{version}\2', raw)
    if count != 1:
        raise ValueError('Locked Cargo package version is missing.')
    lock.write_text(raw, encoding='utf-8')
    print(f'Prepared Umalytics {version} ({commit}).')


def sign(executable, output):
    # Only the raw 32-byte seed is accepted. Never pass the secret on a command
    # line, write it to the checkout, or include it in an exception message.
    try:
        secret = base64.b64decode(os.environ.get('UMALYTICS_UPDATE_SIGNING_KEY', ''), validate=True)
        if len(secret) != 32:
            raise ValueError()
        key = Ed25519PrivateKey.from_private_bytes(secret)
    except (ValueError, TypeError) as error:
        raise ValueError('UMALYTICS_UPDATE_SIGNING_KEY must contain a base64 raw 32-byte Ed25519 private key.') from None
    expected = bytes.fromhex((ROOT / 'desktop/update-public-key.txt').read_text(encoding='ascii').strip())
    actual = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    if actual != expected:
        raise ValueError('The signing key does not match the public key embedded in this application.')
    info = json.loads((ROOT / 'desktop/build-info.json').read_text(encoding='utf-8'))
    parts = read_components(executable)
    if parts and (parts['appVersion'] != info['version'] or parts['buildNumber'] != info['buildNumber']):
        raise ValueError('Executable component identity differs from the release version.')
    raw_executable = executable.read_bytes()
    manifest = {'schemaVersion': 1, 'version': info['version'], 'buildNumber': info['buildNumber'],
                'commit': info['commit'], 'filename': 'Umalytics.exe', 'bytes': len(raw_executable),
                'sha256': hashlib.sha256(raw_executable).hexdigest(),
                'dataSha256': hashlib.sha256((ROOT / 'public/data/update-manifest.json').read_bytes()).hexdigest(),
                'releaseUrl': f"{REPOSITORY}/releases/tag/v{info['version']}"}
    raw = (json.dumps(manifest, sort_keys=True, separators=(',', ':')) + '\n').encode()
    signature = base64.b64encode(key.sign(raw)) + b'\n'
    verify_manifest(raw, signature, expected)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'release-manifest.json').write_bytes(raw)
    (output / 'release-manifest.sig').write_bytes(signature)
    print(f"Signed Umalytics {info['version']}: {len(raw_executable)} bytes, SHA-256 {manifest['sha256']}.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    stamp = commands.add_parser('prepare')
    stamp.add_argument('--build-number', type=int, required=True)
    stamp.add_argument('--commit', required=True)
    signer = commands.add_parser('sign')
    signer.add_argument('--executable', type=Path, default=ROOT / '.cache/dist/Umalytics.exe')
    signer.add_argument('--output', type=Path, default=ROOT / '.cache/dist')
    args = parser.parse_args()
    try:
        if args.command == 'prepare':
            prepare(args.build_number, args.commit)
        else:
            sign(args.executable, args.output)
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f'Release preparation failed: {error}\n')


if __name__ == '__main__':
    main()
