"""Real HTTP routes with isolated synthetic registry/storage; no installed app."""
import json
from pathlib import Path
import secrets
import sys
import threading

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
from service import Service, LocalServer, make_handler
from simulation_service import SimulationService

class Store:
    races = Service.races
    import_race = Service.import_race
    def __init__(self, root):
        self.data_dir = root / 'storage'
        self.inbox = self.data_dir / 'races'
        self.inbox.mkdir(parents=True, exist_ok=True)
        self.csrf = secrets.token_hex(32)
        self.lock = threading.RLock()
        self._race_metadata = {}
        self._summary_reference_key = None
        self.simulation = SimulationService(self, root)
    def summary_reference(self): return ({}, {})
    def summary_course(self, entry, reference): return {}

if __name__ == '__main__':
    store = Store(Path(sys.argv[1]))
    server = LocalServer(('127.0.0.1', 0), make_handler(store))
    print(json.dumps({'url': 'http://127.0.0.1:' + str(server.server_port), 'csrf': store.csrf}), flush=True)
    try:
        server.serve_forever()
    finally:
        store.simulation.close()
