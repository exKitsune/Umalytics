"""Developer benchmark for repeated seed experiments; never publishes analysis.

Validate the original replay once, prepare its fixed inputs once, then measure
independent seeds through a bounded worker. Compact runs omit decision tracing
and full-frame retention, so they cannot replace a verified dashboard trace.
"""
import argparse
import json
from pathlib import Path
import random
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
from globalsim_bridge import adapter, runtime
from globalsim_bridge.worker_pool import WorkerPool


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture', type=Path)
    parser.add_argument('--count', type=int, default=100)
    parser.add_argument('--seed', type=int, default=1729, help='Reproducible seed-list seed')
    parser.add_argument('--include-trace', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if not 1 <= args.count <= 10000:
        parser.error('--count must be between 1 and 10000')
    manifest = json.loads((ROOT / 'simulation/installed-bundles.json').read_text())
    bundle = next(row for row in reversed(manifest['bundles']) if row['kind'] == 'simulation' and row.get('decisionTraceSchema'))
    pool = WorkerPool()
    config = runtime.RuntimeConfig(ROOT / bundle['artifact'], ROOT / bundle['appRoot'], ROOT / bundle['resourceRoot'],
        expected_engine_sha256=bundle['artifact_sha256'], decision_trace_schema=bundle['decisionTraceSchema'],
        worker_pool=pool, worker_protocol=bundle.get('workerProtocol', 'json'), work_root=ROOT / '.cache/seed-benchmark')
    try:
        capture = json.loads(args.capture.read_text(encoding='utf-8-sig'))
        baseline = runtime.evaluate_capture(capture, config)
        if baseline['status'] != 'verified':
            raise ValueError('Original race must match before benchmarking seed experiments: ' + str(baseline['error'] or baseline['status']))
        refs = adapter.ReferenceData.load(config.umalytics_root, config.globalsim_root)
        initial, audit = adapter.prepare_capture(capture, refs)
        if initial is None or audit['status'] != 'ready':
            raise ValueError('Initial setup unavailable')
        rng = random.Random(args.seed)
        seeds = rng.sample(range(-(2**31), 2**31), args.count)
        times, results = [], []
        started = time.perf_counter()
        for index, seed in enumerate(seeds):
            request = {**initial, 'seed': seed, 'retainAllFrames': args.include_trace,
                       'decisionTrace': args.include_trace, 'traceConservePower': args.include_trace}
            tick = time.perf_counter()
            modeled, _, _ = runtime._run_worker(config, runtime._canonical(request) + b'\n')
            if 'error' in modeled:
                raise ValueError(modeled['error'])
            times.append(time.perf_counter() - tick)
            results.append({'seed': seed, 'results': modeled['results']})
            if (index + 1) % 25 == 0:
                print(f'{index + 1}/{args.count} independent seeds complete', file=sys.stderr, flush=True)
        elapsed = time.perf_counter() - started
        # Repeating the original seed after other races must recover its result.
        original, _, _ = runtime._run_worker(config, runtime._canonical({**initial, 'decisionTrace': True, 'traceConservePower': True}) + b'\n')
        if original != baseline['modeled']:
            raise AssertionError('Simulator state leaked between seed runs')
        compact, _, _ = runtime._run_worker(config, runtime._canonical({**initial, 'retainAllFrames': False,
            'decisionTrace': False, 'traceConservePower': False}) + b'\n')
        if compact['results'] != baseline['modeled']['results']:
            raise AssertionError('Compact output changed race results')
        for index in {0, len(seeds) - 1}:
            traced, _, _ = runtime._run_worker(config, runtime._canonical({**initial, 'seed': seeds[index],
                'decisionTrace': True, 'traceConservePower': True}) + b'\n')
            if traced['results'] != results[index]['results']:
                raise AssertionError('Seed result differs between compact and traced runs')
        report = {'kind': 'seed-experiment-benchmark', 'verifiedOriginal': True, 'repeatOriginalIdentical': True, 'compactResultsIdentical': True,
            'engineSha256': bundle['artifact_sha256'], 'count': args.count, 'includeTrace': args.include_trace,
            'seconds': elapsed, 'racesPerSecond': args.count / elapsed, 'medianMs': statistics.median(times) * 1000,
            'p95Ms': sorted(times)[min(len(times) - 1, int(.95 * len(times)))] * 1000,
            'seedListSeed': args.seed}
        if args.output:
            args.output.write_text(json.dumps({**report, 'runs': results}, separators=(',', ':')), encoding='utf-8')
        print(json.dumps(report, indent=2))
    finally:
        pool.close()


if __name__ == '__main__':
    main()
