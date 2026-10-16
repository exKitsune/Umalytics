"""Exercise real protected service APIs with a local signed-release server.

Only the network transport and native helper process are harmless fixtures. The
controller, streaming downloads, signature checks, staging and service routes are
the production implementations. No production override or signing bypass exists.
"""
import base64
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'desktop'))
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from updater import LATEST, REPOSITORY, UpdateController, staging_lock
from service import LocalServer, Service, make_handler

OPENER = build_opener(ProxyHandler({}))
KEY = Ed25519PrivateKey.generate()
PUBLIC = KEY.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
PAYLOAD = b'MZ harmless signed update fixture\n' * 8000
state = {'mode': 'valid', 'generation': 1, 'requests': [], 'conditional': 0}


class Releases(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        state['requests'].append(self.path)
        manifest = {'schemaVersion': 1, 'version': '0.2.7', 'buildNumber': 7, 'commit': 'a' * 40,
                    'filename': 'Umalytics.exe', 'bytes': len(PAYLOAD),
                    'sha256': hashlib.sha256(PAYLOAD).hexdigest(), 'dataSha256': 'b' * 64,
                    'releaseUrl': REPOSITORY + '/releases/tag/v0.2.7'}
        if state['mode'] == 'arbitrary-url':
            manifest['url'] = 'https://attacker.invalid/payload.exe'
        raw = json.dumps(manifest, separators=(',', ':')).encode()
        if self.path.endswith('/release-manifest.json'):
            etag = '"fixture-' + str(state['generation']) + '"'
            if self.headers.get('If-None-Match') == etag:
                state['conditional'] += 1
                self.send_response(304)
                self.end_headers()
                return
            content = raw
        elif self.path.endswith('/release-manifest.sig'):
            content = base64.b64encode(KEY.sign(raw))
            if state['mode'] == 'bad-signature':
                content = base64.b64encode(bytes(64))
            etag = None
        elif self.path == '/exKitsune/Umalytics/releases/download/v0.2.7/Umalytics.exe':
            content, etag = PAYLOAD, None
            if state['mode'] == 'bad-hash':
                content = b'X' * len(PAYLOAD)
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Length', str(len(content)))
        if etag:
            self.send_header('ETag', etag)
        self.end_headers()
        if state['mode'] == 'interrupted' and self.path.endswith('/Umalytics.exe'):
            self.wfile.write(content[:100])
            self.close_connection = True
        else:
            self.wfile.write(content)


class FixtureResponse:
    def __init__(self, response, original):
        self.response, self.original = response, original
        self.headers = response.headers

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.response.close()

    def geturl(self):
        return 'https://attacker.invalid/payload' if state['mode'] == 'bad-redirect' else self.original

    def read(self, size):
        return self.response.read(size)

    def read1(self, size):
        return self.response.read1(size)


class FixtureTransport:
    def __init__(self, url):
        self.url = url

    def open(self, request, timeout):
        assert request.full_url.startswith(REPOSITORY + '/releases/'), request.full_url
        path = request.full_url.removeprefix('https://github.com')
        translated = Request(self.url + path, headers=dict(request.header_items()))
        return FixtureResponse(OPENER.open(translated, timeout=timeout), request.full_url)


def api(url, path, body=None, token=None, origin=None):
    headers = {}
    if body is not None:
        headers = {'Content-Type': 'application/json', 'Origin': origin or url}
        if token is not None:
            headers['X-UmaTrace-CSRF'] = token
    request = Request(url + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with OPENER.open(request, timeout=5) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def wait_status(url, expected, timeout=8):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        status = api(url, '/api/update/status')[1]
        if status['phase'] == expected:
            return status
        time.sleep(.03)
    raise AssertionError(f'Expected {expected}: {status}')


HELPER = r'''
import base64, hashlib, json, sys, time
from pathlib import Path
from urllib.request import Request, ProxyHandler, build_opener
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
tx=json.loads(Path(sys.argv[1]).read_text())
raw=Path(tx['manifestPath']).read_bytes()
Ed25519PublicKey.from_public_bytes(bytes.fromhex(sys.argv[3])).verify(base64.b64decode(Path(tx['signaturePath']).read_bytes()),raw)
manifest=json.loads(raw)
assert hashlib.sha256(Path(tx['stagedExecutable']).read_bytes()).hexdigest()==manifest['sha256']
assert hashlib.sha256(Path(tx['executablePath']).read_bytes()).hexdigest()==tx['expectedOldExeSha256']
opener=build_opener(ProxyHandler({}))
with opener.open(sys.argv[2]+'/api/health') as response: health=json.load(response)
request=Request(sys.argv[2]+'/api/update/restart',data=json.dumps({'token':tx['token']}).encode(),headers={'Content-Type':'application/json','Origin':sys.argv[2],'X-UmaTrace-CSRF':health['csrfToken']})
with opener.open(request) as response: assert json.load(response)['phase']=='restarting'
if sys.argv[5]=='crash-after-ack': raise SystemExit(2)
if sys.argv[5]=='abort-after-ack':
 request=Request(sys.argv[2]+'/api/update/abort',data=json.dumps({'token':tx['token']}).encode(),headers={'Content-Type':'application/json','Origin':sys.argv[2],'X-UmaTrace-CSRF':health['csrfToken']})
 with opener.open(request) as response: assert json.load(response)['phase']=='error'
 raise SystemExit(0)
Path(sys.argv[4]).write_text(json.dumps({'verified':True,'version':manifest['version'],'nativeHandoff':True}))
while not Path(sys.argv[6]).exists(): time.sleep(.02)
'''


def packaging_flow(folder):
    """Run the actual release CLI in an isolated source tree with a fixture key."""
    tree = folder / 'release-source'
    for name in ('scripts/release.py', 'desktop/updater.py', 'package.json', 'package-lock.json',
                 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json',
                 'public/data/update-manifest.json'):
        destination = tree / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, destination)
    (tree / 'desktop/update-public-key.txt').write_text(PUBLIC.hex())
    executable = tree / '.cache/dist/Umalytics.exe'
    executable.parent.mkdir(parents=True)
    executable.write_bytes(PAYLOAD)
    command = [sys.executable, str(tree / 'scripts/release.py')]
    prepared = subprocess.run([*command, 'prepare', '--build-number', '7', '--commit', 'a' * 40],
                              capture_output=True, text=True, timeout=10)
    assert prepared.returncode == 0, prepared.stderr
    for name in ('package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'desktop/build-info.json'):
        assert json.loads((tree / name).read_text())['version'] == '0.2.7'
    assert 'name = "umatrace"\nversion = "0.2.7"' in (tree / 'src-tauri/Cargo.lock').read_text()
    seed = KEY.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
    fixture_secret = base64.b64encode(seed).decode()
    result = subprocess.run([*command, 'sign'], env=dict(os.environ, UMALYTICS_UPDATE_SIGNING_KEY=fixture_secret),
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert fixture_secret not in result.stdout + result.stderr
    raw = (executable.parent / 'release-manifest.json').read_bytes()
    signature = (executable.parent / 'release-manifest.sig').read_bytes()
    KEY.public_key().verify(base64.b64decode(signature), raw)
    manifest = json.loads(raw)
    assert manifest['sha256'] == hashlib.sha256(PAYLOAD).hexdigest()
    assert manifest['dataSha256'] == hashlib.sha256((tree / 'public/data/update-manifest.json').read_bytes()).hexdigest()
    failed = subprocess.run([*command, 'sign'], env=dict(os.environ, UMALYTICS_UPDATE_SIGNING_KEY=''),
                            capture_output=True, text=True, timeout=10)
    assert failed.returncode != 0 and 'must contain a base64' in failed.stderr
    assert (executable.parent / 'release-manifest.json').read_bytes() == raw


def main():
    releases = ThreadingHTTPServer(('127.0.0.1', 0), Releases)
    threading.Thread(target=releases.serve_forever, kwargs={'poll_interval': .05}, daemon=True).start()
    server = None
    app = None
    children = []
    (ROOT / '.cache').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='update-flow-', dir=ROOT / '.cache') as temporary:
        folder = Path(temporary)
        packaging_flow(folder)
        executable = folder / 'Umalytics.exe'
        old = b'MZ current harmless installation'
        executable.write_bytes(old)
        data = folder / 'Umalytics-data'
        resources = folder / 'resources/desktop'
        resources.mkdir(parents=True)
        (resources / 'build-info.json').write_text(json.dumps({'version': '0.2.0', 'buildNumber': 0}))
        (resources / 'update-public-key.txt').write_text(PUBLIC.hex())
        active = [True]
        launches = []
        report = folder / 'helper-report.json'
        helper = folder / 'helper-fixture.py'
        helper.write_text(HELPER)
        fail_helper = [True]
        helper_mode = ['success']
        release_helper = folder / 'release-helper'
        try:
            app = Service(data, no_proxy=True, desktop_exe=executable)
            app.updater.close()
            server = LocalServer(('127.0.0.1', 0), make_handler(app))
            app.server = server
            url = f'http://127.0.0.1:{server.server_port}'
            parent_environment = dict(os.environ)

            def launch(arguments, **kwargs):
                launches.append(arguments)
                assert arguments[1] == '--apply-update'
                assert kwargs['env']['PYINSTALLER_RESET_ENVIRONMENT'] == '1'
                assert dict(os.environ) == parent_environment, 'Helper handoff changed its parent environment.'
                command = ([sys.executable, '-c', 'raise SystemExit(1)'] if fail_helper[0] else
                           [sys.executable, str(helper), arguments[2], url, PUBLIC.hex(), str(report), helper_mode[0], str(release_helper)])
                child = subprocess.Popen(command, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), env=kwargs['env'])
                children.append(child)
                return child

            app.updater = UpdateController(data, executable, resources.parent, lambda: active[0],
                                          opener=FixtureTransport(f'http://127.0.0.1:{releases.server_port}'), launch=launch)
            threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .05}, daemon=True).start()
            status, health = api(url, '/api/health')
            assert status == 200 and health['version'] == '0.2.0'
            token = health['csrfToken']
            assert api(url, '/api/update/install', {}, origin='https://attacker.invalid')[0] == 403
            assert api(url, '/api/update/check', {})[0] == 403
            assert api(url, '/api/update/restart', {'token': '0' * 64}, token)[0] == 400

            sentinels = {'races/preserved.json': b'{"synthetic":true}', 'capture/private-test': b'private-fixture',
                         'webview/state': b'profile-fixture', 'exports/preserved.json': b'{}'}
            for relative, raw in sentinels.items():
                path = data / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)

            for mode in ('bad-signature', 'arbitrary-url', 'bad-redirect', 'bad-hash', 'interrupted'):
                state['mode'], state['generation'] = mode, state['generation'] + 1
                assert api(url, '/api/update/install', {}, token)[0] == 200
                failed = wait_status(url, 'error')
                assert failed['error']
                assert executable.read_bytes() == old and not launches
                assert not (data / 'cache/update/Umalytics.exe.partial').exists()
                for relative, raw in sentinels.items():
                    assert (data / relative).read_bytes() == raw

            state['mode'], state['generation'] = 'valid', state['generation'] + 1
            app.updater.start()
            available = wait_status(url, 'available')
            assert available['availableVersion'] == '0.2.7' and available['canInstall']
            assert available['currentVersion'] == '0.2.0' and available['checkedAt']
            assert api(url, '/api/update/check', {}, token)[0] == 200
            wait_status(url, 'available')
            assert state['conditional'] >= 1
            # Simulate an hour that became overdue during system sleep.
            with app.updater.lock:
                app.updater.next_check = time.time() - 3601
            app.updater.wake.set()
            deadline = time.monotonic() + 5
            while state['conditional'] < 2 and time.monotonic() < deadline:
                time.sleep(.03)
            assert state['conditional'] >= 2

            # A native cleanup/helper lock prevents the client from touching
            # shared staging files. Its old receipt is invalidated only after
            # exclusive access becomes available.
            update_folder = data / 'cache/update'
            receipt = update_folder / 'success.json'
            receipt.write_text('{"previous":"fixture"}')
            with staging_lock(update_folder):
                assert api(url, '/api/update/install', {}, token)[0] == 200
                wait_status(url, 'error')
                assert receipt.read_text() == '{"previous":"fixture"}'
            assert api(url, '/api/update/install', {}, token)[0] == 200
            waiting = wait_status(url, 'waiting-for-game')
            assert not receipt.exists()
            assert waiting['gameActive'] and waiting['downloadBytes'] == len(PAYLOAD)
            assert not launches and not report.exists()
            assert executable.read_bytes() == old
            active[0] = False
            wait_status(url, 'error')
            assert len(launches) == 1 and executable.read_bytes() == old
            assert not report.exists(), 'Failed native preparation must leave the live app running.'

            fail_helper[0] = False
            for mode in ('crash-after-ack', 'abort-after-ack'):
                helper_mode[0] = mode
                assert api(url, '/api/update/install', {}, token)[0] == 200
                wait_status(url, 'error')
                assert executable.read_bytes() == old and not report.exists()
                deadline = time.monotonic() + 3
                while not app.updater.status()['canInstall'] and time.monotonic() < deadline:
                    time.sleep(.03)
                assert app.updater.status()['canInstall'], 'A failed acknowledged helper must allow retry.'
            helper_mode[0] = 'success'
            assert api(url, '/api/update/install', {}, token)[0] == 200
            wait_status(url, 'restarting')
            assert api(url, '/api/update/restart', {'token': json.loads((data / 'cache/update/transaction.json').read_text())['token']}, token)[0] == 400
            assert api(url, '/api/update/abort', {'token': '0' * 64}, token)[0] == 400
            deadline = time.monotonic() + 3
            while not report.exists() and time.monotonic() < deadline:
                time.sleep(.03)
            app.updater.close()
            release_helper.touch()
            for child in children:
                child.wait(timeout=5)
            assert json.loads(report.read_text()) == {'verified': True, 'version': '0.2.7', 'nativeHandoff': True}
            transaction = json.loads((data / 'cache/update/transaction.json').read_text())
            assert Path(transaction['installationDir']) == folder
            assert Path(transaction['dataDirectory']) == data
            assert len(transaction['token']) == 64
            assert (data / 'cache/update/Umalytics.exe').read_bytes() == PAYLOAD
            assert (data / 'cache/update/helper.exe').read_bytes() == old
            assert executable.read_bytes() == old
            for relative, raw in sentinels.items():
                assert (data / relative).read_bytes() == raw
            assert all('attacker' not in path for path in state['requests'])
            print(json.dumps({'service': 'real loopback', 'signedReleaseServer': 'local fixture',
                              'invalidSignature': 'passed', 'schemaAndRedirectBounds': 'passed',
                              'hashAndInterruptedDownload': 'passed', 'conditionalAndResume': 'passed',
                              'gameDeferral': 'passed', 'failedHelperRecovery': 'passed',
                              'acknowledgedHelperCrashAndAbort': 'passed',
                              'nativeStagingLock': 'passed',
                              'verifiedHelperHandshake': 'passed', 'releaseStampAndSigning': 'passed',
                              'userData': 'preserved'}))
        finally:
            if app:
                app.updater.close()
                app.closed.set()
            release_helper.touch()
            if server:
                server.shutdown()
                server.server_close()
            if app:
                app.status_socket.close()
            for child in children:
                if child.poll() is None:
                    child.wait(timeout=5)
            releases.shutdown()
            releases.server_close()


if __name__ == '__main__':
    main()
