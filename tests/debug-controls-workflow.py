"""Real local HTTP controls, raw recording, expiry, and deletion in disposable data."""
from http.server import BaseHTTPRequestHandler
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
import service

with tempfile.TemporaryDirectory(prefix='debug-controls-', dir=ROOT / '.cache') as temporary:
    data = Path(temporary)
    instance = service.Service(data, no_proxy=True)
    server = service.LocalServer(('127.0.0.1', 0), BaseHTTPRequestHandler)
    instance.server = server
    server.RequestHandlerClass = service.make_handler(instance)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    opener = build_opener(ProxyHandler({}))

    def call(path, body=None, authorized=True):
        headers = {'Origin': origin}
        if body is not None:
            headers.update({'Content-Type': 'application/json', 'X-UmaTrace-CSRF': instance.csrf if authorized else ''})
        request = Request(origin + path, headers=headers, data=json.dumps(body).encode() if body is not None else None)
        try:
            response = opener.open(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    try:
        assert call('/api/debug-capture')[1]['enabled'] is False
        assert call('/api/debug-capture/prepare', {}, False)[0] == 403
        assert call('/api/debug-capture', {'enabled': True})[0] == 400
        challenge = call('/api/debug-capture/prepare', {})[1]
        body = {'enabled': True, 'challenge': challenge['challenge'], 'phrase': 'CAPTURE SECRETS',
                'acknowledgements': ['secrets', 'all-api', 'private-files']}
        assert call('/api/debug-capture', body)[0] == 400, 'Five-second safety delay not enforced'
        # Use the mandatory wait to create unrelated preservation canaries.
        (data / 'races/keep.json').write_text('{"fixture":true}')
        (data / 'capture/keep-key.dpapi').write_bytes(b'PRIVATE_PRESERVATION_CANARY')
        time.sleep(challenge['waitSeconds'] + .1)
        assert call('/api/debug-capture', {**body, 'phrase': 'wrong'})[0] == 400
        assert call('/api/debug-capture', {**body, 'acknowledgements': []})[0] == 400
        assert call('/api/debug-capture', body)[1]['enabled'] is True
        assert call('/api/debug-capture', body)[0] == 400, 'Challenge was reusable'
        archive = instance.debug_capture.archive
        request = SimpleNamespace(raw_content=b'SYNTHETIC_SECRET', method='POST', scheme='https',
            host='example.invalid', port=443, path='/fixture', http_version='HTTP/1.1',
            headers=SimpleNamespace(fields=[(b'authorization', b'SYNTHETIC_SECRET')]))
        flow = SimpleNamespace(id='fixture', request=request, response=None, error=None)
        archive.record(flow, 'request')
        assert len(list(archive.folder.glob('*.json.gz'))) == 1
        assert call('/api/health')[1]['debugCapture']['enabled'] is True
        assert call('/api/logs/clear', {'confirm': 'DELETE LOGS'}, False)[0] == 403
        assert call('/api/logs/clear', {})[0] == 400
        (data / 'logs').mkdir(exist_ok=True)
        (data / 'logs/fixture.jsonl').write_text('{"fixture":true}\n')
        assert call('/api/logs/clear', {'confirm': 'DELETE LOGS'})[1]['enabled'] is False
        archive.record(flow, 'request')
        assert not list(archive.folder.iterdir()), 'Raw capture resumed after deletion'
        assert not (data / 'logs/fixture.jsonl').exists()
        assert (data / 'races/keep.json').read_text() == '{"fixture":true}'
        assert (data / 'capture/keep-key.dpapi').read_bytes() == b'PRIVATE_PRESERVATION_CANARY'
        archive.flag.write_text('{"enabled":true,"expiresAt":1}')
        archive.record(flow, 'request')
        assert not archive.enabled() and not list(archive.folder.iterdir())
        # Persistent capture is a separate, explicitly acknowledged choice.
        challenge = call('/api/debug-capture/prepare', {})[1]
        time.sleep(challenge['waitSeconds'] + .1)
        permanent = {**body, 'challenge': challenge['challenge'], 'duration': 'permanent'}
        assert call('/api/debug-capture', {**permanent, 'duration': 'invalid'})[0] == 400
        result = call('/api/debug-capture', permanent)[1]
        assert result['mode'] == 'permanent' and result['enabled'] and result['expiresAt'] is None
        from debug_capture import DebugCapture
        restarted = DebugCapture(data)
        assert restarted.status()['enabled'] and restarted.status()['mode'] == 'permanent'
        assert restarted.clear()['enabled'] is False
        assert not DebugCapture(data).status()['enabled'], 'Deleted logs re-enabled persistent capture'
        archive.flag.write_text('{"enabled":true}')
        assert DebugCapture(data).status()['enabled'] is False, 'Service restart resumed raw capture'
    finally:
        instance.shutdown()
        thread.join(5)
        server.server_close()
        instance.status_socket.close()

print('Debug controls workflow passed: CSRF, warnings, typed confirmation, delay, raw recording, timed expiry, explicit permanent capture across restart, disabling/deletion, legacy default-off, and race/key preservation.')
