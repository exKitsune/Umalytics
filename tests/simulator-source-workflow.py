"""Exercise saved-source verification with real isolated Git checkouts, offline."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from simulator_source import source_lock, verify_source
spec = importlib.util.spec_from_file_location('prepare_simulator', ROOT / 'scripts/prepare-simulator.py')
prepare_simulator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare_simulator)


class SavedSourceTests(unittest.TestCase):
    def setUp(self):
        (ROOT / '.cache').mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='saved-source-test-', dir=ROOT / '.cache')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.source = self.base / 'source'
        self.source.mkdir()
        self.environment = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
        self.environment.update(GIT_ALLOW_PROTOCOL='file', GIT_TERMINAL_PROMPT='0')
        self.git('init', '--quiet')
        # The saved simulator also declares * -text, preserving source/data bytes
        # across Windows and Linux clones regardless of global autocrlf settings.
        (self.source / '.gitattributes').write_bytes(b'* -text\n')
        self.original = b'exact simulator fixture\n'
        (self.source / 'fixture').write_bytes(self.original)
        self.git('add', '.gitattributes', 'fixture')
        self.git('-c', 'user.name=Source verification test', '-c', 'user.email=test@example.invalid',
                 '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Isolated test fixture')
        self.revision = self.git('rev-parse', 'HEAD').decode().strip()

    def git(self, *args):
        return subprocess.check_output(['git', '-c', 'safe.directory=' + self.source.as_posix(),
            '-C', str(self.source), *args], env=self.environment, stderr=subprocess.PIPE, timeout=30)

    def test_exact_saved_checkout_and_bundle_restore(self):
        identity = verify_source(self.source, self.revision)
        bundle = self.base / 'history.bundle'
        self.git('bundle', 'create', str(bundle), '--all')
        restored = self.base / 'restored'
        subprocess.run(['git', 'clone', '--quiet', str(bundle), str(restored)],
                       check=True, env=self.environment, capture_output=True, timeout=30)
        self.assertEqual(verify_source(restored, self.revision), identity)
        self.assertEqual((restored / 'fixture').read_bytes(), self.original)

    def test_wrong_revision_does_not_check_out_or_change_original(self):
        with self.assertRaisesRegex(ValueError, 'revision mismatch'):
            verify_source(self.source, '0' * 40)
        self.assertEqual(self.git('rev-parse', 'HEAD').decode().strip(), self.revision)
        self.assertEqual((self.source / 'fixture').read_bytes(), self.original)

    def test_local_modifications_are_preserved_and_rejected(self):
        changed = b'local development must survive\n'
        (self.source / 'fixture').write_bytes(changed)
        with self.assertRaisesRegex(ValueError, 'local changes'):
            verify_source(self.source, self.revision)
        self.assertEqual((self.source / 'fixture').read_bytes(), changed)

    def test_untracked_source_is_preserved_and_rejected(self):
        extra = self.source / 'new-source.rs'
        extra.write_bytes(b'local untracked work')
        with self.assertRaisesRegex(ValueError, 'local changes'):
            verify_source(self.source, self.revision)
        self.assertTrue(extra.is_file())

    def test_missing_checkout_does_not_fetch(self):
        absent = self.base / 'absent'
        with self.assertRaisesRegex(ValueError, 'no upstream fetch is attempted'):
            verify_source(absent)
        self.assertFalse(absent.exists())

    def test_nested_folder_cannot_impersonate_checkout(self):
        nested = self.source / 'nested'
        nested.mkdir()
        with self.assertRaisesRegex(ValueError, 'Saved simulator checkout required'):
            verify_source(nested, self.revision)

    def test_release_pins_agree_and_actions_outputs_need_no_source(self):
        lock = source_lock()
        sys.path.insert(0, str(ROOT / 'desktop'))
        from globalsim_bridge.adapter import GLOBALSIM_COMMIT
        from globalsim_bridge.runtime import UPSTREAM_REVISION
        self.assertEqual(lock['upstreamRevision'], GLOBALSIM_COMMIT)
        self.assertEqual(lock['upstreamRevision'], UPSTREAM_REVISION)
        output = self.base / 'github-output'
        subprocess.run([sys.executable, str(ROOT / 'scripts/simulator_source.py'),
                        '--source', str(self.base / 'missing'), '--github-output', str(output)],
                       check=True, capture_output=True, timeout=30)
        self.assertEqual(dict(line.split('=', 1) for line in output.read_text().splitlines()),
                         {'repository': lock['repository'], 'revision': lock['revision']})

    def test_saved_trace_must_match_manifest_and_public_source_pin(self):
        stage = self.base / 'traced'
        (stage / 'src').mkdir(parents=True)
        code = b'fn observed() {}\n'
        (stage / 'src/lib.rs').write_bytes(code)
        digest = hashlib.sha256(b'src/lib.rs\0' + code).hexdigest()
        identity = {**prepare_simulator.instrumentation(), 'sourceSha256': digest}
        manifest = stage / 'instrumentation.json'
        manifest.write_text(json.dumps(identity), encoding='utf-8')
        lock = {**source_lock(), 'sourceSha256': digest}
        with patch.object(prepare_simulator, 'source_lock', return_value=lock):
            self.assertEqual(prepare_simulator.validate_prepared_source(stage), identity)
            changed = b'fn changed_mechanics() {}\n'
            (stage / 'src/lib.rs').write_bytes(changed)
            with self.assertRaisesRegex(ValueError, 'reviewed source hash'):
                prepare_simulator.validate_prepared_source(stage)
            identity['sourceSha256'] = hashlib.sha256(b'src/lib.rs\0' + changed).hexdigest()
            manifest.write_text(json.dumps(identity), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'reviewed source hash'):
                prepare_simulator.validate_prepared_source(stage)

    def test_saved_trace_rejects_different_instrumentation(self):
        stage = self.base / 'traced'
        stage.mkdir()
        identity = {**prepare_simulator.instrumentation(), 'schema': 'unreviewed-schema'}
        (stage / 'instrumentation.json').write_text(json.dumps(identity), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'reviewed patch'):
            prepare_simulator.validate_prepared_source(stage)


if __name__ == '__main__':
    unittest.main()
