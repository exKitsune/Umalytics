"""Portable boundary tests; these fixtures are synthetic, not official races.

The seven user-capture integration checks are run separately against the actual
pinned executable. No user capture paths or private data are embedded here.
"""
from __future__ import annotations

import base64
import copy
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "desktop"))
from globalsim_bridge import RuntimeConfig, evaluate_capture
from globalsim_bridge import runtime
from globalsim_bridge.cache_storage import SHARED, read_blob


def expanded_entry(path):
    entry = json.loads(path.read_bytes())
    if entry.pop('storage', None) == SHARED:
        entry['modeled'] = json.loads(read_blob(path, entry, 64 * 1024 * 1024))
    return entry


def fixture():
    timestamp = struct.unpack('<f', struct.pack('<f', .0666))[0]
    pieces = [struct.pack('<ii', 4, 100000002), struct.pack('<fiii', 0., 1, 12, 31),
              struct.pack('<i', 0), struct.pack('<ii', 2, 16)]
    for t, pos, hp in ((0., 0., 1000), (timestamp, 1.25, 999)):
        pieces.extend((struct.pack('<f', t), struct.pack('<fHHHbb', pos, 1000, 300, hp, 0, -1)))
    pieces.extend((struct.pack('<i', 0), struct.pack('<ifffBBfBif', 0, 1., 0., .03, 0, 0, 10., 2, 0, 1.),
                   struct.pack('<i', 0), struct.pack('<i', 0)))
    scenario = base64.b64encode(zlib.compress(b''.join(pieces))).decode('ascii')
    capture = {'race_scenario': scenario, 'race_horse_data_array': [{'frame_order': 1}]}
    initial = dict(runtime.REQUIRED_PROFILE, seed=42, courseId=10805, horses=[{'gateIndex': 0}])
    modeled = {
        'results': [{'finishTimeRaw': 1., 'finishOrder': 0, 'startDelayTime': .03,
                     'lastSpurtStartDistance': 10., 'runningStyle': 2, 'gutsOrder': 0, 'wizOrder': 0}],
        'frames': [{'t': t, 'horses': [{'pos': pos, 'speed': 3.001, 'hp': hp+.2, 'lane': .1,
                                      'temptationMode': 0, 'blockFrontHorseIndex': -1}]}
                   for t, pos, hp in ((0., 0., 1000), (timestamp, 1.25, 999))],
        'skillEvents': [], 'skillDetailEvents': [], 'skillTargetEvents': [],
        'competitionEvents': [], 'conservePowerEvents': [],
    }
    return capture, initial, modeled


class RuntimeGateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.engine = self.root / 'configured-test-engine'
        self.engine.write_bytes(b'trusted synthetic test identity')
        self.config = RuntimeConfig(self.engine, self.root, self.root,
                                    work_root=self.root/'work', cache_root=self.root/'cache')
        self.capture, self.initial, self.modeled = fixture()
        self.references = SimpleNamespace(identity={'fixture': 'immutable synthetic references v1'})

    def evaluate(self, modeled=None, audit=None, initial=True):
        audit = audit or {'status': 'ready', 'missingInputs': [], 'errors': []}
        prepared = self.initial if initial else None
        with patch.object(runtime.adapter.ReferenceData, 'load', return_value=self.references), \
             patch.object(runtime.adapter, 'prepare_capture', return_value=(prepared, audit)), \
             patch.object(runtime, '_run_worker', return_value=(copy.deepcopy(modeled if modeled is not None else self.modeled), .01, '')) as worker:
            result = evaluate_capture(self.capture, self.config)
        return result, worker.call_count

    def test_matching_recorded_fields_keep_modeled_distinct(self):
        result, calls = self.evaluate()
        self.assertEqual((result['status'], calls), ('verified', 1))
        self.assertIsNot(result['observed'], result['modeled'])
        self.assertEqual(result['capabilities']['hiddenState'], 'not_provided')
        self.assertTrue(result['comparison']['allComparedChecksPass'])

    def test_missing_context_does_not_start_worker(self):
        result, calls = self.evaluate(audit={'status': 'needs_input', 'missingInputs': ['courseId','grade'], 'errors': []}, initial=False)
        self.assertEqual((result['status'], calls), ('needs_input', 0))
        self.assertIsNone(result['modeled'])
        self.assertIsNotNone(result['observed'])

    def test_missing_capabilities_cannot_receive_verified(self):
        for key in ('skillEvents','skillDetailEvents','skillTargetEvents','competitionEvents','conservePowerEvents'):
            with self.subTest(key=key):
                modeled = copy.deepcopy(self.modeled)
                del modeled[key]
                result, _ = self.evaluate(modeled)
                self.assertEqual(result['status'], 'unsupported')
                self.assertFalse(result['comparison']['allComparedChecksPass'])
        for key in ('pos','speed','hp','lane','temptationMode','blockFrontHorseIndex'):
            with self.subTest(key=key):
                modeled = copy.deepcopy(self.modeled)
                del modeled['frames'][0]['horses'][0][key]
                result, _ = self.evaluate(modeled)
                self.assertEqual(result['status'], 'unsupported')
                self.assertFalse(result['comparison']['allComparedChecksPass'])

    def test_cached_modeled_output_is_compared_again(self):
        first, calls = self.evaluate()
        self.assertEqual((first['status'], calls), ('verified', 1))
        path = runtime._cache_path(self.config, first['cacheKey'])
        entry = expanded_entry(path)
        # Even an internally consistent altered cache entry cannot reuse the
        # previous verdict; there is deliberately no cached verdict to trust.
        entry['modeled']['frames'][1]['horses'][0]['pos'] += 1
        entry['modeledSha256'] = hashlib.sha256(runtime._canonical(entry['modeled'])).hexdigest()
        path.write_bytes(runtime._canonical(entry))
        second, calls = self.evaluate()
        self.assertEqual((second['status'], second['cacheHit'], calls), ('mismatch', True, 0))
        self.assertEqual(second['comparison']['frames']['fields']['pos']['mismatches'], 1)

    def test_engine_and_data_changes_invalidate_cache(self):
        first, _ = self.evaluate()
        self.engine.write_bytes(b'new configured executable identity')
        second, calls = self.evaluate()
        self.assertEqual(calls, 1)
        self.assertFalse(second['cacheHit'])
        self.assertNotEqual(first['cacheKey'], second['cacheKey'])
        self.references = SimpleNamespace(identity={'fixture': 'different immutable reference snapshot'})
        third, calls = self.evaluate()
        self.assertEqual(calls, 1)
        self.assertNotEqual(second['cacheKey'], third['cacheKey'])

    def test_default_legacy_profile_is_rejected_before_worker(self):
        self.initial.pop('experimentalRetailRuntime')
        result, calls = self.evaluate()
        self.assertEqual((result['status'], calls), ('unsupported', 0))

    def test_corrupt_compressed_replay_is_structured_failure(self):
        self.capture['race_scenario'] = base64.b64encode(b'not a compressed replay').decode()
        result, calls = self.evaluate()
        self.assertEqual((result['status'], calls), ('unsupported', 0))
        self.assertEqual(result['error']['code'], 'INVALID_CAPTURE')

    def test_malformed_typed_output_is_structured_failure(self):
        modeled = copy.deepcopy(self.modeled)
        modeled['frames'][0]['horses'][0]['pos'] = 'not a number'
        result, calls = self.evaluate(modeled)
        self.assertEqual((result['status'], calls), ('unsupported', 1))
        self.assertEqual(result['error']['code'], 'PROFILE_OR_OUTPUT_UNSUPPORTED')

    def test_unknown_layout_is_not_verified(self):
        raw = bytearray(zlib.decompress(base64.b64decode(self.capture['race_scenario'])))
        struct.pack_into('<i', raw, 4, 100000003)
        self.capture['race_scenario'] = base64.b64encode(zlib.compress(bytes(raw))).decode()
        result, calls = self.evaluate()
        self.assertEqual((result['status'], calls), ('unsupported', 0))
        self.assertEqual(result['error']['code'], 'UNSUPPORTED_REPLAY_LAYOUT')

    def test_binary_pin_is_enforced_and_attestation_is_explicit(self):
        self.config = replace(self.config, expected_engine_sha256='0'*64)
        result, calls = self.evaluate()
        self.assertEqual((result['status'], calls), ('engine_error', 0))
        self.assertEqual(result['error']['code'], 'ENGINE_PIN_MISMATCH')
        self.config = replace(self.config, expected_engine_sha256=hashlib.sha256(self.engine.read_bytes()).hexdigest())
        result, calls = self.evaluate()
        self.assertEqual((result['status'], calls), ('verified', 1))
        self.assertTrue(result['identities']['engine']['binaryPinVerified'])
        self.assertEqual(result['identities']['worker']['sourceRevision'], 'expected/not attested')


class WorkerBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def config(self, program, **limits):
        return RuntimeConfig(Path(sys.executable), self.root, self.root,
                             work_root=self.root/'work', engine_args=('-c', program), **limits)

    def test_nonzero_worker_exit(self):
        with self.assertRaises(runtime._WorkerFailure) as error:
            runtime._run_worker(self.config('import sys; sys.stdin.buffer.read(); sys.stderr.write("test failure"); sys.exit(7)'), b'{}\n')
        self.assertEqual(error.exception.code, 'ENGINE_EXIT')
        self.assertEqual(error.exception.details['exitCode'], 7)

    def test_timeout_without_reading_input(self):
        start = time.monotonic()
        with self.assertRaises(runtime._WorkerFailure) as error:
            runtime._run_worker(self.config('import time; time.sleep(30)', timeout_seconds=.1), b'x'*1000000)
        self.assertEqual(error.exception.code, 'TIMEOUT')
        self.assertLess(time.monotonic()-start, 5)

    def test_bounded_stdout_and_stderr(self):
        for stream in ('stdout', 'stderr'):
            with self.subTest(stream=stream), self.assertRaises(runtime._WorkerFailure) as error:
                program=f'import sys,time; sys.{stream}.write("x"*1000000); sys.{stream}.flush(); time.sleep(30)'
                runtime._run_worker(self.config(program, max_output_bytes=1024, max_stderr_bytes=1024, timeout_seconds=2), b'{}\n')
            self.assertEqual(error.exception.code, 'OUTPUT_LIMIT')


if __name__ == '__main__':
    unittest.main()
