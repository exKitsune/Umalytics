"""Real HTTP -> production gate -> pinned process -> fresh comparison.

Requires an installed simulator and one known matching local capture. All era
coverage/facts are SYNTHETIC, in disposable copies only; no production support
claim is made. Spies count real calls, never replace computation or results.
"""
import argparse
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import time
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
from globalsim_bridge import runtime
from globalsim_bridge.adapter import ReferenceData
from service import LocalServer, make_handler

spec = importlib.util.spec_from_file_location('fixture', ROOT / 'tests/versioned-service-fixture.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', type=Path, required=True)
    parser.add_argument('--engine', required=True, help='Installed simulator ID, not an executable path')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    original = args.capture.read_bytes()
    source_registry = (ROOT / 'simulation/engine-registry.json').read_bytes()
    installed = json.loads((ROOT / 'simulation/installed-bundles.json').read_text())
    bundle = next(b for b in installed['bundles'] if b['kind'] == 'simulation' and b['engine_id'] == args.engine)
    inference = next(b for b in reversed(installed['bundles']) if b['kind'] == 'inference')
    traced = bundle.get('decisionTraceSchema') == 'umalytics-decisions-v1'
    checks = {}
    with tempfile.TemporaryDirectory(prefix='sim-http-', dir=ROOT / '.cache') as folder:
        root = Path(folder)
        for row in (bundle, inference):
            relative = Path(row['artifact']).parent
            shutil.copytree(ROOT / relative, root / relative)
        (root / 'simulation/installed-bundles.json').write_text(json.dumps({'schemaVersion': 1, 'bundles': [bundle, inference]}))
        registry = {'schemaVersion': 1, 'registryId': 'synthetic-http-test-only',
            'eras': [{'eraId': 'test', 'sequence': 1, 'region': 'global', 'modes': ['practice'],
                      'reference': 'SYNTHETIC; no real compatibility assertion',
                      'window': {'from': '2000-01-01T00:00:00Z', 'until': '2001-01-01T00:00:00Z'}}],
            'engines': [{'engineId': row['engine_id'], 'version': row['version'], 'profile': row['profile'],
                'kind': row['kind'], 'identity': {'artifactSha256': row['artifact_sha256'], 'dataSha256': row['data_sha256']},
                'region': 'global', 'modes': ['practice'], 'eraIds': ['test'],
                'reference': 'SYNTHETIC coverage of real installed artifacts'} for row in (bundle, inference)],
            'futureInferencePolicies': []}
        registry_path = root / 'simulation/engine-registry.json'
        registry_path.write_text(json.dumps(registry))
        store = fixture.Store(root)
        capture = json.loads(original)
        assert isinstance(capture, dict)
        unknown = deepcopy(capture)
        for key in ('originalRace', 'original_race'):
            unknown.pop(key, None)
        capture = deepcopy(unknown)
        capture['original_race'] = {'schemaVersion': 1, 'facts': {
            key: {'value': value, 'source': 'independently-confirmed-original-race',
                  'reference': 'SYNTHETIC TEST ONLY', **({'precisionMicros': 1000000} if key == 'occurredAt' else {})}
            for key, value in {'region': 'global', 'mode': 'practice', 'occurredAt': '2000-06-01T00:00:00Z'}.items()}}
        (store.inbox / 'selected.json').write_text(json.dumps([unknown, capture]))
        (store.inbox / 'unknown.json').write_text(json.dumps(unknown))
        server = LocalServer(('127.0.0.1', 0), make_handler(store))
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        opener = build_opener(ProxyHandler({}))

        def request(path, body=None):
            req = Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                headers={'Origin': base, 'Content-Type': 'application/json', 'X-UmaTrace-CSRF': store.csrf})
            with opener.open(req, timeout=10) as response:
                return json.load(response)

        def begin(race_id='selected~1'):
            stored = request('/api/races/' + race_id)
            route = '/api/simulation/races/' + race_id
            job = request(route, {'expectedEntrySha256': stored['sha256']})
            for _ in range(300):
                job = request(route + '?jobId=' + job['jobId'])
                if job['phase'] == 'complete':
                    return job
                time.sleep(.1)
            raise AssertionError('Real simulator HTTP job timed out')

        def stale(job):
            try:
                request('/api/simulation/races/selected~1?jobId=' + job['jobId'] + '&include=payloads')
            except HTTPError as error:
                assert error.code == 409
            else:
                raise AssertionError('Stale simulated details were exposed')

        try:
            with patch.object(runtime, '_run_worker', wraps=runtime._run_worker) as worker, \
                 patch.object(runtime, 'compare_observations', wraps=runtime.compare_observations) as compare:
                cold = begin()
                report = cold['report']
                assert report['mode'] == 'verified_simulation', json.dumps({key: value for key, value in report.items() if key not in ('observed', 'simulation')})
                assert worker.call_count == compare.call_count == 1
                assert worker.call_args.args[0].engine_path == (root / bundle['artifact']).resolve()
                sim = report['simulation']
                assert not sim['cacheHit'] and sim['timing']['engineSeconds'] > 0
                assert sim['identities']['engine']['sha256'] == bundle['artifact_sha256']
                assert 'modeled' not in sim and 'observed' not in report
                details = request('/api/simulation/races/selected~1?jobId=' + cold['jobId'] + '&include=payloads')
                assert details['report']['simulation']['modeled']
                checks['realProcessAndComparedDetails'] = True
                warm = begin()
                assert warm['report']['mode'] == 'verified_simulation'
                assert warm['report']['simulation']['cacheHit']
                expected_workers = 1
                expected_comparisons = 2
                assert worker.call_count == expected_workers and compare.call_count == expected_comparisons
                checks['cachedOutputComparedAgain'] = True
                if traced:
                    assert details['report']['simulation']['capabilities']['hiddenState'] == 'simulated_trace'
                    assert details['report']['simulation']['modeled']['decisionTrace']['complete']
                # A new service instance has no jobs or in-memory model cache.
                from simulation_service import SimulationService
                store.simulation.close()
                store.simulation = SimulationService(store, root)
                restarted = begin()
                expected_comparisons += 1
                assert restarted['report']['mode'] == 'verified_simulation'
                assert restarted['report']['simulation']['cacheHit']
                assert worker.call_count == expected_workers and compare.call_count == expected_comparisons
                assert request('/api/analysis-cache')['entries']
                warm = restarted
                checks['savedAnalysisSurvivesRestart'] = True
                cache_before = {p: p.read_bytes() for p in (store.data_dir / 'cache/globalsim').rglob('*.json')}
                with patch.object(ReferenceData, 'load', side_effect=AssertionError('Unknown race loaded model references')):
                    assert begin('unknown')['report']['mode'] == 'recorded_only'
                assert worker.call_count == expected_workers and compare.call_count == expected_comparisons
                assert cache_before == {p: p.read_bytes() for p in (store.data_dir / 'cache/globalsim').rglob('*.json')}
                checks['unknownNoModelAccessWithoutTrialPolicy'] = True
                if traced:
                    registry['allowUnknownVersionSimulation'] = True
                    registry_path.write_text(json.dumps(registry))
                    trial = begin('unknown')
                    assert trial['report']['mode'] == 'verified_simulation'
                    assert trial['report']['compatibility']['mode'] == 'simulation_trial'
                    assert trial['report']['simulation']['capabilities']['hiddenState'] == 'simulated_trace'
                    assert not trial['report']['permissions']['inferenceExecutionPlan']
                    expected_workers += 1
                    expected_comparisons += 1
                    assert worker.call_count == expected_workers and compare.call_count == expected_comparisons
                    checks['unknownTrialMatchesWithoutInference'] = True
                    del registry['allowUnknownVersionSimulation']
                    registry_path.write_text(json.dumps(registry))
                # Mutate only the disposable bundle: reject old authorization
                # and decline execution even when a matching cache exists.
                with (root / bundle['artifact']).open('ab') as stream:
                    stream.write(b'changed-test-artifact')
                stale(warm)
                fallback = begin()
                assert fallback['report']['mode'] == 'inference_plan'
                assert worker.call_count == expected_workers and compare.call_count == expected_comparisons
                auth = request('/api/simulation/races/selected~1/inference', {'jobId': fallback['jobId']})
                assert auth['authorized']
                checks['tamperedSimulatorDeniedEligibleInferenceRetained'] = True
                registry['registryId'] = 'changed-test-policy'
                registry_path.write_text(json.dumps(registry))
                stale(fallback)
                checks['policyChangeRevokesDetails'] = True
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
            store.simulation.executor.shutdown(wait=True, cancel_futures=True)
    assert args.capture.read_bytes() == original
    assert (ROOT / 'simulation/engine-registry.json').read_bytes() == source_registry
    result = {'schemaVersion': 1, 'syntheticCoverageOnly': True, 'captureSha256': hashlib.sha256(original).hexdigest(),
              'simulatorArtifactSha256': bundle['artifact_sha256'], 'originalAndProductionRegistryUnchanged': True, 'checks': checks}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
