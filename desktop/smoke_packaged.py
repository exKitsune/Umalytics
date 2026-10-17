"""Verify an actual packaged binary in an isolated workspace data folder."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import socket
import ssl
import shutil
import sys
import tempfile
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

parser = argparse.ArgumentParser()
parser.add_argument('executable', type=Path)
parser.add_argument('--collector-probe', action='store_true')
parser.add_argument('--no-proxy', action='store_true')
parser.add_argument('--update-reference', action='store_true')
parser.add_argument('--headless', action='store_true', help='Skip interactive Explorer selection checks.')
args = parser.parse_args()
executable_command = [sys.executable, str(args.executable.resolve())] if args.executable.suffix == '.py' else [str(args.executable.resolve())]
args.collector_probe = not args.no_proxy
root = Path(__file__).resolve().parent.parent
opener = build_opener(ProxyHandler({}))


def port_available(port):
    with socket.socket() as probe:
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            probe.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False


def assert_owned(health, data):
    assert Path(health.get('dataDirectory', '')).resolve() == data.resolve(), 'Refusing to control another installation.'


def explorer_export_check(path, close=False):
    if args.headless:
        return
    # Inspect the real Explorer window created for this unique test directory.
    # Never close another Explorer window or terminate the shell process.
    script = r'''
    $target = $env:UMATRACE_TEST_EXPORT_FILE
    $folder = [IO.Path]::GetDirectoryName($target)
    $shell = New-Object -ComObject Shell.Application
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        foreach ($window in $shell.Windows()) {
            try {
                if ($window.Document.Folder.Self.Path -eq $folder) {
                    if ($env:UMATRACE_TEST_CLOSE -eq '1') { $window.Quit(); exit 0 }
                    foreach ($item in $window.Document.SelectedItems()) {
                        if ($item.Path -eq $target) { exit 0 }
                    }
                }
            } catch {}
        }
        Start-Sleep -Milliseconds 100
    }
    if ($env:UMATRACE_TEST_CLOSE -eq '1') { exit 0 }
    exit 1
    '''
    result = subprocess.run(['powershell.exe', '-NoProfile', '-WindowStyle', 'Hidden', '-Command', script],
                            env=dict(os.environ, UMATRACE_TEST_EXPORT_FILE=str(path), UMATRACE_TEST_CLOSE='1' if close else '0'),
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=subprocess.CREATE_NO_WINDOW, timeout=15)
    if not close:
        assert result.returncode == 0, 'Explorer did not select the saved JSON file.'


def tls_loopback_fixture(data, game_sni=False):
    from datetime import datetime, timedelta, timezone
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    hostname = 'api.games.\x75mamusume.com' if game_sni else 'localhost'
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, hostname)])
    now = datetime.now(timezone.utc)
    certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                   .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=1))
                   .not_valid_after(now + timedelta(hours=1))
                   .add_extension(x509.SubjectAlternativeName([x509.DNSName(hostname)]), critical=False)
                   .sign(key, hashes.SHA256()))
    cert_path, key_path = data / 'fixture-cert.pem', data / 'fixture-key.pem'
    cert_path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    body = b'{"synthetic":"encrypted loopback fixture"}'
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_GET(self):
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert_path, key_path)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .05}, daemon=True).start()
    try:
        socket_client = socket.create_connection(('127.0.0.1', 14327), timeout=5)
        target = f'127.0.0.1:{server.server_port}'
        socket_client.sendall(f'CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n'.encode())
        header = b''
        while not header.endswith(b'\r\n\r\n'):
            header += socket_client.recv(1)
            if len(header) > 8192:
                raise RuntimeError('Invalid CONNECT response.')
        assert b' 200 ' in header
        client_context = ssl.create_default_context(cafile=str(cert_path))
        with client_context.wrap_socket(socket_client, server_hostname=hostname) as encrypted:
            assert hashlib.sha256(encrypted.getpeercert(binary_form=True)).digest() == hashlib.sha256(certificate.public_bytes(serialization.Encoding.DER)).digest()
            if game_sni:
                for _ in range(20):
                    with opener.open(url + '/api/health', timeout=3) as status_response:
                        status = json.load(status_response)['proxy']
                    if status['gameConnected']:
                        break
                    time.sleep(.05)
                else:
                    raise AssertionError('API TLS traffic did not promptly update game connection status.')
                assert status['listening'] and status['activeGameConnections'] == 1 and status['lastGameTrafficAt']
            encrypted.sendall(b'GET /synthetic HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
            response = b''
            while True:
                chunk = encrypted.recv(4096)
                if not chunk:
                    break
                response += chunk
            assert response.endswith(body)
    finally:
        server.shutdown()
        server.server_close()
    for _ in range(30):
        with opener.open(url + '/api/health', timeout=3) as status_response:
            status = json.load(status_response)['proxy']
        if not status['gameConnected']:
            break
        time.sleep(.1)
    assert not status['gameConnected'] and status['activeGameConnections'] == 0


def geometry_from_packaged_http():
    with opener.open(url + '/data/course-geometry.json', timeout=10) as response:
        raw = response.read()
    geometry = json.loads(raw)
    assert geometry['schemaVersion'] == 1 and len(geometry['courses']) == 119
    for binding in geometry['courses'].values():
        assert binding['path'] in geometry['paths']
        if binding.get('loop'):
            assert binding['loop'] in geometry['paths']
    binding = geometry['courses']['10606']
    path = geometry['paths'][binding['path']]
    assert path['distance'] == 2400 and len(path['points']) == 1001
    first, last = path['points'][0], path['points'][-1]
    assert abs(first[0] - 95.264) < .002 and abs(first[2] - 193.040) < .002
    assert abs(last[0] + 217.306) < .002 and abs(last[2] - 180.100) < .002
    length_xz = sum(((b[0]-a[0])**2 + (b[2]-a[2])**2)**.5 for a, b in zip(path['points'], path['points'][1:]))
    assert abs(length_xz - 2400) < .1
    loop = geometry['paths'][binding['loop']]
    assert len(loop['points']) == 1001 and loop['distance'] == 2095
    return raw
assert all(port_available(port) for port in (14317, 14327)), 'Existing service/proxy owns packaged test ports; left untouched.'
with tempfile.TemporaryDirectory(prefix='desktop-smoke-', dir=root / '.cache') as folder:
    data = Path(folder)
    url = 'http://127.0.0.1:14317'
    service_args = ['--serve', '--port', '14317', '--proxy-port', '14327', '--data-dir', folder]
    if not args.collector_probe:
        service_args.append('--no-proxy')
    child = subprocess.Popen([*executable_command, *service_args],
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        for _ in range(120):
            try:
                with opener.open(url + '/api/health', timeout=1) as response:
                    health = json.load(response)
                break
            except Exception:
                if child.poll() is not None:
                    raise RuntimeError('Packaged service exited before readiness.')
                time.sleep(0.25)
        else:
            raise RuntimeError('Packaged service did not become ready.')
        assert_owned(health, data)
        assert health['app'] == 'UmaTrace' and health['staticReady'] and not health['certificate']['trusted']
        with opener.open(url + '/api/data/status', timeout=3) as response:
            assert len(json.load(response)['manifestSha256']) == 64
        with opener.open(url + '/data/simulator-skill-ids.json', timeout=3) as response:
            assert len(json.load(response)) > 100
        with opener.open(url + '/data/metadata.json', timeout=3) as response:
            assert json.load(response)['schemaVersion'] == 1
        bundled_geometry = geometry_from_packaged_http()
        with opener.open(url + '/api/licenses', timeout=3) as response:
            notice_text = response.read().decode('utf-8')
        assert 'Python-LICENSE.txt' in notice_text and 'Frontend svelte ' in notice_text
        assert 'Rust crate tauri-' in notice_text and 'Python package mitmproxy ' in notice_text
        assert not (data / 'licenses').exists(), 'New install extracted a legacy license tree.'
        assert not (data / 'THIRD-PARTY-NOTICES.txt').exists(), 'New install extracted embedded notices.'
        if args.collector_probe:
            for _ in range(80):
                with opener.open(url + '/api/health', timeout=3) as response:
                    health = json.load(response)
                if health['proxy']['state'] == 'running' and health['proxy']['stage'] == 'probe' and health['certificate']['exists']:
                    break
                time.sleep(0.25)
            else:
                raise RuntimeError('Bundled collector did not become ready in passthrough mode.')
            assert health['certificate']['exists'] and not health['certificate']['trusted']
            assert health['proxy']['listening'] and not health['proxy']['gameConnected']
            with socket.create_connection(('127.0.0.1', 14327), timeout=3):
                pass  # TCP readiness only: no game, credentials, or upstream traffic.
            tls_loopback_fixture(data)
            tls_loopback_fixture(data, game_sni=True)
            # Polling the real running collector and API must not rewrite data files.
            def persistent_files():
                return {str(p.relative_to(data)): (p.stat().st_mtime_ns, p.stat().st_size)
                        for p in data.rglob('*') if p.is_file()}
            before_idle = persistent_files()
            for _ in range(12):
                with opener.open(url + '/api/health', timeout=3) as response:
                    assert json.load(response)['proxy']['listening']
                time.sleep(.25)
            assert persistent_files() == before_idle, 'Idle collector changed persistent files.'
            assert not (data / 'collector-status.json').exists()
        race = [{'title': 'Packaged smoke fixture', 'category': 'practice', 'race_scenario': 'synthetic'}]
        (data / 'races' / 'synthetic.json').write_text(json.dumps(race), encoding='utf-8')
        with opener.open(url + '/api/races?summary=1', timeout=3) as response:
            assert json.load(response)['total'] == 1
        with opener.open(url + '/api/races/synthetic', timeout=3) as response:
            assert json.load(response)['data'] == race
        second = subprocess.run([*executable_command, *service_args],
                                timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        assert second.returncode == 0 and child.poll() is None
        headers = {'Content-Type': 'application/json', 'Origin': url, 'X-UmaTrace-CSRF': health['csrfToken']}
        for blocked_headers in ({'Content-Type': 'application/json', 'Origin': url},
                                {'Content-Type': 'application/json', 'X-UmaTrace-CSRF': health['csrfToken']},
                                {**headers, 'Origin': 'https://attacker.invalid'}):
            try:
                opener.open(Request(url + '/api/settings', data=b'{"collectionEnabled":false}', headers=blocked_headers), timeout=3)
            except HTTPError as error:
                assert error.code == 403
            else:
                raise AssertionError('Mutation lacked required origin or CSRF protection.')
        with opener.open(Request(url + '/api/settings', data=b'{"categories":{"career":false}}', headers=headers), timeout=3) as response:
            assert json.load(response)['categories']['career'] is False
        settings_mtime = (data / 'settings.json').stat().st_mtime_ns
        with opener.open(Request(url + '/api/settings', data=b'{"categories":{"career":false}}', headers=headers), timeout=3) as response:
            assert json.load(response)['categories']['career'] is False
        assert (data / 'settings.json').stat().st_mtime_ns == settings_mtime
        with opener.open(Request(url + '/api/settings', data=json.dumps({'exportDirectory': str(data / 'exports')}).encode(), headers=headers), timeout=3) as response:
            assert Path(json.load(response)['exportDirectory']) == data / 'exports'
        export_content = json.dumps({'title': 'System export fixture', 'races': race}, ensure_ascii=False)
        export_body = json.dumps({'filename': 'system-export.json', 'content': export_content}).encode()
        with opener.open(Request(url + '/api/exports', data=export_body, headers=headers), timeout=10) as response:
            exported = json.load(response)
        assert Path(exported['path']).read_text(encoding='utf-8') == export_content
        assert Path(exported['path']).parent == (data / 'exports').resolve()
        if not args.headless:
            assert exported['revealed']
        with opener.open(Request(url + '/api/exports', data=export_body, headers=headers), timeout=10) as response:
            duplicate_export = json.load(response)
        assert duplicate_export['filename'] == 'system-export (1).json'
        assert Path(duplicate_export['path']).read_text(encoding='utf-8') == export_content
        explorer_export_check(duplicate_export['path'])
        explorer_export_check(duplicate_export['path'], close=True)
        for filename in ('../escape.json', 'CON.json', 'invalid.exe'):
            try:
                opener.open(Request(url + '/api/exports', data=json.dumps({'filename':filename, 'content':export_content}).encode(), headers=headers), timeout=3)
            except HTTPError as error:
                assert error.code == 400
            else:
                raise AssertionError('Unsafe export filename accepted.')
        if args.collector_probe:
            with opener.open(Request(url + '/api/settings', data=b'{"collectionEnabled":false}', headers=headers), timeout=3) as response:
                assert not json.load(response)['collectionEnabled']
            time.sleep(2)
            with socket.create_connection(('127.0.0.1', 14327), timeout=3):
                pass  # Pausing exports must leave the game proxy available.
            tls_loopback_fixture(data)
            compiler = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework/v4.0.30319/csc.exe'
            probe = data / 'LauncherFixture.exe'
            subprocess.run([str(compiler), '/nologo', '/target:exe', f'/out:{probe}',
                            '/reference:System.Runtime.Serialization.dll', str(root / 'tests/launcher/LauncherProbe.cs')],
                           check=True, creationflags=subprocess.CREATE_NO_WINDOW)
            child_output = data / 'child-argv.json'
            forwarded = [str(child_output), '', 'two words', 'quote"inside', 'C:\\ends with slash\\',
                         '\\"', '日本語', '%command%', '$literal`value', '--check']
            before = dict(os.environ)
            launch = subprocess.run([*executable_command, '--port', '14317', '--launch-game', '--', str(probe), *forwarded],
                                    timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
            assert launch.returncode == 37
            child_record = json.loads(child_output.read_text(encoding='utf-8'))
            assert child_record['args'] == forwarded, 'Launcher arguments changed: ' + repr(child_record['args'])
            assert not child_record['console_attached'], 'Launcher attached a console.'
            for key in ('http_proxy', 'https_proxy', 'all_proxy'):
                assert child_record[key] == 'http://127.0.0.1:14327'
            assert child_record['no_proxy'] == 'localhost,127.0.0.1,::1'
            assert dict(os.environ) == before
        # Legacy Team Trials arrays retain each race independently in the history.
        team_races = [{'title': f'Team trial {i}', 'race_category': 'team-trials', 'race_scenario': f'synthetic-{i}'} for i in range(5)]
        team_races[0].update(race_course_set={'id':10606,'distance':2400}, weather=1, ground_condition=1, season=2)
        team_races[1].update(courseId=10602, distance=1600, conditions={'weather':'Sunny','ground':'Firm'})
        team_races[2].update({'<RaceCourseSet>k__BackingField':{'Id':10811,'Distance':3200}, '<Weather>k__BackingField':2})
        team_races[3].update(race_instance_id=100901)
        team_races[4].update(race_instance_id=123456789, auth={'token':'summary-must-not-expose'}, conditions={'weather':'x'*100})
        (data / 'races/team.json').write_text(json.dumps(team_races))
        with opener.open(url + '/api/races/team', timeout=3) as response:
            assert len(json.load(response)['data']) == 5
        with opener.open(url + '/api/races?summary=1&limit=200', timeout=3) as response:
            summary = json.load(response)
        assert summary['total'] == 6 and summary['nextOffset'] is None
        team_entries = [entry for entry in summary['races'] if entry['filename'] == 'team.json']
        assert len(team_entries) == 5 and len({r['sha256'] for r in team_entries}) == 5
        by_id = {entry['id']: entry for entry in team_entries}
        assert by_id['team~0']['courseId'] == 10606 and by_id['team~0']['distance'] == 2400
        assert by_id['team~0']['conditions'] == {'weather':'1', 'ground':'1', 'season':'2'}
        assert by_id['team~1']['courseId'] == 10602 and by_id['team~1']['conditions']['ground'] == 'Firm'
        assert by_id['team~2']['courseId'] == 10811 and by_id['team~2']['distance'] == 3200
        assert by_id['team~3']['raceInstanceId'] == 100901
        with opener.open(url + '/data/metadata.json', timeout=3) as response:
            active_metadata = json.load(response)
        if active_metadata.get('raceInstances', {}).get('100901'):
            assert by_id['team~3']['courseId'] == 10606 and by_id['team~3']['distance'] == 2400
        assert by_id['team~4']['courseId'] is None and by_id['team~4']['distance'] is None
        assert by_id['team~4']['conditions']['weather'] is None
        assert 'auth' not in by_id['team~4'] and 'race_scenario' not in by_id['team~4'] and 'summary-must-not-expose' not in json.dumps(summary)
        for entry in team_entries:
            assert entry['category'] == 'team-trials'
            with opener.open(url + '/api/races/' + entry['id'], timeout=3) as response:
                selected = json.load(response)
            assert len(selected['data']) == 1 and selected['sha256'] == entry['sha256']
        if args.update_reference:
            with opener.open(Request(url + '/api/data/update', data=b'{}', headers=headers), timeout=120) as response:
                update = json.load(response)
            assert update['source'] == 'repository' and len(update['manifestSha256']) == 64
            with opener.open(url + '/data/courses.json', timeout=3) as response:
                assert len(json.load(response)) > 100
            geometry_from_packaged_http()
        with opener.open(Request(url + '/api/app/exit', data=b'{}', headers=headers), timeout=3) as response:
            assert json.load(response)['ok']
        assert child.wait(timeout=15) == 0
        retained_mtimes = {data / 'settings.json': (data / 'settings.json').stat().st_mtime_ns}
        legacy_notice = data / 'licenses/legacy-fixture.txt'
        legacy_notice.parent.mkdir()
        legacy_notice.write_text('Preserve an earlier installation notice.\n', encoding='utf-8')
        retained_mtimes[legacy_notice] = legacy_notice.stat().st_mtime_ns
        child = subprocess.Popen([*executable_command, *service_args], creationflags=subprocess.CREATE_NO_WINDOW)
        for _ in range(120):
            try:
                with opener.open(url + '/api/health', timeout=1) as response:
                    restarted = json.load(response)
                break
            except Exception:
                time.sleep(0.25)
        else:
            raise RuntimeError('Packaged service did not restart with persisted data.')
        assert_owned(restarted, data)
        with opener.open(url + '/api/settings', timeout=3) as response:
            settings = json.load(response)
        assert all(p.stat().st_mtime_ns == modified for p, modified in retained_mtimes.items()), 'Restart rewrote unchanged settings or licenses.'
        assert list(legacy_notice.parent.iterdir()) == [legacy_notice], 'Restart copied a legacy license tree.'
        assert not settings['categories']['career']
        if args.collector_probe:
            assert not settings['collectionEnabled']
        with opener.open(url + '/api/races?summary=1', timeout=3) as response:
            assert json.load(response)['total'] == 6
        if args.update_reference:
            with opener.open(url + '/api/data/status', timeout=3) as response:
                assert json.load(response)['source'] == 'repository'
        geometry_from_packaged_http()
        headers['X-UmaTrace-CSRF'] = restarted['csrfToken']
        with opener.open(Request(url + '/api/app/exit', data=b'{}', headers=headers), timeout=3) as response:
            assert json.load(response)['ok']
        assert child.wait(timeout=15) == 0
        # An invalid geometry snapshot must fail even with matching file hashes.
        # This drives the real installed-cache validation on process startup.
        active_path = data / 'data/active.json'
        active = json.loads(active_path.read_text(encoding='utf-8'))
        valid_snapshot = data / 'data'
        manifest = json.loads((valid_snapshot / 'update-manifest.json').read_text(encoding='utf-8'))
        bad_geometry = json.loads((valid_snapshot / 'course-geometry.json').read_text(encoding='utf-8'))
        next(iter(bad_geometry['paths'].values()))['points'][0][0] = 'invalid-coordinate'
        bad_raw = json.dumps(bad_geometry).encode()
        manifest['files']['course-geometry.json'] = {'sha256': hashlib.sha256(bad_raw).hexdigest(), 'bytes': len(bad_raw)}
        manifest_raw = json.dumps(manifest).encode()
        bad_digest = hashlib.sha256(manifest_raw).hexdigest()
        bad_snapshot = valid_snapshot
        (bad_snapshot / 'course-geometry.json').write_bytes(bad_raw)
        (bad_snapshot / 'update-manifest.json').write_bytes(manifest_raw)
        active['manifestSha256'] = bad_digest
        active_path.write_text(json.dumps(active))
        child = subprocess.Popen([*executable_command, *service_args], creationflags=subprocess.CREATE_NO_WINDOW)
        for _ in range(120):
            try:
                with opener.open(url + '/api/health', timeout=1) as response:
                    restored = json.load(response)
                break
            except Exception:
                time.sleep(.25)
        else:
            raise RuntimeError('Packaged service did not reject the corrupted cache and start.')
        assert_owned(restored, data)
        assert geometry_from_packaged_http() == bundled_geometry
        with opener.open(url + '/api/data/status', timeout=3) as response:
            restored_data = json.load(response)
        assert restored_data['source'] == 'bundled' and restored_data['manifestSha256'] != bad_digest
        headers['X-UmaTrace-CSRF'] = restored['csrfToken']
        opener.open(Request(url + '/api/app/exit', data=b'{}', headers=headers), timeout=3).close()
        assert child.wait(timeout=15) == 0
        print(json.dumps({'serviceProcess': 'passed', 'processMode': 'source' if args.executable.suffix == '.py' else 'packaged', 'collectorPassthrough': 'passed' if args.collector_probe else 'not requested',
                          'encryptedLoopbackProxy': 'passed' if args.collector_probe else 'not requested',
                          'apiConnectionLifecycle': 'passed' if args.collector_probe else 'not requested',
                          'idlePersistentWrites': 'none' if args.collector_probe else 'not requested',
                          'unchangedSettingsWrites': 'none', 'desktopExportReveal': 'not requested (headless)' if args.headless else 'passed',
                          'actualLauncherStub': 'passed' if args.collector_probe else 'not requested',
                          'referenceAssets': 'passed', 'repositoryUpdate': 'passed' if args.update_reference else 'not requested',
                          'courseGeometryBindings': '119 passed', 'tokyoGeometry': 'passed', 'invalidGeometryCache': 'rejected',
                          'syntheticLibrary': 'passed', 'teamTrialsHistory': 'passed', 'singleInstance': 'passed',
                          'compactCourseConditions': 'passed',
                          'settings': 'passed', 'restartPersistence': 'passed', 'certificateTrustChanged': False, 'actualGameLaunched': False}))
    finally:
        explorer_export_check(data / 'exports/system-export.json', close=True)
        if child.poll() is None:
            try:
                with opener.open(url + '/api/health', timeout=1) as response:
                    latest = json.load(response)
                assert_owned(latest, data)
                stop_headers = {'Content-Type': 'application/json', 'Origin': url, 'X-UmaTrace-CSRF': latest['csrfToken']}
                opener.open(Request(url + '/api/app/exit', data=b'{}', headers=stop_headers), timeout=3).close()
                child.wait(timeout=15)
            except Exception:
                (data / 'cache/collector.stop').touch()
                time.sleep(2)
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=5)
