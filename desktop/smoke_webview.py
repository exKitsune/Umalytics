"""Inspect only a smoke test's private WebView2 through its ephemeral debugger.

Never enabled by the shipped application. The caller supplies a disposable
profile and an expected loopback page; no global browser discovery is used.
"""
import json
import socket
import time
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener

from wsproto import ConnectionType, WSConnection
from wsproto.events import AcceptConnection, CloseConnection, Ping, Request, TextMessage


class DevTools:
    def __init__(self, url):
        address = urlsplit(url)
        if address.scheme != 'ws' or address.hostname != '127.0.0.1':
            raise ValueError('Only the owned loopback debugger is allowed.')
        self.socket = socket.create_connection((address.hostname, address.port), timeout=3)
        self.socket.settimeout(3)
        self.wire = WSConnection(ConnectionType.CLIENT)
        self.socket.sendall(self.wire.send(Request(host=address.netloc, target=address.path)))
        self.sequence = 0
        self.errors = []
        self.text = ''
        for event in self.events():
            if isinstance(event, AcceptConnection):
                break
            raise ValueError('WebView debugger refused its local connection.')

    def events(self):
        block = self.socket.recv(65536)
        if not block:
            raise ConnectionError('WebView debugger closed.')
        self.wire.receive_data(block)
        yield from self.wire.events()

    def call(self, method, params=None):
        self.sequence += 1
        ident = self.sequence
        self.socket.sendall(self.wire.send(TextMessage(data=json.dumps({'id': ident, 'method': method, 'params': params or {}}))))
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            for event in self.events():
                if isinstance(event, Ping):
                    self.socket.sendall(self.wire.send(event.response()))
                elif isinstance(event, CloseConnection):
                    raise ConnectionError('WebView debugger closed.')
                elif isinstance(event, TextMessage):
                    self.text += event.data
                    if not event.message_finished:
                        continue
                    packet = json.loads(self.text)
                    self.text = ''
                    if packet.get('method') == 'Runtime.exceptionThrown':
                        detail = packet['params']['exceptionDetails']
                        self.errors.append({'text': detail.get('exception', {}).get('description', detail.get('text', 'JavaScript exception'))[:1000], 'line': detail.get('lineNumber')})
                    if packet.get('id') == ident:
                        if 'error' in packet:
                            raise ValueError(packet['error'].get('message', 'DevTools command failed'))
                        return packet.get('result', {})
        raise TimeoutError('WebView debugger command timed out.')

    def close(self):
        self.socket.close()


def owned_page(profile, expected_url):
    """The debugger port comes only from the profile created by this test."""
    marker = next(iter(profile.rglob('DevToolsActivePort')), None)
    if marker is None:
        return None
    try:
        port = int(marker.read_text().splitlines()[0])
        if not 0 < port < 65536:
            return None
        with build_opener(ProxyHandler({})).open(f'http://127.0.0.1:{port}/json/list', timeout=3) as response:
            pages = json.load(response)
    except (OSError, ValueError, IndexError):
        # The marker and listener become ready independently during startup.
        return None
    page = next((p for p in pages if p.get('type') == 'page' and p.get('url', '').rstrip('/') == expected_url.rstrip('/')), None)
    return DevTools(page['webSocketDebuggerUrl']) if page else None


def frontend_state(debugger):
    result = debugger.call('Runtime.evaluate', {'expression': "JSON.stringify({readyState:document.readyState,appShell:!!document.querySelector('.app-shell'),settings:!!document.querySelector('button[aria-label=\"Settings\"]'),visibility:document.visibilityState})", 'returnByValue': True})
    if result.get('exceptionDetails'):
        raise ValueError('Frontend readiness expression failed.')
    return json.loads(result['result']['value'])
