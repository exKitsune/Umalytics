import gzip
import hashlib
import json
import sqlite3
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
from contextlib import closing
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
from globalsim_bridge import runtime
from globalsim_bridge.cache_storage import SHARED, blob_path, unpack, summary_bytes, summary_value
from analysis_cache import AnalysisCache
from background_analysis import BackgroundAnalysis
from storage_maintenance import optimize


class CompressedStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.model = {'decisionTrace': {'rows': [[1, 2.345678901234, True, None]] * 1000}, 'seed': -17}
        self.secret = b'k' * 32

    def path(self, namespace, key):
        return self.root / 'cache/globalsim' / namespace / 'globalsim-modeled-v1' / (key + '.json')

    def write(self, namespace, key):
        path = self.path(namespace, key)
        runtime._write_cache(path, key, self.model, 100000, self.secret)
        return path

    def test_deduplicates_exact_models_but_authenticates_each_binding(self):
        first, second = self.write('one', 'a'*64), self.write('two', 'b'*64)
        blobs = list((self.root/'cache/globalsim/modeled-blobs-v1').glob('*.gz'))
        self.assertEqual(len(blobs), 1)
        self.assertLess(blobs[0].stat().st_size, len(runtime._canonical(self.model)) // 10)
        self.assertEqual(runtime._read_cache(first, 'a'*64, 100000, self.secret), self.model)
        self.assertEqual(runtime._read_cache(second, 'b'*64, 100000, self.secret), self.model)
        self.assertIsNone(runtime._read_cache(first, 'b'*64, 100000, self.secret))
        self.assertIsNone(runtime._read_cache(first, 'a'*64, 100000, b'x'*32))
        header = json.loads(first.read_bytes())
        self.assertEqual(header['storage'], SHARED)
        self.assertNotIn('modeled', header)
        blobs[0].write_bytes(gzip.compress(b'{"forged":true}'))
        self.assertIsNone(runtime._read_cache(first, 'a'*64, 100000, self.secret))
        self.write('one', 'a'*64)  # Corruption is repaired by a fresh execution.
        self.assertEqual(runtime._read_cache(second, 'b'*64, 100000, self.secret), self.model)

    def test_legacy_authentication_and_bounded_decompression(self):
        path = self.write('one', 'a'*64)
        header = json.loads(path.read_bytes());header.pop('storage');header['modeled'] = self.model
        path.write_bytes(runtime._canonical(header))
        self.assertEqual(runtime._read_cache(path, 'a'*64, 100000, self.secret), self.model)
        with self.assertRaises(ValueError):
            unpack(gzip.compress(b'x'*10000), 20)
        with self.assertRaises(ValueError):
            blob_path(path, '../outside')
        path = self.write('two', 'b'*64)
        header = json.loads(path.read_bytes());header['modeledSha256'] = '../outside'
        path.write_bytes(json.dumps(header).encode())
        self.assertIsNone(runtime._read_cache(path, 'b'*64, 100000, self.secret))

    def test_inventory_counts_shared_bytes_once_and_purge_preserves_sources(self):
        first, second = self.write('one', 'a'*64), self.write('two', 'b'*64)
        cache = AnalysisCache(self.root)
        status = cache.read()
        self.assertEqual(len(status['entries']), 2)
        physical = cache.path.stat().st_size + first.stat().st_size + second.stat().st_size + sum(p.stat().st_size for p in cache.blob_files())
        self.assertEqual(status['bytes'], physical)
        self.assertEqual(sum(e['bytes'] for e in status['entries']), physical-cache.path.stat().st_size)
        (self.root/'races').mkdir();source = self.root/'races/kept.json';source.write_text('original')
        cache.update({'action':'policy','policy':{'mode':'races','value':1,'background':False}})
        self.assertEqual(len(cache.blob_files()), 1, 'The surviving binding still owns this blob.')
        remaining = cache.read()['entries'][0]['key']
        kept = first if remaining == 'a'*64 else second
        self.assertEqual(runtime._read_cache(kept, remaining, 100000, self.secret), self.model)
        cache.update({'action':'purge'})
        self.assertEqual(cache.blob_files(), [])
        self.assertEqual(source.read_text(), 'original')

    def test_simulator_summaries_keep_every_value_and_support_legacy_rows(self):
        summary = {'seed':-7, 'runners':[{'name':'スペシャルウィーク','gain':0.12345678901234,'missing':None}]*9}
        packed = summary_bytes(summary)
        self.assertEqual(summary_value(packed), summary)
        self.assertEqual(summary_value(json.dumps(summary)), summary)
        self.assertLess(len(packed), len(json.dumps(summary)))

    def test_new_dashboard_replaces_old_context_for_same_original_capture(self):
        worker = BackgroundAnalysis.__new__(BackgroundAnalysis)
        worker.service = SimpleNamespace(lock=threading.RLock(), simulation=SimpleNamespace(cache_auth_key=lambda:self.secret))
        worker.cache = AnalysisCache(self.root)
        worker.save('a'*64, {'entrySha256':'c'*64}, b'first', 'old-engine-key', '2026', 'e'*64)
        worker.save('b'*64, {'entrySha256':'c'*64}, b'new', 'new-engine-key', '2026', 'f'*64)
        worker.save('d'*64, {'entrySha256':'d'*64}, b'other', 'other-capture', '2026', 'f'*64)
        with worker.cache.connect() as db:
            self.assertEqual(set(db.execute('SELECT key,payload FROM prepared')), {('b'*64,b'new'),('d'*64,b'other')})

    def test_offline_migration_is_repeatable_and_keeps_latest_authenticated_view(self):
        (self.root/'simulation-cache.key').write_bytes(self.secret)
        path = self.write('legacy', 'a'*64)
        header = json.loads(path.read_bytes());header.pop('storage');header['modeled'] = self.model
        path.write_bytes(runtime._canonical(header))
        original_time = path.stat().st_mtime_ns
        (self.root/'races').mkdir();(self.root/'races/kept.json').write_text('original')
        cache = AnalysisCache(self.root)
        summary = json.dumps({'entrySha256':'c'*64})
        import hmac
        with cache.connect() as db:
            for key, payload in [('a'*64,b'old'),('b'*64,b'latest')]:
                signature = hmac.digest(self.secret,key.encode()+summary.encode()+payload,'sha256')
                db.execute('INSERT INTO prepared VALUES (?,?,?,?,?,?,?)',(key,key,'d'*64,'2026',payload,signature,summary))
        record = {'seed':-7,'gates':list(range(9)),'runners':[{'place':1,'time':123.456789,'name':'runner'}]*9}
        with closing(sqlite3.connect(self.root/'simulator.sqlite')) as db, db:
            db.execute('CREATE TABLE runs (job TEXT,n INTEGER,summary TEXT,dashboard BLOB,PRIMARY KEY(job,n))')
            db.execute('INSERT INTO runs VALUES (?,?,?,?)',('job',0,json.dumps(record),b'preserve-dashboard'))
        first = optimize(self.root, True)
        self.assertEqual((first['migratedModels'],first['obsoleteDashboards'],first['packedRuns']),(1,1,1))
        self.assertEqual(path.stat().st_mtime_ns,original_time)
        self.assertEqual(runtime._read_cache(path,'a'*64,100000,self.secret),self.model)
        with cache.connect() as db:
            self.assertEqual(db.execute('SELECT key,payload FROM prepared').fetchall(),[('b'*64,b'latest')])
            self.assertEqual(db.execute('PRAGMA auto_vacuum').fetchone()[0],2)
        with closing(sqlite3.connect(self.root/'simulator.sqlite')) as db:
            raw,dashboard = db.execute('SELECT summary,dashboard FROM runs').fetchone()
            self.assertEqual(summary_value(raw),record)
            self.assertEqual(dashboard,b'preserve-dashboard')
        second = optimize(self.root, True)
        self.assertEqual((second['migratedModels'],second['obsoleteDashboards'],second['packedRuns']),(0,0,0))
        restored = optimize(self.root, plain_summaries=True)
        self.assertEqual(restored['restoredRuns'],1)
        with closing(sqlite3.connect(self.root/'simulator.sqlite')) as db:
            raw,dashboard = db.execute('SELECT summary,dashboard FROM runs').fetchone()
            self.assertIsInstance(raw,str)
            self.assertEqual(json.loads(raw),record)
            self.assertEqual(dashboard,b'preserve-dashboard')
        self.assertEqual((self.root/'races/kept.json').read_text(),'original')


if __name__ == '__main__':
    unittest.main()
