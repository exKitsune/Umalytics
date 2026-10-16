"""Signed replacement, process restart, rollback and crash recovery in disposable installs.

The Rust harness embeds the shipped helper unchanged and supplies a generated
test signing key and isolated loopback port. No production private key, game,
Windows certificate store or installed collector is accessed.
"""
import argparse
import base64
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

FLAGS = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
OPENER = build_opener(ProxyHandler({}))
MARKER = b'UMALYTICS-WORKFLOW-VERSION='
TOKEN = '3' * 64
CSRF = 'workflow-csrf'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def request(port, path, body=None):
    base = f'http://127.0.0.1:{port}'
    headers = {'Content-Type': 'application/json', 'Origin': base, 'X-UmaTrace-CSRF': CSRF}
    req = Request(base + path, headers=headers, data=None if body is None else json.dumps(body).encode())
    with OPENER.open(req, timeout=3) as response:
        return json.load(response)


def wait_health(port, version=None):
    for _ in range(160):
        try:
            health = request(port, '/api/health')
            if version is None or health['version'] == version:
                return health
        except (OSError, ValueError):
            pass
        time.sleep(.05)
    raise AssertionError(f'Synthetic collector did not become ready: {version}')


def owned_service(payload, install, port):
    payload = json.loads(payload)
    install = Path(install)
    data = Path(os.environ.get('UMALYTICS_WORKFLOW_DATA', install / 'Umalytics-data'))
    reference = ('synthetic-reference:' + payload['version']).encode()
    runtime = ('synthetic-collector:' + payload['version']).encode()
    (data / 'data').mkdir(parents=True, exist_ok=True)
    (data / 'runtime').mkdir(parents=True, exist_ok=True)
    (data / 'data/metadata.json').write_bytes(reference)
    (data / 'data/update-manifest.json').write_bytes(reference)
    (data / 'data/active.json').write_text(json.dumps({'manifestSha256': sha(reference)}))
    runtime_path = data / 'runtime/UmalyticsCollector.exe'
    runtime_path.write_bytes(runtime)
    started = time.monotonic()
    state = {'phase': 'waiting-for-game'}

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *args):
            pass

        def send_json(self, value, status=200):
            raw = json.dumps(value).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if self.path == '/api/health':
                self.send_json({'ok': True, 'app': 'UmaTrace', 'mode': 'desktop', 'csrfToken': CSRF,
                                'staticReady': time.monotonic() - started >= payload.get('staticDelay', 0),
                                'dataDirectory': str(data), 'version': payload['version'],
                                'dataSha256': '0' * 64 if payload.get('badData') else sha(reference),
                                'runtimeBuildSha256': '0' * 64 if payload.get('badRuntime') else sha(runtime),
                                'runtimeExecutable': str(runtime_path), 'update': state,
                                'pyinstallerResetEnvironment': os.environ.get('PYINSTALLER_RESET_ENVIRONMENT'),
                                'proxy': {'running': False, 'listening': False,
                                          'activeGameConnections': 1 if payload.get('gameActive') else 0,
                                          'gameConnected': bool(payload.get('gameActive'))}})
            elif self.path == '/api/data/status':
                self.send_json({'manifestSha256': sha(reference)})
            elif self.path == '/api/settings':
                self.send_json({'collectionEnabled': False})
            else:
                self.send_json({'error': 'Unknown path'}, 404)

        def do_POST(self):
            if self.headers.get('X-UmaTrace-CSRF') != CSRF:
                self.send_json({'error': 'CSRF'}, 403)
                return
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            if self.path in ('/api/update/restart', '/api/update/abort'):
                if body.get('token') != TOKEN:
                    self.send_json({'error': 'Invalid helper'}, 400)
                    return
                state['phase'] = 'restarting' if self.path.endswith('/restart') else 'error'
                with (install / 'events.txt').open('a') as output:
                    output.write(self.path + '\n')
                self.send_json(state)
            elif self.path in ('/api/app/exit', '/fixture/exit'):
                if self.path == '/api/app/exit' and (not body.get('onlyIfIdle') or payload.get('gameActive') or payload.get('refuseStop')):
                    self.send_json({'error': 'Busy'}, 409)
                    return
                self.send_json({'ok': True})
                threading.Thread(target=server.shutdown, daemon=True).start()
            else:
                self.send_json({'error': 'Unknown path'}, 404)

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.serve_forever(poll_interval=.05)
    server.server_close()


