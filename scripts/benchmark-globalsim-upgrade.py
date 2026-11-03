"""Warm, alternating worker benchmark with identical fixtures and seed lists."""
import argparse
from contextlib import ExitStack
import gzip
import hashlib
import json
from pathlib import Path
import statistics
import sys
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--before', type=Path, required=True)
    parser.add_argument('--after', type=Path, required=True)
    parser.add_argument('--v74', type=Path, required=True)
    parser.add_argument('--count', type=int, default=12)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.source / 'tools'))
    from validation_runner import Worker
    from replay_protocol import decode
    engines = {'v74': args.v74, 'ported': args.before, 'optimized': args.after}
    variants = [(name, mode) for name in engines for mode in ('compact', 'trace')]
    variants.append(('optimized', 'outcome'))
    records = []
    fixtures = ['additional-bonus-on-final-skill-tick', 'leader-gap-duration-rounding', 'pacemaker-handover-refresh-1800-a']
    for name in fixtures:
        fixture = args.source / f'tests/fixtures/accuracy/{name}.json.gz'
        original = json.loads(gzip.decompress(fixture.read_bytes()))['input']
        measurements = {key: [] for key in variants}
        sizes = {key: [] for key in variants}
        with ExitStack() as stack:
            log = stack.enter_context(tempfile.TemporaryFile())
            workers = {key: stack.enter_context(Worker([str(engines[key[0]].resolve())], log, timeout=90)) for key in variants}
            for iteration in range(-2, args.count):
                # Two warmups; alternate order to limit temperature/order bias.
                order = variants if iteration % 2 == 0 else list(reversed(variants))
                results = {}
                for key in order:
                    engine, mode = key
                    spec = dict(original, seed=original['seed'] + max(0, iteration),
                                decisionTrace=mode == 'trace', retainAllFrames=mode == 'trace')
                    if mode == 'outcome': spec['omitFrames'] = True
                    wire = (json.dumps(spec, separators=(',', ':')) + '\n').encode()
                    start = time.perf_counter()
                    reply = workers[key].exchange(wire)
                    elapsed = time.perf_counter() - start
                    value = decode(reply).to_json_value()
                    assert 'error' not in value, value
                    results[key] = value['results']
                    if iteration >= 0:
                        measurements[key].append(elapsed * 1000)
                        sizes[key].append(len(reply))
                assert results['optimized', 'compact'] == results['optimized', 'outcome'] == results['optimized', 'trace']
                assert results['ported', 'compact'] == results['optimized', 'compact']
        for key in variants:
            row = dict(fixture=name, engine=key[0], mode=key[1], count=args.count,
                       medianMs=statistics.median(measurements[key]),
                       meanBytes=statistics.mean(sizes[key]))
            records.append(row)
            print(json.dumps(row), flush=True)
    report = dict(schemaVersion=1, method='Persistent binary-v1 workers; two warmups; alternating order; fixed consecutive seeds; median includes pipe transfer and protocol validation.',
                  engines={k: hashlib.sha256(v.read_bytes()).hexdigest() for k,v in engines.items()}, cases=records,
                  optimizedOutcomeResultsIdentical=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__': main()
