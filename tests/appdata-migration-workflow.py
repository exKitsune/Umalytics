"""Run the native storage migration against disposable installations."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--harness', type=Path, required=True)
args = parser.parse_args()
FLAGS = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def inventory(folder):
    return {path.relative_to(folder).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in folder.rglob('*') if path.is_file()}


with tempfile.TemporaryDirectory(prefix='umalytics-appdata-') as temporary:
    root = Path(temporary).resolve()

    def scenario(name, content=None, existing=None):
        base = root / name
        source, target = base / 'install/Umalytics-data', base / 'local/Umalytics'
        for folder, entries in ((source, content or {}), (target, existing or {})):
            for relative, raw in entries.items():
                path = folder / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
        return source, target

    def run(source, target, ok=True):
        result = subprocess.run([str(args.harness.resolve()), '--migrate-storage', str(source)],
                                env=dict(os.environ, LOCALAPPDATA=str(target.parent)),
                                capture_output=True, check=True, creationflags=FLAGS, timeout=45)
        result = json.loads(result.stdout)
        assert result['ok'] == ok, result
        return result

    files = {'settings.json': b'{"collectionEnabled":true}', 'races/one.json': b'["saved race"]',
             'capture/umalytics-ca.pem': b'private identity fixture', 'exports/export.json': b'[1,2,3]',
             'cache/webview/Profile/browser.dat': b'browser profile', 'runtime/UmalyticsCollector.exe': b'old runtime',
             'data/metadata.json': b'{"skills":{}}', 'notes.txt': b'unknown user file',
             'races/non-ascii-日本語.json': b'{}'}
    source, target = scenario('complete', files)
    (source / 'empty/nested').mkdir(parents=True)
    before = inventory(source)
    run(source, target)
    assert not source.exists()
    assert (target / 'empty/nested').is_dir()
    assert {name: inventory(target)[name] for name in before} == before
    assert json.loads((target / 'storage-layout.json').read_text())['legacyMigrationComplete'] is True
    run(source, target)
    # Completed and fresh users must never re-import a stale adjacent folder.
    source.mkdir(parents=True)
    (source / 'settings.json').write_bytes(b'stale preferences')
    target_before = inventory(target)
    run(source, target)
    assert inventory(target) == target_before and (source / 'settings.json').read_bytes() == b'stale preferences'

    source, target = scenario('fresh')
    run(source, target)
    assert not source.exists() and (target / 'storage-layout.json').is_file()
    source.mkdir(parents=True)
    (source / 'ignored.txt').write_bytes(b'not imported later')
    run(source, target)
    assert not (target / 'ignored.txt').exists() and source.exists()

    source, target = scenario('resume', files, dict(list(files.items())[:3]))
    before = inventory(source)
    run(source, target)
    assert not source.exists() and all(inventory(target)[name] == value for name, value in before.items())

    source, target = scenario('conflict', files, {'capture/umalytics-ca.pem': b'a different capture identity'})
    before, destination_before = inventory(source), inventory(target)
    run(source, target, ok=False)
    assert inventory(source) == before and inventory(target) == destination_before
    assert not (target / 'storage-layout.json').exists()

    source, target = scenario('file-folder-conflict', files, {'races': b'not a directory'})
    before, destination_before = inventory(source), inventory(target)
    run(source, target, ok=False)
    assert inventory(source) == before and inventory(target) == destination_before

    # A Windows junction must not copy or delete data outside the source tree.
    source, target = scenario('linked', files)
    outside = root / 'outside'
    outside.mkdir()
    (outside / 'keep.txt').write_bytes(b'keep outside bytes')
    junction = source / 'linked'
    if os.name == 'nt':
        subprocess.run(['cmd.exe', '/c', 'mklink', '/J', str(junction), str(outside)],
                       creationflags=FLAGS, check=True, capture_output=True)
        try:
            run(source, target, ok=False)
            assert (outside / 'keep.txt').read_bytes() == b'keep outside bytes'
            assert not target.exists()
        finally:
            os.rmdir(junction)
    else:
        junction.symlink_to(outside, target_is_directory=True)
        run(source, target, ok=False)
        junction.unlink()
print('AppData migration passed: full copy, hashes, empty folders, resume, conflicts, linked paths, one-time completion and fresh-install isolation.')
