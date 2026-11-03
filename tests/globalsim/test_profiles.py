"""Bundle upgrades must not relabel saved engine/data identities."""
from dataclasses import replace
from pathlib import Path
import json
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'desktop'))
from globalsim_bridge.adapter import ReferenceData
from globalsim_bridge.profiles import PROFILE_COMMITS
from globalsim_bridge.runtime import RuntimeConfig


class ProfileTests(unittest.TestCase):
    def test_latest_bundle_of_each_profile_keeps_its_recorded_data_fingerprint(self):
        manifest = ROOT / 'simulation/installed-bundles.json'
        if not manifest.exists(): self.skipTest('Packaged workers required')
        rows = [r for r in json.loads(manifest.read_bytes())['bundles']
                if r['kind'] == 'simulation' and r['profile'] in PROFILE_COMMITS]
        # Earlier local development artifacts may predate the current adapter's
        # skill-addition contract. Preserve the shipped v74 pin across upgrade.
        latest = {row['profile']: row for row in rows}
        for row in latest.values():
            with self.subTest(engine=row['engine_id']):
                refs = ReferenceData.load(ROOT / row['appRoot'], ROOT / row['resourceRoot'], row['profile'])
                self.assertEqual(refs.fingerprint, row['data_sha256'])
                self.assertEqual(refs.identity['expectedEngineCommit'], PROFILE_COMMITS[row['profile']])
                other = 'v74' if row['profile'] == 'v77' else 'v77'
                self.assertNotEqual(replace(refs, profile=other).fingerprint, refs.fingerprint)

    def test_unknown_profile_rejected_before_execution(self):
        with self.assertRaisesRegex(ValueError, 'Unsupported GlobalSim profile'):
            RuntimeConfig(Path('engine'), ROOT, ROOT, profile='v999')
