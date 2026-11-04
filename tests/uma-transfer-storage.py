"""Exercise real library import, SQLite persistence, restart, and validation."""
import json
from pathlib import Path
import sys
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from sandbox_service import SandboxService

folder = Path(sys.argv[1])
(folder / 'data').mkdir()
payload = json.loads((folder / 'import.json').read_bytes())
store = SandboxService(SimpleNamespace(data_dir=folder / 'data'))
try:
    store.save({'collection': 'umas', 'action': 'import', 'records': payload['umas'], 'folders': payload['folders']})
finally:
    store.close()
store = SandboxService(SimpleNamespace(data_dir=folder / 'data'))
try:
    saved = store.library()
    (folder / 'saved.json').write_text(json.dumps(saved))
    before = len(saved['umas'])
    invalid = {**saved['umas'][0], 'exportContext': {'strategy': 'invalid'}}
    try:
        store.save({'collection': 'umas', 'action': 'import', 'records': [invalid]})
        raise AssertionError('Malformed context was accepted')
    except ValueError:
        pass
    assert len(store.library()['umas']) == before
finally:
    store.close()
