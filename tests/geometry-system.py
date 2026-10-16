"""Run the actual extraction CLI against an explicitly supplied installed cache."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--bundled', type=Path, default=ROOT / 'public/data/course-geometry.json')
    args = parser.parse_args()
    output = ROOT / '.cache/geometry-system-tests' / uuid.uuid4().hex
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/extract-course-geometry.py'),
        '--cache', str(args.cache.resolve()), '--output', str(output),
        '--reference', str(ROOT / 'public/data/courses.json')], cwd=ROOT,
        capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError('Extraction CLI failed: ' + result.stderr[-2000:])
    actual = json.loads((output / 'course-geometry.json').read_text(encoding='utf-8'))
    expected = json.loads(args.bundled.read_text(encoding='utf-8'))
    actual['source'].pop('extractedAt', None)
    expected['source'].pop('extractedAt', None)
    if actual != expected:
        raise RuntimeError('Whole-process extraction differs from bundled geometry.')
    report = json.loads((output / 'geometry-extraction-report.json').read_text(encoding='utf-8'))
    if report['failures'] or report['missingCached']:
        raise RuntimeError('The cache is missing assets or an asset could not be parsed.')
    print(f"System check passed: {len(actual['courses'])} courses, {len(actual['paths'])} paths; exact bundled output, excluding timestamp.")
    print('Only the explicitly supplied cache was read; game files were not modified.')


if __name__ == '__main__':
    main()
