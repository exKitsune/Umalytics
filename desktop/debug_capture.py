"""Guarded persistent or timed full API capture and local log deletion."""
import importlib.util
import json
from pathlib import Path
import secrets
import sys
import threading
import time

from storage import atomic_json, linked

PHRASE = 'CAPTURE SECRETS'
ACKS = ['secrets', 'all-api', 'private-files']


class DebugCapture:
    def __init__(self, data_dir):
        self.root = Path(data_dir)
        source = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1])) / 'scripts/proxy/development_capture.py'
        spec = importlib.util.spec_from_file_location('_umalytics_debug_capture', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.archive = module.DevelopmentCapture(self.root)
        self.guard = module.capture_guard
        self.lock = threading.RLock()
        self.challenge = None
        # Only an explicit persistent opt-in survives a service restart.
        if self._flag().get('mode') != 'permanent' or not self.archive.enabled():
            self.disable()

    def _flag(self):
        try:
            if linked(self.archive.flag) or self.archive.flag.stat().st_size > 1024:
                return {}
            value = json.loads(self.archive.flag.read_bytes())
            return value if isinstance(value, dict) else {}
        except (OSError, ValueError):
            return {}

    def disable(self):
        with self.lock, self.guard(self.root):
            atomic_json(self.archive.flag, {'enabled': False})
            self.challenge = None
        return self.status()

    def status(self):
        enabled = self.archive.enabled()
        flag = self._flag()
        mode = flag.get('mode', '30m') if enabled else None
        return {'enabled': enabled, 'mode': mode, 'sessionMinutes': 30 if mode == '30m' else None,
                'expiresAt': flag.get('expiresAt') if enabled else None}

    def prepare(self):
        with self.lock:
            self.challenge = (secrets.token_urlsafe(32), time.monotonic())
            return {'challenge': self.challenge[0], 'waitSeconds': 5}

    def update(self, body):
        if body.get('enabled') is False:
            return self.disable()
        with self.lock:
            mode = body.get('duration', '30m')
            if mode not in ('permanent', '30m'):
                raise ValueError('Choose permanent or 30-minute debug capture.')
            challenge = self.challenge
            if (body.get('enabled') is not True or not challenge or
                    not secrets.compare_digest(str(body.get('challenge', '')), challenge[0]) or
                    body.get('phrase') != PHRASE or body.get('acknowledgements') != ACKS or
                    not 5 <= time.monotonic() - challenge[1] <= 120):
                raise ValueError('Read all warnings, wait five seconds, and type CAPTURE SECRETS.')
            with self.guard(self.root):
                if linked(self.archive.folder) or any(linked(p) for p in self.archive.folder.parents):
                    raise ValueError('Linked debug capture folder refused.')
                self.archive.folder.mkdir(exist_ok=True)
                if sys.platform == 'win32':
                    from capture_identity import restrict
                    restrict(self.archive.folder)
                atomic_json(self.archive.flag, {'enabled': True, 'mode': mode, 'session': secrets.token_hex(16),
                            **({'expiresAt': time.time() + 30 * 60} if mode == '30m' else {})})
            self.challenge = None
            return self.status()

    def clear(self):
        # Disable first. The same interprocess lock covers every raw capture
        # write, including writers already processing a response.
        self.disable()
        deleted = 0
        with self.lock, self.guard(self.root):
            for folder in (self.root / 'logs', self.archive.folder):
                if linked(folder) or any(linked(p) for p in folder.parents):
                    raise ValueError('Linked log folder refused.')
                if not folder.exists():
                    continue
                for path in folder.iterdir():
                    if linked(path) or not path.is_file():
                        raise ValueError('Unexpected entry in log folder. Nothing outside log files will be deleted.')
                    path.unlink()
                    deleted += 1
        return {**self.status(), 'deletedFiles': deleted}
