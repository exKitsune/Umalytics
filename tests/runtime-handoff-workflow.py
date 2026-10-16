"""Native startup helper against actual service runtimes in temporary installations.

Requires an older packaged service and the small Cargo harness. TLS traffic is
loopback-only and synthetic; no game, certificate trust or user installation is
touched. All generated keys and data stay in the owned temporary directory.
"""
import argparse
from contextlib import contextmanager
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

parser = argparse.ArgumentParser()
parser.add_argument('--legacy-service', type=Path, required=True)
parser.add_argument('--harness', type=Path, required=True)
parser.add_argument('--alternate-python', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
opener = build_opener(ProxyHandler({}))
flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
bootstrap = "import sys; from pathlib import Path; sys.path.insert(0,sys.argv.pop(1)); import service; service.RESOURCE_ROOT=Path(sys.argv.pop(1)); raise SystemExit(service.main())"


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def get(base, path):
    with opener.open(base + path, timeout=3) as response:
        return response.read()


def health(base):
    return json.loads(get(base, '/api/health'))


def owned(base, data):
    value = health(base)
    assert value['app'] == 'UmaTrace' and Path(value['dataDirectory']).resolve() == data.resolve()
    assert not value['certificate']['trusted']
    return value


def post(base, path, value, status):
    request = Request(base + path, data=json.dumps(value).encode(), headers={
        'Content-Type': 'application/json', 'Origin': base, 'X-UmaTrace-CSRF': status['csrfToken']})
    with opener.open(request, timeout=5) as response:
        return json.load(response)


def wait_owned(base, data, child=None):
    for _ in range(120):
        try:
            return owned(base, data)
        except (OSError, HTTPError):
            if child is not None and child.poll() is not None:
                raise AssertionError('Owned service exited before readiness.')
            time.sleep(.1)
    raise AssertionError('Owned service did not become ready.')


def stop(base, data):
    try:
        status = owned(base, data)
    except (OSError, HTTPError):
        return
    post(base, '/api/app/exit', {}, status)
    for _ in range(160):
        try:
            get(base, '/api/health')
        except (OSError, HTTPError):
            return
        time.sleep(.1)
    raise AssertionError('Owned service did not stop.')


def source_command(runtime, resources, data, listen, proxy=None):
    command = [str(runtime), '-c', bootstrap, str(root / 'desktop'), str(resources),
               '--serve', '--data-dir', str(data), '--port', str(listen)]
    command += ['--no-proxy'] if proxy is None else ['--proxy-port', str(proxy)]
    return command


def native(runtime, resources, data, listen):
    command = source_command(runtime, resources, data, listen)
    # A detached Windows runtime can inherit a diagnostic pipe handle, delaying
    # communicate() EOF after the harness exits. Files keep readiness bounded.
    report = data.parent / f'native-result-{time.time_ns()}.json'
    errors = report.with_suffix('.stderr')
    with report.open('wb') as output, errors.open('wb') as error:
        subprocess.run([str(args.harness.resolve()), str(listen), str(runtime), str(data), *command[1:]],
                       stdout=output, stderr=error, timeout=60, creationflags=flags, check=True)
    return json.loads(report.read_text())


@contextmanager
def running(command, base, data):
    child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, creationflags=flags)
    try:
        wait_owned(base, data, child)
        yield child
    finally:
        stop(base, data)
        if child.poll() is None:
            child.wait(timeout=20)


@contextmanager
def held_game_connection(data, proxy_port):
    from datetime import datetime, timedelta, timezone
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    hostname = 'api.games.\x75mamusume.com'
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
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *arguments):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert_path, key_path)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    encrypted = None
    try:
        client = socket.create_connection(('127.0.0.1', proxy_port), timeout=5)
        target = f'127.0.0.1:{server.server_port}'
        client.sendall(f'CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n'.encode())
        response = b''
        while not response.endswith(b'\r\n\r\n'):
            response += client.recv(1)
            assert len(response) < 8192
        assert b' 200 ' in response
        encrypted = ssl.create_default_context(cafile=str(cert_path)).wrap_socket(client, server_hostname=hostname)
        assert encrypted.getpeercert(binary_form=True) == certificate.public_bytes(serialization.Encoding.DER)
        yield
    finally:
        if encrypted is not None:
            encrypted.close()
        server.shutdown()
        server.server_close()


