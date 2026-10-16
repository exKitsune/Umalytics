"""Offline whole-service workflows against disposable portable installations.

Run with .cache/proxy-venv/Scripts/python.exe tests/portable-storage-workflow.py.
No real installation, game, trust store mutation or external network is used.
"""
import hashlib
import base64
import gzip
import json
import os
from pathlib import Path
import runpy
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
import service as desktop
from reference_data import FILES
from capture_store import load_store


def snapshot(version):
    values = {
        'metadata.json': {'schemaVersion': 1, 'characters': {}, 'skillNames': {}, 'skills': {}, 'release': version},
        'courses.json': {'101': {'distance': 1600}},
        'course-geometry.json': {'schemaVersion': 1, 'paths': {}, 'courses': {}},
        'simulator-skill-ids.json': [], 'reference-source.json': {'release': version},
    }
    contents = {name: json.dumps(value).encode() for name, value in values.items()}
    contents.update({'NOTICE.txt': b'fixture notice', 'UMA-TOOLS-LICENSE.txt': b'fixture license'})
    manifest = json.dumps({'schemaVersion': 1, 'files': {name: {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()} for name, raw in contents.items()}}).encode()
    return manifest, contents


def bundle(resources, version):
    manifest, contents = snapshot(version)
    folder = resources / 'dist/data'
    folder.mkdir(parents=True, exist_ok=True)
    for name, raw in dict(contents, **{'update-manifest.json': manifest}).items():
        (folder / name).write_bytes(raw)
    return manifest, contents


def legacy_snapshot(data, version, source='repository'):
    manifest, contents = snapshot(version)
    digest = hashlib.sha256(manifest).hexdigest()
    folder = data / 'data' / digest
    folder.mkdir(parents=True)
    for name, raw in dict(contents, **{'update-manifest.json': manifest}).items():
        (folder / name).write_bytes(raw)
    (data / 'data/active.json').write_text(json.dumps({'source': source, 'manifestSha256': digest}))
    return folder


