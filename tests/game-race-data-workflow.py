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
from game_race_data import GameRaceData, master_candidates
from service import Service


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

    def test_bundled_and_explicit_capture_values_win(self):
        base = json.dumps({'raceInstances': {'678901': 10606}, 'raceInstanceConditions': {'678901': {'grade': 1, 'time': 1}}}).encode()
        value = json.loads(self.reader.metadata(base))
        self.assertEqual(value['raceInstances']['678901'], 10606)
        self.assertEqual(value['raceInstanceConditions']['678901'], {'grade': 1, 'time': 1})
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


if __name__ == '__main__':
    unittest.main()
