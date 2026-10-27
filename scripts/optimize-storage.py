"""Migrate an offline data directory. No race JSON or saved build is removed."""
import argparse
import json
from pathlib import Path
import sys
from urllib.request import ProxyHandler, build_opener
from urllib.error import URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from storage_maintenance import optimize, storage_bytes

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data-dir', required=True, type=Path)
parser.add_argument('--apply', action='store_true', help='Apply migration; otherwise report current bytes only.')
parser.add_argument('--keep-latest-dashboards', action='store_true', help='Discard older derived dashboard versions for identical source captures.')
parser.add_argument('--plain-run-summaries', action='store_true', help='Restore plain JSON summaries before using an older executable.')
parser.add_argument('--service-port', type=int, default=4317)
args = parser.parse_args()
root = args.data_dir.resolve(strict=True)
if args.apply:
    try:
        opener = build_opener(ProxyHandler({}))
        with opener.open(f'http://127.0.0.1:{args.service_port}/api/health', timeout=3) as response:
            health = json.load(response)
        if Path(health['dataDirectory']).resolve() == root:
            raise SystemExit('Exit Umalytics from the tray before optimizing its storage.')
    except (URLError, TimeoutError):
        pass
    print(json.dumps(optimize(root, args.keep_latest_dashboards, args.plain_run_summaries), indent=2))
else:
    print(json.dumps({'bytes': storage_bytes(root), 'applied': False}, indent=2))
