"""Windows integration test: only a local stand-in is launched, never the game."""
import ctypes
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import threading

ROOT = Path(__file__).resolve().parents[2]
launcher = ROOT / '.cache/launcher/UmaTrace.Launcher.exe'
temporary = ROOT / '.cache/launcher-tests'
temporary.mkdir(parents=True, exist_ok=True)
probe = temporary / '\x55mamusume\x50rettyDerby.exe'
output = temporary / 'child-result.json'
status = Path(os.environ['LOCALAPPDATA']) / 'UmaTrace/launcher/latest-launch.json'
compiler = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework/v4.0.30319/csc.exe'
assert not ctypes.windll.shell32.IsUserAnAdmin(), 'Use an unelevated Windows token.'
subprocess.run([str(compiler), '/nologo', '/target:exe', '/platform:anycpu',
                f'/out:{probe}', '/reference:System.Runtime.Serialization.dll',
                str(ROOT / 'tests/launcher/LauncherProbe.cs')], check=True,
               creationflags=subprocess.CREATE_NO_WINDOW)

data = launcher.read_bytes()
pe_offset = struct.unpack_from('<I', data, 0x3c)[0]
subsystem = struct.unpack_from('<H', data, pe_offset + 24 + 68)[0]
assert subsystem == 2, f'Expected Windows GUI subsystem, got {subsystem}'

# Bind fails if a real collector already owns this port. Never displace it.
listener = socket.socket()
listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
listener.bind(('127.0.0.1', 4327))
listener.listen()
done = threading.Event()
def accept_checks():
    listener.settimeout(0.2)
    while not done.is_set():
        try:
            connection, _ = listener.accept()
            connection.close()
        except socket.timeout:
            pass
        except OSError:
            break
thread = threading.Thread(target=accept_checks, daemon=True)
thread.start()
try:
    # No CREATE_NO_WINDOW flag for the launcher: its own PE subsystem must be GUI.
    check = subprocess.run([str(launcher), '--check', '--', str(probe)], timeout=10)
    assert check.returncode == 0, status.read_text()
    checked = json.loads(status.read_text())
    assert checked['state'] == 'ready' and not checked['console_attached']

    forwarded = [str(output), '', 'two words', 'quote"inside', 'C:\\ends with slash\\',
                 '\\"', '日本語', '%command%', '$literal`value', '--check']
    environment = dict(os.environ)
    environment.update(HTTP_PROXY='http://parent.invalid:1', HTTPS_PROXY='http://parent.invalid:2',
                       ALL_PROXY='http://parent.invalid:3', NO_PROXY='parent.invalid')
    original_environment = dict(os.environ)
    result = subprocess.run([str(launcher), '--quiet', '--', str(probe), *forwarded],
                            env=environment, timeout=10)
    assert result.returncode == 37, status.read_text()
    child = json.loads(output.read_text(encoding='utf-8'))
    assert child['args'] == forwarded, 'Steam argument forwarding changed the child argv.'
    for name in ('http_proxy', 'https_proxy', 'all_proxy'):
        assert child[name] == 'http://127.0.0.1:4327', name
    assert child['no_proxy'] == 'localhost,127.0.0.1,::1'
    assert Path(child['working_directory']) == probe.parent
    assert not child['console_attached']
    assert dict(os.environ) == original_environment
    launched = json.loads(status.read_text())
    assert launched['state'] == 'exited' and launched['exit_code'] == 37
    assert not launched['elevated'] and not launched['console_attached']
    assert 'args' not in launched, 'Game arguments must not be logged.'
finally:
    done.set()
    listener.close()
    thread.join(timeout=2)

# A stopped collector must give an actionable error without launching a child.
output.unlink()
missing_proxy = subprocess.run([str(launcher), '--quiet', '--', str(probe), str(output)], timeout=10)
assert missing_proxy.returncode == 1
assert json.loads(status.read_text())['error'] == 'proxy_unavailable'
assert not output.exists()
summary = dict(windows_gui_subsystem=True, launcher_console=False, child_console=False,
               argument_round_trip=True, child_only_proxy=True, exit_code_forwarding=True,
               missing_proxy_blocks_launch=True, real_game_launched=False)
(temporary / 'verification.json').write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2))
