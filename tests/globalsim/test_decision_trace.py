"""Synthetic policy/trace integrity tests, without asserting real era dates."""
from copy import deepcopy
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
from globalsim_bridge import versioning
from globalsim_bridge.decision_trace import MOTION_COLUMNS, SCHEMA, validate_trace
from test_versioning import registry, evidence, CAPTURE_SHA
from simulation_service import SimulationService
import test_runtime as runtime_tests


def trace():
    row = [0.] * len(MOTION_COLUMNS)
    row[0], row[1], row[3], row[15] = 1, .0666, .0666, -1
    return dict(schema=SCHEMA, complete=True, dropped=0, observations=2, motionColumns=MOTION_COLUMNS,
        motion=[row], events=[dict(sequence=1, lastSequence=1, tick=0, lastTick=0,
        time=0., lastTime=0., count=1, horseIndex=0, stage='initialization', skillId='1', detail=0,
        kind='skill-wit', data={'checked':True,'roll':99.,'threshold':80.,'passed':False})])


class TrialPolicyTests(unittest.TestCase):
    def setUp(self):
        self.reg = registry()
        self.reg['allowUnknownVersionSimulation'] = True
        self.reg['unknownVersionSimulators'] = [{k:v for k,v in self.reg['engines'][0].items() if k not in ('kind','eraIds')}]

    def test_unknown_trial_does_not_authorize_inference_or_claim_known_version(self):
        decision = versioning.select_compatibility(CAPTURE_SHA, evidence(None), self.reg)
        self.assertEqual(decision['mode'], 'simulation_trial')
        self.assertEqual(decision['evidenceStatus'], 'unknown')
        self.assertIsNone(decision['matchedEraId'])
        self.assertFalse(decision['inference']['eligible'])
        self.assertTrue(decision['simulation']['eligible'])
        selected = [row for row in decision['engineEligibility'] if row['engineId'] == decision['simulation']['engineId']]
        self.assertEqual(len(selected), 1)
        self.assertTrue(selected[0]['eligible'])
        self.assertEqual(selected[0]['reasonCodes'], ['UNKNOWN_VERSION_REPLAY_TRIAL'])

    def test_trial_cannot_relabel_a_registered_artifact(self):
        self.reg['unknownVersionSimulators'][0]['identity'] = {'artifactSha256':'c'*64,'dataSha256':'d'*64}
        decision = versioning.select_compatibility(CAPTURE_SHA, evidence(None), self.reg)
        self.assertEqual(decision['evidenceStatus'], 'invalid')
        self.assertFalse(decision['simulation']['eligible'])

    def test_packaged_trial_supports_the_actual_capture_modes(self):
        service = SimulationService(None, Path(__file__).resolve().parents[2])
        self.addCleanup(service.executor.shutdown)
        manifest = {'schemaVersion':1, 'bundles':[{
            'kind':'simulation','profile':'v74','decisionTraceSchema':SCHEMA,
            'engine_id':'test-trace','version':'test','artifact_sha256':'a'*64,'data_sha256':'d'*64}]}
        with patch('simulation_service.read_json', side_effect=[self.reg, manifest]), patch.object(Path, 'exists', return_value=True):
            configured, _ = service.config()
        for mode in ('practice','team-trials','champions-meeting'):
            decision = versioning.select_compatibility(CAPTURE_SHA, evidence(None,region='global',mode=mode), configured)
            self.assertEqual(decision['mode'], 'simulation_trial')

    def test_invalid_conflicting_and_known_older_rules_never_use_unknown_trial(self):
        for ev in (evidence('1999-12-15T00:00:00Z'), evidence('2000-04-15T00:00:00Z'),
                   evidence('2000-01-15T00:00:00Z'), evidence('2000-02-15T00:00:00Z',rulesetId='synthetic-rules-0'),
                   evidence(None,region='different-region'), evidence(None,mode='different-mode'),
                   {**evidence(None),'captureSha256':'a'*64}):
            with self.subTest(ev=ev):
                decision = versioning.select_compatibility(CAPTURE_SHA, ev, self.reg)
                self.assertNotEqual(decision['mode'], 'simulation_trial')
                self.assertFalse(decision['simulation']['eligible'])

    def test_known_coverage_takes_precedence_and_trial_can_be_disabled(self):
        self.assertEqual(versioning.select_compatibility(CAPTURE_SHA,evidence(),self.reg)['mode'],'compatible')
        self.reg['allowUnknownVersionSimulation']=False
        self.assertEqual(versioning.select_compatibility(CAPTURE_SHA,evidence(None),self.reg)['mode'],'recorded_only')


class TraceValidationTests(unittest.TestCase):
    def test_schema_order_runner_and_completeness(self):
        self.assertIsNone(validate_trace(trace(),1))
        mutations = [lambda t:t.update(complete=False), lambda t:t.update(dropped=1),
            lambda t:t.update(observations=3), lambda t:t['motion'][0].__setitem__(15,1),
            lambda t:t['motion'][0].__setitem__(19,float('nan')),
            lambda t:t['events'][0].update(count=2), lambda t:t['events'][0].update(horseIndex=1),
            lambda t:t['events'][0].update(horseIndex=float('inf')),
            lambda t:t.update(motion=[]), lambda t:t.update(schema='unknown')]
        for mutate in mutations:
            value=deepcopy(trace());mutate(value)
            self.assertIsNotNone(validate_trace(value,1))


class TracedRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.fixture=runtime_tests.RuntimeGateTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.config=replace(self.fixture.config,decision_trace_schema=SCHEMA,
            expected_engine_sha256=hashlib.sha256(self.fixture.engine.read_bytes()).hexdigest())
        self.root,self.modeled,self.evaluate=self.fixture.root,self.fixture.modeled,self.fixture.evaluate

    def test_trace_is_authorized_only_after_matching_and_validating(self):
        model=deepcopy(self.modeled);model['decisionTrace']=trace()
        report,calls=self.evaluate(model)
        self.assertEqual(report['capabilities']['hiddenState'],'simulated_trace')
        model['frames'][1]['horses'][0]['pos']+=10
        self.assertEqual(self.evaluate(model)[0]['capabilities']['hiddenState'],'not_provided')
        model=deepcopy(self.modeled);model['decisionTrace']=trace();model['decisionTrace']['complete']=False
        self.assertEqual(self.evaluate(model)[0]['capabilities']['hiddenState'],'not_provided')

    def test_hidden_decisions_are_reexecuted_not_trusted_from_disk(self):
        model=deepcopy(self.modeled);model['decisionTrace']=trace()
        first,_=self.evaluate(model)
        self.assertEqual(first['capabilities']['hiddenState'],'simulated_trace')
        second,calls=self.evaluate(model)
        self.assertEqual(calls,1)
        self.assertFalse(second['cacheHit'])
        self.assertEqual(list(self.root.rglob('*.json')),[])