with tempfile.TemporaryDirectory(prefix='runtime-handoff-', dir=root / '.cache') as folder:
    workspace = Path(folder)
    resources = workspace / 'resources'
    shutil.copytree(root / 'public/data', resources / 'dist/data')
    (resources / 'dist/index.html').write_text('<html><title>Current runtime handoff fixture</title></html>')
    runtime = Path(sys.executable).resolve()
    alternate = args.alternate_python.resolve()
    assert runtime != alternate
    listen = port()
    base = f'http://127.0.0.1:{listen}'
    data = workspace / 'installation'

    # A real previous packaged service has legacy health without runtime identity.
    # Keep it immutable; only its disposable installation is upgraded.
    legacy_hash = hashlib.sha256(args.legacy_service.read_bytes()).digest()
    with running([str(args.legacy_service.resolve()), '--serve', '--no-proxy', '--port', str(listen), '--data-dir', str(data)], base, data) as legacy:
        old = owned(base, data)
        assert 'runtimeExecutable' not in old
        assert b'Current runtime handoff fixture' not in get(base, '/')
        result = native(runtime, resources, data, listen)
        assert result == {'ok': True, 'launched': True, 'error': None}
        legacy.wait(timeout=20)
        current = owned(base, data)
        assert Path(current['runtimeExecutable']).resolve() == runtime
        assert b'Current runtime handoff fixture' in get(base, '/')
        metadata = json.loads(get(base, '/data/metadata.json'))
        assert len(metadata['skills']) > 700 and all('activateLot' in s and 'iconId' in s for s in metadata['skills'].values())
        token = current['csrfToken']
        assert native(runtime, resources, data, listen) == {'ok': True, 'launched': False, 'error': None}
        assert owned(base, data)['csrfToken'] == token
        foreign = workspace / 'another-installation'
        foreign.mkdir()
        refused = native(runtime, resources, foreign, listen)
        assert not refused['ok'] and not refused['launched'] and 'Another Umalytics installation' in refused['error']
        assert owned(base, data)['csrfToken'] == token
    assert hashlib.sha256(args.legacy_service.read_bytes()).digest() == legacy_hash
    assert not list((data / 'proxy').iterdir())

    # Different modern executable paths also require handoff, rather than just
    # recognizing an arbitrary responding /api/health endpoint.
    with running(source_command(alternate, resources, data, listen), base, data) as previous:
        result = native(runtime, resources, data, listen)
        assert result['ok'] and result['launched']
        previous.wait(timeout=20)
        assert Path(owned(base, data)['runtimeExecutable']).resolve() == runtime

    # A real unrelated HTTP listener must survive without any native launch.
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *arguments):
            pass
    unrelated = ThreadingHTTPServer(('127.0.0.1', listen), Quiet)
    threading.Thread(target=unrelated.serve_forever, daemon=True).start()
    try:
        refused = native(runtime, resources, data, listen)
        assert not refused['ok'] and not refused['launched'] and 'another program' in refused['error']
        assert get(base, '/')
    finally:
        unrelated.shutdown()
        unrelated.server_close()

    # Real collector, synthetic TLS held open with game SNI. No upstream game
    # request occurs and its fixture certificate is trusted only by this client.
    active_data = workspace / 'active-installation'
    proxy_port = port()
    with running(source_command(runtime, root, active_data, listen, proxy_port), base, active_data):
        for _ in range(120):
            status = owned(base, active_data)
            if status['proxy']['listening']:
                break
            time.sleep(.1)
        else:
            raise AssertionError('Synthetic collector did not listen.')
        token = status['csrfToken']
        with held_game_connection(active_data, proxy_port):
            for _ in range(60):
                status = owned(base, active_data)
                if status['proxy']['activeGameConnections'] == 1:
                    break
                time.sleep(.05)
            else:
                raise AssertionError('Synthetic connection did not reach the health API.')
            assert native(runtime, resources, active_data, listen) == {'ok': True, 'launched': False, 'error': None}
            refused = native(alternate, resources, active_data, listen)
            assert not refused['ok'] and not refused['launched'] and 'Capture is still running' in refused['error']
            try:
                post(base, '/api/app/exit', {'onlyIfIdle': True}, status)
            except HTTPError as error:
                assert error.code == 409
            else:
                raise AssertionError('Conditional exit disrupted a live synthetic capture.')
            assert owned(base, active_data)['csrfToken'] == token
        for _ in range(60):
            if owned(base, active_data)['proxy']['activeGameConnections'] == 0:
                break
            time.sleep(.05)
        assert owned(base, active_data)['proxy']['activeGameConnections'] == 0
    print(json.dumps({'legacyRuntimeHandoff': 'passed', 'currentRuntimeReuse': 'passed', 'modernRuntimeHandoff': 'passed',
                      'foreignInstallation': 'untouched', 'unrelatedListener': 'untouched', 'activeCapture': 'preserved',
                      'conditionalExit': '409 while active', 'servedFrontend': 'current', 'servedSkillFields': 'complete',
                      'certificateTrustChanged': False, 'actualGameLaunched': False}))
