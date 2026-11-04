"""Serve immutable desktop assets, decompressing only requested packed entries."""
from collections import OrderedDict
import gzip
import hashlib
import io
import json
import mimetypes
import re
from pathlib import Path, PurePosixPath
import threading
import zlib

from storage import linked

MAX_ASSET = 32 * 1024 * 1024


class DesktopFrontend:
    def __init__(self, data_dir):
        self.root = Path(data_dir) / 'runtime/frontend'
        self.bundle = None
        self.schema = 1
        self.manifest = {}
        self.identity = None
        self.cache = OrderedDict()
        self.cache_bytes = 0
        self.lock = threading.RLock()

    def asset(self, name):
        with self.lock:
            try:
                return self._asset(name)
            except (OSError, ValueError, TypeError, KeyError, EOFError, zlib.error):
                return None

    def _asset(self, name):
        try:
            pointer = self.root / 'current.json'
            if not linked(pointer) and pointer.stat().st_size < 1024:
                value = json.loads(pointer.read_bytes())
                if not isinstance(value, dict):
                    value = {}
                schema, identity = value.get('schemaVersion'), value.get('bundle', '')
                if schema in (1, 2) and isinstance(identity, str) and re.fullmatch('[0-9a-f]{64}', identity):
                    candidate = self.root / identity
                    if candidate.is_dir() and not any(linked(p) for p in (candidate, *candidate.parents)):
                        self.bundle, self.schema = candidate, schema
        except (OSError, ValueError, TypeError):
            pass  # Retain the last bundle during an interrupted pointer update.
        parts = PurePosixPath(name.lstrip('/') or 'index.html').parts
        if not self.bundle or any(p in ('.', '..') or '\\' in p or ':' in p for p in parts):
            return None
        if any(linked(p) for p in (self.bundle, *self.bundle.parents)):
            return None
        if self.schema == 1:
            path = self.bundle.joinpath(*parts)
            if any(linked(p) for p in (path, *path.parents)) or not path.is_file() or path.stat().st_size > MAX_ASSET:
                return None
            return path.read_bytes(), mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        manifest_path, pack = self.bundle / 'manifest.json', self.bundle / 'assets.pack'
        if linked(manifest_path) or linked(pack):
            return None
        ms, ps = manifest_path.stat(), pack.stat()
        identity = (self.bundle, ms.st_mtime_ns, ms.st_ctime_ns, ms.st_size, ps.st_mtime_ns, ps.st_ctime_ns, ps.st_size)
        if self.identity != identity:
            self.identity = None
            self.cache.clear()
            self.cache_bytes = 0
            if ms.st_size > 4 * 1024 * 1024 or ps.st_size > 512 * 1024 * 1024:
                return None
            raw = manifest_path.read_bytes()
            if hashlib.sha256(raw).hexdigest() != self.bundle.name:
                return None
            manifest = json.loads(raw)
            if not isinstance(manifest, dict):
                return None
            self.manifest, self.identity = manifest, identity
        name = '/'.join(parts)
        if name in self.cache:
            self.cache.move_to_end(name)
            return self.cache[name]
        entry = self.manifest.get(name)
        if not isinstance(entry, list) or len(entry) != 4:
            return None
        offset, length, size, digest = entry
        if (any(type(n) is not int or n < 0 for n in (offset, length, size))
                or size > MAX_ASSET or length > MAX_ASSET + 65536 or offset + length > ps.st_size
                or not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest)):
            return None
        with pack.open('rb') as source:
            source.seek(offset)
            compressed = source.read(length)
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as source:
            raw = source.read(size + 1)
        if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
            return None
        result = raw, mimetypes.guess_type(name)[0] or 'application/octet-stream'
        if size <= MAX_ASSET // 2:
            while self.cache and self.cache_bytes + size > MAX_ASSET // 2:
                _, (old, _) = self.cache.popitem(last=False)
                self.cache_bytes -= len(old)
            self.cache[name] = result
            self.cache_bytes += size
        return result
