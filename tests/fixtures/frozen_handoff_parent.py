"""Test-only frozen HTTP process calling the production native helper handoff."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import threading

from updater import UpdateController

parser = argparse.ArgumentParser()
parser.add_argument('--control', type=Path, required=True)
parser.add_argument('--child', action='store_true')
args = parser.parse_args()
control = json.loads(args.control.read_text())
assert control['port'] not in (4317, 4327)
controller = None
if not args.child:
    controller = UpdateController(Path(control['data']), Path(control['desktopExe']), Path(control['resources']))
    control['runtime'] = str(Path(sys.executable).resolve())
    control['extraction'] = str(Path(sys._MEIPASS).resolve())
    args.control.write_text(json.dumps(control))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, value):
        raw = json.dumps(value).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self.send_json({'phase': 'child' if args.child else 'parent', 'csrfToken': control['token'],
            'runtimeExecutable': str(Path(sys.executable).resolve()), 'extraction': str(Path(sys._MEIPASS).resolve())})

    def do_POST(self):
        assert self.headers.get('X-UmaTrace-CSRF') == control['token']
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path == '/fixture/handoff' and controller:
            folder = Path(control['data']) / 'cache/update'
            folder.mkdir(parents=True)
            stage = folder / 'Umalytics.exe'
            stage.write_bytes(Path(control['desktopExe']).read_bytes())
            controller.raw, controller.signature = b'{}', b''
            controller.phase = 'waiting-for-game'
            manifest = {'version': '0.2.2', 'sha256': hashlib.sha256(stage.read_bytes()).hexdigest()}
            self.send_json({'ok': True})
            threading.Thread(target=controller._handoff, args=(folder, stage, manifest), daemon=True).start()
        elif self.path == '/api/update/restart' and controller:
            self.send_json(controller.restart(body['token']))
        elif self.path == '/api/app/exit':
            self.send_json({'ok': True})
            if controller:
                controller.close()
            threading.Thread(target=server.shutdown, daemon=True).start()
        else:
            raise ValueError('Unknown fixture endpoint.')


server = ThreadingHTTPServer(('127.0.0.1', control['port']), Handler)
try:
    server.serve_forever(poll_interval=.03)
finally:
    server.server_close()
