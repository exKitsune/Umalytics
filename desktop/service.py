"""UmaTrace per-user background service and bundled collector entry point.

Only sanitized observer exports are served. Never log HTTP bodies, game arguments,
or upstream traffic. Certificate installation is reachable only by explicit UI consent.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit
from storage import atomic_json, default_data_directory, prepare_storage, cleanup_legacy_notices

PORT = 4317
PROXY_PORT = 4327
MAX_RACE = 16 * 1024 * 1024
MAX_LIST = 32 * 1024 * 1024
CATEGORIES = ('career', 'team-trials', 'practice', 'champions-meeting', 'other')
RESOURCE_ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent.parent))
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self):
        # Windows SO_REUSEADDR permits another server to steal traffic. An exclusive
        # bind is also our per-user single-instance guard.
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def settings_default():
    return {'schemaVersion': 1, 'collectionEnabled': True, 'startAtLogin': False,
            'categories': {category: True for category in CATEGORIES},
            'preferences': {'theme': 'dark', 'fontScale': 100, 'courseAssignments': {}, 'browserMigrationComplete': False}}


def reveal_file(path):
    """Select an app-owned exported file using the native Explorer shell API."""
    if os.name != 'nt':
        return False
    ole = ctypes.WinDLL('ole32')
    shell = ctypes.WinDLL('shell32')
    ole.CoInitializeEx.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    ole.CoInitializeEx.restype = ctypes.c_long
    ole.CoTaskMemFree.argtypes = [ctypes.c_void_p]
    shell.SHParseDisplayName.argtypes = [ctypes.c_wchar_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p), ctypes.c_uint32, ctypes.c_void_p]
    shell.SHParseDisplayName.restype = ctypes.c_long
    shell.SHOpenFolderAndSelectItems.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32]
    shell.SHOpenFolderAndSelectItems.restype = ctypes.c_long
    initialized = ole.CoInitializeEx(None, 2)
    item = ctypes.c_void_p()
    try:
        if shell.SHParseDisplayName(str(path.resolve()), None, ctypes.byref(item), 0, None) < 0:
            return False
        return shell.SHOpenFolderAndSelectItems(item, 0, None, 0) >= 0
    finally:
        if item:
            ole.CoTaskMemFree(item)
        if initialized >= 0:
            ole.CoUninitialize()


def command(*args):
    return [sys.executable, *args] if getattr(sys, 'frozen', False) else [sys.executable, str(Path(__file__).resolve()), *args]


def current_user_trust(der, install=False):
    """Open only CurrentUser ROOT, compare the exact certificate bytes."""
    if os.name != 'nt':
        return False
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    crypt.CertOpenStore.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p]
    crypt.CertOpenStore.restype = ctypes.c_void_p
    crypt.CertCloseStore.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    crypt.CertFindCertificateInStore.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_void_p]
    crypt.CertFindCertificateInStore.restype = ctypes.c_void_p
    crypt.CertFreeCertificateContext.argtypes = [ctypes.c_void_p]
    crypt.CertAddEncodedCertificateToStore.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
    # CERT_STORE_PROV_SYSTEM_W=10; CURRENT_USER=0x10000, READONLY=0x8000.
    store = crypt.CertOpenStore(ctypes.c_void_p(10), 0, None, 0x10000 | (0 if install else 0x8000), ctypes.c_wchar_p('ROOT'))
    if not store:
        return False
    try:
        if install:
            return bool(crypt.CertAddEncodedCertificateToStore(store, 1, der, len(der), 4, None))
        class Blob(ctypes.Structure):
            _fields_ = [('cbData', ctypes.c_uint32), ('pbData', ctypes.c_void_p)]
        digest = ctypes.create_string_buffer(hashlib.sha1(der).digest())
        blob = Blob(20, ctypes.cast(digest, ctypes.c_void_p))
        context = crypt.CertFindCertificateInStore(store, 1, 0, 0x10000, ctypes.byref(blob), None)
        if context:
            crypt.CertFreeCertificateContext(context)
            return True
        return False
    finally:
        crypt.CertCloseStore(store, 0)


class Service:
    def __init__(self, data_dir, no_proxy=False, desktop_exe=None, proxy_port=PROXY_PORT):
        self.data_dir = data_dir = prepare_storage(data_dir)
        self.inbox = data_dir / 'races'
        self.ca_dir = data_dir / 'capture'
        self.status_path = data_dir / 'cache' / 'collector-status.json'
        self.stop_path = data_dir / 'cache' / 'collector.stop'
        self.settings_path = data_dir / 'settings.json'
        self.desktop_exe = desktop_exe
        self.proxy_port = proxy_port
        for folder in (data_dir, self.inbox, self.ca_dir):
            folder.mkdir(parents=True, exist_ok=True)
        notices = RESOURCE_ROOT / 'THIRD-PARTY-NOTICES.txt'
        if not getattr(sys, 'frozen', False):
            notices = RESOURCE_ROOT / '.cache' / 'desktop-licenses' / notices.name
        self.notices = notices.read_bytes() if notices.is_file() and not notices.is_symlink() else b'Umalytics dependency notices are unavailable in this development build. Build the desktop notice bundle to include complete offline licenses.\n'
        self.storage_notices = cleanup_legacy_notices(data_dir, self.notices)
        self.csrf = secrets.token_urlsafe(32)
        self.settings = settings_default()
        try:
            self.update_settings(json.loads(self.settings_path.read_text(encoding='utf-8')), persist=False)
        except (OSError, ValueError, TypeError):
            pass
        atomic_json(self.settings_path, self.settings)
        self.no_proxy = no_proxy
        self.proxy = None
        self.proxy_state = 'disabled' if no_proxy else 'starting'
        self.closed = threading.Event()
        self.lock = threading.RLock()
        self.server = None
        self.install_lock = threading.Lock()
        self.update_lock = threading.Lock()
        self.export_lock = threading.Lock()
        self.status_lock = threading.Lock()
        self.collector_status = {}
        self.status_token = secrets.token_urlsafe(32)
        self.status_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.status_socket.bind(('127.0.0.1', 0))
        self.status_socket.settimeout(.5)
        threading.Thread(target=self.receive_status, daemon=True).start()
        self._cert_cache = (0, {'exists': False, 'trusted': False})
        self._race_metadata = {}
        self._summary_reference_key = None
        self._summary_reference = ({}, {})
        self.launcher_pids = {}
        self.launcher_lock = threading.RLock()
        self.assets = {}
        dist = RESOURCE_ROOT / 'dist'
        if dist.exists():
            for path in dist.rglob('*'):
                if path.is_file() and not path.is_symlink() and path.stat().st_size <= MAX_LIST:
                    self.assets['/' + path.relative_to(dist).as_posix()] = (path.read_bytes(), mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
            if '/index.html' in self.assets:
                self.assets['/'] = self.assets['/index.html']
        from reference_data import ReferenceData
        self.reference_data = ReferenceData(data_dir / 'data', self.assets)
        from updater import UpdateController
        self.updater = UpdateController(data_dir, desktop_exe, RESOURCE_ROOT, game_active=self.game_active)
        self.runtime_build_sha256 = hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest() if getattr(sys, 'frozen', False) else None
        manifest = self.assets.get('/data/update-manifest.json')
        self.bundled_data_sha256 = hashlib.sha256(manifest[0]).hexdigest() if manifest else None

    def game_active(self):
        proxy = self.proxy_status()
        if proxy['activeGameConnections'] > 0 or proxy['running'] and not proxy['listening']:
            return True
        from processes import process_identity, process_names
        with self.launcher_lock:
            for pid, created in list(self.launcher_pids.items()):
                try:
                    if process_identity(pid)[1] == created:
                        return True
                except OSError:
                    pass
                self.launcher_pids.pop(pid, None)
        try:
            return any(name.lower() in ('\x75mamusume.exe', '\x75mamusume\x70rettyderby.exe') for name in process_names())
        except OSError:
            return True  # Defer replacement if the process inventory is unavailable.

    def launcher_state(self, body):
        from processes import process_identity
        pid, active = body.get('pid'), body.get('active')
        if set(body) != {'pid', 'active'} or type(pid) is not int or pid <= 0 or type(active) is not bool:
            raise ValueError('Invalid launcher state.')
        # Restart authorization and launch registration share the controller lock
        # so an idle check cannot race the interval before the game is spawned.
        with self.updater.lock:
            if active and self.updater.status()['phase'] == 'restarting':
                raise ValueError('Umalytics is restarting for an update.')
            with self.launcher_lock:
                if active:
                    try:
                        executable, created = process_identity(pid)
                        if Path(executable).resolve() != Path(process_identity(os.getpid())[0]).resolve():
                            raise ValueError('Launcher must use this installation runtime.')
                        self.launcher_pids[pid] = created
                    except OSError as error:
                        raise ValueError('Launcher process is unavailable.') from error
                else:
                    self.launcher_pids.pop(pid, None)
        return {'ok': True}

    def update_settings(self, patch, persist=True):
        if not isinstance(patch, dict) or set(patch) - {'schemaVersion', 'collectionEnabled', 'startAtLogin', 'categories', 'preferences'}:
            raise ValueError('Unknown setting.')
        if 'schemaVersion' in patch and patch['schemaVersion'] != 1:
            raise ValueError('Unsupported settings version.')
        if 'collectionEnabled' in patch:
            if not isinstance(patch['collectionEnabled'], bool):
                raise ValueError('Collection enabled must be boolean.')
        categories = patch.get('categories', {})
        if not isinstance(categories, dict) or set(categories) - set(CATEGORIES) or any(not isinstance(v, bool) for v in categories.values()):
            raise ValueError('Invalid collection categories.')
        preferences = self.validate_preferences(patch.get('preferences', {}))
        if 'startAtLogin' in patch:
            if not isinstance(patch['startAtLogin'], bool):
                raise ValueError('Start at login must be boolean.')
            if persist and patch['startAtLogin'] != self.settings['startAtLogin']:
                if os.name != 'nt' or not self.desktop_exe:
                    raise ValueError('Start at login is available from the desktop executable.')
                import winreg
                with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run') as key:
                    if patch['startAtLogin']:
                        winreg.SetValueEx(key, 'Umalytics', 0, winreg.REG_SZ, f'"{self.desktop_exe}" --background')
                    else:
                        try:
                            winreg.DeleteValue(key, 'Umalytics')
                        except FileNotFoundError:
                            pass
            self.settings['startAtLogin'] = patch['startAtLogin']
        if 'collectionEnabled' in patch:
            self.settings['collectionEnabled'] = patch['collectionEnabled']
        self.settings['categories'].update(categories)
        self.settings['preferences'].update(preferences)
        if persist:
            atomic_json(self.settings_path, self.settings)
        return dict(self.settings, categories=dict(self.settings['categories']))

    def validate_preferences(self, patch):
        if not isinstance(patch, dict) or set(patch) - {'theme', 'fontScale', 'courseAssignments', 'browserMigrationComplete'}:
            raise ValueError('Unknown preference.')
        if 'theme' in patch and patch['theme'] not in ('dark', 'light'):
            raise ValueError('Invalid theme.')
        if 'fontScale' in patch and (type(patch['fontScale']) is not int or not 75 <= patch['fontScale'] <= 200 or patch['fontScale'] % 5):
            raise ValueError('Text size must be 75–200%, in steps of 5%.')
        if 'browserMigrationComplete' in patch and type(patch['browserMigrationComplete']) is not bool:
            raise ValueError('Migration status must be boolean.')
        if 'courseAssignments' in patch:
            assignments = patch['courseAssignments']
            if (not isinstance(assignments, dict) or len(assignments) > 10000
                    or any(not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_.~-]{1,240}', key)
                           or '..' in key or type(value) is not int or not 0 < value <= 9007199254740991
                           for key, value in assignments.items())):
                raise ValueError('Invalid course assignments.')
        return patch

    def update_preferences(self, patch):
        clean = self.validate_preferences(patch)
        self.settings['preferences'].update(clean)
        atomic_json(self.settings_path, self.settings)
        return dict(self.settings['preferences'])

    def import_race(self, body):
        race_id, race = body.get('id'), body.get('race')
        if set(body) != {'id', 'race'} or not isinstance(race_id, str) or not re.fullmatch(r'local-[0-9a-f]{64}', race_id):
            raise ValueError('A deterministic local race ID is required.')
        if (not isinstance(race, dict) or race.get('schemaVersion') != 1
                or not isinstance(race.get('runners'), list) or not 1 <= len(race['runners']) <= 64
                or not isinstance(race.get('frames'), list) or len(race['frames']) > 100000
                or not isinstance(race.get('events'), list) or len(race['events']) > 100000
                or any(not isinstance(item, dict) for name in ('runners', 'frames', 'events') for item in race[name])):
            raise ValueError('A portable race document is required.')
        allowed = {'schemaVersion', 'id', 'title', 'synthetic', 'distance', 'courseId', 'conditions', 'laneDistanceMax',
                   'runners', 'frames', 'events', 'warnings', 'category', 'capturedAt', 'courseIdentity', 'distanceEvidence',
                   'grade', 'conditionEvidence', 'capture', 'randomSeed'}
        if set(race) - allowed:
            raise ValueError('Unsupported portable race fields.')
        # Bound nested content before JSON serialization or recursive consumers.
        pending, nodes = [(race, 0)], 0
        while pending:
            value, depth = pending.pop()
            nodes += 1
            if depth > 24 or nodes > 1500000:
                raise ValueError('Race structure exceeds supported limits.')
            if isinstance(value, dict):
                if any(not isinstance(key, str) or len(key) > 256 or key in ('__proto__', 'prototype', 'constructor') for key in value):
                    raise ValueError('Invalid race field.')
                pending.extend((item, depth + 1) for item in value.values())
            elif isinstance(value, list):
                pending.extend((item, depth + 1) for item in value)
            elif isinstance(value, str):
                if len(value) > 65536:
                    raise ValueError('Race text exceeds supported limits.')
            elif value is not None and type(value) not in (bool, int, float):
                raise ValueError('Invalid race value.')
        raw = json.dumps(race, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
        if len(raw) > MAX_RACE:
            raise ValueError('Race exceeds the file size limit.')
        target = self.inbox / (race_id + '.json')
        if target.is_symlink() or target.exists() and target.read_bytes() != raw:
            raise ValueError('This local race ID already belongs to a different document.')
        from storage import atomic_bytes
        atomic_bytes(target, raw)
        self._race_metadata.pop(target.name, None)
        return self.races(1, race_id, summary=True)['races'][0]

    def ensure_certificate(self):
        if self.no_proxy:
            return
        from capture_store import load_store
        load_store(self.ca_dir)

    def certificate(self, force=False):
        if not force and time.monotonic() - self._cert_cache[0] < 3:
            return self._cert_cache[1]
        status = {'exists': False, 'trusted': False, 'store': 'CurrentUser\\Root'}
        try:
            raw = (self.ca_dir / 'umalytics-ca-cert.pem').read_bytes()
            from cryptography import x509
            from cryptography.hazmat.primitives import serialization
            certificate = x509.load_pem_x509_certificate(raw)
            der = certificate.public_bytes(serialization.Encoding.DER)
            status.update(exists=True, trusted=current_user_trust(der),
                          sha256=hashlib.sha256(der).hexdigest().upper(),
                          sha1=hashlib.sha1(der).hexdigest().upper(),
                          subject=certificate.subject.rfc4514_string(),
                          expiresAt=certificate.not_valid_after_utc.isoformat())
        except (OSError, ValueError):
            pass
        self._cert_cache = (time.monotonic(), status)
        return status

    def install_certificate(self, expected_hash):
        with self.install_lock:
            status = self.certificate(force=True)
            if not status['exists'] or not secrets.compare_digest(str(expected_hash), status['sha256']):
                raise ValueError('Certificate changed. Review its current fingerprint first.')
            if status['trusted']:
                return status
            if os.name != 'nt':
                raise ValueError('Windows CurrentUser certificate store is required.')
            # The fingerprint-bearing settings button is explicit consent. Windows
            # manages the CurrentUser Root security confirmation; do not add a second
            # application confirmation in front of it.
            from cryptography import x509
            from cryptography.hazmat.primitives import serialization
            der = x509.load_pem_x509_certificate((self.ca_dir / 'umalytics-ca-cert.pem').read_bytes()).public_bytes(serialization.Encoding.DER)
            if hashlib.sha256(der).hexdigest().upper() != expected_hash or not current_user_trust(der, install=True):
                raise ValueError('Windows could not install the reviewed certificate.')
            return self.certificate(force=True)

    def receive_status(self):
        while not self.closed.is_set():
            try:
                raw, address = self.status_socket.recvfrom(16384)
                if address[0] != '127.0.0.1':
                    continue
                message = json.loads(raw)
                if not isinstance(message, dict) or not secrets.compare_digest(str(message.get('token', '')), self.status_token):
                    continue
                status = message.get('status')
                if not isinstance(status, dict):
                    continue
                # Only aggregate counters and finite status markers cross IPC.
                clean = {key: value for key, value in status.items()
                         if isinstance(key, str) and len(key) < 64
                         and (type(value) is int and 0 <= value <= 2**63
                              or key == 'state' and value in ('starting', 'running', 'stopped')
                              or key == 'stage' and value in ('probe', 'inspect')
                              or key == 'lastGameTrafficAt' and (value is None or isinstance(value, str) and len(value) < 64))}
                with self.status_lock:
                    self.collector_status = clean
            except socket.timeout:
                pass
            except (OSError, ValueError, TypeError):
                if self.closed.is_set():
                    return

    def proxy_status(self):
        status = {'state': self.proxy_state, 'port': self.proxy_port, 'running': bool(self.proxy and self.proxy.poll() is None),
                  'collectionEnabled': self.settings['collectionEnabled'], 'stage': getattr(self, 'proxy_stage', 'probe')}
        if self.proxy and self.proxy.poll() is not None:
            status['state'] = 'crashed'
        if status['running']:
            with self.status_lock:
                status.update(self.collector_status)
                status['state'] = self.collector_status.get('state', 'starting')
        status['listening'] = status['running'] and status['state'] == 'running'
        status['activeGameConnections'] = status.get('activeGameConnections', 0) if status['listening'] else 0
        status['gameConnected'] = status['activeGameConnections'] > 0
        status.setdefault('lastGameTrafficAt', None)
        return status

    def export_json(self, body):
        filename, content = body.get('filename'), body.get('content')
        if (set(body) != {'filename', 'content'} or not isinstance(filename, str)
                or not re.fullmatch(r'[^<>:"/\\|?*\x00-\x1f]{1,120}\.json', filename)
                or filename.startswith('.') or filename.endswith(' .json')
                or filename.split('.')[0].rstrip(' ').upper() in {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}
                or not isinstance(content, str)):
            raise ValueError('A safe JSON filename and JSON content are required.')
        raw = content.encode('utf-8')
        if not 0 < len(raw) <= MAX_RACE:
            raise ValueError('Export exceeds the file size limit.')
        from reference_data import strict_json
        if not isinstance(strict_json(raw), (dict, list)):
            raise ValueError('Export must contain a JSON object or array.')
        with self.export_lock:
            folder = self.data_dir / 'exports'
            if folder.is_symlink():
                raise ValueError('Export folder must belong to this installation.')
            folder.mkdir(exist_ok=True)
            target = folder / filename
            index = 1
            while target.exists():
                target = folder / f'{Path(filename).stem} ({index}).json'
                index += 1
            temporary = target.with_suffix('.partial')
            try:
                with temporary.open('xb') as stream:
                    stream.write(raw)
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
        return {'filename': target.name, 'path': str(target), 'revealed': reveal_file(target)}

    def stop_proxy(self):
        if self.proxy and self.proxy.poll() is None:
            self.stop_path.touch()
            try:
                self.proxy.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self.proxy.terminate()
                self.proxy.wait(timeout=5)
        self.proxy = None

    def supervise(self):
        try:
            self.ensure_certificate()
        except Exception:
            self.proxy_state = 'certificate_error'
            return
        retry_after = 0
        while not self.closed.wait(1):
            with self.lock:
                trusted = self.certificate()['trusted']
                if self.no_proxy:
                    self.stop_proxy()
                    self.proxy_state = 'disabled'
                    continue
                desired_stage = 'inspect' if trusted else 'probe'
                if self.proxy and self.proxy.poll() is None:
                    if getattr(self, 'proxy_stage', None) != desired_stage:
                        self.stop_proxy()
                        retry_after = 0
                    else:
                        self.proxy_state = 'running'
                        continue
                if time.monotonic() < retry_after:
                    continue
                self.stop_path.unlink(missing_ok=True)
                self.status_path.unlink(missing_ok=True)
                with self.status_lock:
                    self.collector_status = {}
                    self.status_token = secrets.token_urlsafe(32)
                env = dict(os.environ, UMATRACE_STATUS_TOKEN=self.status_token)
                try:
                    self.proxy = subprocess.Popen(command('--collector', '--stage', desired_stage, '--proxy-port', str(self.proxy_port), '--data-dir', str(self.data_dir), '--status-port', str(self.status_socket.getsockname()[1])),
                                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                                  stderr=subprocess.DEVNULL, creationflags=NO_WINDOW, env=env)
                    self.proxy_stage = desired_stage
                    self.proxy_state = 'starting'
                except OSError:
                    self.proxy = None
                    self.proxy_state = 'start_failed'
                retry_after = time.monotonic() + 15
        with self.lock:
            self.stop_proxy()

    def summary_reference(self):
        key = self.reference_data.status.get('manifestSha256')
        if key != self._summary_reference_key:
            try:
                courses = json.loads(self.reference_data.assets.get('courses.json', b'{}'))
                metadata = json.loads(self.reference_data.assets.get('metadata.json', b'{}'))
                instances = metadata.get('raceInstances', {}) if isinstance(metadata, dict) else {}
                self._summary_reference = (courses if isinstance(courses, dict) else {},
                                           instances if isinstance(instances, dict) else {})
            except (ValueError, TypeError):
                self._summary_reference = ({}, {})
            self._summary_reference_key = key
        return self._summary_reference

    def summary_course(self, entry, reference):
        # Read only finite public race metadata. Never parse scenarios or runner
        # telemetry just to populate a history row.
        records = [entry] + [entry[key] for key in ('race_start_info', 'room_info') if isinstance(entry.get(key), dict)]
        def number(value, limit=9007199254740991):
            if isinstance(value, str) and re.fullmatch(r'\d{1,16}', value):
                value = int(value)
            return int(value) if type(value) in (int, float) and 0 < value <= limit and value == int(value) else None
        def first_number(aliases, sources=records, limit=9007199254740991):
            return next((valid for source in sources for key in aliases if (valid := number(source.get(key), limit)) is not None), None)
        course_records = []
        course_value = None
        for record in records:
            for key in ('race_course_set', 'raceCourseSet', 'RaceCourseSet', '<RaceCourseSet>k__BackingField'):
                value = record.get(key)
                if isinstance(value, dict):
                    course_records.append(value)
                elif course_value is None:
                    course_value = number(value)
        course = first_number(('id', 'Id', 'course_id', 'courseId', '<Id>k__BackingField'), course_records)
        course = course or first_number(('race_course_id', 'raceCourseId', 'course_id', 'courseId', 'CourseId')) or course_value
        identity = entry.get('courseIdentity') if isinstance(entry.get('courseIdentity'), dict) else {}
        instance = first_number(('race_instance_id', 'raceInstanceId', 'RaceInstanceId')) or number(identity.get('raceInstanceId'))
        courses, instances = reference
        from_instance = False
        if course is None and instance is not None:
            course = number(instances.get(str(instance)))
            from_instance = course is not None
        distance = first_number(('distance', 'race_distance', 'raceDistance', 'Distance', '<Distance>k__BackingField'), records + course_records, 10000)
        if distance is None and course is not None:
            reference_course = courses.get(str(course), {})
            if isinstance(reference_course, dict):
                distance = number(reference_course.get('distance'), 10000)
        conditions = entry.get('conditions') if isinstance(entry.get('conditions'), dict) else {}
        def condition(aliases, normalized):
            for value in [conditions.get(normalized)] + [record.get(key) for record in records for key in aliases]:
                if type(value) in (int, float) and -1000 <= value <= 1000:
                    return str(value)
                if isinstance(value, str) and 0 < len(value.strip()) <= 32 and not any(ord(char) < 32 or ord(char) == 127 for char in value):
                    return value.strip()
            return None
        result = {'courseId': course, 'distance': distance,
                  'conditions': {'weather': condition(('weather', 'Weather', '<Weather>k__BackingField'), 'weather'),
                                 'ground': condition(('ground_condition', 'groundCondition', 'GroundCondition', '<GroundCondition>k__BackingField'), 'ground'),
                                 'season': condition(('season', 'Season', '<Season>k__BackingField'), 'season')}}
        if instance is not None:
            result['raceInstanceId'] = instance
        source = identity.get('source')
        allowed_sources = ('recorded', 'race-instance', 'filename-race-instance', 'manual', 'skill-conditions', 'unknown')
        if source not in allowed_sources or source == 'unknown' and course is not None:
            source = 'race-instance' if from_instance else 'recorded' if course is not None else 'unknown'
        result['courseIdentity'] = {'source': source, **({'raceInstanceId': instance} if instance is not None else {})}
        return result

    def races(self, limit=200, wanted=None, summary=False, offset=0):
        results = []
        total = 0
        wanted_file = wanted
        wanted_index = None
        reference = self.summary_reference()
        reference_key = self._summary_reference_key
        if wanted and '~' in wanted:
            base, _, suffix = wanted.rpartition('~')
            if suffix.isdigit():
                wanted_file, wanted_index = base, int(suffix)
        paths = sorted((p for p in self.inbox.glob('*.json') if not p.is_symlink()), key=lambda p: p.stat().st_mtime, reverse=True)
        for path in paths:
            if wanted_file and path.stem != wanted_file:
                continue
            try:
                stat = path.stat()
                if stat.st_size > MAX_RACE or path.resolve().parent != self.inbox.resolve():
                    continue
                cached = self._race_metadata.get(path.name)
                cache_key = (stat.st_mtime_ns, stat.st_size, reference_key)
                if summary and cached and cached[0] == cache_key:
                    results.extend(dict(item) for item in cached[1])
                    continue
                with path.open('rb') as stream:
                    raw = stream.read(MAX_RACE + 1)
                if len(raw) > MAX_RACE or len(raw) != stat.st_size or path.stat().st_mtime_ns != stat.st_mtime_ns:
                    continue
                data = json.loads(raw.decode('utf-8-sig'))
                if not isinstance(data, (dict, list)):
                    continue
                if not summary and total + len(raw) > MAX_LIST:
                    break
                total += len(raw)
                common = {'filename': path.name,
                          'receivedAt': datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()}
                entries = data if isinstance(data, list) else [data]
                metadata = []
                for index, entry in enumerate(entries):
                    if not isinstance(entry, dict):
                        continue
                    race_raw = raw if len(entries) == 1 else json.dumps(entry, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
                    item = dict(common, id=path.stem if path.stem.startswith('local-') and len(entries) == 1 else f'{path.stem}~{index}', sha256=hashlib.sha256(race_raw).hexdigest())
                    if isinstance(entry.get('synthetic'), bool):
                        item['synthetic'] = entry['synthetic']
                    if isinstance(entry.get('title'), str):
                        item['title'] = entry['title'][:200]
                    category = entry.get('race_category', entry.get('category'))
                    if isinstance(category, str):
                        item['category'] = category[:200]
                    item.update(self.summary_course(entry, reference))
                    metadata.append(item)
                self._race_metadata[path.name] = (cache_key, metadata)
                if summary:
                    results.extend(metadata)
                elif wanted_index is not None:
                    selected = next((item for item in metadata if item['id'] == wanted), None)
                    if selected:
                        results.append(dict(selected, data=[entries[wanted_index]]))
                else:
                    item = dict(common, id=path.stem, sha256=hashlib.sha256(raw).hexdigest(), data=data)
                    if metadata:
                        for key in ('title', 'category', 'courseId', 'distance', 'conditions', 'raceInstanceId', 'courseIdentity'):
                            if key in metadata[0]:
                                item[key] = metadata[0][key]
                    results.append(item)
                if not summary and len(results) >= limit + offset:
                    break
            except (OSError, ValueError, UnicodeError):
                continue
        if summary:
            page = results[offset:offset + limit]
            return {'races': page, 'total': len(results), 'nextOffset': offset + len(page) if offset + len(page) < len(results) else None}
        return results[offset:offset + limit]

    def delete_race(self, race_id):
        if not isinstance(race_id, str) or not 1 <= len(race_id) <= 240 or any(part in race_id for part in ('/', '\\', '..')):
            raise ValueError('Invalid race.')
        stem, sep, suffix = race_id.rpartition('~')
        index = int(suffix) if sep and suffix.isdigit() else None
        file_stem = stem if index is not None else race_id
        path = self.inbox / f'{file_stem}.json'
        if path.is_symlink() or not path.is_file() or path.resolve().parent != self.inbox.resolve():
            raise ValueError('Race not found.')
        raw = path.read_bytes()
        if len(raw) > MAX_RACE:
            raise ValueError('Race not found.')
        data = json.loads(raw.decode('utf-8-sig'))
        if isinstance(data, list):
            if index is None or index < 0 or index >= len(data):
                raise ValueError('Race not found.')
            if len(data) == 1:
                path.unlink()
            else:
                del data[index]
                temporary = path.with_suffix('.json.tmp')
                temporary.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
                temporary.replace(path)
        elif index not in (None, 0):
            raise ValueError('Race not found.')
        else:
            path.unlink()
        self._race_metadata.pop(path.name, None)
        return {'ok': True}

    def shutdown(self):
        self.updater.close()
        self.closed.set()
        if self.server:
            threading.Thread(target=self.server.shutdown, daemon=True).start()


def make_handler(service):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *args):
            pass

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def send(self, status, value=None, raw=None, content_type='application/json; charset=utf-8'):
            body = raw if raw is not None else json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')
            self.send_response(status)
            for key, val in {'Content-Type': content_type, 'Content-Length': str(len(body)), 'Cache-Control': 'no-store',
                             'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
                             'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"}.items():
                self.send_header(key, val)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def allowed(self, mutation=False):
            port = self.server.server_port
            hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
            origin = self.headers.get('Origin')
            if self.headers.get('Host') not in hosts or (origin is not None and origin not in {'http://' + host for host in hosts}):
                self.send(403, {'error': 'Local origin required.'})
                return False
            if self.headers.get('Sec-Fetch-Site') == 'cross-site':
                self.send(403, {'error': 'Cross-site request refused.'})
                return False
            if mutation and (origin is None or not secrets.compare_digest(self.headers.get('X-UmaTrace-CSRF', ''), service.csrf)):
                self.send(403, {'error': 'Explicit local app request required.'})
                return False
            return True

        def do_GET(self):
            if not self.allowed():
                return
            url = urlsplit(self.path)
            path = url.path
            try:
                if path == '/api/health':
                    self.send(200, {'ok': True, 'app': 'UmaTrace', 'mode': 'desktop', 'staticReady': '/' in service.assets,
                                    'csrfToken': service.csrf, 'proxy': service.proxy_status(), 'certificate': service.certificate(),
                                    'launchOption': f'"{service.desktop_exe}" --launch-game -- %command%' if service.desktop_exe else None,
                                    'dataDirectory': str(service.data_dir),
                                    'version': service.updater.version, 'buildNumber': service.updater.build,
                                    'dataSha256': service.bundled_data_sha256,
                                    'runtimeBuildSha256': service.runtime_build_sha256,
                                    'update': service.updater.status(),
                                    'storageNotices': service.storage_notices,
                                    'runtimeExecutable': str(Path(sys.executable).resolve())})
                elif path == '/api/settings':
                    self.send(200, service.settings)
                elif path == '/api/preferences':
                    self.send(200, service.settings['preferences'])
                elif path == '/api/licenses':
                    self.send(200, raw=service.notices, content_type='text/plain; charset=utf-8')
                elif path == '/api/certificate':
                    self.send(200, service.certificate())
                elif path == '/api/data/status':
                    self.send(200, service.reference_data.status)
                elif path == '/api/update/status':
                    self.send(200, service.updater.status())
                elif path == '/api/races':
                    query = parse_qs(url.query)
                    limit = min(200, max(1, int(query.get('limit', ['200'])[0])))
                    offset = max(0, int(query.get('offset', ['0'])[0]))
                    summary = query.get('summary', ['0'])[0] == '1'
                    result = service.races(limit, summary=summary, offset=offset)
                    self.send(200, result if summary else {'races': result})
                elif path == '/api/races/latest':
                    self.send(200, next(iter(service.races(1)), {'filename': None, 'receivedAt': None, 'sha256': None, 'data': None}))
                elif path.startswith('/api/races/'):
                    found = service.races(1, unquote(path[len('/api/races/'):]))
                    self.send(200 if found else 404, found[0] if found else {'error': 'Race not found.'})
                elif path.startswith('/data/') and path[len('/data/'):] in service.reference_data.assets:
                    name = path[len('/data/'):]
                    self.send(200, raw=service.reference_data.assets[name], content_type='application/json' if name.endswith('.json') else 'text/plain; charset=utf-8')
                elif path in service.assets:
                    raw, kind = service.assets[path]
                    self.send(200, raw=raw, content_type=kind)
                else:
                    self.send(404, {'error': 'Not found.'})
            except (ValueError, TypeError):
                self.send(400, {'error': 'Invalid request.'})
            except Exception:
                self.send(500, {'error': 'Local operation failed.'})

        do_HEAD = do_GET

        def do_POST(self):
            if not self.allowed(mutation=True):
                return
            try:
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ValueError('JSON request required.')
                length = int(self.headers.get('Content-Length', '0'))
                limit = MAX_LIST if self.path == '/api/exports' else MAX_RACE + 16384 if self.path == '/api/races/import' else 1024 * 1024 if self.path == '/api/preferences' else 16384
                if length < 1 or length > limit or self.headers.get('Transfer-Encoding'):
                    raise ValueError('Request body size is invalid.')
                from reference_data import strict_json
                body = strict_json(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError('JSON object required.')
                if self.path == '/api/exports':
                    self.send(200, service.export_json(body))
                elif self.path == '/api/update/check':
                    self.send(200, service.updater.check())
                elif self.path == '/api/update/install':
                    self.send(200, service.updater.install())
                elif self.path == '/api/update/restart':
                    self.send(200, service.updater.restart(body.get('token')))
                elif self.path == '/api/update/abort':
                    self.send(200, service.updater.abort(body.get('token')))
                elif self.path == '/api/game/launch-state':
                    self.send(200, service.launcher_state(body))
                elif self.path == '/api/races/import':
                    with service.lock:
                        result = service.import_race(body)
                    self.send(200, result)
                elif self.path == '/api/preferences':
                    with service.lock:
                        result = service.update_preferences(body)
                    self.send(200, result)
                elif self.path == '/api/settings':
                    with service.lock:
                        result = service.update_settings(body)
                    self.send(200, result)
                elif self.path == '/api/certificate/install':
                    self.send(200, service.install_certificate(body.get('sha256')))
                elif self.path == '/api/data/update':
                    with service.update_lock:
                        result = service.reference_data.update()
                    self.send(200, result)
                elif self.path == '/api/races/delete':
                    race_id = body.get('id')
                    with service.lock:
                        result = service.delete_race(race_id)
                    self.send(200, result)
                elif self.path == '/api/app/exit':
                    if body.get('onlyIfIdle') is True:
                        if service.game_active():
                            self.send(409, {'error': 'Close the game before updating Umalytics. Capture may still be running.'})
                            return
                    self.send(200, {'ok': True})
                    service.shutdown()
                else:
                    self.send(404, {'error': 'Not found.'})
            except (ValueError, TypeError, RecursionError) as error:
                self.send(400, {'error': str(error)})
            except Exception:
                self.send(500, {'error': 'Local operation failed.'})

    return Handler


def collector(data_dir, stage='probe', proxy_port=PROXY_PORT, status_port=0):
    # mitmproxy is imported only in this worker; its stdout/stderr never reach logs.
    from capture_store import run_collector
    addon = RESOURCE_ROOT / 'scripts' / 'proxy' / 'observer.py'
    args = ['--mode', 'regular', '--listen-host', '127.0.0.1', '--listen-port', str(proxy_port),
            '--scripts', str(addon), '--set', f'confdir={data_dir / "capture"}',
            '--set', 'flow_detail=0', '--set', 'termlog_verbosity=error', '--set', 'ssl_insecure=false',
            '--set', 'save_stream_file=', '--set', 'hardump=', '--set', 'onboarding=false',
            '--set', 'stream_large_bodies=16m', '--set', 'store_streamed_bodies=false',
            '--set', f'uma_stage={stage}', '--set', f'uma_output={data_dir / "races"}',
            '--set', f'uma_status_udp={status_port}',
            '--set', f'uma_stop_file={data_dir / "cache" / "collector.stop"}', '--set', f'uma_settings={data_dir / "settings.json"}']
    # The observer marks every probe ClientHello ignore_connection=True. Avoid
    # ignore_hosts here: it bypasses the hook that recognizes the game API SNI.
    run_collector(data_dir, args)


def health(port=PORT):
    from urllib.request import ProxyHandler, build_opener
    opener = build_opener(ProxyHandler({}))
    try:
        with opener.open(f'http://127.0.0.1:{port}/api/health', timeout=1) as response:
            data = json.load(response)
            return data if data.get('app') == 'UmaTrace' else None
    except Exception:
        return None


def launch_game(arguments, port=PORT):
    if not arguments or not Path(arguments[0]).is_file():
        raise ValueError('The game executable must follow --launch-game --.')
    status = None
    for _ in range(30):
        status = health(port)
        if status and status['proxy'].get('running') and status['proxy'].get('state') == 'running':
            break
        time.sleep(0.5)
    else:
        raise ValueError('Open UmaTrace, trust its certificate, and enable collection before launching from Steam.')
    env = {k: v for k, v in os.environ.items() if k.lower() not in ('http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'sslkeylogfile')}
    proxy_port = status['proxy'].get('port', PROXY_PORT)
    for name in ('http_proxy', 'https_proxy', 'all_proxy'):
        env[name] = f'http://127.0.0.1:{proxy_port}'
    env['no_proxy'] = 'localhost,127.0.0.1,::1'
    from urllib.request import ProxyHandler, Request, build_opener
    opener = build_opener(ProxyHandler({}))
    origin = f'http://127.0.0.1:{port}'
    headers = {'Origin': origin, 'Content-Type': 'application/json', 'X-UmaTrace-CSRF': status['csrfToken']}
    def mark(active):
        request = Request(origin + '/api/game/launch-state', data=json.dumps({'pid': os.getpid(), 'active': active}).encode(), headers=headers)
        with opener.open(request, timeout=3):
            pass
    mark(True)
    try:
        game = subprocess.Popen(arguments, cwd=str(Path(arguments[0]).resolve().parent), env=env, creationflags=NO_WINDOW)
        return game.wait()
    finally:
        try:
            mark(False)
        except OSError:
            pass


def main():
    # PyInstaller windowed processes provide None for standard streams.
    for name in ('stdout', 'stderr', 'stdin'):
        if getattr(sys, name) is None:
            setattr(sys, name, open(os.devnull, 'r' if name == 'stdin' else 'w'))
    parser = argparse.ArgumentParser()
    parser.add_argument('--collector', action='store_true')
    parser.add_argument('--stage', choices=('probe', 'inspect'), default='probe')
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--no-proxy', action='store_true')
    parser.add_argument('--port', type=int, default=PORT)
    parser.add_argument('--proxy-port', type=int, default=PROXY_PORT)
    parser.add_argument('--status-port', type=int, default=0)
    parser.add_argument('--data-dir', type=Path, default=default_data_directory())
    parser.add_argument('--desktop-exe', type=Path)
    parser.add_argument('--launch-game', action='store_true')
    parser.add_argument('game', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.collector:
        collector(args.data_dir, args.stage, args.proxy_port, args.status_port)
        return 0
    if args.launch_game:
        try:
            return launch_game(args.game[1:] if args.game[:1] == ['--'] else args.game, args.port)
        except ValueError as error:
            if os.name == 'nt':
                ctypes.windll.user32.MessageBoxW(None, str(error), 'UmaTrace', 0x40)
            return 1
    # Binding is the single-instance lock. A second entry never changes state.
    try:
        server = LocalServer(('127.0.0.1', args.port), BaseHTTPRequestHandler)
    except OSError:
        return 0 if health(args.port) else 2
    service = Service(args.data_dir.resolve(), args.no_proxy, args.desktop_exe, args.proxy_port)
    server.RequestHandlerClass = make_handler(service)
    server.daemon_threads = True
    service.server = server
    service.updater.start()
    worker = threading.Thread(target=service.supervise, daemon=True)
    worker.start()
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        service.updater.close()
        service.closed.set()
        worker.join(timeout=15)
        service.status_socket.close()
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
