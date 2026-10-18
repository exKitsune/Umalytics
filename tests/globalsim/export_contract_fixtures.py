"""Export actual gateway responses using synthetic Python unit-test fixtures.

No GlobalSim or inference engine runs. These fixtures establish no actual
release dates or supported race era. Run from any working directory, e.g.:
  python -B tests/export_contract_fixtures.py --output /tmp/gate-fixtures.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_analysis_gate import AnalysisGateTests


def export_fixtures():
    case = AnalysisGateTests()
    case.setUp()
    try:
        results = {
            'verified': case.evaluate()[0],
            'inference': case.evaluate(diagnostic=case.diagnostic('mismatch'))[0],
        }
        for name, era in [('old', 'old'), ('unknown', None), ('future_unsupported', 'future')]:
            results[name] = case.evaluate(era)[0]
        case.registry['allowUnknownVersionSimulation'] = True
        case.registry['unknownVersionSimulators'] = [{k:v for k,v in case.registry['engines'][0].items() if k not in ('kind','eraIds')}]
        results['trial'] = case.evaluate(None)[0]
        del case.registry['allowUnknownVersionSimulation']
        del case.registry['unknownVersionSimulators']
        case.future_policy()
        results['future_inference'] = case.evaluate('future')[0]
        case.registry['engines'][0]['eraIds'].append('future')
        results['mixed_verified'] = case.evaluate('future')[0]
        for result in results.values():
            result.pop('observed', None)
            if result.get('simulation'):
                result['simulation'].pop('observed', None)
                result['simulation'].pop('modeled', None)
        return results
    finally:
        case.doCleanups()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    encoded = json.dumps(export_fixtures(), ensure_ascii=False, allow_nan=False, indent=2) + '\n'
    if args.output:
        args.output.write_text(encoded, encoding='utf-8')
    else:
        print(encoded, end='')
