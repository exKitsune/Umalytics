import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
from sandbox_service import SandboxService


class CapabilityTests(unittest.TestCase):
    def test_uses_verified_installed_data_not_web_export_inventory(self):
        service = SandboxService.__new__(SandboxService)
        bundle = dict(engine_id='engine', version='v74', profile='v74', artifact_sha256='a', data_sha256='b')
        config = SimpleNamespace(umalytics_root=Path('app'), globalsim_root=Path('engine'))
        with patch.object(service, 'installed', return_value=(bundle, config)), patch('engine_skill_catalog.ReferenceData.load', return_value=SimpleNamespace(skill_data={'200012':{'rarity':1}, '100011':{'rarity':5}, '202251':{'alternatives':[{'condition':'is_dirtgrade==1'}]}})) as load:
            result = service.capabilities()
            load.assert_called_once_with(config.umalytics_root, config.globalsim_root)
        self.assertEqual(result['skillIds'], ['100011', '200012', '202251'])
        self.assertEqual(result['engine'], bundle)
        self.assertEqual(result['unavailableSkills'], {})

    def test_missing_engine_does_not_claim_support(self):
        service = SandboxService.__new__(SandboxService)
        with patch.object(service, 'installed', side_effect=ValueError('not installed')):
            self.assertEqual(service.capabilities(), {'available':False, 'skillIds':[], 'error':'not installed'})
