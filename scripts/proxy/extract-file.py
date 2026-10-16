"""Offline sanitizer CLI for complete decoded response JSON; never sends traffic."""
import argparse
import json
from pathlib import Path
from race_extract import extract_races

parser = argparse.ArgumentParser()
parser.add_argument('input', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--endpoint', default='')
args = parser.parse_args()
if args.input.stat().st_size > 64 * 1024 * 1024:
    parser.error('Input exceeds 64 MiB.')
races = extract_races(json.loads(args.input.read_text(encoding='utf8')), args.endpoint)
args.output.write_text(json.dumps(races), encoding='utf8')
print(f'Extracted {len(races)} race(s).')
