"""Read-only mitmproxy addon. Probe tunnels TLS; inspect decodes selected responses.

No login, request replay, header/body editing, game access, or credential persistence.
Only sanitized race documents and numerical diagnostic counters are written.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import asyncio
import json
import os
import socket
import sys
import threading
import time
import uuid
import zlib

from mitmproxy import ctx, exceptions

sys.path.insert(0, str(Path(__file__).resolve().parent))
from race_extract import api_route, apply_room_bindings, collect_room_bindings, extract_races, remember_room_bindings, trace_api_payload, classify_race
from uma_envelope import extract_request_context, decode_response_body, EnvelopeDecodeError

API_HOST = 'api.games.\x75mamusume.com'
PREFIXES = ('/\x75mamusume/',)
MAX_BODY = 16 * 1024 * 1024
MAX_SETTINGS = 16 * 1024


def decode_http_body(raw, encoding):
    if not isinstance(raw, bytes) or len(raw) > MAX_BODY:
        raise ValueError('body_limit')
    if encoding in ('', 'identity'):
        return raw
    if encoding not in ('gzip', 'deflate'):
        raise ValueError('http_encoding_unsupported')
    decoder = zlib.decompressobj(31 if encoding == 'gzip' else 15)
    data = decoder.decompress(raw, MAX_BODY + 1)
    if len(data) > MAX_BODY or decoder.unconsumed_tail or not decoder.eof or decoder.unused_data:
        raise ValueError('http_encoding_invalid')
    return data


class RaceObserver:
    def __init__(self):
        self.stage = 'probe'
        self.contexts = {}
        self.room_bindings = []
        self.lock = threading.Lock()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='uma-race-export')
        self.pending = set()
        self.last_write = 0.0
        self.last_status = None
        self.status_udp_port = 0
        self.status_token = os.environ.get('UMATRACE_STATUS_TOKEN', '')
        self.status_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.api_connections = set()
        self.output_path = ''
        self.status_path = ''
        self.duration = 0
        self.stop_path = ''
        self.settings_path = ''
        self.monitor = None
        self.status = {'state': 'starting', 'client_connections': 0, 'api_tls_hellos': 0,
                       'api_tls_established': 0, 'api_tls_failed': 0, 'eligible_requests': 0,
                       'eligible_responses': 0, 'unsupported_requests': 0, 'decode_failed': 0,
                       'responses_without_race': 0, 'races_written': 0, 'backlog_dropped': 0,
                       'write_failed': 0, 'races_filtered': 0, 'collection_paused': 0}
        self.status.update(api_http_requests=0, api_http_responses=0,
                           http_connect_requests=0, api_connect_requests=0,
                           activeGameConnections=0, lastGameTrafficAt=None)

    def load(self, loader):
        loader.add_option('uma_stage', str, 'probe', 'probe (TLS passthrough) or inspect (API host only).')
        loader.add_option('uma_output', str, '', 'Absolute race-only JSON inbox.')
        loader.add_option('uma_status', str, '', 'Absolute sanitized status JSON path.')
        loader.add_option('uma_status_udp', int, 0, 'Authenticated localhost status receiver port; no status file needed.')
        loader.add_option('uma_duration', int, 0, 'Automatically stop after this many seconds; 0 disables the timer.')
        loader.add_option('uma_stop_file', str, '', 'Optional absolute path; creating this file requests graceful shutdown.')
        loader.add_option('uma_settings', str, '', 'Optional absolute collection settings JSON; reread for each response.')

    def configure(self, updated):
        if ctx.options.uma_stage not in ('probe', 'inspect'):
            raise exceptions.OptionsError('uma_stage must be probe or inspect')
        self.stage = ctx.options.uma_stage
        if self.stage == 'inspect' and not Path(ctx.options.uma_output).is_absolute():
            raise exceptions.OptionsError('uma_output must be an absolute path')
        if ctx.options.uma_status and not Path(ctx.options.uma_status).is_absolute():
            raise exceptions.OptionsError('uma_status must be an absolute path')
        if not 0 <= ctx.options.uma_duration <= 86400:
            raise exceptions.OptionsError('uma_duration must be between 0 and 86400')
        self.output_path = ctx.options.uma_output
        self.status_path = ctx.options.uma_status
        self.status_udp_port = ctx.options.uma_status_udp
        if not 0 <= self.status_udp_port <= 65535 or self.status_udp_port and not self.status_token:
            raise exceptions.OptionsError('Local status receiver requires a valid port and session token')
        self.duration = ctx.options.uma_duration
        if ctx.options.uma_stop_file and not Path(ctx.options.uma_stop_file).is_absolute():
            raise exceptions.OptionsError('uma_stop_file must be an absolute path')
        self.stop_path = ctx.options.uma_stop_file
        self.settings_path = getattr(ctx.options, 'uma_settings', '')
        if self.settings_path and not Path(self.settings_path).is_absolute():
            raise exceptions.OptionsError('uma_settings must be an absolute path')
        # Do not allow an inherited user config to turn this into a flow recorder.
        if ctx.options.ssl_insecure or ctx.options.save_stream_file or ctx.options.hardump or ctx.options.flow_detail != 0:
            raise exceptions.OptionsError('Observer requires verified upstream TLS, no flow recording, and flow_detail=0')

    def running(self):
        self.status['state'] = 'running'
        self._write_status(force=True)
        self.monitor = asyncio.create_task(self._monitor())

    async def _monitor(self):
        started = time.monotonic()
        while True:
            await asyncio.sleep(1)
            self._write_status()
            if (self.duration and time.monotonic() - started >= self.duration
                    or self.stop_path and Path(self.stop_path).exists()):
                ctx.master.shutdown()
                return

    def _count(self, key):
        with self.lock:
            self.status[key] += 1
        self._write_status()

    def _write_status(self, force=False):
        with self.lock:
            now = time.monotonic()
            data = dict(self.status, stage=self.stage)
            if data == self.last_status:
                return
            if not self.status_udp_port and not force and now - self.last_write < 0.25:
                return
            filename = self.status_path
            if not filename and not self.status_udp_port:
                return
            try:
                if self.status_udp_port:
                    message = json.dumps({'token': self.status_token, 'status': data}).encode('utf-8')
                    self.status_socket.sendto(message, ('127.0.0.1', self.status_udp_port))
                else:
                    path = Path(filename)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    temporary = path.with_suffix('.partial')
                    temporary.write_text(json.dumps(dict(data, updated_at=datetime.now(timezone.utc).isoformat())), encoding='utf-8')
                    os.replace(temporary, path)
                self.last_write = now
                self.last_status = data
            except OSError:
                # Never pass exceptions that might contain sensitive values to logs.
                self.status['write_failed'] += 1

    def client_connected(self, client):
        self._count('client_connections')

    def _game_traffic(self, client):
        with self.lock:
            self.api_connections.add(client.id)
            self.status['activeGameConnections'] = len(self.api_connections)
            self.status['lastGameTrafficAt'] = datetime.now(timezone.utc).isoformat()
        self._write_status()

    def client_disconnected(self, client):
        with self.lock:
            self.api_connections.discard(client.id)
            self.status['activeGameConnections'] = len(self.api_connections)
        self._write_status()

    def http_connect(self, flow):
        self._count('http_connect_requests')
        if flow.request.host == API_HOST and flow.request.port == 443:
            self._game_traffic(flow.client_conn)
            self._count('api_connect_requests')

    def tls_clienthello(self, data):
        target = data.client_hello.sni == API_HOST
        if target:
            self._game_traffic(data.context.client)
            self._count('api_tls_hellos')
        # No SNI or any other domain is always passed through encrypted.
        if self.stage != 'inspect' or not target:
            data.ignore_connection = True

    def tls_established_client(self, data):
        if data.conn.sni == API_HOST:
            self._count('api_tls_established')

    def tls_failed_client(self, data):
        if data.conn.sni == API_HOST:
            self._count('api_tls_failed')

    def _api_flow(self, flow):
        request = flow.request
        # In local/transparent mode request.host is the original destination IP.
        # Require both TLS SNI and HTTP authority instead; never rewrite routing.
        authority = request.host_header or ''
        return (self.stage == 'inspect' and request.scheme == 'https' and request.port == 443
                and flow.client_conn.sni == API_HOST
                and authority.lower() in (API_HOST, API_HOST + ':443'))

    def _eligible(self, flow):
        request = flow.request
        return (self._api_flow(flow) and request.method == 'POST'
                and request.path.split('?', 1)[0].startswith(PREFIXES))

    def requestheaders(self, flow):
        if not self._eligible(flow):
            flow.request.stream = True

    def responseheaders(self, flow):
        if not self._eligible(flow):
            flow.response.stream = True

    def request(self, flow):
        if self._api_flow(flow):
            self._game_traffic(flow.client_conn)
            self._count('api_http_requests')
        if not self._eligible(flow):
            return
        self._count('eligible_requests')
        if len(self.contexts) >= 128:
            self._count('backlog_dropped')
            return
        try:
            body = decode_http_body(flow.request.raw_content, flow.request.headers.get('content-encoding', '').lower())
            self.contexts[flow.id] = extract_request_context(body)
        except (ValueError, EnvelopeDecodeError):
            self._count('unsupported_requests')

    def response(self, flow):
        context = self.contexts.pop(flow.id, None)
        if self._api_flow(flow):
            self._game_traffic(flow.client_conn)
            self._count('api_http_responses')
        if not self._eligible(flow):
            return
        self._count('eligible_responses')
        route = api_route(flow.request.path)
        if not 200 <= flow.response.status_code < 300:
            self._trace(route, flow.response.status_code, None)
            self._write_status(force=True)
            return
        raw = flow.response.raw_content
        if not isinstance(raw, bytes) or len(raw) > MAX_BODY:
            self._count('decode_failed')
            self._trace(route, flow.response.status_code, None)
            return
        self.pending = {f for f in self.pending if not f.done()}
        if len(self.pending) >= 8:
            self._count('backlog_dropped')
            return
        category, category_source = classify_race(flow.request.path)
        captured_at = datetime.now(timezone.utc).isoformat()
        # The race file still receives only a category. The local trace keeps the route.
        # No flow, headers, URL query, cookie, or auth objects leave the hook.
        self.pending.add(self.pool.submit(self._export, raw, flow.response.headers.get('content-encoding', '').lower(), context, category, category_source, captured_at, route))

    def _settings(self):
        if not self.settings_path:
            return {}
        try:
            with Path(self.settings_path).open('rb') as stream:
                data = stream.read(MAX_SETTINGS + 1)
            if len(data) > MAX_SETTINGS:
                return {}
            value = json.loads(data)
            return value if isinstance(value, dict) else {}
        except (OSError, ValueError):
            # Atomic settings replacement may briefly leave no file. Default on.
            return {}

    def _trace(self, route, status, payload):
        """Local route log. Course numbers and field names only; never a body or identifier."""
        if not self.output_path or not route:
            return
        record = {'at': datetime.now(timezone.utc).isoformat(), 'route': route, 'status': status}
        if payload is not None:
            record.update(trace_api_payload(payload))
        try:
            line = json.dumps(record, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
        except (TypeError, ValueError):
            return
        if len(line) > 4000:
            return
        folder = Path(self.output_path).parent / 'cache'
        path = folder / 'api-trace.jsonl'
        with self.lock:
            try:
                folder.mkdir(parents=True, exist_ok=True)
                if path.exists() and path.stat().st_size > 512 * 1024:
                    kept = path.read_text(encoding='utf-8').splitlines()[-200:]
                    path.write_text('\n'.join(kept) + '\n', encoding='utf-8')
                with path.open('a', encoding='utf-8') as stream:
                    stream.write(line + '\n')
            except OSError:
                return

    def _export(self, raw, encoding, context, category='other', category_source='unknown', captured_at=None, route=None):
        settings = self._settings()
        if settings.get('collectionEnabled') is False:
            self._count('collection_paused')
            return
        traced = False
        try:
            body = decode_http_body(raw, encoding)
            if body.lstrip().startswith(b'{'):
                payload = json.loads(body)
            elif context is not None:
                payload = decode_response_body(body, context)
            else:
                raise ValueError('missing_request_context')
            # Rebuild a constant group route solely to reuse endpoint classification.
            groups = {'career': 'single_mode', 'team-trials': 'team_stadium',
                      'practice': 'room_match', 'champions-meeting': 'champions'}
            endpoint = '/\x75mamusume/' + groups.get(category, 'unknown') + '/'
            self._trace(route, 200, payload)
            traced = True
            races = extract_races(payload, endpoint=endpoint, captured_at=captured_at)
            bindings = collect_room_bindings(payload)
            remember_room_bindings(self.room_bindings, bindings)
            apply_room_bindings(races, self.room_bindings)
            if not races:
                self._count('responses_without_race')
                return
            categories = settings.get('categories', {})
            categories = categories if isinstance(categories, dict) else {}
            selected = [race for race in races if categories.get(race['race_category']) is not False]
            with self.lock:
                self.status['races_filtered'] += len(races) - len(selected)
            races = selected
            if not races:
                self._write_status(force=True)
                return
            documents = [json.dumps(race, ensure_ascii=False, allow_nan=False).encode('utf-8') for race in races]
            if sum(map(len, documents)) > MAX_BODY:
                raise ValueError('output_limit')
        except Exception:
            self._count('decode_failed')
            if not traced:
                self._trace(route, 200, None)
            return
        folder = Path(self.output_path)
        for output in documents:
            name = 'observed-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex[:8]
            temporary = folder / (name + '.partial')
            try:
                folder.mkdir(parents=True, exist_ok=True)
                with temporary.open('xb') as stream:
                    stream.write(output)
                os.replace(temporary, folder / (name + '.json'))
                with self.lock:
                    self.status['races_written'] += 1
            except OSError:
                self._count('write_failed')
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass
        self._write_status(force=True)

    def error(self, flow):
        self.contexts.pop(flow.id, None)

    def done(self):
        if self.monitor:
            self.monitor.cancel()
        self.contexts.clear()
        self.pool.shutdown(wait=True, cancel_futures=True)
        self.status['state'] = 'stopped'
        self._write_status(force=True)
        self.status_socket.close()


addons = [RaceObserver()]
