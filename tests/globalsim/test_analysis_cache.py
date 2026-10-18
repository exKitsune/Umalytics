"""User cache controls cover both stores without exposing simulator writes."""
import base64
import gzip
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
from analysis_cache import AnalysisCache


class SharedCacheControlsTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.cache = AnalysisCache(self.root)
        self.sim = self.root / 'cache/globalsim' / ('a'*64) / 'globalsim-modeled-v1' / ('b'*64+'.json')
        self.sim.parent.mkdir(parents=True)
        self.sim.write_bytes(b'{}')
        self.cache.update({'action':'put', 'key':'c'*64, 'raceId':'synthetic',
            'revision':'d'*64, 'date':'2000-01-01T00:00:00Z',
            'payload':base64.b64encode(gzip.compress(b'synthetic inference')).decode()})

    def test_inventory_and_purge_include_simulation_without_deleting_originals(self):
        (self.root/'races').mkdir()
        race = self.root/'races/kept.json';race.write_bytes(b'original')
        secret = self.root/'simulation-cache.key';secret.write_bytes(b'k'*32)
        status = self.cache.read()
        self.assertEqual(len(status['entries']),2)
        self.assertEqual(status['bytes'],self.cache.path.stat().st_size+2)
        self.assertFalse(any('_path' in row for row in status['entries']))
        self.assertIsNone(self.cache.read('b'*64)['payload'])
        self.assertEqual(self.cache.update({'action':'purge'})['entries'],[])
        self.assertFalse(self.sim.exists())
        self.assertEqual(race.read_bytes(),b'original')
        self.assertEqual(secret.read_bytes(),b'k'*32)

    def test_count_and_disk_limits_share_a_budget(self):
        status = self.cache.update({'action':'policy','policy':{'mode':'races','value':1,'background':False}})
        self.assertEqual(len(status['entries']),1)
        self.assertEqual(status['entries'][0]['revision'],'simulation-v1')
        self.sim.write_bytes(b'x'*(2*1024*1024))
        status = self.cache.update({'action':'policy','policy':{'mode':'size','value':1,'background':False}})
        self.assertEqual(status['entries'],[])
        self.assertLessEqual(status['bytes'],1024*1024)


if __name__ == '__main__':
    unittest.main()
