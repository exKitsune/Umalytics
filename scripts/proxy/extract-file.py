"""Offline sanitizer CLI for complete decoded response JSON; never sends traffic."""
import argparse
import json
from pathlib import Path
from race_extract import apply_race_times, apply_room_bindings, collect_race_times, collect_room_bindings, extract_races, remember_race_times, remember_room_bindings, saved_replay_route, stamp_race_clocks

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
times = []
remember_race_times(times, collect_race_times(payload, args.endpoint))
replay = saved_replay_route(args.endpoint)
stamp_race_clocks(races, None, replay)
apply_race_times(races, times)
stamp_race_clocks(races, None, replay)
apply_room_bindings(races, memory)
args.output.write_text(json.dumps(races), encoding='utf8')
print(f'Extracted {len(races)} race(s).')
