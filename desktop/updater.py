"""Signed, bounded GitHub releases and deferred portable desktop replacement.

Network metadata never supplies a download URL: both endpoints are derived from
the compiled repository and the verified version. The native helper independently
verifies the signature, bytes and paths before stopping the installation.
"""
from __future__ import annotations

import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
try:
    from .app_components import read_components
except ImportError:
    from app_components import read_components

REPOSITORY = 'https://github.com/exKitsune/Umalytics'
LATEST = REPOSITORY + '/releases/latest/download/'
INTERVAL = 3600
MAX_EXECUTABLE = 512 * 1024 * 1024
MAX_METADATA = 16 * 1024
TIMEOUT = 10
MAX_DOWNLOAD_SECONDS = 900
HEX = re.compile(r'^[0-9a-f]{64}$')
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def utc(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace('+00:00', 'Z')


def atomic_bytes(path, raw):
    if linked(path):
        raise ValueError('Update staging files must not be symbolic links.')
    temporary = path.with_name(path.name + '.' + secrets.token_hex(8) + '.partial')
    try:
        with temporary.open('xb') as target:
            target.write(raw)
            target.flush()
            os.fsync(target.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def linked(path):
    return path.is_symlink() or getattr(path, 'is_junction', lambda: False)()


@contextmanager
def staging_lock(folder):
    """Use the native helper's exact lock while invalidating old cleanup work."""
    path = folder / 'apply.lock'
    if linked(path):
        raise ValueError('Linked update lock refused.')
    if os.name == 'nt':
        import ctypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32,
                                      ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
        kernel.CreateFileW.restype = ctypes.c_void_p
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = kernel.CreateFileW(str(path), 0xC0000000, 0, None, 4, 0x80, None)
        if handle == ctypes.c_void_p(-1).value:
            raise ValueError('An update helper is already running. Try again shortly.')
        try:
            yield
        finally:
            kernel.CloseHandle(handle)
    else:
        import fcntl
        with path.open('a+b') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise ValueError('An update helper is already running. Try again shortly.') from None
            try:
                yield
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)


def validated_url(url):
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443)
            or parsed.fragment):
        raise ValueError('Release connection must use approved HTTPS hosts.')
    if parsed.hostname == 'github.com':
        if not parsed.path.startswith('/exKitsune/Umalytics/releases/'):
            raise ValueError('Release connection left the official repository.')
    elif parsed.hostname not in ('release-assets.githubusercontent.com', 'objects.githubusercontent.com'):
        raise ValueError('Release redirect host is not approved.')
    return url


class ReleaseRedirects(HTTPRedirectHandler):
    max_redirections = 3
    max_repeats = 1

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validated_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def release_opener():
    return build_opener(ProxyHandler({}), ReleaseRedirects())


