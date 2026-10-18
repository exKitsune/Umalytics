"""Read-only capture regression: original worker == patched off == patched on.

Accepts private captures locally; writes only hashes, verdicts and counts.
No tolerance changes, seed fitting, or recorded-outcome injection are permitted.
"""
import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
from globalsim_bridge.adapter import ReferenceData, prepare_capture, normalize_capture
from globalsim_bridge.comparator import compare_observations, decode_scenario
from globalsim_bridge.decision_trace import validate_trace


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--engine', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--capture', type=Path, action='append', default=[])
    parser.add_argument('--capture-dir', type=Path, help='Locate the seven unchanged handoff manifest fixtures')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    sources = [(path, None) for path in args.capture]
    if args.capture_dir:
        manifest = json.loads((ROOT / 'simulation/evidence/fixture-manifest.json').read_text())
        sources += [(args.capture_dir / case['captureFile'], case) for case in manifest['cases']]
    if not sources:
        parser.error('Supply at least one capture or the manifest capture directory.')
    references = ReferenceData.load(ROOT, args.source)
    environment = {k:v for k,v in os.environ.items() if not k.startswith('GLOBALSIM_')}
    environment['GLOBALSIM_OUTPUT'] = 'json'

    def run(engine, initial, traced=False):
        start=time.monotonic()
        request={**initial, **({'decisionTrace':True,'traceConservePower':True} if traced else {})}
        process=subprocess.run([str(engine.resolve())], input=json.dumps(request)+'\n', text=True,
            capture_output=True, timeout=90, env=environment, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        assert process.returncode==0, process.stderr[:1000]
        return json.loads(process.stdout), time.monotonic()-start, len(process.stdout.encode())

    rows=[]
    for capture, expected in sources:
        original=capture.read_bytes()
        original_hash=hashlib.sha256(original).hexdigest()
        if expected: assert original_hash==expected['captureSha256'], 'Original capture changed'
        raw=json.loads(original)
        initial,audit=prepare_capture(raw,references)
        row={'fixture':capture.stem.rsplit('-',1)[-1], 'originalFileSha256':original_hash}
        if initial is None:
            row.update(status=audit['status'],engineExecuted=False)
        else:
            input_hash=hashlib.sha256(json.dumps(initial,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
            if expected: assert input_hash==expected['previousCanonicalInputSha256'], 'Prepared setup changed'
            baseline,_,_=run(args.baseline,initial)
            off,_,_=run(args.engine,initial)
            on,seconds,size=run(args.engine,initial,True)
            trace=on.pop('decisionTrace')
            power=on.pop('conservePowerDiagnostics')
            assert on.pop('conservePowerDiagnosticVersion')==1
            assert len(power)==len(initial['horses'])
            assert all(isinstance(row['timeline'],list) for row in power)
            assert baseline==off==on, 'Observation instrumentation changed race output'
            assert validate_trace(trace,len(initial['horses'])) is None
            for event in trace['events']:
                data=event['data']
                if event['kind'] in ('skill-activated','effect-applied','condition','initial-stats'):
                    assert event['horseIndex'] is not None, 'Runner identity was lost in a constructor scope'
                if event['kind']=='skill-wit':
                    assert (data['roll'] is None) == (not data['checked'])
                    assert data['passed'] == (not data['checked'] or data['roll'] < data['threshold'])
                if event['kind']=='spurt-roll':
                    assert data['passed'] == (data['roll'] < data['threshold'])
            normalized=normalize_capture(raw)
            comparison=compare_observations(decode_scenario(normalized['race_scenario']),on,initial,normalized)
            kinds=Counter(event['kind'] for event in trace['events'])
            row.update(preparedInputSha256=input_hash,baselineEqualsOffEqualsOn=True,
                status='verified' if comparison['allComparedChecksPass'] else 'mismatch',traceComplete=True,
                events=len(trace['events']),motion=len(trace['motion']),spurtRolls=kinds['spurt-roll'],
                witChecks=kinds['skill-wit'],bytes=size,seconds=round(seconds,3))
        if expected: assert row['status']==expected['expectedStatus']
        assert capture.read_bytes()==original, 'Original capture was modified'
        rows.append(row)
        print(json.dumps(row),flush=True)
    result={'schemaVersion':1, 'originalArtifactSha256':hashlib.sha256(args.baseline.read_bytes()).hexdigest(),
        'tracedArtifactSha256':hashlib.sha256(args.engine.read_bytes()).hexdigest(),'fixtures':rows}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':
    main()
