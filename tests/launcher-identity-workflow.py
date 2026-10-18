"""Launcher installation identity; the full native smoke exercises the child."""
import hashlib
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
import service

with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    executable = root / 'service.exe'
    executable.write_bytes(b'synthetic runtime identity, not an executable')
    status = {'runtimeExecutable': str(executable), 'dataDirectory': str(root),
              'runtimeBuildSha256': hashlib.sha256(executable.read_bytes()).hexdigest()}
    with patch.object(sys, 'frozen', True, create=True), patch.object(sys, 'executable', str(executable)):
        service.validate_launcher_service(status, root)
        for key, value in [('runtimeExecutable', str(root / 'other.exe')),
                           ('dataDirectory', str(root / 'other-installation')),
                           ('runtimeBuildSha256', '0' * 64), ('runtimeBuildSha256', None)]:
            try:
                service.validate_launcher_service({**status, key: value}, root)
            except ValueError:
                pass
            else:
                raise AssertionError('Foreign/missing identity accepted: ' + key)
    with patch.object(sys, 'frozen', False, create=True):
        service.validate_launcher_service({'runtimeExecutable': str(root / 'python.exe')}, root)
        try:
            service.validate_launcher_service(status, root)
        except ValueError:
            pass
        else:
            raise AssertionError('Development launcher accepted an installed runtime')
print('Launcher identity checks passed.')