def verify_manifest(raw, signature, public_key):
    """Verify the original bytes before parsing; never reserialize for signing."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    if len(raw) > MAX_METADATA or len(signature) > 256:
        raise ValueError('Release metadata exceeds its size limit.')
    try:
        detached = base64.b64decode(signature.strip(), validate=True)
        if len(detached) != 64:
            raise ValueError('Invalid signature length.')
        Ed25519PublicKey.from_public_bytes(public_key).verify(detached, raw)
    except (InvalidSignature, ValueError, TypeError) as error:
        raise ValueError('Release signature verification failed.') from error
    try:
        manifest = json.loads(raw)
    except (UnicodeError, ValueError) as error:
        raise ValueError('Release metadata is invalid.') from error
    expected = {'schemaVersion', 'version', 'buildNumber', 'commit', 'filename', 'bytes', 'sha256', 'dataSha256', 'releaseUrl'}
    if not isinstance(manifest, dict) or set(manifest) != expected:
        raise ValueError('Release metadata schema is unsupported.')
    build = manifest['buildNumber']
    if (manifest['schemaVersion'] != 1 or type(manifest['schemaVersion']) is not int
            or type(build) is not int or not 1 <= build <= 2147483647
            or manifest['version'] != f'0.2.{build}'
            or manifest['filename'] != 'Umalytics.exe'
            or type(manifest['bytes']) is not int or not 1 <= manifest['bytes'] <= MAX_EXECUTABLE
            or not isinstance(manifest['commit'], str) or not re.fullmatch('[0-9a-f]{40}', manifest['commit'])
            or any(not isinstance(manifest[key], str) or not HEX.fullmatch(manifest[key]) for key in ('sha256', 'dataSha256'))
            or manifest['releaseUrl'] != f"{REPOSITORY}/releases/tag/v0.2.{build}"):
        raise ValueError('Release metadata fields are invalid.')
    return manifest


class UpdateController:
    def __init__(self, data_dir, desktop_exe, resource_root, game_active=lambda: False,
                 *, opener=None, launch=None):
        self.data_dir = Path(data_dir).resolve()
        self.desktop_exe = Path(desktop_exe).resolve() if desktop_exe else None
        self.resource_root = Path(resource_root)
        self.game_active = game_active
        self.opener = opener or release_opener()
        self.launch = launch or subprocess.Popen
        self.lock = threading.RLock()
        self.closed = threading.Event()
        self.wake = threading.Event()
        self.busy = False
        self.thread = None
        self.worker = None
        self.manifest = None
        self.raw = None
        self.signature = None
        self.etag = None
        self.checked = None
        self.next_check = time.time()
        self.progress = 0
        self.phase = 'idle'
        self.error = None
        self.restart_token = None
        self.helper_started = None
        self.app_only = False
        self.await_game_restart = False
        self.collector_sha256 = None
        self.identity_stamp = None
        metadata = self.resource_root / 'desktop'
        # Source-mode test/dev servers can substitute their frontend asset root;
        # their application identity still comes from the source checkout.
        if not getattr(sys, 'frozen', False) and not (metadata / 'build-info.json').is_file():
            metadata = Path(__file__).resolve().parent
        info = json.loads((metadata / 'build-info.json').read_text(encoding='utf-8'))
        self.build = info['buildNumber']
        self.version = info['version']
        if type(self.build) is not int or self.build < 0 or self.version != f'0.2.{self.build}':
            raise ValueError('Bundled application version is invalid.')
        self.public_key = bytes.fromhex((metadata / 'update-public-key.txt').read_text(encoding='ascii').strip())
        if len(self.public_key) != 32:
            raise ValueError('Bundled release public key is invalid.')

    def start(self):
        with self.lock:
            if self.thread is not None:
                return
            self.next_check = time.time()
            self.thread = threading.Thread(target=self._schedule, name='release-scheduler', daemon=True)
            self.thread.start()

    def close(self):
        self.closed.set()
        self.wake.set()

    def status(self):
        with self.lock:
            self.refresh_app_identity()
            available = self.manifest if self.manifest and self.manifest['buildNumber'] > self.build else None
            return {'phase': self.phase, 'currentVersion': self.version,
                    'availableVersion': available['version'] if available else None,
                    'checkedAt': utc(self.checked) if self.checked else None,
                    'nextCheckAt': utc(self.next_check), 'downloadBytes': self.progress,
                    'downloadTotal': available['bytes'] if available else 0,
                    'error': self.error, 'gameActive': bool(self.game_active()), 'collectorChanged': not self.app_only,
                    'reopenGameRequired': self.reopen_required(),
                    'canInstall': bool(available and not self.busy and self.desktop_exe and not self.closed.is_set())}

    def refresh_app_identity(self):
        if not self.desktop_exe:
            return
        try:
            stat = self.desktop_exe.stat()
            stamp = (stat.st_mtime_ns, stat.st_size)
            if stamp == self.identity_stamp:
                return
            parts = read_components(self.desktop_exe)
            if parts:
                self.version, self.build = parts['appVersion'], parts['buildNumber']
                if self.phase == 'restarting' and self.manifest and self.build == self.manifest['buildNumber']:
                    self.phase = 'idle'
            self.identity_stamp = stamp
        except OSError:
            pass

    def can_keep_collector(self, stage):
        old, new = read_components(self.desktop_exe), read_components(stage)
        runtime = self.data_dir / 'runtime/UmalyticsCollector.exe'
        if not old or not new or old['collectorSha256'] != new['collectorSha256'] or linked(runtime):
            return False
        if self.collector_sha256 is not None and self.collector_sha256 != new['collectorSha256']:
            return False
        try:
            with runtime.open('rb') as stream:
                return hashlib.file_digest(stream, 'sha256').hexdigest() == new['collectorSha256']
        except OSError:
            return False

    def reopen_required(self):
        marker = self.data_dir / 'cache/collector-reopen.json'
        if not marker.is_file() or linked(marker):
            return False
        # Only the verified native update/rollback completion clears this.
        # Merely observing a new game process does not prove collector readiness.
        return True

    def _schedule(self):
        while not self.closed.is_set():
            if time.time() >= self.next_check:
                self.check()
            # Wall clock is checked after every wake, including after sleep. A
            # monotonic hour-long wait would postpone overdue checks after resume.
            self.wake.wait(15)
            self.wake.clear()

    def check(self):
        return self._begin(False)

    def install(self):
        if not self.desktop_exe:
            raise ValueError('Application updates require the Windows desktop executable.')
        return self._begin(True)

    def restart(self, token):
        """Protected local API called only after the helper's own verification."""
        with self.lock:
            if (not isinstance(token, str) or not self.restart_token
                    or not secrets.compare_digest(token, self.restart_token)
                    or self.phase != 'waiting-for-game'
                    or not self.helper_started or time.monotonic() - self.helper_started > 60):
                raise ValueError('Update helper authorization is invalid or expired.')
            if self.closed.is_set() or self.game_active() and not self.app_only:
                raise ValueError('Close the game before restarting Umalytics.')
            self.phase = 'restarting'
            return self.status()

    def abort(self, token):
        """Allow the verified helper to recover an old service that could not exit."""
        with self.lock:
            if (not isinstance(token, str) or not self.restart_token
                    or not secrets.compare_digest(token, self.restart_token)
                    or self.phase not in ('waiting-for-game', 'restarting')):
                raise ValueError('Update helper authorization is invalid.')
            self.restart_token = None
            self.phase = 'error'
            self.error = 'The update could not restart safely. The current app is unchanged; try again.'
            return self.status()

    def _begin(self, install):
        with self.lock:
            if self.busy or self.closed.is_set() or self.phase == 'restarting':
                return self.status()
            self.busy = True
            self.phase = 'checking'
            self.error = None
            self.worker = threading.Thread(target=self._run, args=(install,), name='release-download', daemon=True)
            self.worker.start()
            return self.status()

    def _read(self, url, maximum, headers=None):
        request = Request(validated_url(url), headers={'User-Agent': 'Umalytics-release-client', 'Accept': 'application/octet-stream', **(headers or {})})
        with self.opener.open(request, timeout=TIMEOUT) as response:
            validated_url(response.geturl())
            length = response.headers.get('Content-Length')
            if length is not None and (not length.isdecimal() or int(length) > maximum):
                raise ValueError('Release response exceeds its size limit.')
            raw = bytearray()
            started = time.monotonic()
            read = getattr(response, 'read1', response.read)
            while len(raw) <= maximum:
                if self.closed.is_set():
                    raise ValueError('Release check was cancelled.')
                if time.monotonic() - started > 30:
                    raise ValueError('Release metadata request timed out.')
                block = read(min(4096, maximum + 1 - len(raw)))
                if not block:
                    break
                raw.extend(block)
                if len(raw) > maximum:
                    break
            if len(raw) > maximum:
                raise ValueError('Release response exceeds its size limit.')
            if length is not None and int(length) != len(raw):
                raise ValueError('Release response was interrupted.')
            return bytes(raw), response.headers.get('ETag')

    def _check(self):
        headers = {'If-None-Match': self.etag} if self.etag and self.manifest else {}
        try:
            raw, etag = self._read(LATEST + 'release-manifest.json', MAX_METADATA, headers)
        except HTTPError as error:
            if error.code != 304 or not self.manifest:
                raise
        else:
            signature, _ = self._read(LATEST + 'release-manifest.sig', 256)
            manifest = verify_manifest(raw, signature, self.public_key)
            with self.lock:
                self.manifest, self.raw, self.signature, self.etag = manifest, raw, signature, etag
        with self.lock:
            self.checked = time.time()
            self.next_check = self.checked + INTERVAL
            self.phase = 'available' if self.manifest['buildNumber'] > self.build else 'idle'

    def _run(self, install):
        try:
            self._check()
            if install and self.manifest['buildNumber'] > self.build and not self.closed.is_set():
                self._download()
        except Exception as error:
            with self.lock:
                self.restart_token = None
                self.phase = 'error'
                # Never surface request URLs (asset redirects contain credentials).
                self.error = str(error) if isinstance(error, ValueError) else 'Release request failed. Check your connection and try again.'
                self.next_check = time.time() + INTERVAL
        finally:
            with self.lock:
                self.busy = False

    def _download(self):
        manifest = dict(self.manifest)
        folder = self.data_dir / 'cache' / 'update'
        if any(linked(path) for path in (self.data_dir, self.data_dir / 'cache', folder)):
            raise ValueError('Update staging directory must not be a symbolic link.')
        folder.mkdir(parents=True, exist_ok=True)
        # Normal native startup can still be cleaning the previous successful
        # update. Invalidate its receipt under the same lock before reusing any
        # staging names; native cleanup rechecks the receipt inside its lock.
        with staging_lock(folder):
            # Do not invalidate the completion receipt while native cleanup
            # still needs it to retire a locked or partially removed backup.
            if linked(folder / 'backup') or (folder / 'backup').exists():
                raise ValueError('Temporary update cleanup is still pending. Restart Umalytics and try again.')
            receipt = folder / 'success.json'
            if linked(receipt) or receipt.exists() and not receipt.is_file():
                raise ValueError('Unexpected update cleanup receipt.')
            receipt.unlink(missing_ok=True)
        stage = folder / 'Umalytics.exe'
        partial = folder / 'Umalytics.exe.partial'
        if any(linked(path) for path in (stage, partial)):
            raise ValueError('Update staging files must not be symbolic links.')
        partial.unlink(missing_ok=True)
        with self.lock:
            self.phase, self.progress = 'downloading', 0
        asset = REPOSITORY + f"/releases/download/v{manifest['version']}/Umalytics.exe"
        digest = hashlib.sha256()
        started = time.monotonic()
        try:
            request = Request(validated_url(asset), headers={'User-Agent': 'Umalytics-release-client', 'Accept': 'application/octet-stream'})
            with self.opener.open(request, timeout=TIMEOUT) as response, partial.open('xb') as target:
                validated_url(response.geturl())
                length = response.headers.get('Content-Length')
                if length is not None and length != str(manifest['bytes']):
                    raise ValueError('Release executable size does not match its signature.')
                total = 0
                while True:
                    if self.closed.is_set():
                        raise ValueError('Update download was cancelled.')
                    if time.monotonic() - started > MAX_DOWNLOAD_SECONDS:
                        raise ValueError('Release executable download timed out.')
                    read = getattr(response, 'read1', response.read)
                    block = read(min(256 * 1024, manifest['bytes'] + 1 - total))
                    if not block:
                        break
                    total += len(block)
                    if total > manifest['bytes']:
                        raise ValueError('Release executable exceeds its signed size.')
                    target.write(block)
                    digest.update(block)
                    with self.lock:
                        self.progress = total
                target.flush()
                os.fsync(target.fileno())
            if total != manifest['bytes'] or digest.hexdigest() != manifest['sha256']:
                raise ValueError('Release executable verification failed; the current app is unchanged.')
            partial.replace(stage)
        finally:
            partial.unlink(missing_ok=True)
        atomic_bytes(folder / 'release-manifest.json', self.raw)
        atomic_bytes(folder / 'release-manifest.sig', self.signature)
        self.app_only = self.can_keep_collector(stage)
        self.await_game_restart = not self.app_only and bool(self.game_active())
        with self.lock:
            self.phase = 'waiting-for-game'
        while not self.closed.is_set():
            if self.app_only or not self.game_active():
                self._handoff(folder, stage, manifest)
                return
            self.closed.wait(1)

    def _handoff(self, folder, stage, manifest):
        if self.closed.is_set():
            return
        if self.await_game_restart:
            atomic_bytes(self.data_dir / 'cache/collector-reopen.json', b'{"schemaVersion":1}')
        if not self.desktop_exe.is_file() or self.desktop_exe.is_symlink():
            raise ValueError('The current desktop executable is unavailable.')
        helper = folder / 'helper.exe'
        if linked(helper):
            raise ValueError('Update helper must not be a symbolic link.')
        # Hash the exact helper bytes as they are copied, avoiding a second
        # whole-executable read/allocation during the restart handoff.
        old_digest = hashlib.sha256()
        with self.desktop_exe.open('rb') as source, helper.open('wb') as target:
            while block := source.read(1024 * 1024):
                target.write(block)
                old_digest.update(block)
            target.flush()
        transaction = {'schemaVersion': 1, 'installationDir': str(self.desktop_exe.parent),
                       'executablePath': str(self.desktop_exe), 'dataDirectory': str(self.data_dir),
                       'stagedExecutable': str(stage), 'manifestPath': str(folder / 'release-manifest.json'),
                       'signaturePath': str(folder / 'release-manifest.sig'),
                       'previousVersion': self.version, 'version': manifest['version'],
                       'expectedOldExeSha256': old_digest.hexdigest(),
                       'token': secrets.token_hex(32)}
        path = folder / 'transaction.json'
        atomic_bytes(path, json.dumps(transaction, separators=(',', ':')).encode())
        if self.closed.is_set() or self.game_active() and not self.app_only:
            raise ValueError('The game started during update preparation. Retry after it closes.')
        with self.lock:
            self.restart_token = transaction['token']
            self.helper_started = time.monotonic()
        # This native helper and the app it starts outlive this frozen service.
        # Preserve the public reset flag across that native process boundary so
        # PyInstaller unpacks a fresh runtime instead of reusing our deleted _MEI.
        environment = dict(os.environ, PYINSTALLER_RESET_ENVIRONMENT='1')
        process = self.launch([str(helper), '--apply-update', str(path)], cwd=str(self.desktop_exe.parent),
                              creationflags=NO_WINDOW, env=environment)
        while not self.closed.is_set():
            with self.lock:
                if self.phase == 'error':
                    return
                if self.app_only and self.phase == 'idle' and self.build == manifest['buildNumber']:
                    return
                acknowledged = self.phase == 'restarting'
            if process.poll() is not None or (not acknowledged and time.monotonic() - self.helper_started > 60):
                raise ValueError('The update helper could not prepare a restart. The current app is unchanged.')
            self.closed.wait(.25)
