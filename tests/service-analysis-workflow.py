"""Real headless inference, tray queue, restart reuse and stale-cache rejection."""
import gzip
import json
from pathlib import Path
import shutil
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
sys.path.insert(0, str(ROOT / 'tests'))
import importlib.util
spec = importlib.util.spec_from_file_location('versioned_fixture', ROOT / 'tests/versioned-service-fixture.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
Store = fixture.Store
from background_analysis import BackgroundAnalysis
from analysis_cache import AnalysisCache
from simulation_service import StaleAnalysis
from analysis_events import AnalysisEvents


def until(predicate, message):
    end = time.monotonic() + 45
    while time.monotonic() < end:
        if predicate():
            return
        time.sleep(.05)
    raise AssertionError(message)


with tempfile.TemporaryDirectory(prefix='service-analysis-') as temporary:
    root = Path(temporary)
    manifest = json.loads((ROOT / 'simulation/installed-bundles.json').read_text())
    bundle = next(row for row in reversed(manifest['bundles']) if row['kind'] == 'inference')
    for field in ('artifact', 'data'):
        target = root / bundle[field]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / bundle[field], target)
    shutil.copytree(ROOT / 'simulation/analysis', root / 'simulation/analysis')
    (root / 'simulation/installed-bundles.json').write_text(json.dumps({'schemaVersion': 1, 'bundles': [bundle]}))
    (root / 'simulation/engine-registry.json').write_text(json.dumps({'schemaVersion': 1, 'registryId': 'synthetic-headless', 'eras': [], 'engines': [], 'futureInferencePolicies': [], 'allowReplayInference': True}))
    store = Store(root)
    store.events = AnalysisEvents()
    capture = json.loads((ROOT / 'tests/fixtures/race.json').read_text())
    def add(name, day):
        (store.inbox / (name + '.json')).write_text(json.dumps({**capture, 'racedAt': f'2026-01-{day:02d}T00:00:00Z'}))
    # File discovery/mtime order differs from the actual race order.
    add('new', 3); add('old', 1); add('middle', 2)
    cache = AnalysisCache(store.data_dir)
    cache.update({'action': 'policy', 'policy': {'mode': 'unlimited', 'value': 1000, 'background': True}})
    starts, worker_pids = [], []
    original = BackgroundAnalysis.run
    def counted(self, job):
        starts.append(job['raceId'])
        result = original(self, job)
        worker_pids.append(self.node_pool.session.process.pid)
        return result
    BackgroundAnalysis.run = counted
    service = BackgroundAnalysis(store, root)
    try:
        assert service.available
        until(lambda: len(service.checked) == 3, 'Headless backlog did not finish: ' + str(service.status()))
        assert starts == ['new~0', 'middle~0', 'old~0'], starts
        assert len(set(worker_pids)) == 1, 'The calculation worker was restarted between races.'
        # An idle worker can exit unexpectedly; the next job remains self-contained.
        child = service.node_pool.session.process
        child.kill()
        child.wait(timeout=5)
        add('newest', 4)
        until(lambda: len(service.checked) == 4, 'New capture was not discovered without a window.')
        assert starts[-1] == 'newest~0'
        assert worker_pids[-1] != worker_pids[0]
        body = {'revision': bundle['uiRevision']}
        saved = service.request('newest~0', body)
        assert saved['phase'] == 'complete' and saved['hasAnalysis']
        assert saved['report']['mode'] == 'inference_plan'
        assert store.events.wait(0, 0)['analysis'] >= 4
        reference = service.reference(saved['referenceKey'])
        assert json.loads(gzip.decompress(reference)) == json.loads((root / bundle['data']).read_text())
        with service.cache.connect() as db:
            packed = db.execute('SELECT payload FROM prepared WHERE key=?', (saved['key'],)).fetchone()[0]
        assert 'referenceData' not in json.loads(gzip.decompress(packed)), 'Shared references must not be copied into every race.'
        value = json.loads(gzip.decompress(service.payload('newest~0', saved['key'])))['value']
        assert len(value['race']['runners']) == 2 and value['runners']
        assert value['authorization']['plan']['engine']['engineId'] == bundle['engine_id']
        before = len(starts)
        for _ in range(12):
            assert service.request('newest~0', body)['key'] == saved['key']
        assert len(starts) == before, 'Reopening saved analysis reran the engine.'
        # No job lease survives a restart. The authenticated snapshot does.
        service.close()
        service = BackgroundAnalysis(store, root)
        assert service.request('newest~0', body)['phase'] == 'complete'
        assert len(starts) == before
        # Existing payloads cannot be replayed against changed race evidence.
        add('newest', 5)
        try:
            service.payload('newest~0', saved['key'])
            raise AssertionError('Changed capture accepted a stale dashboard.')
        except StaleAnalysis:
            pass
        with cache.connect() as db:
            db.execute('UPDATE prepared SET payload=? WHERE key=?', (b'forged', saved['key']))
        service.volatile.clear()
        assert service.read(saved['key']) is None, 'Unauthenticated cache was accepted.'
        print('Service analysis: headless newest-first backlog, new capture, immutable inference, restart reuse and invalidation passed.')
    finally:
        service.close()
        store.simulation.close()
        BackgroundAnalysis.run = original
