"""Catalog refresh is data-only, daily, restart-safe and offline-tolerant."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
from catalog_data import CatalogData, DAY, RETRY, MANIFEST, download


def raw(value):
    return json.dumps(value).encode()


class FakeCatalog:
    def __init__(self):
        self.calls = []
        self.fail = False
        self.manifest = {name: 'abcdef12' for name in ('skills', 'characters', 'character-cards', 'support-cards')}
        self.rows = {
            'characters': [{'char_id': 1099, 'name_en': 'Hokko Tarumae'}],
            'character-cards': [{'card_id': 109901, 'title_en_gl': '[Starry Lightship]',
                                 'release_en': '2026-10-24', 'url_name': '109901-hokko-tarumae'}],
            'support-cards': [{'support_id': 30172, 'char_id': 1044, 'rarity': 3,
                               'type': 'intelligence', 'char_name': 'Sweep Tosho', 'url_name': '30172-sweep-tosho'}],
            'skills': [{'id': 100991, 'rarity': 3, 'name_en': 'Test unique', 'loc': {'en': {}},
                        'char': [109901], 'condition_groups': [{'condition': 'phase==2', 'base_time': 50000,
                                                             'effects': [{'type': 21, 'value': 3500}]}]}],
        }

    def fetch(self, url, limit):
        self.calls.append(url)
        if self.fail:
            raise OSError('Synthetic offline failure')
        if url == MANIFEST:
            return raw(self.manifest)
        name = url.rsplit('/', 1)[1].split('.')[0]
        return raw(self.rows[name])


class CatalogRefresh(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name) / 'catalog'
        self.now = 1700000000
        self.remote = FakeCatalog()
        self.metadata = {'characters': {}, 'outfits': {}, 'skillNames': {}, 'skills': {}}
        self.catalog = self.create()

    def create(self):
        return CatalogData(self.folder, self.metadata, fetch=self.remote.fetch, clock=lambda: self.now)

    def test_daily_manifest_check_skips_unchanged_files_and_survives_restart(self):
        self.assertTrue(self.catalog.check())
        value = self.catalog.snapshot()
        self.assertEqual(value['career']['outfitGlobalReleases']['109901'], '2026-10-24')
        self.assertEqual(value['career']['skillOwners']['100991'], [109901])
        self.assertEqual(len(self.remote.calls), 5)
        self.assertFalse(self.catalog.check())
        restored = self.create()
        self.assertEqual(restored.snapshot(), value)
        self.assertFalse(restored.check())
        self.now += DAY
        self.assertTrue(restored.check())
        self.assertEqual(len(self.remote.calls), 6, 'Only the manifest downloads when revisions are unchanged')
        self.assertEqual(restored.snapshot()['revision'], value['revision'])
        self.assertEqual(restored.snapshot()['updatedAt'], value['updatedAt'])
        self.assertNotEqual(restored.snapshot()['checkedAt'], value['checkedAt'])

    def test_offline_failure_keeps_last_good_data_and_throttles_restart_retry(self):
        self.catalog.check()
        before = (self.folder / 'current.json').read_bytes()
        original = self.catalog.snapshot()
        self.remote.fail = True
        self.now += DAY
        self.assertFalse(self.catalog.check())
        self.assertEqual((self.folder / 'current.json').read_bytes(), before)
        failed = self.catalog.snapshot()
        self.assertEqual(failed['fallback'], original['fallback'])
        self.assertEqual(failed['revision'], original['revision'])
        self.assertIn('last available', failed['error'])
        restored = self.create()
        calls = len(self.remote.calls)
        self.assertFalse(restored.check())
        self.assertEqual(len(self.remote.calls), calls)
        self.now += RETRY
        self.remote.fail = False
        self.assertTrue(restored.check())
        self.assertIsNone(restored.snapshot()['error'])

    def test_incomplete_or_invalid_update_is_never_activated(self):
        self.catalog.check()
        before = (self.folder / 'current.json').read_bytes()
        self.now += DAY
        self.remote.manifest['character-cards'] = 'abcdef13'
        self.remote.rows['character-cards'][0]['release_en'] = '2026-02-31'
        self.assertFalse(self.catalog.check())
        self.assertEqual((self.folder / 'current.json').read_bytes(), before)
        self.now += RETRY
        self.remote.rows['character-cards'][0]['release_en'] = '2026-10-24'
        self.remote.rows['skills'][0]['loc'] = []
        self.assertFalse(self.catalog.check(), 'Unexpected catalog shape remains a recoverable failure')
        self.assertEqual((self.folder / 'current.json').read_bytes(), before)

    def test_corrupt_cache_recovers_without_mutating_engine_definitions(self):
        original = {'name': 'Installed', 'branches': [{'condition': 'original', 'effects': []}]}
        self.metadata['skills']['100991'] = deepcopy(original)
        self.catalog = self.create()
        self.catalog.check()
        self.assertNotIn('100991', self.catalog.snapshot()['fallback']['skills'])
        self.assertEqual(self.metadata['skills']['100991'], original)
        (self.folder / 'current.json').write_bytes(b'{broken')
        restored = self.create()
        self.assertIsNone(restored.snapshot()['fallback'])
        self.assertTrue(restored.check())
        self.assertEqual(restored.snapshot()['career']['outfitGlobalReleases']['109901'], '2026-10-24')

    def test_changed_installed_base_rebuilds_catalog_even_with_same_remote_revision(self):
        self.catalog.check()
        self.metadata['skills']['100991'] = {'name': 'Now installed', 'description': 'Installed definition'}
        restored = self.create()
        self.assertTrue(restored.check())
        self.assertNotIn('100991', restored.snapshot()['fallback']['skills'])
        self.assertEqual(len(self.remote.calls), 10)

    def test_rejects_external_urls_and_stops_on_close(self):
        for url in ('https://evil.example/data/skills.json', 'https://gametora.com/redirect',
                    'https://gametora.com/data/\u0075mamusume/skills.../secret.json'):
            with self.assertRaisesRegex(ValueError, 'Unknown catalog resource'):
                download(url, 1024)
        self.catalog.close()
        self.assertFalse(self.catalog.check())
        self.assertEqual(self.remote.calls, [])

    def test_snapshot_is_detached_from_internal_cache(self):
        self.catalog.check()
        snapshot = self.catalog.snapshot()
        snapshot['career']['outfitGlobalReleases']['109901'] = None
        self.assertEqual(self.catalog.snapshot()['career']['outfitGlobalReleases']['109901'], '2026-10-24')


if __name__ == '__main__':
    unittest.main()
