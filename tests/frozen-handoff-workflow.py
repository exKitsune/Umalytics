"""Exercise real frozen parent -> native helper -> same-path fresh runtime.

The console-only fixture uses production UpdateController._handoff. Both cases
wait for actual PyInstaller parent extraction cleanup before launching its next
copy. No installed service, Windows trust store or real game is accessed.
"""
import argparse
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
FLAGS = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
OPENER = build_opener(ProxyHandler({}))


def request(port, token=None, path='/api/health', body=None):
    origin = f'http://127.0.0.1:{port}'
    headers = {'Origin': origin, 'Content-Type': 'application/json', 'X-UmaTrace-CSRF': token or ''}
    with OPENER.open(Request(origin + path, headers=headers, data=None if body is None else json.dumps(body).encode()), timeout=.5) as response:
        return json.load(response)


def wait(check, seconds=20):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except (OSError, ValueError, URLError):
            pass
        time.sleep(.03)
    raise AssertionError('Frozen handoff condition timed out.')


def build_fixture(cache):
    output = cache / 'dist/FrozenRuntime.exe'
    source = ROOT / 'tests/fixtures/frozen_handoff_parent.py'
    with (cache / 'build.log').open('wb') as log:
        subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--console',
            '--name', 'FrozenRuntime', '--paths', str(ROOT / 'desktop'), '--exclude-module', 'cryptography',
            '--distpath', str(cache / 'dist'), '--workpath', str(cache / 'work'), '--specpath', str(cache),
            str(source)], stdout=log, stderr=log, creationflags=FLAGS, check=True, timeout=180,
            env=dict(os.environ, PYINSTALLER_CONFIG_DIR=str(cache / 'config')))
    compiler = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework/v4.0.30319/csc.exe'
    helper = cache / 'Umalytics.exe'
    subprocess.run([str(compiler), '/nologo', '/target:exe', f'/out:{helper}', '/reference:System.Web.Extensions.dll',
        str(ROOT / 'tests/fixtures/FrozenHandoffHelper.cs')], creationflags=FLAGS, check=True, capture_output=True)
    return output, helper


def wait_for_helper_exit(pid):
    # result.json is written just before the helper returns. Wait for its
    # process to exit before TemporaryDirectory removes the still-mapped EXE.
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    handle = kernel.OpenProcess(0x00100000, False, pid)
    if not handle:
        error = ctypes.get_last_error()
        if error == 87:  # Already exited.
            return
        raise ctypes.WinError(error)
    try:
        assert kernel.WaitForSingleObject(handle, 20000) == 0, 'Frozen fixture helper did not exit.'
    finally:
        kernel.CloseHandle(handle)


def case(folder, runtime, helper, legacy):
    install = folder / ('legacy' if legacy else 'fixed')
    data = install / 'Umalytics-data'
    data.mkdir(parents=True)
    target = data / 'runtime/UmalyticsCollector.exe'
    target.parent.mkdir()
    shutil.copyfile(runtime, target)
    desktop = install / 'Umalytics.exe'
    shutil.copyfile(helper, desktop)
    resources = install / 'resources/desktop'
    resources.mkdir(parents=True)
    (resources / 'build-info.json').write_text('{"version":"0.2.1","buildNumber":1}')
    (resources / 'update-public-key.txt').write_text('00' * 32)
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    assert port not in (4317, 4327)
    control = {'port': port, 'token': secrets.token_hex(32), 'legacy': legacy, 'data': str(data),
        'desktopExe': str(desktop), 'resources': str(resources.parent)}
    control_path = data / 'control.json'
    control_path.write_text(json.dumps(control))
    with (install / 'parent.log').open('wb') as log:
        parent = subprocess.Popen([str(target), '--control', str(control_path)], stdout=log, stderr=log,
            creationflags=FLAGS, env=dict(os.environ, PYINSTALLER_RESET_ENVIRONMENT='1'))
        try:
            health = wait(lambda: request(port))
            assert health['phase'] == 'parent'
            parent_extraction = Path(health['extraction'])
            request(port, control['token'], '/fixture/handoff', {})
            assert parent.wait(timeout=20) == 0
            wait(lambda: not parent_extraction.exists())
            if not legacy:
                child = wait(lambda: request(port))
                assert child['phase'] == 'child' and child['runtimeExecutable'] == str(target)
                assert Path(child['extraction']) != parent_extraction
                request(port, control['token'], '/api/app/exit', {})
            result = wait(lambda: json.loads((data / 'result.json').read_bytes()))
            wait_for_helper_exit(result['helperPid'])
            assert result['parentExtractionRemoved'] and result['inheritedReset'] == '1', result
            if legacy:
                assert result['exitCode'] != 0 and 'python312.dll' in result['error'].lower(), result
            else:
                assert result['exitCode'] == 0, result
        finally:
            if parent.poll() is None:
                parent.kill()
                parent.wait()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    args = parser.parse_args()
    cache = ROOT / '.cache/frozen-handoff-fixture'
    cache.mkdir(exist_ok=True)
    runtime, helper = build_fixture(cache)
    with tempfile.TemporaryDirectory(prefix='frozen-handoff-', dir=ROOT / '.cache') as temporary:
        case(Path(temporary), runtime, helper, True)
        case(Path(temporary), runtime, helper, False)
    print(json.dumps({'realFrozenHandoff': 'passed', 'legacyDeletedExtractionFailure': 'reproduced',
        'nativeHelperAfterParentExit': 'passed', 'samePathFreshRuntime': 'passed', 'installedAppTouched': False}))
