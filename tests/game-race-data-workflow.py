"""Installed reference discovery, refresh, failure fallback and capture precedence."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from game_race_data import GameRaceData, master_candidates, merge_metadata
from engine_skill_catalog import EngineSkillCatalog
from service import Service
from simulation_service import SimulationService
from copy import deepcopy


class GameRaceDataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / 'LocalLow/\x43ygames/\x75mamusume/master/master.mdb'
        self.path.parent.mkdir(parents=True)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.executescript('''CREATE TABLE race_instance(id INTEGER, race_id INTEGER, time INTEGER);
                CREATE TABLE race(id INTEGER, course_set INTEGER, grade INTEGER);
                CREATE TABLE race_course_set(id INTEGER);
                CREATE TABLE private_account(secret TEXT);
                INSERT INTO private_account VALUES ('DO_NOT_EXPORT');
                INSERT INTO race_course_set VALUES (10701);
                INSERT INTO race VALUES (23,10701,100);
                INSERT INTO race_instance VALUES (678901,23,2);''')
        self.reader = GameRaceData(lambda: (self.path,))
        self.base = json.dumps({'raceInstances': {'42': 10606}, 'raceInstanceConditions': {}}).encode()

    def test_default_discovery_and_projection(self):
        with patch.dict(os.environ, {'LOCALAPPDATA': str(self.root / 'Local'), 'USERPROFILE': str(self.root / 'profile')}):
            self.assertEqual(master_candidates()[0], self.path)
            actual = GameRaceData().metadata(self.base)
        value = json.loads(actual)
        self.assertEqual(value['raceInstances']['678901'], 10701)
        self.assertEqual(value['raceInstanceConditions']['678901'], {'grade': 100, 'time': 2})
        self.assertEqual(value['installedGameRaceSource']['sha256'], hashlib.sha256(self.path.read_bytes()).hexdigest())
        self.assertNotIn('DO_NOT_EXPORT', actual.decode())
        self.assertNotIn(str(self.path), actual.decode())

    def test_refresh_and_missing_or_corrupt_database(self):
        original = self.reader.metadata(self.base)
        self.assertIs(self.reader.metadata(self.base), original)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('INSERT INTO race_instance VALUES (678902,23,3)')
        updated = json.loads(self.reader.metadata(self.base))
        self.assertEqual(updated['raceInstances']['678902'], 10701)
        self.path.write_bytes(b'not a database')
        self.assertEqual(self.reader.metadata(self.base), self.base)
        self.path.unlink()
        self.assertEqual(self.reader.metadata(self.base), self.base)

    def test_installed_lookup_and_explicit_capture_values_win(self):
        base = json.dumps({'raceInstances': {'678901': 10606}, 'raceInstanceConditions': {'678901': {'grade': 1, 'time': 1}}}).encode()
        value = json.loads(self.reader.metadata(base))
        self.assertEqual(value['raceInstances']['678901'], 10701)
        self.assertEqual(value['raceInstanceConditions']['678901'], {'grade': 100, 'time': 2})
        service = Service.__new__(Service)
        service.game_race_data = self.reader
        service.reference_data = type('Reference', (), {'assets': {'metadata.json': self.base,
            'courses.json': b'{"10701":{"distance":1200},"10606":{"distance":2400}}'}, 'status': {'manifestSha256': 'test'}})()
        service._summary_reference_key = None
        references = service.summary_reference()
        raw = {'race_instance_id': 678901}
        self.assertEqual(service.summary_course(raw, references)['courseId'], 10701)
        self.assertEqual(raw, {'race_instance_id': 678901})
        explicit = service.summary_course({**raw, 'race_course_id': 10606, 'distance': 2400}, references)
        self.assertEqual((explicit['courseId'], explicit['distance']), (10606, 2400))
        self.assertIsNone(service.summary_course({'race_instance_id': 999999}, references)['courseId'])
        key = service._summary_reference_key
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('INSERT INTO race_instance VALUES (678903,23,2)')
        references = service.summary_reference()
        self.assertNotEqual(service._summary_reference_key, key)
        self.assertEqual(service.summary_course({'race_instance_id': 678903}, references)['courseId'], 10701)

    def test_simulation_context_uses_only_preserved_facts(self):
        capture = {'race_horse_data_array': [], 'race_instance_id': 678901}
        original = deepcopy(capture)
        context = self.reader.context(capture)
        self.assertEqual({key: context[key] for key in ('courseId', 'grade', 'time')},
                         {'courseId': 10701, 'grade': 100, 'time': 2})
        self.assertIn(hashlib.sha256(self.path.read_bytes()).hexdigest(), context['provenance']['courseId']['reference'])
        self.assertEqual(capture, original)
        supplied = {'time': 3, 'provenance': {'time': {'source': 'user-confirmed', 'reference': 'fixture confirmation'}}}
        explicit = self.reader.context({**capture, 'race_course_id': 10606, 'race_grade': 800}, supplied)
        self.assertNotIn('courseId', explicit)
        self.assertNotIn('grade', explicit)
        self.assertEqual(explicit, supplied)
        portable = self.reader.context({'schemaVersion': 1, 'raceHorse': [], 'raceInstanceId': 678901,
                                        'courseId': 999999})
        self.assertEqual(portable['courseId'], 10701)  # Normalized UI values are not provenance.
        self.assertIsNone(self.reader.context({**capture, 'race_instance_id': 999999}))

    def test_public_metadata_overlay_is_hashed_and_preserves_pinned_definitions(self):
        projection = {**self.reader.read(), 'characters': {'7': 'New character'},
                      'skillNames': {'8': 'New skill'}, 'skills': {'8': {'name': 'New skill'}}}
        base = {'characters': {'7': 'Pinned character'}, 'skills': {}, 'skillNames': {}}
        merged = merge_metadata(base, projection)
        self.assertEqual(merged['characters']['7'], 'Pinned character')
        self.assertEqual(merged['skillNames']['8'], 'New skill')
        self.assertEqual(base['skills'], {})
        host = type('Host', (), {'data_dir': self.root})()
        catalog = EngineSkillCatalog(type('Simulation', (), {'service': host})())
        path = self.root / 'reference.json'
        path.write_text(json.dumps({'metadata': base, 'skillIds': []}))
        original = path.read_bytes()
        display, key = catalog.display_reference(path, None, projection)
        self.assertEqual(hashlib.sha256(display.read_bytes()).hexdigest(), key)
        self.assertEqual(json.loads(display.read_bytes())['metadata']['skillNames']['8'], 'New skill')
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(catalog.display_reference(path, None, projection), (display, key))

    def test_program_context_and_simulation_cache_refresh(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.executescript('CREATE TABLE single_mode_program(id INTEGER,race_instance_id INTEGER); INSERT INTO single_mode_program VALUES (77,678901);')
        context = self.reader.context({'race_horse_data_array': [], 'race_program_id': 77})
        self.assertEqual(context['raceInstanceId'], 678901)
        capture = {'race_horse_data_array': [], 'race_instance_id': 678901}
        host = type('Host', (), {'data_dir': self.root, 'inbox': self.root / 'races', 'game_race_data': self.reader})()
        simulation = SimulationService(host, self.root)
        self.addCleanup(simulation.close)
        simulation.selected = lambda *_: (capture, 'a' * 64)
        simulation.config = lambda: ({}, {'schemaVersion': 1, 'bundles': []})
        first = simulation.snapshot('fixture~0', None, None)
        self.assertIs(simulation.snapshot('fixture~0', None, None), first)
        self.assertIsNone(first['requested_context'])
        self.assertEqual(first['context']['time'], 2)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('UPDATE race_instance SET time=4')
        refreshed = simulation.snapshot('fixture~0', None, first['requested_context'])
        self.assertNotEqual(refreshed['identity'], first['identity'])
        self.assertEqual(refreshed['context']['time'], 4)


if __name__ == '__main__':
    unittest.main()
