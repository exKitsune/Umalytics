"""Cancel an owning workflow and verify its real isolated HTTP service exits."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
from processes import process_identity


def workflow(folder):
    resources, data = folder / 'resources', folder / 'Umalytics-data'
    resources.mkdir()
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    assert port not in (4317, 4327)
    code = '''import json,os,subprocess,sys,time
child=subprocess.Popen([sys.executable,sys.argv[1],sys.argv[2],str(os.getpid()),'--serve','--no-proxy','--port',sys.argv[3],'--data-dir',sys.argv[4]],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
print(json.dumps({'pid':child.pid}),flush=True)
time.sleep(60)
'''
    owner = subprocess.Popen([sys.executable, '-c', code, str(ROOT / 'tests/desktop-service-fixture.py'), str(resources), str(port), str(data)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    child_pid, identity = None, None
    try:
        child_pid = json.loads(owner.stdout.readline())['pid']
        identity = process_identity(child_pid)
        opener = build_opener(ProxyHandler({}))
        deadline = time.monotonic() + 8
        while True:
            try:
                with opener.open(f'http://127.0.0.1:{port}/api/health', timeout=.5) as response:
                    health = json.load(response)
                break
            except OSError:
                assert owner.poll() is None and time.monotonic() < deadline, 'Owned fixture did not start.'
                time.sleep(.03)
        assert Path(health['dataDirectory']).resolve() == data.resolve()
        assert health['proxy']['state'] == 'disabled' and not health['certificate']['exists']
        owner.kill()
        owner.wait(timeout=5)
        stopped = time.monotonic()
        while True:
            try:
                process_identity(child_pid)
            except OSError:
                break
            assert time.monotonic() - stopped < 3, 'Cancelled workflow left its service running.'
            time.sleep(.03)
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', port))
        return time.monotonic() - stopped
    finally:
        if owner.poll() is None:
            owner.kill()
            owner.wait(timeout=5)
        if child_pid and identity:
            try:
                if process_identity(child_pid) == identity:
                    os.kill(child_pid, signal.SIGTERM)
            except OSError:
                pass


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='fixture-lifetime-', dir=ROOT / '.cache') as temporary:
        elapsed = workflow(Path(temporary))
    print(json.dumps({'realService': 'passed', 'cancelledWorkflowCleanup': 'passed', 'secondsAfterOwnerExit': round(elapsed, 3), 'installedAppTouched': False}))
