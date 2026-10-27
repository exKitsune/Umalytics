"""Window-independent, newest-first analysis and authenticated dashboard snapshots."""
from collections import OrderedDict
import hashlib
import hmac
import json
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import time

from analysis_cache import AnalysisCache
from simulation_service import StaleAnalysis, digest, read_json


class BackgroundAnalysis:
    def __init__(self, service, root):
        self.service, self.root = service, Path(root)
        self.cache = AnalysisCache(service.data_dir)
        self.lock = threading.RLock()
        self.wake = threading.Event()
        self.closed = False
        self.jobs = OrderedDict()
        self.volatile = OrderedDict()
        self.failures = {}
        self.active = None
        self.last_error = None
        self.checked = {}
        self.last_scan = 0
        self.entries = []
        self.references = {}
        from globalsim_bridge.worker_pool import WorkerPool
        self.node_pool = WorkerPool()
        self.node_identity = None
        self.build = self.root / 'simulation/analysis/build.json'
        self.worker = self.root / 'simulation/analysis/worker.mjs'
        self.node = str(self.root / 'analysis-runtime/node.exe') if getattr(sys, 'frozen', False) else shutil.which('node')
        self.available = bool(self.node and self.build.is_file() and self.worker.is_file())
        self.thread = None
        if self.available:
            self.thread = threading.Thread(target=self.loop, name='saved-race-analysis', daemon=True)
            self.thread.start()

    def _reference_file(self, key):
        """Only an installed, content-verified file may reach the local worker."""
        _, manifest = self.service.simulation.config()
        bundle = next((r for r in manifest['bundles'] if r['kind'] == 'inference' and r['data_sha256'] == key), None)
        path = self.service.simulation.path(bundle['data']) if bundle else self.service.simulation.skill_catalog.path(key, True)
        if not path.is_file():
            raise StaleAnalysis('Reference bundle is no longer installed.')
        stat = path.stat()
        stamp = (str(path), stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size)
        cached = self.references.get(key)
        if cached is None or cached[0] != stamp:
            raw = path.read_bytes()
            if hashlib.sha256(raw).hexdigest() != key:
                raise StaleAnalysis('Reference bundle changed.')
            cached = [stamp, raw, None]
            self.references[key] = cached
            while len(self.references) > 3:
                self.references.pop(next(iter(self.references)))
        return path, cached

    def reference_path(self, key):
        return self._reference_file(key)[0]

    def reference(self, key):
        _, cached = self._reference_file(key)
        if cached[2] is None:
            import gzip
            cached[2] = gzip.compress(cached[1], compresslevel=1)
        return cached[2]

    def library_changed(self):
        self.last_scan = 0
        self.wake.set()

    def signature(self, snap=None):
        """Stat signatures invalidate memoized identities; content hashes bind persisted output."""
        paths = [self.build, self.worker, self.root / 'simulation/engine-registry.json', self.root / 'simulation/installed-bundles.json']
        if snap is None:
            registry, manifest = self.service.simulation.config()
            allowed = {e['engineId'] for e in registry.get('engines', [])}
            allowed.update(e['engineId'] for e in registry.get('unknownVersionSimulators', []))
        else:
            selection = snap['selection']
            manifest = snap['manifest']
            allowed = {selection.get(k, {}).get('engineId') for k in ('simulation', 'inference')}
        latest = next((r['engine_id'] for r in reversed(manifest.get('bundles', [])) if r['kind'] == 'inference'), None)
        allowed.add(latest)
        for row in manifest.get('bundles', []):
            if row['engine_id'] not in allowed:
                continue
            paths.append(self.service.simulation.path(row['artifact']))
            if row.get('skillCatalog'):
                paths.append(self.service.simulation.skill_catalog.path(row['skillCatalog']))
            if row['kind'] == 'inference':
                paths.append(self.service.simulation.path(row['data']))
            else:
                for key in ('appRoot', 'resourceRoot'):
                    paths.extend(sorted(p for p in self.service.simulation.path(row[key]).rglob('*') if p.is_file()))
        return tuple((str(p), st.st_mtime_ns, st.st_ctime_ns, st.st_size) for p in paths for st in [p.stat()])

    def identity(self, race_id, expected=None):
        snap = self.service.simulation.snapshot(race_id, expected, None)
        signature = self.signature(snap)
        build = read_json(self.build)
        # Hash every installed resource once per filesystem change. Never trust
        # caller-supplied cache keys or bypass a changed artifact/evidence gate.
        if not hasattr(self, '_resource_hashes'):
            self._resource_hashes = {}
        resources = self._resource_hashes.get(signature)
        if resources is None:
            resources = digest([(row[0], hashlib.sha256(Path(row[0]).read_bytes()).hexdigest()) for row in signature])
            if len(self._resource_hashes) > 8:
                self._resource_hashes.clear()
            self._resource_hashes[signature] = resources
        key = digest(['dashboard-v1', snap['identity'], build, resources])
        return snap, key, build

    def read(self, key, payload=False):
        with self.lock:
            cached = self.volatile.get(key)
            if cached:
                self.volatile.move_to_end(key)
                return cached[0], cached[1] if payload else None
        with self.service.lock, self.cache.connect() as db:
            row = db.execute('SELECT summary,payload,signature FROM prepared WHERE key=?', (key,)).fetchone()
        if not row:
            return None
        summary, packed, signature = row
        auth = self.service.simulation.cache_auth_key()
        if not auth or not hmac.compare_digest(signature, hmac.digest(auth, key.encode() + summary.encode() + packed, 'sha256')):
            return None
        decoded = json.loads(summary)
        with self.lock:
            self.volatile[key] = (decoded, packed)
            while len(self.volatile) > 2:
                self.volatile.popitem(last=False)
        return decoded, packed if payload else None

    def save(self, key, summary, packed, race_id, date, revision):
        text = json.dumps(summary, separators=(',', ':'), allow_nan=False)
        auth = self.service.simulation.cache_auth_key()
        if not auth:
            raise ValueError('Analysis cache authentication unavailable.')
        signature = hmac.digest(auth, key.encode() + text.encode() + packed, 'sha256')
        with self.service.lock, self.cache.connect() as db:
            db.execute('DELETE FROM prepared WHERE race=?', (race_id,))
            capture = summary.get('entrySha256')
            if isinstance(capture, str) and len(capture) == 64:
                # Context/engine cache keys used to accumulate multiple complete
                # dashboards for the same source capture. Only its latest derived
                # view is needed; native model caches retain their own bindings.
                db.execute("DELETE FROM prepared WHERE CASE WHEN json_valid(summary) THEN json_extract(summary,'$.entrySha256') END=?", (capture,))
            db.execute('INSERT OR REPLACE INTO prepared VALUES (?,?,?,?,?,?,?)', (key, race_id, revision, date, packed, signature, text))
            self.cache.prune(db)

    def request(self, race_id, body):
        if set(body) - {'expectedEntrySha256', 'revision', 'knownKey'} or not self.available:
            raise ValueError('Service analysis unavailable.')
        snap, key, build = self.identity(race_id, body.get('expectedEntrySha256'))
        if body.get('revision') != build['revision']:
            raise StaleAnalysis('The application was updated. Reload the window.')
        cached = self.read(key)
        if cached:
            return cached[0]
        with self.lock:
            if self.closed:
                raise ValueError('Service is shutting down.')
            job = self.jobs.get(key)
            if job and job['phase'] == 'failed' and self.failures.get(race_id, 0) > time.monotonic():
                raise ValueError(job['error'])
            if job and job['phase'] in ('complete', 'failed'):
                self.jobs.pop(key)
                job = None
            if not job:
                if len(self.jobs) >= 32:
                    for old in list(self.jobs):
                        if self.jobs[old]['phase'] in ('complete', 'failed'):
                            self.jobs.pop(old)
                if len(self.jobs) >= 32:
                    raise ValueError('Analysis queue is full.')
                self.jobs[key] = dict(raceId=race_id, key=key, snap=snap, build=build, phase='queued')
            self.jobs.move_to_end(key, last=False)  # Foreground ahead of old captures.
            self.wake.set()
        return {'phase': 'queued', 'key': key, 'entrySha256': snap['entry_hash']}

    def payload(self, race_id, key):
        _, current, _ = self.identity(race_id)
        if current != key:
            raise StaleAnalysis('Race, engine or compatibility selection changed.')
        cached = self.read(key, True)
        if not cached:
            raise StaleAnalysis('Saved analysis was cleared. Reopen this race.')
        return cached[1]

    def status(self):
        with self.lock:
            return {'available': self.available, 'running': self.active is not None,
                    'raceId': self.active, 'checked': len(self.checked), 'total': len(self.entries),
                    'failed': len(self.failures), 'error': self.last_error}

    def background_candidate(self):
        with self.service.lock, self.cache.connect() as db:
            policy = self.cache.policy(db)
        if not policy['background']:
            return None
        if time.monotonic() - self.last_scan >= 3:
            entries, offset = [], 0
            while True:
                page = self.service.races(200, summary=True, offset=offset)
                entries.extend(page['races'])
                if page['nextOffset'] is None:
                    break
                offset = page['nextOffset']
            self.entries = sorted(entries, key=lambda e: (e.get('racedAt') or e['receivedAt'], e['id']), reverse=True)
            library_stamp = tuple((e['id'], e['sha256']) for e in self.entries)
            if getattr(self, '_library_stamp', None) != library_stamp:
                self._library_stamp = library_stamp
                if hasattr(self.service, 'events'):
                    self.service.events.publish('library')
            self.last_scan = time.monotonic()
        entries = self.entries[:policy['value']] if policy['mode'] == 'races' else self.entries
        signature = self.signature()
        if getattr(self, '_background_signature', None) != signature:
            self.checked.clear()
            self._background_signature = signature
        if policy['mode'] == 'size' and self.cache.read()['bytes'] >= policy['value'] * 1024 * 1024:
            return None
        for entry in entries:
            # Evidence sidecars are independently versioned from the capture.
            evidence = self.service.data_dir / 'analysis-evidence'
            evidence_stamp = tuple((p.name, p.stat().st_mtime_ns, p.stat().st_size) for p in evidence.glob('*.json'))
            stamp = (entry['sha256'], evidence_stamp)
            if self.checked.get(entry['id']) == stamp or self.failures.get(entry['id'], 0) > time.monotonic():
                continue
            with self.lock:
                if any(j['phase'] == 'queued' for j in self.jobs.values()):
                    return None
            snap, key, build = self.identity(entry['id'], entry['sha256'])
            if self.read(key):
                self.checked[entry['id']] = stamp
                continue
            return dict(raceId=entry['id'], key=key, snap=snap, build=build, phase='queued', stamp=stamp)
        return None

    def loop(self):
        while not self.closed:
            job = None
            try:
                with self.lock:
                    job = next((j for j in self.jobs.values() if j['phase'] == 'queued'), None)
                if job is None:
                    maintenance = getattr(self.service, 'storage_optimizer', None)
                    if maintenance and maintenance.reserving_databases:
                        self.wake.wait(.2)
                        self.wake.clear()
                        continue
                    job = self.background_candidate()
                if job:
                    with self.lock:
                        job['phase'] = 'running'
                        self.active = job['raceId']
                    if not self.read(job['key']):
                        self.run(job)
                    job['phase'] = 'complete'
                    if 'stamp' in job:
                        self.checked[job['raceId']] = job['stamp']
                    self.failures.pop(job['raceId'], None)
                    self.last_error = None
            except StaleAnalysis as error:
                # A capture or catalog can change while this job is running.
                # Discard the old result and rescan current inputs without the
                # failure cooldown used for actual calculation errors.
                with self.lock:
                    if job:
                        job.update(phase='failed', error=str(error))
                        self.checked.pop(job['raceId'], None)
                        self.failures.pop(job['raceId'], None)
                    self.last_error = None
                    self.last_scan = 0
                job = None  # Yield before retrying, even if inputs keep changing.
            except Exception as error:
                self.last_error = str(error)
                if job:
                    job.update(phase='failed', error=str(error))
                    self.failures[job['raceId']] = time.monotonic() + 60
            finally:
                with self.lock:
                    self.active = None
            if job is None:
                self.wake.wait(1)
                self.wake.clear()

    def run(self, job):
        race_id, snap = job['raceId'], job['snap']
        simulation = self.service.simulation
        selected = simulation.submit(race_id, {'expectedEntrySha256': snap['entry_hash']}, transient=True)
        while selected['phase'] != 'complete':
            if self.closed:
                return
            self.wake.wait(.05)
            self.wake.clear()
            selected = simulation.get(race_id, selected['jobId'])
        detail = simulation.get(race_id, selected['jobId'], True)
        report = detail['report']
        summary = {'phase': 'complete', 'key': job['key'], 'entrySha256': snap['entry_hash'],
                   'revision': job['build']['revision'], 'report': selected['report'], 'hasAnalysis': report['mode'] != 'recorded_only'}
        packed = b''
        if summary['hasAnalysis']:
            _, manifest = simulation.config()
            auth = None
            if report['mode'] == 'inference_plan':
                auth = simulation.authorize(race_id, {'jobId': selected['jobId']})
                bundle = next(r for r in manifest['bundles'] if r['engine_id'] == auth['plan']['engine']['engineId'])
                if auth['uiRevision'] != job['build']['revision']:
                    summary['hasAnalysis'] = False  # Do not project an incompatible historical display schema.
            else:
                bundle = next(r for r in reversed(manifest['bundles']) if r['kind'] == 'inference')
            if summary['hasAnalysis']:
                summary['referenceKey'] = bundle['data_sha256']
                reference_path = self.reference_path(summary['referenceKey'])
                if report['mode'] == 'verified_simulation':
                    sim_id = report['binding']['simulation']['engineId']
                    sim_bundle = next(r for r in manifest['bundles'] if r['engine_id'] == sim_id)
                    overlay = simulation.skill_catalog.read(sim_bundle['skillCatalog']) if sim_bundle.get('skillCatalog') else None
                    reference_path, summary['referenceKey'] = simulation.skill_catalog.display_reference(reference_path, overlay)
                payload = {'capture': snap['capture'], 'raceId': race_id, 'entrySha256': snap['entry_hash'],
                           'report': report, 'auth': auth, 'referencePath': str(reference_path),
                           'referenceKey': summary['referenceKey'], 'artifact': str(simulation.path(bundle['artifact']))}
                folder = self.service.data_dir / 'cache' / 'analysis-work'
                folder.mkdir(parents=True, exist_ok=True)
                with tempfile.TemporaryDirectory(prefix='job-', dir=folder) as temporary:
                    output = Path(temporary) / 'prepared.gz'
                    payload['output'] = str(output)
                    from globalsim_bridge.runtime import RuntimeConfig
                    from globalsim_bridge.worker_pool import WorkerPool
                    if self.node_identity != job['build']['identity']:
                        self.node_pool.close()
                        self.node_pool = WorkerPool()
                        self.node_identity = job['build']['identity']
                    config = RuntimeConfig(Path(self.node), self.root, self.root, work_root=folder,
                        engine_args=('--max-old-space-size=2048', str(self.worker), '--serve'),
                        expected_engine_sha256=hashlib.sha256(Path(self.node).read_bytes()).hexdigest(),
                        timeout_seconds=180, max_input_bytes=128*1024*1024, max_output_bytes=16384, low_priority=True)
                    # Keep each request self-contained if an idle worker exits.
                    # The worker still reuses its assembled immutable reference.
                    reply, _, _ = self.node_pool.run(config, json.dumps(payload, separators=(',', ':')).encode() + b'\n')
                    if reply.get('ok') is not True:
                        raise ValueError('Dashboard analysis failed: ' + str(reply.get('error', 'Invalid reply'))[:1000])
                    packed = output.read_bytes()
                if auth:
                    simulation.authorize(race_id, {'jobId': selected['jobId']})
        _, key, _ = self.identity(race_id, snap['entry_hash'])
        if key != job['key'] or self.closed:
            raise StaleAnalysis('Analysis inputs changed while preparing the dashboard.')
        # Recheck executable/reference integrity before publishing results.
        simulation.get(race_id, selected['jobId'])
        entry = self.service.races(1, race_id, summary=True)['races'][0]
        group = 'capture:' + snap['entry_hash']
        self.save(key, summary, packed, group, entry.get('racedAt') or entry['receivedAt'], job['build']['revision'])
        with self.lock:
            self.volatile[key] = (summary, packed)
            while len(self.volatile) > 2:
                self.volatile.popitem(last=False)
        with simulation.lock:
            simulation.jobs.pop(selected['jobId'], None)
        job.pop('snap', None)
        if hasattr(self.service, 'events'):
            self.service.events.publish('analysis')

    def changed(self):
        with self.lock:
            self.volatile.clear()
        self.checked.clear()
        self.last_scan = 0
        self.wake.set()

    def close(self):
        self.closed = True
        self.wake.set()
        self.node_pool.close()
        if self.thread and self.thread is not threading.current_thread():
            self.thread.join(timeout=5)
