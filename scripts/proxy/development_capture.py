"""Opt-in, local full API capture for protocol development. Contains secrets.

Enable with cache/development-capture.json: {"enabled": true}. These files are
not ordinary diagnostics and must never be included in support uploads.
"""
import base64
from collections import deque
import queue
from contextlib import contextmanager
from datetime import datetime, timezone
import gzip
import json
import os
from pathlib import Path
import re
import threading
import time
import uuid

MAX_BODY = 64 * 1024 * 1024
MAX_STORAGE = 512 * 1024 * 1024


def regular(path):
    return not any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents))


@contextmanager
def capture_guard(root):
    path = Path(root) / 'cache' / 'debug-capture.lock'
    if not regular(path):
        raise ValueError('Linked debug capture lock refused.')
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as stream:
        if stream.seek(0, 2) == 0:
            stream.write(b'\0')
            stream.flush()
        stream.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == 'nt':
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


class DevelopmentCapture:
    def __init__(self, data_dir):
        self.root = Path(data_dir).absolute()
        self.flag = self.root / 'cache' / 'development-capture.json'
        self.folder = self.root / 'development-captures'
        self.lock = threading.Lock()
        self.queue_lock = threading.Lock()
        self.queue = queue.Queue(maxsize=128)
        self.pending_bytes = 0
        self.worker = None
        self.closed = False
        self.inventory = None
        self.inventory_session = None

    def session(self):
        try:
            if not regular(self.flag) or self.flag.stat().st_size > 1024:
                return None
            raw = self.flag.read_bytes()
            flag = json.loads(raw)
            expiry = flag.get('expiresAt')
            enabled = flag.get('enabled') is True and (expiry is None or
                type(expiry) in (int, float) and time.time() < expiry)
            return raw if enabled else None
        except (OSError, ValueError, AttributeError):
            return None

    def enabled(self):
        return self.session() is not None

    @staticmethod
    def snapshot_message(message):
        if message is None:
            return None
        body = message.raw_content
        available = isinstance(body, bytes) and len(body) <= MAX_BODY
        result = {'headers': [[k.decode('latin1'), v.decode('latin1')] for k, v in message.headers.fields],
                  '_body': body if available else None,
                  'bodyBytes': len(body) if isinstance(body, bytes) else None,
                  'bodyUnavailable': None if available else 'size_limit' if isinstance(body, bytes) else 'streamed_or_absent'}
        for key in ('method', 'scheme', 'host', 'port', 'path', 'http_version', 'status_code', 'reason'):
            if hasattr(message, key):
                result[key] = getattr(message, key)
        return result

    @staticmethod
    def message(message):
        result = DevelopmentCapture.snapshot_message(message)
        if result is not None:
            body = result.pop('_body')
            result['bodyBase64'] = base64.b64encode(body).decode('ascii') if body is not None else None
        return result

    def snapshot(self, flow, phase):
        return {'schemaVersion': 1, 'at': datetime.now(timezone.utc).isoformat(),
                'flowId': str(flow.id), 'phase': phase,
                'request': self.snapshot_message(flow.request),
                'response': self.snapshot_message(flow.response) if phase == 'response' else None,
                'transportError': str(flow.error) if phase == 'error' and flow.error else None}

    def submit(self, flow, phase, completed):
        session = self.session()
        if session is None:
            return
        record = self.snapshot(flow, phase)
        size = sum(len(m['_body']) if m['_body'] is not None else 0
                   for m in (record['request'], record['response']) if m)
        with self.queue_lock:
            if self.closed or self.queue.full() or self.pending_bytes + size > 256 * 1024 * 1024:
                completed('development_captures_dropped')
                return
            self.pending_bytes += size
            self.queue.put_nowait((record, session, size, completed))
            if self.worker is None:
                self.worker = threading.Thread(target=self._run, name='debug-capture', daemon=True)
                self.worker.start()

    def _run(self):
        while True:
            item = self.queue.get()
            if item is None:
                self.queue.task_done()
                return
            record, session, size, completed = item
            try:
                if self.write(record, session):
                    completed('development_captures_written')
            except (OSError, ValueError, TypeError):
                completed('write_failed')
            finally:
                with self.queue_lock:
                    self.pending_bytes -= size
                # Release secret payload references while the worker is idle.
                del record, session, item, completed
                self.queue.task_done()

    def close(self):
        with self.queue_lock:
            self.closed = True
        self.queue.join()
        if self.worker:
            self.queue.put(None)
            self.worker.join()

    def record(self, flow, phase):
        session = self.session()
        return self.write(self.snapshot(flow, phase), session) if session is not None else False

    def write(self, record, session):
        if self.session() != session:
            return False
        # Flow objects never leave the networking thread. Encoding and compression
        # operate only on the immutable body bytes and copied metadata above.
        for message in (record['request'], record['response']):
            if message is not None:
                body = message.pop('_body')
                message['bodyBase64'] = base64.b64encode(body).decode('ascii') if body is not None else None
        raw = json.dumps(record, ensure_ascii=True, allow_nan=False).encode('utf-8')
        packed = gzip.compress(raw, compresslevel=1)
        with self.lock, capture_guard(self.root):
            if self.session() != session:
                return False
            if not regular(self.folder):
                raise ValueError('Linked development capture folder refused.')
            self.folder.mkdir(parents=True, exist_ok=True)
            if self.inventory is None or self.inventory_session != session:
                pattern = re.compile(r'[0-9]{8}T[0-9]{12}-[a-f0-9]{32}\.json\.gz')
                self.inventory = deque((p, p.stat().st_size) for p in sorted(self.folder.glob('*.json.gz'))
                    if pattern.fullmatch(p.name) and regular(p) and p.is_file())
                self.inventory_session = session
                self.storage_bytes = sum(size for _, size in self.inventory)
            name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f') + '-' + uuid.uuid4().hex + '.json.gz'
            path = self.folder / name
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(packed)
            self.inventory.append((path, len(packed)))
            self.storage_bytes += len(packed)
            while self.storage_bytes > MAX_STORAGE and len(self.inventory) > 1:
                old, size = self.inventory.popleft()
                if not regular(old):
                    raise ValueError('Linked development capture file refused.')
                old.unlink(missing_ok=True)
                self.storage_bytes -= size
            return True