class Installation:
    def __init__(self, data):
        self.service = desktop.Service(data, no_proxy=True)
        self.server = desktop.LocalServer(('127.0.0.1', 0), desktop.make_handler(self.service))
        self.service.server = self.server
        self.origin = f'http://127.0.0.1:{self.server.server_port}'
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .05}, daemon=True)
        self.thread.start()
        self.opener = build_opener(ProxyHandler({}))
        self.token = self.request('/api/health')[1]['csrfToken']

    def request(self, path, body=None, authenticated=True):
        headers = {}
        if body is not None:
            headers = {'Origin': self.origin, 'Content-Type': 'application/json'}
            if authenticated:
                headers['X-UmaTrace-CSRF'] = self.token
        request = Request(self.origin + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            response = self.opener.open(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            value = json.loads(raw) if response.headers.get('Content-Type', '').startswith('application/json') else raw
            return response.status, value

    def close(self):
        self.service.shutdown()
        self.thread.join(5)
        self.server.server_close()
        self.service.status_socket.close()


def assert_active(data, contents):
    folder = data / 'data'
    assert {name: (folder / name).read_bytes() for name in FILES} == contents
    assert not (folder / '.umalytics-transaction').exists()
    assert all(not path.is_dir() for path in folder.iterdir() if len(path.name) == 64)


def cache_workflow(instance, data, race_id):
    before = {p.name: p.read_bytes() for p in (data / 'races').iterdir()}
    prefs = instance.request('/api/preferences', {'raceTags': {race_id: ['Finals', 'Wet']}})[1]
    status = instance.request('/api/analysis-cache')[1]
    assert status['policy']['mode'] == 'unlimited' and status['entries'] == []
    assert instance.request('/api/analysis-cache', {'action': 'purge'}, authenticated=False)[0] == 403
    payload = base64.b64encode(gzip.compress(os.urandom(600000))).decode()
    for i in range(3):
        body = {'action': 'put', 'key': str(i) * 64, 'raceId': f'fixture-{i}', 'date': f'2026-10-{10+i}T12:00:00Z', 'revision': 'a' * 64, 'payload': payload}
        code, status = instance.request('/api/analysis-cache', body)
        assert code == 200 and len(status['entries']) == i + 1
    assert instance.request('/api/analysis-cache/' + '1' * 64)[1]['payload'] == payload
    policy = {'mode': 'races', 'value': 2, 'background': True}
    status = instance.request('/api/analysis-cache', {'action': 'policy', 'policy': policy})[1]
    assert [row['raceId'] for row in status['entries']] == ['fixture-2', 'fixture-1']
    policy.update(mode='size', value=1)
    status = instance.request('/api/analysis-cache', {'action': 'policy', 'policy': policy})[1]
    assert len(status['entries']) == 1 and status['bytes'] <= 1024 * 1024
    assert status['entries'][0]['raceId'] == 'fixture-2'
    assert instance.request('/api/analysis-cache', {'action': 'revision', 'revision': 'b' * 64})[1]['entries'] == []
    policy.update(mode='unlimited')
    instance.request('/api/analysis-cache', {'action': 'policy', 'policy': policy})
    body.update(revision='b' * 64)
    instance.request('/api/analysis-cache', body)
    instance.request('/api/analysis-cache', body)
    assert len(instance.request('/api/analysis-cache')[1]['entries']) == 1
    status = instance.request('/api/analysis-cache', {'action': 'purge'})[1]
    assert status['entries'] == [] and status['bytes'] < 100000
    for patch in ({'mode': 'size', 'value': -1, 'background': True}, {'mode': 'unknown', 'value': 1, 'background': True}):
        assert instance.request('/api/analysis-cache', {'action': 'policy', 'policy': patch})[0] == 400
    assert instance.request('/api/analysis-cache', dict(body, key='../escape'))[0] == 400
    assert instance.request('/api/preferences', {'raceTags': {race_id: ['x' * 41]}})[0] == 400
    assert {p.name: p.read_bytes() for p in (data / 'races').iterdir()} == before
    assert instance.request('/api/preferences')[1] == prefs
    # Leave one entry to prove the next service process restores it.
    instance.request('/api/analysis-cache', body)
    return prefs


def workflows(temporary):
    resources = temporary / 'resources'
    (resources / 'desktop').mkdir(parents=True)
    (resources / 'desktop/build-info.json').write_text('{"version":"0.2.1","buildNumber":1}')
    (resources / 'desktop/update-public-key.txt').write_text('00' * 32)
    notices = b'Umalytics third-party dependency notices\nPython fixture\nfixture retained notice\n'
    (resources / 'THIRD-PARTY-NOTICES.txt').write_bytes(notices)
    (resources / '.cache/desktop-licenses').mkdir(parents=True)
    (resources / '.cache/desktop-licenses/THIRD-PARTY-NOTICES.txt').write_bytes(notices)
    desktop.RESOURCE_ROOT = resources
    manifest1, contents1 = bundle(resources, 'release-1')
    data = temporary / 'portable/Umalytics-data'
    data.mkdir(parents=True)
    old = legacy_snapshot(data, 'old-repository')
    unknown = data / ('data/' + 'f' * 64)
    unknown.mkdir()
    (unknown / 'personal.txt').write_bytes(b'preserve unknown files')
    (data / 'races').mkdir()
    capture_raw = b'{"title":"preserved capture","race_start_info":{}}'
    (data / 'races/captured.json').write_bytes(capture_raw)
    from mitmproxy.certs import CertStore
    CertStore.create_store(data / 'proxy', 'mitmproxy', 2048)
    original_ca = {path.name: path.read_bytes() for path in (data / 'proxy').iterdir()}
    (data / 'licenses').mkdir()
    (data / 'licenses/Python-LICENSE.txt').write_bytes(b'fixture retained notice')
    (data / 'licenses/DEPENDENCIES.txt').write_bytes(b'Python fixture\n')
    (data / 'THIRD-PARTY-NOTICES.txt').write_bytes(notices)
    instance = Installation(data)
    try:
        assert not old.exists()
        assert (unknown / 'personal.txt').read_bytes() == b'preserve unknown files'
        # Unknown hashed folders survive; only fully verified generated snapshots go.
        for name in FILES:
            assert (data / 'data' / name).read_bytes() == contents1[name]
        assert not (data / 'proxy').exists()
        assert {path.name.replace('umalytics-', 'mitmproxy-', 1): path.read_bytes() for path in (data / 'capture').iterdir()} == original_ca
        assert not (data / 'licenses').exists() and not (data / 'THIRD-PARTY-NOTICES.txt').exists()
        assert instance.request('/api/licenses') == (200, notices)
        assert instance.request('/api/game/launch-state', {'pid': os.getpid(), 'active': True}) == (200, {'ok': True})
        assert instance.request('/api/update/status')[1]['gameActive'] is True
        assert instance.request('/api/app/exit', {'onlyIfIdle': True})[0] == 409
        assert instance.request('/api/game/launch-state', {'pid': os.getpid(), 'active': False}) == (200, {'ok': True})
        assert instance.request('/api/update/status')[1]['gameActive'] is False
        assert instance.request('/api/preferences', {'theme': 'light'}, authenticated=False)[0] == 403
        race_id = 'local-' + 'a' * 64
        race = {'schemaVersion': 1, 'id': 'shared-race', 'title': 'Imported fixture', 'synthetic': False,
                'distance': 1600, 'courseId': 101, 'category': 'practice',
                'runners': [{'id': 'runner-1', 'name': 'Fixture'}], 'frames': [], 'events': [], 'warnings': []}
        code, receipt = instance.request('/api/races/import', {'id': race_id, 'race': race})
        assert code == 200 and receipt['id'] == race_id and len(receipt['sha256']) == 64, receipt
        saved = data / 'races' / (race_id + '.json')
        timestamp = saved.stat().st_mtime_ns
        assert instance.request('/api/races/import', {'id': race_id, 'race': race}) == (200, receipt)
        assert saved.stat().st_mtime_ns == timestamp
        assert instance.request('/api/races/import', {'id': race_id, 'race': dict(race, title='conflict')})[0] == 400
        assert instance.request('/api/races/import', {'id': '../invalid', 'race': race})[0] == 400
        prefs = {'theme': 'light', 'fontScale': 125, 'courseAssignments': {race_id: 101, 'capture-captured~0': 101}, 'browserMigrationComplete': True}
        assert instance.request('/api/preferences', prefs) == (200, prefs)
        settings_stamp = (data / 'settings.json').stat().st_mtime_ns
        assert instance.request('/api/preferences', prefs) == (200, prefs)
        assert (data / 'settings.json').stat().st_mtime_ns == settings_stamp
        assert instance.request('/api/preferences', {'courseAssignments': {'bad': float('nan')}})[0] == 400
        for invalid in (True, 0, 74, 205, 122, '125', None):
            assert instance.request('/api/preferences', {'fontScale': invalid})[0] == 400
        assert instance.request('/api/preferences')[1]['fontScale'] == 125
        assert instance.request('/api/races/' + race_id)[1]['data'] == race
        listed = instance.request('/api/races?summary=1')[1]['races']
        assert next(item for item in listed if item['id'] == race_id)['courseId'] == 101
        assert (data / 'races/captured.json').read_bytes() == capture_raw
        prefs = cache_workflow(instance, data, race_id)
        # Accept repository updates under this bundle, then replace them when
        # starting the next bundled app release, including source=repository.
        repository_manifest, repository_contents = snapshot('newer-repository')
        downloads = dict(repository_contents, **{'update-manifest.json': repository_manifest})
        instance.service.reference_data.download = lambda name, limit: downloads[name]
        assert instance.request('/api/data/update', {})[0] == 200
        assert instance.request('/data/metadata.json')[1]['release'] == 'newer-repository'
    finally:
        instance.close()
    # Same release restarts keep the explicit repository snapshot and settings.
    instance = Installation(data)
    try:
        assert instance.request('/data/metadata.json')[1]['release'] == 'newer-repository'
        assert instance.request('/api/preferences') == (200, prefs)
        assert len(instance.request('/api/analysis-cache')[1]['entries']) == 1
        assert instance.request('/api/races/' + race_id)[1]['data'] == race
        assert instance.request('/api/preferences', {'courseAssignments': {}})[1]['courseAssignments'] == {}
    finally:
        instance.close()
    manifest2, contents2 = bundle(resources, 'release-2')
    instance = Installation(data)
    try:
        assert instance.request('/data/metadata.json')[1]['release'] == 'release-2'
        assert instance.request('/api/races/delete', {'id': race_id}) == (200, {'ok': True})
        assert instance.request('/api/races/' + race_id)[0] == 404
        assert (data / 'races/captured.json').read_bytes() == capture_raw
    finally:
        instance.close()
    # Model process termination after one active replacement: a prepared journal
    # and complete backups must restore the prior complete snapshot on restart.
    folder = data / 'data'
    transaction = folder / '.umalytics-transaction'
    (transaction / 'before').mkdir(parents=True)
    (transaction / 'after').mkdir()
    previous = {}
    for name in (*FILES, 'update-manifest.json', 'active.json'):
        raw = (folder / name).read_bytes()
        (transaction / 'before' / name).write_bytes(raw)
        previous[name] = hashlib.sha256(raw).hexdigest()
    (transaction / 'journal.json').write_text(json.dumps({'schemaVersion': 1, 'phase': 'prepared', 'previous': previous}))
    (folder / 'metadata.json').write_bytes(b'{"partial":true}')
    instance = Installation(data)
    try:
        assert instance.request('/data/metadata.json')[1]['release'] == 'release-2'
        assert not transaction.exists()
        assert instance.request('/api/preferences')[1]['courseAssignments'] == {}
    finally:
        instance.close()
    # Exercise actual collector startup/configuration and graceful shutdown with
    # a migrated CA. Every preexisting identity byte must remain unchanged.
    desktop.RESOURCE_ROOT = ROOT
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    proxy_port = listener.getsockname()[1]
    listener.close()
    process = subprocess.Popen([sys.executable, str(ROOT / 'desktop/service.py'), '--collector', '--data-dir', str(data), '--proxy-port', str(proxy_port)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        for _ in range(100):
            if process.poll() is not None:
                raise AssertionError(process.communicate()[1].decode())
            try:
                with socket.create_connection(('127.0.0.1', proxy_port), timeout=.1):
                    break
            except OSError:
                time.sleep(.1)
        else:
            raise AssertionError('Collector did not start.')
        (data / 'cache/collector.stop').touch()
        stdout, stderr = process.communicate(timeout=10)
        assert process.returncode == 0, stderr.decode()
        assert {path.name.replace('umalytics-', 'mitmproxy-', 1): path.read_bytes() for path in (data / 'capture').iterdir()} == original_ca
        assert not list((data / 'capture').glob('mitmproxy-*'))
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
    # A fresh install generates the friendly subject. Existing partial CAs fail
    # closed and are never regenerated, even when the public cert is present.
    fresh = temporary / 'fresh'
    fresh.mkdir()
    store = load_store(fresh)
    assert 'Umalytics Local Capture' in store.default_ca._cert.subject.rfc4514_string()
    before = {path.name: path.read_bytes() for path in fresh.iterdir()}
    (fresh / 'umalytics-ca.pem').unlink()
    try:
        load_store(fresh)
        raise AssertionError('Partial CA silently regenerated.')
    except ValueError:
        pass
    assert {path.name: path.read_bytes() for path in fresh.iterdir()} == {name: raw for name, raw in before.items() if name != 'umalytics-ca.pem'}


(ROOT / '.cache').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='portable-storage-', dir=ROOT / '.cache') as workspace:
    workflows(Path(workspace))
print('Portable storage/service workflows passed: migration, offline notices, import/preferences restart, reference recovery/release upgrade, live collector CA preservation.')
runpy.run_path(str(ROOT / 'tests/capture-inspection-workflow.py'), run_name='__main__')
runpy.run_path(str(ROOT / 'tests/service-fixture-lifetime-workflow.py'), run_name='__main__')