def main(harness, cross_drive_root=None):
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw).hex()
    original = harness.read_bytes()
    cases = 0
    with tempfile.TemporaryDirectory(prefix='umalytics-updater-workflow-') as temporary:
        root = Path(temporary).resolve()
        assert root.parent == Path(tempfile.gettempdir()).resolve()

        def scenario(name, payload=None, alter=None, expected=True, recovery=False, appdata=False, install_root=None):
            nonlocal cases
            print('Updater workflow: ' + name, file=sys.stderr, flush=True)
            install = (install_root or root) / name
            local = root / (name + '-local')
            data = local / 'Umalytics' if appdata else install / 'Umalytics-data'
            install.mkdir(parents=True, exist_ok=True)
            update = data / 'cache/update'
            update.mkdir(parents=True)
            protected = {'races/one.json': b'synthetic saved race', 'settings.json': b'important preferences',
                         'capture/mitmproxy-ca.pem': b'synthetic private certificate bytes',
                         'cache/webview/profile.txt': b'existing browser data',
                         'data/user-notes.txt': b'unknown user reference notes',
                         'data/' + 'a' * 64 + '/invalid-snapshot.bin': b'unknown snapshot preserved',
                         'runtime/user-notes.txt': b'unknown runtime file preserved'}
            for relative, raw in protected.items():
                target = data / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(raw)
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            env = {**os.environ, 'UMALYTICS_WORKFLOW_PYTHON': sys.executable,
                   'LOCALAPPDATA': str(local), 'UMALYTICS_WORKFLOW_DATA': str(data),
                   'UMALYTICS_WORKFLOW_SCRIPT': str(Path(__file__).resolve()),
                   'UMALYTICS_WORKFLOW_INSTALL': str(install), 'UMALYTICS_WORKFLOW_PORT': str(port),
                   # Simulate the inherited bootloader state of the old frozen
                   # service. Only the production native launch path may request
                   # a fresh unpack; the synthetic app reports its real child env.
                   'PYINSTALLER_RESET_ENVIRONMENT': '0',
                   '_PYI_ARCHIVE_FILE': str(data / 'runtime/UmalyticsCollector.exe'),
                   '_PYI_APPLICATION_HOME_DIR': str(install / 'deleted-old-extraction'),
                   '_PYI_PARENT_PROCESS_LEVEL': '1'}
            old_bytes = original + MARKER + b'{"version":"0.2.0"}\n'
            new_payload = {'version': '0.2.1', **(payload or {})}
            new_bytes = original + MARKER + json.dumps(new_payload).encode() + b'\n'
            exe = install / 'Umalytics.exe'
            exe.write_bytes(old_bytes)
            helper = update / 'helper.exe'
            helper.write_bytes(old_bytes)
            staged = update / 'Umalytics.exe'
            staged.write_bytes(new_bytes)
            manifest = {'schemaVersion': 1, 'version': '0.2.1', 'buildNumber': 1, 'commit': '1' * 40,
                        'filename': 'Umalytics.exe', 'bytes': len(new_bytes), 'sha256': sha(new_bytes),
                        'dataSha256': sha(b'synthetic-reference:0.2.1'),
                        'releaseUrl': 'https://github.com/exKitsune/Umalytics/releases/tag/v0.2.1'}
            tx = {'schemaVersion': 1, 'installationDir': str(install), 'executablePath': str(exe),
                  'dataDirectory': str(data), 'stagedExecutable': str(staged),
                  'manifestPath': str(update / 'release-manifest.json'),
                  'signaturePath': str(update / 'release-manifest.sig'), 'previousVersion': '0.2.0',
                  'version': '0.2.1', 'expectedOldExeSha256': sha(old_bytes), 'token': TOKEN}
            initial_payload = {'version': '0.2.0'}
            if name == 'active-game':
                initial_payload['gameActive'] = True
            if name == 'refused-stop':
                initial_payload['refuseStop'] = True
            initial = subprocess.Popen([sys.executable, __file__, '--owned-service', json.dumps(initial_payload),
                                        str(install), str(port)], creationflags=FLAGS,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
            helper_process = None
            outputs = []
            try:
                wait_health(port, '0.2.0')
                if alter:
                    alter(manifest, tx, update)
                raw = json.dumps(manifest, separators=(',', ':')).encode()
                (update / 'release-manifest.json').write_bytes(raw)
                (update / 'release-manifest.sig').write_bytes(base64.b64encode(private.sign(raw)))
                if name == 'bad-signature':
                    (update / 'release-manifest.sig').write_bytes(base64.b64encode(b'0' * 64))
                transaction = update / 'transaction.json'
                transaction.write_text(json.dumps(tx))
                started = time.monotonic()
                output_path=install / 'helper-output.txt'
                output=output_path.open('w');outputs.append(output)
                helper_process = subprocess.Popen([str(helper), '--apply-update', str(transaction), public, str(port)],
                                                  env=env, creationflags=FLAGS, stdout=output, stderr=output)
                if recovery:
                    wait_health(port, '0.2.1')
                    assert (update / 'backup/journal.json').exists()
                    helper_process.kill()
                    helper_process.wait(timeout=5)
                    request(port, '/api/app/exit', {'onlyIfIdle': True})
                    time.sleep(.3)
                    output_path=install / 'recovery-output.txt'
                    output=output_path.open('w');outputs.append(output)
                    helper_process = subprocess.Popen([str(helper), '--rollback-update', str(transaction), public, str(port)],
                                                      env=env, creationflags=FLAGS, stdout=output, stderr=output)
                helper_process.wait(timeout=90)
                stdout=output_path.read_text()
                assert helper_process.returncode == 0, stdout
                report = json.loads(stdout.strip())
                assert report['ok'] == expected, (name, report)
                expected_version = '0.2.0' if recovery or not expected else '0.2.1'
                health = wait_health(port, expected_version)
                assert sha(exe.read_bytes()) == sha(old_bytes if recovery or not expected else new_bytes)
                for relative, raw in protected.items():
                    assert (data / relative).read_bytes() == raw, (name, relative)
                if expected or recovery or name in ('bad-data-rollback', 'bad-runtime-rollback', 'bad-exe-rollback'):
                    assert not (update / 'backup').exists(), name
                    assert health['pyinstallerResetEnvironment'] == '1', (name, 'Restart reused the previous frozen environment')
                if name == 'refused-stop':
                    assert health['update']['phase'] == 'error'
                    assert '/api/update/abort' in (install / 'events.txt').read_text()
                    for _ in range(100):
                        if (install / 'app-attached.txt').exists():
                            break
                        time.sleep(.05)
                    assert (install / 'app-attached.txt').exists(), 'Relaunched app did not reuse the owned collector'
                if name == 'static-ready-wait':
                    assert time.monotonic() - started >= 1.5
                if expected or recovery:
                    request(port, '/api/app/exit', {'onlyIfIdle': True})
                    time.sleep(.3)
                    clean = subprocess.run([str(exe), '--cleanup', str(data)], env=env, capture_output=True,
                                           text=True, creationflags=FLAGS, check=True, timeout=10)
                    assert json.loads(clean.stdout)['ok']
                    assert not (update / 'success.json').exists()
                    assert not helper.exists()
                cases += 1
            finally:
                try:
                    # This fixture-only endpoint also stops intentional busy
                    # refusal cases, without killing a venv redirector parent.
                    request(port, '/fixture/exit', {})
                except (OSError, ValueError):
                    pass
                if helper_process and helper_process.poll() is None:
                    helper_process.kill()
                    helper_process.wait(timeout=5)
                if initial.poll() is None:
                    try:
                        initial.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        initial.terminate()
                        initial.wait(timeout=3)
                time.sleep(.6)
                for output in outputs:
                    output.close()

        scenario('success')
        scenario('static-ready-wait', {'staticDelay': 1.5})
        scenario('bad-signature', expected=False)
        scenario('tampered-executable', alter=lambda m, t, u: (u / 'Umalytics.exe').write_bytes(b'tampered'), expected=False)
        scenario('outside-install', alter=lambda m, t, u: t.update(dataDirectory=str(root)), expected=False)
        scenario('foreign-release-url', alter=lambda m, t, u: m.update(releaseUrl='https://attacker.invalid/release'), expected=False)
        scenario('active-game', expected=False)
        scenario('refused-stop', expected=False)
        scenario('bad-data-rollback', {'badData': True}, expected=False)
        scenario('bad-runtime-rollback', {'badRuntime': True}, expected=False)

        def bad_executable(manifest, transaction, update):
            raw = b'Not a Windows executable'
            (update / 'Umalytics.exe').write_bytes(raw)
            manifest.update(bytes=len(raw), sha256=sha(raw))

        scenario('bad-exe-rollback', alter=bad_executable, expected=False)
        scenario('interrupted-helper-recovery', {'staticDelay': 20}, recovery=True)
        scenario('appdata-success', appdata=True)
        scenario('appdata-rollback', {'badData': True}, expected=False, appdata=True)
        scenario('appdata-recovery', {'staticDelay': 20}, recovery=True, appdata=True)
        if cross_drive_root:
            with tempfile.TemporaryDirectory(prefix='umalytics-update-test-', dir=cross_drive_root) as other:
                assert Path(other).drive.lower() != root.drive.lower(), 'Cross-drive fixture needs a different drive.'
                scenario('cross-drive-success', appdata=True, install_root=Path(other))
                scenario('cross-drive-rollback', {'badData': True}, expected=False, appdata=True, install_root=Path(other))
    print(json.dumps({'cases': cases, 'signedReplacement': 'passed', 'rollback': 'passed',
                      'crashRecovery': 'passed', 'unknownFiles': 'unchanged', 'userData': 'unchanged',
                      'restartAbort': 'passed', 'temporaryCleanup': 'passed',
                      'independentRestartEnvironment': 'passed'}))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--owned-service':
        owned_service(sys.argv[2], sys.argv[3], int(sys.argv[4]))
    else:
        parser = argparse.ArgumentParser()
        parser.add_argument('--harness', type=Path, required=True)
        parser.add_argument('--cross-drive-root', type=Path)
        args = parser.parse_args()
        main(args.harness.resolve(), args.cross_drive_root)
