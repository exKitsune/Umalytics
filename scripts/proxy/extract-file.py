"""Offline sanitizer CLI for complete decoded response JSON; never sends traffic."""
import argparse
import json
from pathlib import Path
from race_extract import apply_room_bindings, collect_room_bindings, extract_races, remember_room_bindings

parser = argparse.ArgumentParser()
parser.add_argument('input', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--endpoint', default='')
args = parser.parse_args()
if args.input.stat().st_size > 64 * 1024 * 1024:
    parser.error('Input exceeds 64 MiB.')
payload = json.loads(args.input.read_text(encoding='utf8'))
races = extract_races(payload, args.endpoint)
memory = []
remember_room_bindings(memory, collect_room_bindings(payload))
apply_room_bindings(races, memory)
args.output.write_text(json.dumps(races), encoding='utf8')
print(f'Extracted {len(races)} race(s).')
