"""Application mapping, selected-entry jobs and queue bounds (synthetic only)."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
from race_evidence import map_evidence, capture_hash
from simulation_service import SimulationService, QueueFull, StaleAnalysis
from globalsim_bridge.versioning import select_compatibility
from test_versioning import registry as synthetic_registry
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/proxy'))
import race_extract

class CaptureTests(unittest.TestCase):
    def joined(self, definitions):
        memory=[]
        for definition in definitions:
            race_extract.remember_room_bindings(memory, race_extract.collect_room_bindings(
                {'data': {'random_seed': 73123, **definition}}))
        race={'_room_join': {'random_seed': 73123}}
        race_extract.apply_room_bindings([race],memory)
        return race

    def test_direct_setup_aliases_and_distance_conflicts(self):
        for alias in ('race_course_id','course_id'):
            joined=self.joined([{alias:10805,'race_distance':1600}])
            self.assertEqual(joined[alias],10805)
            self.assertEqual(joined['race_distance'],1600)
            self.assertNotIn('distance',joined)
            self.assertEqual(joined['metadata']['umaTrace']['courseSource'],'room-response')
            for conflict in ({alias:10801}, {'race_course_set':{'id':10801}},
                             {alias:10805,'race_distance':2400}):
                self.assertEqual(self.joined([{alias:10805,'race_distance':1600},conflict]),{})
        self.assertEqual(self.joined([{'race_course_id':10805,'course_id':10801}]),{})

    def test_candidate_precision_offset_and_viewer_build_are_observations(self):
        from test_course_capture import synthetic_replay
        raw=synthetic_replay(start_time='2026-10-17T20:01:02.125-04:00',game_build='viewer-build',server_region='global')
        captured=race_extract.extract_races({'data':raw},'/\x75mamusume/room_match/get_saved_race_result')[0]
        observations=captured['original_race']['observations']
        clock=next(row for row in observations if row['sourceField']=='start_time')
        self.assertEqual((clock['offset'],clock['precisionSeconds']),('-0400',0.001))
        self.assertEqual(clock['association']['kind'],'same-response-scenario')
        self.assertTrue(any(row['rawValue']=='viewer-build' for row in observations))
        evidence,_=map_evidence(captured,synthetic_registry())
        self.assertNotIn('gameBuild',evidence)
        self.assertNotIn('occurredAt',evidence)

class MappingTests(unittest.TestCase):
    def test_display_clocks_and_candidates_never_authorize(self):
        capture={'raced_at':'2000-02-02T00:00:00Z','raced_at_source':'capture','captured_at':'2000-02-02T00:00:00Z',
                 'original_race':{'schemaVersion':1,'observations':[{'sourceField':'save_time','rawValue':946684800,'unit':'unix-seconds'}]}}
        evidence,notes=map_evidence(capture,synthetic_registry())
        self.assertNotIn('occurredAt',evidence)
        self.assertTrue(notes)
        self.assertEqual(select_compatibility(capture_hash(capture),evidence,synthetic_registry())['mode'],'recorded_only')

    def test_offset_precision_and_sidecar_binding(self):
        registry=synthetic_registry()
        capture={'race':'synthetic'}
        sidecar={'schemaVersion':1,'captureSha256':capture_hash(capture),'facts':{
            'region':{'value':'synthetic-global','source':'independently-confirmed-original-race','reference':'test'},
            'mode':{'value':'practice','source':'independently-confirmed-original-race','reference':'test'},
            'occurredAt':{'value':'2000-02-02T01:00:00+01:00','precisionMicros':1000000,'source':'independently-confirmed-original-race','reference':'test'}}}
        evidence,_=map_evidence(capture,registry,sidecar)
        self.assertEqual(evidence['occurredAt'],'2000-02-02T00:00:00Z')
        sidecar['facts']['occurredAt']['value']='2000-02-29T23:59:59.500000Z'
        evidence,notes=map_evidence(capture,registry,sidecar)
        self.assertIn('invalidApplicationEvidence',evidence)
        self.assertIn('precision',notes[0])
        sidecar['captureSha256']='0'*64
        evidence,notes=map_evidence(capture,registry,sidecar)
        self.assertIn('invalidApplicationEvidence',evidence)
        self.assertIn('different capture',notes[0])

    def test_sidecar_cannot_erase_conflicting_captured_facts(self):
        capture={'originalRace':{'schemaVersion':1,'facts':{'gameBuild':{
            'value':'original','source':'upstream-original-race','reference':'synthetic'}}}}
        sidecar={'schemaVersion':1,'captureSha256':capture_hash(capture),'facts':{'gameBuild':{
            'value':'different','source':'independently-confirmed-original-race','reference':'synthetic'}}}
        evidence,notes=map_evidence(capture,synthetic_registry(),sidecar)
        self.assertIn('invalidApplicationEvidence',evidence)
        self.assertIn('conflicts',notes[0])

class JobTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);(self.root/'simulation').mkdir()
        self.registry={'schemaVersion':1,'registryId':'synthetic-empty','eras':[],'engines':[],'futureInferencePolicies':[]}
        (self.root/'simulation/engine-registry.json').write_text(json.dumps(self.registry))
        self.capture={'schemaVersion':1,'frames':[], 'runners':[], 'events':[]}
        outer=self
        class Store:
            data_dir=outer.root
            def races(self,limit,wanted):
                return [{'sha256':capture_hash(outer.capture),'data':[outer.capture]}]
        self.service=SimulationService(Store(),self.root);self.addCleanup(self.service.close)
        self.body={'expectedEntrySha256':capture_hash(self.capture)}

    def test_exact_singleton_and_no_engine_or_cache_for_unknown(self):
        with patch('simulation_service.evaluate_for_analysis', wraps=__import__('globalsim_bridge').evaluate_for_analysis) as gate, patch('globalsim_bridge.adapter.ReferenceData.load',side_effect=AssertionError('Forbidden references')):
            receipt=self.service.submit('synthetic~7',self.body)
            for _ in range(100):
                job=self.service.get('synthetic~7',receipt['jobId'])
                if job['phase']=='complete':break
                time.sleep(.01)
            self.assertEqual(gate.call_args.args[0],self.capture)
            self.assertEqual(job['report']['mode'],'recorded_only')
            self.assertNotIn('observed',job['report'])
            self.assertFalse((self.root/'cache').exists())
        with self.assertRaises(StaleAnalysis):self.service.get('other',receipt['jobId'])
        self.capture['changed']=True
        with self.assertRaises(StaleAnalysis):self.service.get('synthetic~7',receipt['jobId'])

    def test_active_dashboard_survives_more_than_eight_completed_jobs(self):
        first = self.service.submit('dashboard', self.body)
        for index in range(12):
            job = self.service.submit('background-' + str(index), self.body)
            for _ in range(100):
                if self.service.get('background-' + str(index), job['jobId'])['phase'] == 'complete':
                    break
                time.sleep(.01)
            self.assertEqual(self.service.get('dashboard', first['jobId'])['phase'], 'complete')

    def test_coalescing_bounded_queue_and_forbidden_options(self):
        entered=threading.Event();release=threading.Event()
        from globalsim_bridge import evaluate_for_analysis
        def delayed(*args,**kwargs):entered.set();release.wait(2);return evaluate_for_analysis(*args,**kwargs)
        with patch('simulation_service.evaluate_for_analysis',side_effect=delayed):
            first=self.service.submit('first',self.body);self.assertTrue(entered.wait(1))
            self.assertEqual(first['jobId'],self.service.submit('first',self.body)['jobId'])
            self.service.submit('second',self.body)
            with self.assertRaises(QueueFull):self.service.submit('third',self.body)
            release.set()
        for key in ('enginePath','registry','evidence','command','profile'):
            with self.assertRaises(ValueError):self.service.submit('first',{**self.body,key:'untrusted'})

    def test_queued_policy_change_is_rejected_before_gateway_execution(self):
        entered=threading.Event();release=threading.Event();registries=[]
        from globalsim_bridge import evaluate_for_analysis
        def delayed(capture,registry,*args,**kwargs):
            registries.append(registry)
            if registry and not entered.is_set():entered.set();release.wait(2)
            return evaluate_for_analysis(capture,registry,*args,**kwargs)
        with patch('simulation_service.evaluate_for_analysis',side_effect=delayed):
            self.service.submit('first',self.body);self.assertTrue(entered.wait(1))
            second=self.service.submit('second',self.body)
            changed={**self.registry,'registryId':'changed-while-queued'}
            (self.root/'simulation/engine-registry.json').write_text(json.dumps(changed))
            release.set()
            for _ in range(100):
                if self.service.jobs[second['jobId']]['phase']=='complete':break
                time.sleep(.01)
            self.assertEqual(sum(bool(registry) for registry in registries),1)
            self.assertIn('before execution',self.service.jobs[second['jobId']]['report']['applicationEvidenceNotes'][0])

if __name__=='__main__':unittest.main()
