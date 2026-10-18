"""Synthetic production-version gates; no simulator or inference engine executes.

All dates, eras, engine bundles, and rule mappings below are artificial test
fixtures. They establish no release cutoff or compatibility for a real race.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
from globalsim_bridge import analysis_gate as gate
from globalsim_bridge.runtime import RuntimeConfig
from test_runtime import fixture as synthetic_replay_fixture


def digest(value):
    return hashlib.sha256(gate._canonical(value)).hexdigest()


class AnalysisGateTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.engine = self.root / 'synthetic-never-executed-engine'
        self.engine.write_bytes(b'Synthetic pinned worker fixture; never executable')
        self.engine_hash = hashlib.sha256(self.engine.read_bytes()).hexdigest()
        self.data = {'kind': 'synthetic immutable simulator reference identity'}
        self.data_hash = digest(self.data)
        self.capture, _, _ = synthetic_replay_fixture()
        self.capture['race_category'] = 'practice'
        self.capture['random_seed'] = 42
        self.config = RuntimeConfig(self.engine, self.root, self.root, cache_root=self.root/'cache',
                                    expected_engine_sha256=self.engine_hash)
        self.simulator = gate.SimulatorBinding('sim-current', 'synthetic-1', 'synthetic-profile',
                                               self.engine_hash, self.data_hash, self.config)
        self.inference = gate.InferenceBinding('infer-current', 'synthetic-1', 'synthetic-profile',
                                               'a'*64, 'b'*64)
        self.simulator_bindings = {self.simulator.engine_id: self.simulator}
        self.inference_bindings = {self.inference.engine_id: self.inference}
        self.registry = {'schemaVersion': 1, 'registryId': 'synthetic-test-registry',
                         'eras': [], 'engines': [], 'futureInferencePolicies': []}
        for sequence, name in enumerate(('old', 'current', 'future')):
            self.registry['eras'].append({'eraId': name, 'sequence': sequence,
                'region': 'global', 'modes': ['practice'], 'reference': 'SYNTHETIC era, no real release date',
                'window': {'from': f'{2020+sequence}-01-01T00:00:00+00:00',
                           'until': f'{2021+sequence}-01-01T00:00:00+00:00'}})
        for kind, binding in (('simulation', self.simulator), ('inference', self.inference)):
            self.registry['engines'].append({**binding.as_identity(), 'kind': kind,
                'region': 'global', 'modes': ['practice'], 'eraIds': ['current'],
                'reference': 'SYNTHETIC registered bundle, never installed as an app engine'})

    def evidence(self, era='current'):
        out = {'schemaVersion': 1, 'captureSha256': digest(self.capture), 'region': 'global', 'mode': 'practice'}
        if era is not None:
            out['occurredAt'] = {'old':'2020-06-01T00:00:00+00:00',
                                 'current':'2021-06-01T00:00:00+00:00',
                                 'future':'2022-06-01T00:00:00+00:00'}[era]
        out['provenance'] = {key: {'source': 'independently-confirmed-original-race',
            'reference': 'SYNTHETIC initial-version evidence'} for key in out if key not in ('schemaVersion', 'captureSha256')}
        return out

    def future_policy(self):
        self.registry['futureInferencePolicies'] = [{'policyId': 'synthetic-future-policy',
            'region': 'global', 'modes': ['practice'], 'inferenceEngineId': self.inference.engine_id,
            'afterEraId': 'current', 'eraIds': ['future'],
            'reference': 'SYNTHETIC explicit future policy; no real compatibility claim',
            'notice': 'Synthetic policy: the older inference model may differ from these newer rules.'}]

    def diagnostic(self, status='verified', cache_hit=False):
        return {'schemaVersion':1, 'status':status, 'verificationScope':'recorded_observations_v1',
            'captureSha256':digest(self.capture), 'raceScenarioSha256':hashlib.sha256(self.capture['race_scenario'].encode()).hexdigest(),
            'inputSha256':'c'*64, 'cacheKey':'d'*64, 'cacheHit':cache_hit,
            'identities': {'engine': {'sha256':self.engine_hash, 'expectedSha256':self.engine_hash,
                'binaryPinVerified':True, 'argumentsSha256':digest(())}, 'data':self.data},
            'inputAudit':None, 'observed':None, 'modeled':{},
            'comparison':{'allComparedChecksPass':status=='verified'},
            'error':None, 'warnings':[], 'timing':{'totalSeconds':0},
            'capabilities': {**{key:'verified' for key in gate.COMPARED_CAPABILITIES}, 'hiddenState':'not_provided'}}

    def evaluate(self, era='current', *, diagnostic=None, registry=None, inference=True, context=None):
        with patch.object(gate.adapter.ReferenceData, 'load', return_value=SimpleNamespace(identity=self.data)) as refs, \
             patch.object(gate.runtime, 'evaluate_capture', return_value=diagnostic or self.diagnostic()) as runtime:
            result = gate.evaluate_for_analysis(self.capture, self.registry if registry is None else registry,
                self.simulator_bindings, evidence=self.evidence(era), context=context,
                inference_bindings=self.inference_bindings if inference else {})
        return result, refs.call_count, runtime.call_count

    def revalidate(self, plan, era='future', **changes):
        args = {'evidence':self.evidence(era), 'measured_artifact_sha256':self.inference.artifact_sha256,
                'measured_data_sha256':self.inference.data_sha256, **changes}
        return gate.revalidate_inference_plan(plan, self.capture, self.registry, self.inference_bindings, **args)

    def test_old_unknown_future_and_unconfigured_gate_touch_no_model_resources(self):
        for era, registry in (('old', self.registry), (None, self.registry), ('future', self.registry),
                              ('current', {})):
            with self.subTest(era=era, registryEmpty=not registry), \
                 patch.object(gate.adapter.ReferenceData, 'load', side_effect=AssertionError('No reference access')) as refs, \
                 patch.object(gate, '_file_sha', side_effect=AssertionError('No executable access')) as files, \
                 patch.object(gate.runtime, 'evaluate_capture', side_effect=AssertionError('No diagnostic bypass')) as runtime, \
                 patch.object(gate.runtime, '_read_cache', return_value=self.diagnostic()) as cache, \
                 patch.object(gate.runtime, '_run_worker', side_effect=AssertionError('No worker')) as worker:
                report = gate.evaluate_for_analysis(self.capture, registry, self.simulator_bindings,
                    evidence=self.evidence(era), inference_bindings=self.inference_bindings)
                self.assertEqual(report['mode'], 'recorded_only')
                self.assertEqual(report['replayStatus'], 'available')
                self.assertIsNotNone(report['observed'])
                self.assertIsNone(report['simulation'])
                self.assertIsNone(report['inferencePlan'])
                self.assertFalse(report['permissions']['unversionedInference'])
                self.assertTrue(any(n['code']=='RECORDED_ONLY' and n['persistent'] for n in report['notices']))
                for mocked in (refs, files, runtime, cache, worker):
                    mocked.assert_not_called()

    def test_compatible_verified_simulator_is_scoped_and_cache_still_gated(self):
        report, _, calls = self.evaluate(diagnostic=self.diagnostic(cache_hit=True))
        self.assertEqual((report['mode'], calls), ('verified_simulation', 1))
        self.assertTrue(report['simulation']['cacheHit'])
        self.assertTrue(report['permissions']['simulatedRecordedCapabilities'])
        self.assertFalse(report['permissions']['inferenceExecutionPlan'])
        self.assertFalse(report['permissions']['unversionedInference'])
        self.assertEqual(report['binding']['captureSha256'], digest(self.capture))

    def test_absent_evidence_is_unknown_without_invented_original_race_fields(self):
        with patch.object(gate.adapter.ReferenceData, 'load') as refs, \
             patch.object(gate.runtime, 'evaluate_capture') as runtime:
            report = gate.evaluate_for_analysis(self.capture, self.registry, self.simulator_bindings,
                inference_bindings=self.inference_bindings)
        self.assertEqual(report['mode'], 'recorded_only')
        self.assertEqual(report['compatibility']['evidenceStatus'], 'unknown')
        self.assertIn('ORIGINAL_RACE_SCOPE_UNKNOWN', report['compatibility']['noticeCodes'])
        self.assertNotIn('INVALID_ORIGINAL_RACE_EVIDENCE', report['compatibility']['noticeCodes'])
        self.assertEqual(report['replayStatus'], 'available')
        refs.assert_not_called()
        runtime.assert_not_called()

    def test_simulator_mismatch_or_failure_uses_only_registered_inference(self):
        for status in ('mismatch', 'engine_error', 'unsupported', 'needs_input'):
            with self.subTest(status=status):
                report, _, _ = self.evaluate(diagnostic=self.diagnostic(status))
                self.assertEqual(report['mode'], 'inference_plan')
                self.assertEqual(report['inferencePlan']['engine'], self.inference.as_identity())
                self.assertEqual(report['inferencePlan']['executionStatus'], 'not_executed')
                self.assertFalse(report['inferencePlan']['provisional'])
                self.assertFalse(report['permissions']['simulatedRecordedCapabilities'])
                blocked, _, _ = self.evaluate(diagnostic=self.diagnostic(status), inference=False)
                self.assertEqual(blocked['mode'], 'recorded_only')

    def test_explicit_replay_fallback_allows_unknown_rules_without_claiming_compatibility(self):
        self.registry['allowReplayInference'] = True
        self.registry['replayInference'] = self.inference.as_identity()
        for era in (None, 'old', 'future'):
            report, _, calls = self.evaluate(era)
            self.assertEqual(report['mode'], 'inference_plan')
            self.assertEqual(calls, 0)
            plan = report['inferencePlan']
            self.assertTrue(plan['provisional'])
            self.assertEqual(plan['provisionalPolicy']['kind'], 'replay-analysis')
            self.assertTrue(any(n['code']=='PROVISIONAL_REPLAY_INFERENCE' for n in report['notices']))
            self.assertFalse(report['permissions']['unversionedInference'])
            self.assertTrue(self.revalidate(plan, era)['authorized'])
            self.assertFalse(self.revalidate(plan, era, measured_artifact_sha256='f'*64)['authorized'])
        self.registry['replayInference']['identity']['artifactSha256'] = 'e'*64
        report, _, _ = self.evaluate(None)
        self.assertEqual(report['mode'], 'recorded_only')

    def test_old_race_can_only_choose_an_explicit_historical_inference_bundle(self):
        historical = gate.InferenceBinding('infer-old', 'synthetic-old', 'historical-profile', 'e'*64, 'f'*64)
        self.registry['engines'].append({**historical.as_identity(), 'kind':'inference',
            'region':'global', 'modes':['practice'], 'eraIds':['old'], 'reference':'SYNTHETIC historical implementation'})
        report, refs, calls = self.evaluate('old')
        self.assertEqual((report['mode'], refs, calls), ('recorded_only', 0, 0))
        self.inference_bindings[historical.engine_id] = historical
        report, refs, calls = self.evaluate('old')
        self.assertEqual((report['mode'], refs, calls), ('inference_plan', 0, 0))
        self.assertEqual(report['inferencePlan']['engine']['engineId'], 'infer-old')

    def test_mismatched_registered_bundle_or_data_stops_before_runtime_cache(self):
        self.simulator_bindings[self.simulator.engine_id] = replace(self.simulator, profile='wrong-profile')
        report, refs, calls = self.evaluate(inference=False)
        self.assertEqual((report['mode'], refs, calls), ('recorded_only', 0, 0))
        self.simulator_bindings[self.simulator.engine_id] = self.simulator
        self.data = {'kind':'changed data identity'}
        report, _, calls = self.evaluate(inference=False)
        self.assertEqual((report['mode'], calls), ('recorded_only', 0))

    def test_future_inference_is_explicit_warned_and_requires_actual_identity(self):
        self.future_policy()
        report, refs, calls = self.evaluate('future')
        self.assertEqual((report['mode'], refs, calls), ('inference_plan', 0, 0))
        plan = report['inferencePlan']
        self.assertTrue(plan['provisional'])
        for notices in (plan['notices'], report['notices']):
            warning = next(n for n in notices if n['code']=='PROVISIONAL_FUTURE_INFERENCE')
            self.assertTrue(warning['persistent'])
            self.assertEqual(warning['severity'], 'warning')
        allowed = self.revalidate(plan)
        self.assertTrue(allowed['authorized'])
        self.assertFalse(allowed['executionPerformed'])
        self.assertEqual(allowed['plan'], plan)
        self.assertFalse(self.revalidate(plan, measured_artifact_sha256=None)['authorized'])
        self.assertFalse(self.revalidate(plan, measured_data_sha256='0'*64)['authorized'])

    def test_cached_provisional_plan_loses_authorization_if_notice_or_selection_changes(self):
        self.future_policy()
        report, _, _ = self.evaluate('future')
        plan = report['inferencePlan']
        changed = deepcopy(plan)
        changed['notices'] = []
        self.assertFalse(self.revalidate(changed)['authorized'])
        self.assertFalse(self.revalidate(plan, era='current')['authorized'])
        self.assertFalse(self.revalidate(plan, context={'unrelated':'changed context'})['authorized'])
        self.capture['random_seed'] += 1
        self.assertFalse(self.revalidate(plan)['authorized'])
        self.capture['random_seed'] -= 1
        self.registry['futureInferencePolicies'] = []
        self.assertFalse(self.revalidate(plan)['authorized'])

    def test_mixed_exact_simulator_and_provisional_inference_prefers_simulator(self):
        self.future_policy()
        self.registry['engines'][0]['eraIds'].append('future')
        report, _, calls = self.evaluate('future')
        self.assertEqual((report['mode'], calls), ('verified_simulation', 1))
        self.assertFalse(any(n['code']=='PROVISIONAL_FUTURE_INFERENCE' for n in report['notices']))
        report, _, calls = self.evaluate('future', diagnostic=self.diagnostic('mismatch'))
        self.assertEqual((report['mode'], calls), ('inference_plan', 1))
        self.assertTrue(report['inferencePlan']['provisional'])
        self.assertTrue(any(n['code']=='PROVISIONAL_FUTURE_INFERENCE' and n['persistent'] for n in report['notices']))

    def test_diagnostic_verified_without_full_identity_and_capabilities_cannot_authorize_simulation(self):
        for defect in ('identity', 'capability', 'capture'):
            with self.subTest(defect=defect):
                diagnostic = self.diagnostic()
                if defect == 'identity':
                    diagnostic['identities'] = {}
                elif defect == 'capability':
                    diagnostic['capabilities']['skillEvents'] = 'unavailable'
                else:
                    diagnostic['captureSha256'] = '0'*64
                report, _, _ = self.evaluate(diagnostic=diagnostic, inference=False)
                self.assertEqual(report['mode'], 'recorded_only')
                self.assertFalse(report['permissions']['simulatedRecordedCapabilities'])

    def test_malformed_unicode_replay_stays_structured_and_touches_no_runtime(self):
        with patch.object(gate.adapter.ReferenceData, 'load') as refs, \
             patch.object(gate.runtime, 'evaluate_capture') as runtime:
            report = gate.evaluate_for_analysis({'race_scenario':'\ud800'}, {}, {})
        self.assertEqual(report['mode'], 'recorded_only')
        self.assertEqual(report['replayStatus'], 'unavailable')
        self.assertIsNotNone(report['error'])
        refs.assert_not_called()
        runtime.assert_not_called()

    def test_observed_singleton_wrappers_keep_outer_hash_and_reject_ambiguous_entries(self):
        for wrapper in ({'data':self.capture}, {'data':[self.capture]}, {'schemaVersion':1, 'races':[self.capture]}):
            with self.subTest(wrapper=list(wrapper)):
                report = gate.evaluate_for_analysis(wrapper, {}, {})
                self.assertEqual(report['mode'], 'recorded_only')
                self.assertEqual(report['replayStatus'], 'available')
                self.assertEqual(report['binding']['captureSha256'], digest(wrapper))
                self.assertNotEqual(report['binding']['captureSha256'], digest(self.capture))
        ambiguous = {'data':[self.capture, deepcopy(self.capture)]}
        report = gate.evaluate_for_analysis(ambiguous, {}, {})
        self.assertEqual(report['replayStatus'], 'unavailable')
        self.assertEqual(report['error']['code'], 'RECORDED_REPLAY_AMBIGUOUS')


if __name__ == '__main__':
    unittest.main()
