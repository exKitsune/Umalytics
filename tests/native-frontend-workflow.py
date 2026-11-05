"""Exercise native readiness diagnostics over real isolated HTTP/WebSocket IO."""
import json
from pathlib import Path
import socketserver
import sys
import tempfile
import threading

from wsproto import ConnectionType, WSConnection
from wsproto.events import AcceptConnection, Request, TextMessage

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
from smoke_webview import DevTools, frontend_state, owned_page

expected = 'http://127.0.0.1:45678'
state = {'error': False, 'blank': False}

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        data = b''
        while b'\r\n\r\n' not in data:
            block = self.request.recv(8192)
            if not block:
                return
            data += block
        if data.startswith(b'GET /json/list '):
            body = json.dumps([{'type': 'page', 'url': 'http://unrelated.invalid'},
                               {'type': 'page', 'url': expected, 'webSocketDebuggerUrl': f'ws://127.0.0.1:{self.server.server_address[1]}/devtools/page/owned'}]).encode()
            self.request.sendall(b'HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: ' + str(len(body)).encode() + b'\r\n\r\n' + body)
            return
        wire = WSConnection(ConnectionType.SERVER)
        wire.receive_data(data)
        assert any(isinstance(event, Request) for event in wire.events())
        self.request.sendall(wire.send(AcceptConnection()))
        while True:
            raw = self.request.recv(65536)
            if not raw:
                return
            wire.receive_data(raw)
            for event in wire.events():
                if not isinstance(event, TextMessage):
                    continue
                command = json.loads(event.data)
                if command['method'] == 'Runtime.enable':
                    if state['error']:
                        packet = {'method': 'Runtime.exceptionThrown', 'params': {'exceptionDetails': {'text': 'Synthetic JS load failure', 'lineNumber': 3}}}
                        self.request.sendall(wire.send(TextMessage(data=json.dumps(packet))))
                    result = {}
                else:
                    result = {'result': {'value': json.dumps({'readyState': 'complete', 'appShell': not state['blank'], 'settings': not state['blank'], 'visibility': 'visible'})}}
                text = json.dumps({'id': command['id'], 'result': result})
                # A CDP message can span multiple WebSocket frames.
                middle = len(text) // 2
                self.request.sendall(wire.send(TextMessage(data=text[:middle], message_finished=False)))
                self.request.sendall(wire.send(TextMessage(data=text[middle:])))

with tempfile.TemporaryDirectory(prefix='native-frontend-') as name:
    profile = Path(name)
    with socketserver.ThreadingTCPServer(('127.0.0.1', 0), Handler) as server:
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            assert owned_page(profile, expected) is None
            marker = profile / 'EBWebView/DevToolsActivePort'
            marker.parent.mkdir()
            marker.write_text('')
            assert owned_page(profile, expected) is None, 'A partially written port marker is not a failure'
            marker.write_text(str(server.server_address[1]) + '\n/devtools/browser/owned\n')
            assert owned_page(profile, 'http://127.0.0.1:9999') is None, 'Never attach to another page'
            for blank, error in ((False, False), (True, False), (False, True)):
                state.update(blank=blank, error=error)
                debugger = owned_page(profile, expected)
                try:
                    debugger.call('Runtime.enable')
                    result = frontend_state(debugger)
                    assert result['appShell'] == (not blank) and result['settings'] == (not blank)
                    assert bool(debugger.errors) == error
                finally:
                    debugger.close()
            try:
                DevTools('ws://unrelated.invalid:1234/debug')
                raise AssertionError('External debugger allowed')
            except ValueError:
                pass
        finally:
            server.shutdown()
            thread.join()
print('Native frontend diagnostics passed: real HTTP/WebSocket IO, fragmented responses, owned-profile isolation, blank UI and JavaScript failure detection.')
