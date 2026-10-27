"""Opt-in, local full API capture for protocol development. Contains secrets.

Enable with cache/development-capture.json: {"enabled": true}. These files are
not ordinary diagnostics and must never be included in support uploads.
"""
import base64
from datetime import datetime, timezone
import gzip
import json
import os
from pathlib import Path
import re
import threading
import uuid

MAX_BODY = 64 * 1024 * 1024
MAX_STORAGE = 512 * 1024 * 1024


def regular(path):
    return not any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents))


class DevelopmentCapture:
    def __init__(self, data_dir):
        self.root = Path(data_dir).absolute()
        self.flag = self.root / 'cache' / 'development-capture.json'
        self.folder = self.root / 'development-captures'
        self.lock = threading.Lock()

    def enabled(self):
        try:
            if not regular(self.flag) or self.flag.stat().st_size > 1024:
                return False
            return json.loads(self.flag.read_text(encoding='utf-8')).get('enabled') is True
        except (OSError, ValueError, AttributeError):
            return False

    @staticmethod
    def message(message):
        if message is None:
            return None
        body = message.raw_content
        available = isinstance(body, bytes) and len(body) <= MAX_BODY
        result = {'headers': [[k.decode('latin1'), v.decode('latin1')] for k, v in message.headers.fields],
                  'bodyBase64': base64.b64encode(body).decode('ascii') if available else None,
                  'bodyBytes': len(body) if isinstance(body, bytes) else None,
                  'bodyUnavailable': None if available else 'size_limit' if isinstance(body, bytes) else 'streamed_or_absent'}
        for key in ('method', 'scheme', 'host', 'port', 'path', 'http_version', 'status_code', 'reason'):
            if hasattr(message, key):
                result[key] = getattr(message, key)
        return result

    def record(self, flow, phase):
        if not self.enabled():
            return
        # No decoder is involved: even unsupported envelopes remain inspectable.
        record = {'schemaVersion': 1, 'at': datetime.now(timezone.utc).isoformat(),
                  'flowId': str(flow.id), 'phase': phase,
                  'request': self.message(flow.request),
                  'response': self.message(flow.response) if phase == 'response' else None,
                  'transportError': str(flow.error) if phase == 'error' and flow.error else None}
        raw = json.dumps(record, ensure_ascii=True, allow_nan=False).encode('utf-8')
        with self.lock:
            if not regular(self.folder):
                raise ValueError('Linked development capture folder refused.')
            self.folder.mkdir(parents=True, exist_ok=True)
            name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f') + '-' + uuid.uuid4().hex + '.json.gz'
            path = self.folder / name
            packed = gzip.compress(raw, compresslevel=1)
            # Exclusive creation and restrictive POSIX permissions; Windows uses
            # the user's private AppData permissions inherited from the data root.
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(packed)
            pattern = re.compile(r'[0-9]{8}T[0-9]{12}-[a-f0-9]{32}\.json\.gz')
            files = sorted((p for p in self.folder.glob('*.json.gz') if pattern.fullmatch(p.name) and regular(p) and p.is_file()), key=lambda p: p.name)
            total = sum(p.stat().st_size for p in files)
            for old in files:
                if total <= MAX_STORAGE or old == path:
                    break
                total -= old.stat().st_size
                old.unlink()
