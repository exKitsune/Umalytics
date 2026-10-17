"""Exercise the distributable native EXE in an isolated portable installation.

This starts the real embedded runtime and a harmless launcher fixture. It never
installs certificate trust, changes startup/Steam settings, or launches the game.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.request import ProxyHandler, Request, build_opener


parser = argparse.ArgumentParser()
parser.add_argument('executable', type=Path)
parser.add_argument('--headless', action='store_true', help='Skip Explorer selection assertions on CI desktops.')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
url = 'http://127.0.0.1:4317'
opener = build_opener(ProxyHandler({}))
no_window = subprocess.CREATE_NO_WINDOW


def port_available(port):
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            probe.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False


def get(path):
    with opener.open(url + path, timeout=3) as response:
        return json.load(response)


def post(path, body, health):
    headers = {'Content-Type': 'application/json', 'Origin': url,
               'X-UmaTrace-CSRF': health['csrfToken']}
    request = Request(url + path, data=json.dumps(body).encode(), headers=headers)
    with opener.open(request, timeout=10) as response:
        return json.load(response)


def own_health(data):
    health = get('/api/health')
    assert health['app'] == 'UmaTrace'
    assert Path(health['dataDirectory']).resolve() == data.resolve(), 'Refusing to control another installation.'
    return health


def explorer_selection(path, close=False):
    script = r'''
    $target = $env:UMALYTICS_NATIVE_EXPORT
    $folder = [IO.Path]::GetDirectoryName($target)
    $shell = New-Object -ComObject Shell.Application
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        foreach ($window in $shell.Windows()) {
            try {
                if ($window.Document.Folder.Self.Path -eq $folder) {
                    if ($env:UMALYTICS_NATIVE_CLOSE -eq '1') { $window.Quit(); exit 0 }
                    foreach ($item in $window.Document.SelectedItems()) {
                        if ($item.Path -eq $target) { exit 0 }
                    }
                }
            } catch {}
        }
        Start-Sleep -Milliseconds 100
    }
    if ($env:UMALYTICS_NATIVE_CLOSE -eq '1') { exit 0 }
    exit 1
    '''
    result = subprocess.run(['powershell.exe', '-NoProfile', '-WindowStyle', 'Hidden', '-Command', script],
                            env=dict(os.environ, UMALYTICS_NATIVE_EXPORT=str(path), UMALYTICS_NATIVE_CLOSE='1' if close else '0'),
                            creationflags=no_window, timeout=15)
    if not close:
        assert result.returncode == 0, 'Explorer did not select the native export.'


def wait_for_owned_runtime(data):
    # The PyInstaller parent may retain its EXE briefly after releasing API ports.
    # Wait for only the exact private runtime processes; never terminate them.
    script = r'''
    $runtime = $env:UMALYTICS_NATIVE_RUNTIME
    $owned = @(Get-Process -Name UmalyticsCollector -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -and [IO.Path]::GetFileName($_.Path) -eq 'UmalyticsCollector.exe' -and
        $_.Path.StartsWith($runtime + '\', [StringComparison]::OrdinalIgnoreCase)
    })
    if ($owned.Count -gt 0) { $owned | Wait-Process -Timeout 20 -ErrorAction Stop }
    '''
    subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
                   env=dict(os.environ, UMALYTICS_NATIVE_RUNTIME=str(data / 'runtime')),
                   creationflags=no_window, timeout=25, check=True)


assert all(port_available(port) for port in (4317, 4327)), 'Existing app/proxy owns the native test ports; leave it running.'
with tempfile.TemporaryDirectory(prefix='native-smoke-', dir=root / '.cache') as folder:
    install = Path(folder)
    executable = install / 'Umalytics.exe'
    legacy = install / 'Umalytics-data'
    local = install / 'local-appdata'
    environment = dict(os.environ, LOCALAPPDATA=str(local))
    data = local / 'Umalytics'
    shutil.copy2(args.executable.resolve(), executable)
    (legacy / 'webview').mkdir(parents=True)
    (legacy / 'webview/legacy-profile-marker.txt').write_text('legacy browser profile preserved', encoding='utf-8')
    export_path = None
    started = False
    resident = None
    try:
        resident = subprocess.Popen([str(executable), '--background'], creationflags=no_window, env=environment)
        started = True
        for _ in range(240):
            assert resident.poll() is None, 'Background launch exited without a resident tray.'
            try:
                health = own_health(data)
                break
            except (OSError, ValueError):
                time.sleep(.25)
        else:
            raise AssertionError('Native background tray did not start its collector.')
        assert health['staticReady'] and not health['certificate']['trusted']
        assert not legacy.exists(), 'The old adjacent data directory was not removed.'
        assert str(executable) in health['launchOption']
        for _ in range(120):
            health = own_health(data)
            if health['proxy']['listening'] and health['certificate']['exists']:
                break
            time.sleep(.25)
        else:
            raise AssertionError('Native embedded collector did not listen.')
        assert health['proxy']['stage'] == 'probe' and not health['proxy']['gameConnected']
        assert health['certificate']['exists'] and not health['certificate']['trusted']
        assert not (data / 'webview').exists()
        assert (data / 'cache/webview/legacy-profile-marker.txt').read_text() == 'legacy browser profile preserved'
        for _ in range(120):
            if get('/api/preferences')['browserMigrationComplete']:
                break
            assert resident.poll() is None, 'Native window closed before loading its frontend.'
            time.sleep(.25)
        else:
            raise AssertionError('The native WebView did not finish loading the file-backed library.')
        runtime = list((data / 'runtime').glob('*.exe'))
        assert len(runtime) == 1
        assert runtime[0].name == 'UmalyticsCollector.exe'
        assert hashlib.sha256(runtime[0].read_bytes()).hexdigest() == health['runtimeBuildSha256']
        with opener.open(url + '/api/licenses', timeout=3) as response:
            notices = response.read().decode('utf-8')
        assert 'Python-LICENSE.txt' in notices and 'Frontend svelte ' in notices
        assert not (data / 'THIRD-PARTY-NOTICES.txt').exists()
        assert not (data / 'licenses').exists(), 'Native install extracted a legacy license tree.'
        assert not (data / 'proxy').exists()
        assert (data / 'capture/umalytics-ca-cert.pem').is_file()
        with opener.open(url + '/', timeout=3) as response:
            assert b'<html' in response.read().lower()
        race = {'title':'Native packaged fixture', 'race_course_set':{'id':10606,'distance':2400},
                'weather':1, 'ground_condition':1, 'race_scenario':'synthetic'}
        (data / 'races/native.json').write_text(json.dumps([race]), encoding='utf-8')
        summary = get('/api/races?summary=1')['races'][0]
        assert summary['courseId'] == 10606 and summary['distance'] == 2400
        assert summary['conditions']['weather'] == '1' and summary['conditions']['ground'] == '1'
        assert 'race_scenario' not in summary
        compiler = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework/v4.0.30319/csc.exe'
        fixture = install / 'LauncherFixture.exe'
        subprocess.run([str(compiler), '/nologo', '/target:exe', f'/out:{fixture}',
                        '/reference:System.Runtime.Serialization.dll', str(root / 'tests/launcher/LauncherProbe.cs')],
                       creationflags=no_window, check=True)
        output = install / 'child-argv.json'
        forwarded = [str(output), '', 'two words', 'quote"inside', 'C:\\ends with slash\\', '日本語', '%command%', '$literal`value', '--check']
        result = subprocess.run([str(executable), '--launch-game', '--', str(fixture), *forwarded],
                                creationflags=no_window, timeout=30, env=environment)
        assert result.returncode == 37
        assert resident.poll() is None, 'Steam launch closed a tray that was already running.'
        assert own_health(data)['proxy']['listening']
        record = json.loads(output.read_text(encoding='utf-8'))
        assert record['args'] == forwarded, 'Launcher arguments changed: ' + repr(record['args'])
        assert not record['console_attached'], 'Launcher attached a console.'
        assert all(record[key] == 'http://127.0.0.1:4327' for key in ('http_proxy','https_proxy','all_proxy'))
        assert record['no_proxy'] == 'localhost,127.0.0.1,::1'
        post('/api/settings', {'exportDirectory': str(data / 'exports')}, health)
        exported = post('/api/exports', {'filename':'native-export.json', 'content':json.dumps([race])}, health)
        export_path = Path(exported['path'])
        assert export_path.parent == (data / 'exports').resolve()
        if not args.headless:
            assert exported['revealed']
        assert json.loads(export_path.read_text(encoding='utf-8')) == [race]
        if not args.headless:
            explorer_selection(export_path)
            explorer_selection(export_path, close=True)
        before = {p:p.stat().st_mtime_ns for p in data.rglob('*') if p.is_file() and 'cache' not in p.relative_to(data).parts}
        legacy.mkdir()
        (legacy / 'ignore-after-migration.txt').write_text('stale folder must stay untouched')
        subprocess.run([str(executable), '--background'], creationflags=no_window, timeout=60, check=True, env=environment)
        assert own_health(data)['proxy']['listening']
        assert resident.poll() is None, 'A second background launch closed the resident tray.'
        assert all(p.stat().st_mtime_ns == modified for p, modified in before.items())
        assert (legacy / 'ignore-after-migration.txt').is_file()
        assert not (data / 'ignore-after-migration.txt').exists()
        assert not (data / 'collector-status.json').exists()
        assert post('/api/app/exit', {}, own_health(data))['ok']
        started = False
        for _ in range(80):
            if all(port_available(port) for port in (4317,4327)):
                break
            time.sleep(.25)
        else:
            raise AssertionError('Native service/proxy did not release their ports.')
        wait_for_owned_runtime(data)
        assert resident.wait(timeout=15) == 0, 'Native tray stayed alive after the collector was stopped.'
        steam = subprocess.run([str(executable), '--launch-game', '--', str(fixture), *forwarded],
                               creationflags=no_window, timeout=90, env=environment)
        assert steam.returncode == 37
        for _ in range(80):
            if all(port_available(port) for port in (4317, 4327)):
                break
            time.sleep(.25)
        else:
            started = True
            raise AssertionError('Steam-owned launch left collection running after the game fixture exited.')
        wait_for_owned_runtime(data)
        print(json.dumps({'nativeExecutable':'passed', 'appDataInstallation':'passed', 'adjacentDataMigration':'passed',
                          'embeddedRuntimeHash':'passed', 'nativeLauncherFixture':'passed',
                          'desktopExportExplorerSelection':'skipped (headless)' if args.headless else 'passed', 'courseSummary':'passed',
                          'residentTrayLifetime':'passed', 'singleInstanceBackground':'passed',
                          'nativeFrontendStorage':'passed', 'legacyProfileMigration':'passed',
                          'repeatedBackgroundWrites':'none', 'ownedShutdown':'passed',
                          'steamOwnedSessionShutdown':'passed',
                          'certificateTrustChanged':False, 'actualGameLaunched':False}))
    finally:
        if export_path and not args.headless:
            explorer_selection(export_path, close=True)
        if started:
            post('/api/app/exit', {}, own_health(data))
            for _ in range(80):
                if all(port_available(port) for port in (4317,4327)):
                    break
                time.sleep(.25)
            wait_for_owned_runtime(data)
        if resident and resident.poll() is None:
            resident.wait(timeout=15)
        # WebView2's child processes release profile files shortly after Tauri
        # exits. Wait for those owned files instead of killing browser processes.
        assert install.resolve().parent == (root / '.cache').resolve() and install.name.startswith('native-smoke-')
        for attempt in range(150):
            try:
                shutil.rmtree(install)
                break
            except PermissionError:
                if attempt == 149:
                    raise
                time.sleep(.2)
