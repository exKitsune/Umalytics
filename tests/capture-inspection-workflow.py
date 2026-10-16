"""Real HTTPS inspection using only loopback and ephemeral certificate trust."""
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import ipaddress
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
from mitmproxy.certs import CertStore
from storage import prepare_storage

HOST = 'api.games.\x75mamusume.com'


def workflow(folder):
    data = folder / 'Umalytics-data'
    data.mkdir()
    CertStore.create_store(data / 'proxy', 'mitmproxy', 2048, organization='Preserved Fixture CA', cn='Preserved Fixture CA')
    original = {path.name: path.read_bytes() for path in (data / 'proxy').iterdir()}
    prepare_storage(data)
    ca = x509.load_pem_x509_certificate((data / 'capture/umalytics-ca-cert.pem').read_bytes())
    upstream_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, HOST)])
    now = datetime.now(timezone.utc)
    upstream_cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
        .public_key(upstream_key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1)).not_valid_after(now + timedelta(hours=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(HOST), x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
        .sign(upstream_key, hashes.SHA256()))
    upstream_pem, key_pem = folder / 'upstream.pem', folder / 'upstream-key.pem'
    upstream_pem.write_bytes(upstream_cert.public_bytes(serialization.Encoding.PEM))
    key_pem.write_bytes(upstream_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    payload = json.dumps({'data': {'race_scenario': 'SYNTHETIC_LOOPBACK_SCENARIO', 'race_course_id': 10606,
        'auth': {'token': 'PRIVATE_LOOPBACK_FIXTURE'}, 'trainer_info': {'name': 'PRIVATE_LOOPBACK_FIXTURE'}}}).encode()
    requests = []
    class Upstream(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            requests.append((self.path, self.rfile.read(int(self.headers.get('Content-Length', '0')))))
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    # Keep the production observer's logical HTTPS port 443, but route that
    # exact loopback destination to an ephemeral fixture port. No privileged or
    # shared port binding, DNS lookup, or external socket is needed.
    server = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
    routing = folder / 'loopback-route.py'
    routing.write_text(f'''def server_connect(data):
    original = data.server.address
    data.server.address = ('127.0.0.1', {server.server_port})
    assert original == ('127.0.0.1', 443)

def requestheaders(flow):
    assert flow.request.host in ('127.0.0.1', '{HOST}')
    assert flow.request.port in (443, {server.server_port})
    # Changing the physical endpoint can rewrite authority. Restore the
    # fixture's logical HTTPS destination before the real observer inspects it.
    flow.request.port = 443
    flow.request.host_header = '{HOST}'

request = requestheaders
responseheaders = requestheaders
response = requestheaders
''', encoding='utf-8')
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(upstream_pem, key_pem)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .05}, daemon=True).start()
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    status, stop = data / 'cache/inspection-status.json', data / 'cache/inspection.stop'
    args = ['--listen-host', '127.0.0.1', '--listen-port', str(port), '--mode', 'regular',
        '--scripts', str(routing), '--scripts', str(ROOT / 'scripts/proxy/observer.py'), '--set', f'confdir={data / "capture"}',
        '--set', 'flow_detail=0', '--set', 'termlog_verbosity=error', '--set', 'onboarding=false',
        '--set', 'ssl_insecure=false', '--set', f'ssl_verify_upstream_trusted_ca={upstream_pem}',
        '--set', 'uma_stage=inspect', '--set', f'uma_output={data / "races"}',
        '--set', f'uma_status={status}', '--set', f'uma_stop_file={stop}']
    code = 'import sys,json;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from capture_store import run_collector;run_collector(Path(sys.argv[2]),json.loads(sys.argv[3]))'
    log = (folder / 'collector.log').open('wb')
    process = subprocess.Popen([sys.executable, '-c', code, str(ROOT / 'desktop'), str(data), json.dumps(args)],
        stdout=log, stderr=log, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        for _ in range(100):
            if process.poll() is not None:
                raise AssertionError('Inspection collector exited before readiness; see disposable fixture log.')
            try:
                if json.loads(status.read_bytes()).get('state') == 'running':
                    break
            except (OSError, ValueError):
                pass
            time.sleep(.1)
        else:
            raise AssertionError('Inspection collector did not start.')
        connection = socket.create_connection(('127.0.0.1', port), timeout=5)
        connection.sendall(b'CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n')
        header = b''
        while not header.endswith(b'\r\n\r\n'):
            block = connection.recv(1)
            assert block and len(header) < 8192
            header += block
        assert b' 200 ' in header
        client_context = ssl.create_default_context(cafile=str(data / 'capture/umalytics-ca-cert.pem'))
        with client_context.wrap_socket(connection, server_hostname=HOST) as encrypted:
            leaf = x509.load_der_x509_certificate(encrypted.getpeercert(binary_form=True))
            leaf.verify_directly_issued_by(ca)
            assert leaf.issuer == ca.subject
            assert leaf.fingerprint(hashes.SHA256()) != upstream_cert.fingerprint(hashes.SHA256()), 'TLS was passed through instead of inspected.'
            request_body = b'{}'
            encrypted.sendall(f'POST /\x75mamusume/room_match/result HTTP/1.1\r\nHost: {HOST}\r\nContent-Type: application/json\r\nContent-Length: {len(request_body)}\r\nConnection: close\r\n\r\n'.encode() + request_body)
            response = b''
            while True:
                block = encrypted.recv(65536)
                if not block:
                    break
                response += block
            assert b' 200 ' in response.split(b'\r\n', 1)[0] and response.endswith(payload)
        for _ in range(100):
            stats = json.loads(status.read_bytes())
            outputs = list((data / 'races').glob('*.json'))
            if stats['races_written'] == 1 and len(outputs) == 1:
                break
            time.sleep(.05)
        else:
            raise AssertionError('Observer did not extract the synthetic HTTPS response: ' + json.dumps(stats))
        assert requests == [('/\x75mamusume/room_match/result', b'{}')]
        for key in ('api_tls_hellos', 'api_tls_established', 'api_http_requests', 'api_http_responses', 'eligible_requests', 'eligible_responses', 'races_written'):
            assert stats[key] == 1, (key, stats[key])
        assert stats['api_tls_failed'] == 0 and stats['decode_failed'] == 0 and stats['write_failed'] == 0
        saved_raw = outputs[0].read_bytes()
        saved = json.loads(saved_raw)
        assert saved['race_scenario'] == 'SYNTHETIC_LOOPBACK_SCENARIO' and saved['race_category'] == 'practice'
        assert b'PRIVATE_LOOPBACK_FIXTURE' not in saved_raw and b'auth' not in saved_raw and b'trainer' not in saved_raw
        stop.touch()
        assert process.wait(timeout=10) == 0
        assert {path.name.replace('umalytics-', 'mitmproxy-', 1): path.read_bytes() for path in (data / 'capture').iterdir()} == original
        assert not list((data / 'capture').glob('mitmproxy-*'))
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        log.close()
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='capture-inspection-', dir=ROOT / '.cache') as temporary:
        workflow(Path(temporary))
    print('HTTPS inspection passed: migrated CA signed and client-verified leaf; upstream TLS verified; observer captured and sanitized one synthetic loopback response; CA/key bytes unchanged.')
