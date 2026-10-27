"""Live upgrades preserve results, resume checkpoints and yield to DB readers."""
from contextlib import closing
import hashlib
import hmac
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
from storage_optimizer import StorageOptimizer, STEPS
from storage_gate import database_gate
from sandbox_service import SandboxService
from globalsim_bridge import runtime
from globalsim_bridge.cache_storage import SHARED


class AutomaticStorageTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.auth = b'k'*32
        self.service = SimpleNamespace(data_dir=self.root, server=object(), closed=threading.Event(),
            game_active=lambda:False, diagnostics=SimpleNamespace(event=Mock(),exception=Mock()),
            simulation=SimpleNamespace(cache_auth_key=lambda:self.auth), analysis_service=SimpleNamespace(active=None))
        (self.root/'cache').mkdir()
        self.analysis = self.root/'cache/analysis.sqlite'
        with closing(sqlite3.connect(self.analysis)) as db, db:
            db.executescript('CREATE TABLE entries (key TEXT PRIMARY KEY,race TEXT UNIQUE,revision TEXT,date TEXT,payload BLOB);'
                'CREATE TABLE prepared (key TEXT PRIMARY KEY,race TEXT,revision TEXT,date TEXT,payload BLOB,signature BLOB,summary TEXT);'
                'CREATE TABLE options (key TEXT PRIMARY KEY,value TEXT);')
            text = json.dumps({'entrySha256':'c'*64})
            for key,payload in [('a'*64,b'old-dashboard'),('b'*64,b'latest-dashboard')]:
                signature = hmac.digest(self.auth,key.encode()+text.encode()+payload,'sha256')
                db.execute('INSERT INTO prepared VALUES (?,?,?,?,?,?,?)',(key,key,'d'*64,'2026',payload,signature,text))
        self.runs = [{'index':n,'seed':-7+n,'runners':[{'name':'Uma','place':n+1,'time':123.456789,'gain':None}]*9} for n in range(3)]
        with closing(sqlite3.connect(self.root/'simulator.sqlite')) as db, db:
            db.execute('CREATE TABLE runs (job TEXT,n INTEGER,summary TEXT,dashboard BLOB,PRIMARY KEY(job,n))')
            for n,summary in enumerate(self.runs):
                db.execute('INSERT INTO runs(rowid,job,n,summary,dashboard) VALUES (?,?,?,?,?)',((n+1)*10,'job',n,json.dumps(summary),None))
        self.store = SandboxService(self.service)
        self.service.sandbox = self.store
        self.addCleanup(self.store.close)
        self.store.write_job(dict(id='job',phase='complete',setup={},total=3))
        self.model = {'seed':-17,'frames':[[0.1,20.123456789]]*2000}
        self.paths = []
        self.legacy = []
        for ns,key in [('one','a'*64),('two','b'*64)]:
            path = self.root/'cache/globalsim'/ns/'globalsim-modeled-v1'/(key+'.json')
            path.parent.mkdir(parents=True)
            digest = hashlib.sha256(runtime._canonical(self.model)).hexdigest()
            raw = runtime._canonical(dict(schemaVersion=1,cacheKey=key,modeledSha256=digest,
                authentication=runtime._cache_mac(self.auth,key,digest),modeled=self.model))
            path.write_bytes(raw);self.paths.append(path);self.legacy.append(raw)
        (self.root/'races').mkdir();(self.root/'races/kept.json').write_text('original-race')

    def worker(self, build='release-1', idle=lambda:True):
        return StorageOptimizer(self.service,build,idle=idle,startup_delay=0)

    def finish(self, worker):
        for _ in range(100):
            worker.tick()
            if worker.phase == 'complete':
                return
        self.fail('Optimization did not finish')

    def test_resume_latest_dashboard_and_cursor_survive_live_vacuum(self):
        before = self.store.job('job')
        self.assertEqual(before['runCursor'],30)
        worker = self.worker();worker.tick();worker.close()
        self.assertEqual(json.loads(self.paths[0].read_bytes())['storage'],SHARED)
        paused = self.worker(idle=lambda:False);paused.tick()
        self.assertEqual(paused.phase,'waiting')
        self.assertEqual(self.paths[1].read_bytes(),self.legacy[1])
        resumed = self.worker();self.finish(resumed)
        self.assertEqual(resumed.state['counts'],dict(models=2,runs=3,dashboards=1,skipped=0))
        self.assertEqual(self.store.job('job')['runs'],before['runs'])
        self.assertEqual(self.store.job('job')['runCursor'],30)
        for path in self.paths:
            self.assertEqual(runtime._read_cache(path,path.stem,1000000,self.auth),self.model)
        self.assertEqual(len(list((self.root/'cache/globalsim/modeled-blobs-v1').glob('*.gz'))),1)
        with closing(sqlite3.connect(self.analysis)) as db:
            self.assertEqual(db.execute('SELECT payload FROM prepared').fetchall(),[(b'latest-dashboard',)])
            self.assertEqual(db.execute('PRAGMA auto_vacuum').fetchone()[0],2)
        with self.store.connect() as db:
            # SQLite may retain or reassign implicit rowids during VACUUM.
            # Exercise reassignment explicitly on builds that preserve them.
            db.execute('UPDATE runs SET rowid=rowid+1000')
            db.execute('UPDATE runs SET rowid=n+1')
        self.assertEqual(self.store.job('job')['runCursor'],30)
        self.store.save_run('job',3,({'index':3,'seed':77,'runners':[]},None))
        delta = self.store.job('job',after=before['runCursor'])
        self.assertEqual([r['index'] for r in delta['runs']],[3])
        self.assertGreater(delta['runCursor'],30)
        self.assertEqual((self.root/'races/kept.json').read_text(),'original-race')

    def test_completed_build_is_quiet_and_next_release_rescans_formats(self):
        first = self.worker();self.finish(first)
        unchanged = self.worker()
        self.assertEqual(unchanged.phase,'complete')
        self.paths[0].write_bytes(self.legacy[0])
        unchanged.tick()
        self.assertNotIn('storage',json.loads(self.paths[0].read_bytes()))
        updated = self.worker('release-2');self.finish(updated)
        self.assertEqual(updated.state['counts']['models'],1)
        self.assertEqual(updated.state['counts']['runs'],0)

    def test_app_busy_and_shutdown_do_not_publish_incomplete_work(self):
        worker = self.worker(idle=lambda:False);worker.tick()
        self.assertEqual(worker.phase,'waiting')
        self.assertEqual(self.paths[0].read_bytes(),self.legacy[0])
        worker.close();worker.tick()
        self.assertEqual(worker.phase,'stopped')
        resumed = self.worker()
        with patch('storage_optimizer.convert_model',side_effect=OSError('transient disk error')):
            with self.assertRaises(OSError):resumed.tick()
        self.assertEqual(resumed.state['completed'],[])
        self.assertEqual(self.paths[0].read_bytes(),self.legacy[0])
        self.finish(self.worker())

    def test_update_is_committed_before_background_migration_starts(self):
        update = self.root/'cache/update';(update/'backup').mkdir(parents=True)
        worker = StorageOptimizer(self.service,'release-1',startup_delay=0)
        worker.tick()
        self.assertEqual(worker.phase,'waiting')
        self.assertEqual(self.paths[0].read_bytes(),self.legacy[0])
        (update/'success.json').write_text('{"schemaVersion":1}')
        worker.tick()
        self.assertEqual(json.loads(self.paths[0].read_bytes())['storage'],SHARED)

    def test_future_plan_runs_new_steps_without_a_manual_script(self):
        first = self.worker();self.finish(first)
        future = (*STEPS,('future-layout-v2','Future optimization','future'))
        with patch('storage_optimizer.STEPS',future),patch.object(StorageOptimizer,'_future',lambda _s,_p:True,create=True):
            updated = self.worker();self.finish(updated)
            self.assertIn('future-layout-v2',updated.state['completed'])

    def test_waiting_db_reader_interrupts_compaction_and_keeps_data(self):
        payload = b'x'*65536
        with closing(sqlite3.connect(self.analysis)) as db, db:
            db.executemany('INSERT INTO entries VALUES (?,?,?,?,?)',[(f'{n:064x}',f'r{n}','d'*64,'2026',payload) for n in range(256)])
        worker = self.worker()
        worker.state['completed'] = [key for key,_,_ in STEPS[:4]]
        gate = database_gate(self.analysis)
        started = threading.Event();finished = threading.Event();failures = []
        original = sqlite3.connect
        class InterruptibleConnection(sqlite3.Connection):
            def set_progress_handler(self, callback, interval):
                def progress():
                    started.set()
                    until = time.monotonic()+2
                    while not gate.waiting and time.monotonic()<until:
                        time.sleep(.001)
                    return callback()
                super().set_progress_handler(progress,interval)
        def reader():
            try:
                if not started.wait(3):raise AssertionError('VACUUM did not start')
                with gate.use(),closing(original(self.analysis)) as db:
                    self.assertEqual(db.execute('SELECT count(*) FROM entries').fetchone()[0],256)
                finished.set()
            except Exception as error:failures.append(error)
        thread = threading.Thread(target=reader);thread.start()
        try:
            with patch('storage_optimizer.sqlite3.connect',side_effect=lambda *a,**k:original(*a,**k,factory=InterruptibleConnection)):
                worker.tick()
        finally:thread.join(timeout=4)
        self.assertFalse(failures,failures)
        self.assertTrue(finished.is_set())
        self.assertEqual(worker.phase,'waiting')
        self.assertNotIn('analysis-layout-v1',worker.state['completed'])
        self.finish(worker)
        with closing(original(self.analysis)) as db:
            self.assertEqual(db.execute('SELECT sum(length(payload)) FROM entries').fetchone()[0],256*len(payload))


if __name__ == '__main__':unittest.main()
