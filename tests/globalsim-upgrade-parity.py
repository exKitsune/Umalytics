"""Compare an untouched upstream worker with the local tracing port, offline."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
from globalsim_bridge.decision_trace import validate_trace, expand_trace


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--engine', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.source / 'tools'))
    from validation_runner import Worker
    from check_accuracy_regressions import check_strict
    fixtures = sorted((args.source / 'tests/fixtures/accuracy').glob('*.json.gz'))
    assert fixtures
    rows = []
    with tempfile.TemporaryFile() as log, Worker([str(args.baseline.resolve())], log, output='json', timeout=90) as base, \
            Worker([str(args.engine.resolve())], log, output='json', timeout=90) as port:
        def exchange(worker, spec):
            return json.loads(worker.exchange((json.dumps(spec, separators=(',', ':')) + '\n').encode()))

        for fixture in fixtures:
            case = json.loads(gzip.decompress(fixture.read_bytes()))
            spec = dict(case['input'], retainAllFrames=True)
            expected = exchange(base, spec)
            assert exchange(port, spec) == expected, (case['name'], 'trace-off changed output')
            traced = exchange(port, dict(spec, decisionTrace=True))
            trace = traced.pop('decisionTrace')
            assert traced == expected, (case['name'], 'trace-on changed output')
            assert validate_trace(trace, len(spec['horses'])) is None, case['name']
            trace = expand_trace(trace)
            assert any(e['kind'] == 'skill-wit' for e in trace['events']) or not any(h['skills'] for h in spec['horses'])
            audit = check_strict(case['expected'], expected, dense_frames=True, spec=spec)
            rows.append(dict(case=case['name'], fixtureSha256=hashlib.sha256(fixture.read_bytes()).hexdigest(),
                             traceParity=True, observationsPass=audit['passed'],
                             events=len(trace['events']), motion=len(trace['motion'])))
            print(json.dumps(rows[-1]), flush=True)

        # Exercise both cached initializers, reused skill data and thread-local
        # sessions. An error between trace requests must not leak observations.
        case = json.loads(gzip.decompress(fixtures[0].read_bytes()))
        spec = dict(case['input'], retainAllFrames=True, decisionTrace=True)
        first = exchange(port, spec)
        for _ in range(3):
            assert exchange(port, spec) == first, 'Prepared trace differs from first request'
        assert 'error' in exchange(port, dict(spec, seed=2**40))
        assert exchange(port, spec) == first, 'Trace leaked across failed request'
        for threads in (1, 2):
            batch = dict(spec, seeds=[spec['seed']] * 3, threads=threads)
            assert exchange(port, batch) == first, 'Seed batch trace differs'
            for _ in range(2):
                assert json.loads(port.exchange(b'')) == first, 'Seed batch trace differs'
        assert 'decisionTrace' not in exchange(port, dict(spec, decisionTrace=False))
    report = dict(schemaVersion=1, upstreamCommit='95f1416fb8c130dd2ef4b53c3b8277c6ba4c8055',
                  baselineSha256=hashlib.sha256(args.baseline.read_bytes()).hexdigest(),
                  engineSha256=hashlib.sha256(args.engine.read_bytes()).hexdigest(),
                  cases=rows, repeatedAndBatchedTraceParity=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
