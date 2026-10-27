"""Bounded local lifecycle logs. Never include payloads, arguments or exception text."""
import atexit
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
import threading
import time
import traceback

from storage import linked

MAX_BYTES = 1024 * 1024
MAX_FILES = 12  # per process role, across launches and rotated segments
ROLES = ('service', 'collector', 'launcher')
_current = None
_hooks_installed = False


def log_directory(data_dir):
    folder = Path(data_dir).absolute() / 'logs'
    if any(linked(path) for path in (folder, *folder.parents)):
        raise ValueError('Linked diagnostics folder refused.')
    folder.mkdir(parents=True, exist_ok=True)
    return folder


class DiagnosticLog:
    def __init__(self, data_dir, role, version='unknown', *, max_bytes=MAX_BYTES, max_files=MAX_FILES):
        if role not in ROLES:
            raise ValueError('Unknown diagnostic role.')
        self.data_dir, self.role = Path(data_dir).absolute(), role
        self.version = version if re.fullmatch(r'[0-9A-Za-z.+-]{1,40}', version) else 'unknown'
        self.session = f'{time.time_ns()}-{os.getpid()}'
        self.segment = 0
        self.max_bytes, self.max_files = max_bytes, max_files
        self.lock = threading.Lock()
        self.closed = threading.Event()
        self.failed = False
        self.enabled = False
        self.event('process_start')

    def _path(self, folder):
        return folder / f'{self.role}-{self.session}-{self.segment:04}.jsonl'

    def _prune(self, folder, current):
        pattern = re.compile(rf'{self.role}-[0-9]+-[0-9]+-[0-9]+\.jsonl')
        files = [p for p in folder.iterdir() if pattern.fullmatch(p.name) and not linked(p) and p.is_file()]
        files.sort(key=lambda p: p.stat().st_mtime_ns, reverse=True)
        for path in [p for p in files if p != current][self.max_files - 1:]:
            path.unlink(missing_ok=True)

    def event(self, event, *, code=None, count=None, child_pid=None, exception=None):
        # Event names are source constants. No free-form messages/context dicts.
        if not re.fullmatch(r'[a-z_]{1,64}', event):
            return
        record = {'timestamp': datetime.now(timezone.utc).isoformat(timespec='milliseconds'),
                  'pid': os.getpid(), 'role': self.role, 'session': self.session,
                  'version': self.version, 'event': event}
        for key, value in (('code', code), ('count', count), ('childPid', child_pid)):
            if isinstance(value, int):
                record[key] = value
        if exception is not None:
            record['exceptionType'] = type(exception).__name__[:80]
            # Do not use format_exception: it includes messages, source text and paths.
            record['frames'] = [{'file': Path(frame.filename).name, 'function': frame.name, 'line': frame.lineno}
                                for frame in traceback.extract_tb(exception.__traceback__, limit=24)]
        try:
            raw = (json.dumps(record, ensure_ascii=True) + '\n').encode('utf-8')
            with self.lock:
                folder = log_directory(self.data_dir)
                path = self._path(folder)
                if linked(path):
                    raise ValueError('Linked diagnostic file refused.')
                if path.exists() and path.stat().st_size + len(raw) > self.max_bytes:
                    self.segment += 1
                    path = self._path(folder)
                if linked(path):
                    raise ValueError('Linked diagnostic file refused.')
                fresh = not path.exists()
                with path.open('ab') as stream:
                    stream.write(raw)
                    stream.flush()
                if fresh:
                    self._prune(folder, path)
                self.enabled = True
        except (OSError, ValueError):
            # An unwritable/full disk must never take down the app being diagnosed.
            self.enabled = False

    def exception(self, event, error, *, fatal=False):
        self.failed |= fatal
        self.event(event, exception=error)

    def heartbeat(self):
        while not self.closed.wait(60):
            self.event('heartbeat')

    def finish(self):
        if not self.closed.is_set():
            self.closed.set()
            self.event('process_exit_after_exception' if self.failed else 'process_exit')


def initialize(data_dir, role, version='unknown'):
    global _current, _hooks_installed
    if _current and (_current.data_dir, _current.role) == (Path(data_dir).absolute(), role):
        return _current
    if _current:
        _current.finish()
    _current = DiagnosticLog(data_dir, role, version)
    threading.Thread(target=_current.heartbeat, name='diagnostics-heartbeat', daemon=True).start()
    if not _hooks_installed:
        original_sys, original_thread = sys.excepthook, threading.excepthook

        def main_exception(kind, error, tb):
            if _current:
                _current.exception('unhandled_exception', error, fatal=True)
            original_sys(kind, error, tb)

        def thread_exception(args):
            if _current:
                _current.exception('thread_exception', args.exc_value)
            original_thread(args)

        sys.excepthook, threading.excepthook = main_exception, thread_exception
        atexit.register(lambda: _current and _current.finish())
        _hooks_installed = True
    return _current


def report_exception(event, error):
    if _current:
        _current.exception(event, error)
