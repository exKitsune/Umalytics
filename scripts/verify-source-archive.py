"""Verify extracted source bytes without contacting upstream repositories."""
import hashlib
import json
from pathlib import Path, PurePosixPath


def verify(root):
    manifest = json.loads((root / 'SOURCE-MANIFEST.json').read_bytes())
    if manifest.get('schemaVersion') != 1 or not isinstance(manifest.get('files'), dict):
        raise ValueError('Invalid source manifest')
    for name, expected in manifest['files'].items():
        relative = PurePosixPath(name)
        path = (root / name).resolve()
        if relative.is_absolute() or '..' in relative.parts or not path.is_relative_to(root.resolve()):
            raise ValueError('Invalid source manifest path')
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('Source archive file changed: ' + name)
    return len(manifest['files'])


if __name__ == '__main__':
    print(f'Verified {verify(Path(__file__).resolve().parents[1])} source files.')
