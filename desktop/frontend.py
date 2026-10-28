"""Serve the desktop's immutable frontend without restarting the collector."""
import json
import mimetypes
import re
from pathlib import Path, PurePosixPath


class DesktopFrontend:
    def __init__(self, data_dir):
        self.root = Path(data_dir) / 'runtime/frontend'
        self.bundle = None

    def asset(self, name):
        try:
            pointer = self.root / 'current.json'
            if not pointer.is_symlink() and pointer.stat().st_size < 1024:
                value = json.loads(pointer.read_bytes())
                if value.get('schemaVersion') == 1 and re.fullmatch('[0-9a-f]{64}', value.get('bundle', '')):
                    candidate = self.root / value['bundle']
                    if candidate.is_dir() and not candidate.is_symlink():
                        self.bundle = candidate
        except (OSError, ValueError, TypeError):
            pass
        parts = PurePosixPath(name.lstrip('/') or 'index.html').parts
        if not self.bundle or any(p in ('.', '..') or '\\' in p or ':' in p for p in parts):
            return None
        path = self.bundle.joinpath(*parts)
        try:
            if any(p.is_symlink() for p in [self.root, self.root.parent, self.bundle, path, *path.parents]):
                return None
            if not path.is_file() or path.stat().st_size > 32 * 1024 * 1024:
                return None
            return path.read_bytes(), mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        except OSError:
            return None
