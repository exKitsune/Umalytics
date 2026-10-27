"""Persistent transport must isolate requests and retire failed workers."""
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
from globalsim_bridge.runtime import RuntimeConfig, _run_worker, _WorkerFailure
from globalsim_bridge.worker_pool import WorkerPool


class WorkerPoolTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.pool = WorkerPool()
        self.addCleanup(self.pool.close)
        self.config = RuntimeConfig(Path(sys.executable), Path(self.folder.name), Path(self.folder.name),
            expected_engine_sha256=hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest(), worker_pool=self.pool,
            work_root=Path(self.folder.name), timeout_seconds=3)

    def program(self, source, **changes):
        return replace(self.config, engine_args=('-u', '-c', source), **changes)

    def test_reuses_process_without_leaking_request_state(self):
        config = self.program('import sys,json,os\nfor line in sys.stdin:\n x=json.loads(line);print(json.dumps(dict(seed=x["seed"],pid=os.getpid())),flush=True)')
        results = [_run_worker(config, json.dumps({'seed': seed}).encode() + b'\n')[0] for seed in [7, 999, 7]]
        self.assertEqual([r['seed'] for r in results], [7, 999, 7])
        self.assertEqual(len({r['pid'] for r in results}), 1)
        with self.assertRaises(_WorkerFailure):
            _run_worker(replace(config, expected_engine_sha256='0'*64), b'{}\n')

    def test_pin_is_reused_only_for_the_same_live_executable(self):
        from globalsim_bridge.runtime import _file_digest
        config=self.program('import sys\nfor line in sys.stdin: print("{}",flush=True)')
        with patch('globalsim_bridge.runtime._file_digest',wraps=_file_digest) as digest:
            for _ in range(3):_run_worker(config,b'{}\n')
            self.assertEqual(digest.call_count,1)
            self.pool.session.process.kill();self.pool.session.process.wait()
            _run_worker(config,b'{}\n')
            self.assertEqual(digest.call_count,2,'A restarted process must authenticate again')
        original=Path.stat
        def changed(path,*args,**kwargs):
            stat=original(path,*args,**kwargs)
            if path==config.engine_path:
                from types import SimpleNamespace
                return SimpleNamespace(st_dev=stat.st_dev,st_ino=stat.st_ino,st_size=stat.st_size,
                    st_mtime_ns=stat.st_mtime_ns+1,st_ctime_ns=stat.st_ctime_ns)
            return stat
        with patch.object(Path,'stat',changed),patch('globalsim_bridge.runtime._file_digest',return_value='0'*64):
            with self.assertRaisesRegex(_WorkerFailure,'matching executable pin'):_run_worker(config,b'{}\n')
        self.assertIsNone(self.pool.session)

    def test_timeout_and_bad_output_retire_process(self):
        for source, options in [('import time;time.sleep(30)', {'timeout_seconds': .15}),
                ('import sys\nfor line in sys.stdin: print("x"*5000,flush=True)', {'max_output_bytes': 1024}),
                ('import sys\nfor line in sys.stdin: print("{broken}",flush=True)', {})]:
            with self.assertRaises(_WorkerFailure):
                _run_worker(self.program(source, **options), b'{}\n')
            self.assertIsNone(self.pool.session)
        good = self.program('import sys\nfor line in sys.stdin: print("{}",flush=True)')
        self.assertEqual(_run_worker(good, b'{}\n')[0], {})

    def test_binary_exact_values_and_bounds(self):
        source = '''import sys,struct
for line in sys.stdin:
 data=b'{"seed":7}';raw=struct.pack('<7d',.0666,1.25,20.5,999.125,-0.,4.,-1.)
 sys.stdout.buffer.write(struct.pack('<8sQIIQ',b'GSIMRP01',len(data),1,1,len(raw))+data+raw);sys.stdout.buffer.flush()
'''
        value = _run_worker(self.program(source, worker_protocol='binary-v1'), b'{}\n')[0]
        self.assertEqual(value['frames'], [{'t': .0666, 'horses': [{'pos': 1.25, 'speed': 20.5, 'hp': 999.125, 'lane': -0., 'temptationMode': 4., 'blockFrontHorseIndex': -1.}]}])
        compact=_run_worker(self.program(source,worker_protocol='binary-v1',decode_frames=False),b'{}\n')[0]
        retained=_run_worker(self.program(source,worker_protocol='binary-v1',retain_binary_frames=True),b'{}\n')[0]
        self.assertNotIn('frames',retained)
        self.assertEqual(retained['_binary_frames'][:2],(1,1))
        self.assertEqual(len(retained['_binary_frames'][2]),56)
        self.assertEqual(compact,{'seed':7},'Outcome callers omit decoding, not protocol validation')
        bad = 'import sys,struct\nfor line in sys.stdin: sys.stdout.buffer.write(struct.pack("<8sQIIQ",b"GSIMRP01",2**40,0,0,0));sys.stdout.buffer.flush()'
        with self.assertRaises(_WorkerFailure):
            _run_worker(self.program(bad, worker_protocol='binary-v1'), b'{}\n')

    def test_close_stops_idle_child(self):
        config = self.program('import sys\nfor line in sys.stdin: print("{}",flush=True)')
        _run_worker(config, b'{}\n')
        child = self.pool.session.process
        self.pool.close()
        self.assertIsNotNone(child.poll())
        with self.assertRaises(_WorkerFailure):
            _run_worker(config, b'{}\n')


if __name__ == '__main__':
    unittest.main()
