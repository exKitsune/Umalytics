"""Exercise standalone source rebuild inputs and release guards with real Git."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
package = load('package_source', 'package-source.py')
verify = load('verify_archive', 'verify-source-archive.py')
from simulator_source import verify_source, source_digest
from source_dependencies import download


class SourcePackageTests(unittest.TestCase):
    def setUp(self):
        (ROOT / '.cache').mkdir(exist_ok=True)
        temporary = tempfile.TemporaryDirectory(dir=ROOT / '.cache', prefix='source-package-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / 'engine'
        self.source.mkdir()
        self.git('init', '--quiet')
        (self.source / '.gitattributes').write_bytes(b'* -text\n')
        (self.source / 'old-private-history.txt').write_bytes(b'not part of shipped source')
        self.commit()
        (self.source / 'old-private-history.txt').unlink()
        (self.source / 'src').mkdir()
        (self.source / 'src/lib.rs').write_bytes(b'pub fn fixture() {}\n')
        (self.source / 'LICENSE').write_bytes(b'license fixture\n')
        (self.source / 'NOTICE').write_bytes(b'notice fixture\n')
        self.commit()
        self.revision = self.git('rev-parse', 'HEAD').decode().strip()
        self.lock = dict(schemaVersion=1, repository='example/engine', revision=self.revision,
                         upstreamRevision=self.revision, sourceSha256=source_digest(self.source))

    def git(self, *args):
        return package.git(self.source, *args)

    def commit(self):
        self.git('add', '-A')
        self.git('-c', 'user.name=Source fixture', '-c', 'user.email=fixture@example.invalid',
                 '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture')

    def export(self, development=False):
        output = self.root / 'source.zip'
        files = package.simulator_files(self.source, self.revision, development)
        package.write_archive(output, files, dict(schemaVersion=1, development=development))
        with zipfile.ZipFile(output) as archive:
            archive.extractall(self.root / 'extracted')
        extracted = self.root / 'extracted/Umalytics'
        verify.verify(extracted)
        return extracted, extracted / '.cache/globalsim-saved'

    def test_exact_release_checkout_works_without_upstream_or_old_history(self):
        extracted, engine = self.export()
        with patch('simulator_source.source_lock', return_value=self.lock):
            self.assertEqual(verify_source(engine)['revision'], self.revision)
        self.assertEqual(package.git(engine, 'rev-list', '--count', 'HEAD').strip(), b'1')
        self.assertEqual(package.git(engine, 'remote').strip(), b'')
        self.assertFalse((engine / 'old-private-history.txt').exists())
        self.assertEqual((engine / 'src/lib.rs').read_bytes(), (self.source / 'src/lib.rs').read_bytes())

    def test_pending_review_source_is_exported_but_cannot_be_a_release(self):
        (self.source / 'src/lib.rs').write_bytes(b'pub fn traced_fixture() {}\n')
        (self.source / 'instrumentation.json').write_bytes(b'{}\n')
        self.lock.update(pendingReview=True, sourceSha256=source_digest(self.source))
        _, engine = self.export(True)
        with patch('simulator_source.source_lock', return_value=self.lock):
            self.assertTrue(verify_source(engine, development=True)['development'])
            with self.assertRaisesRegex(ValueError, 'await user review'):
                verify_source(engine)

    def test_archive_detects_changed_source(self):
        extracted, engine = self.export()
        (engine / 'src/lib.rs').write_bytes(b'altered')
        with self.assertRaisesRegex(ValueError, 'file changed'):
            verify.verify(extracted)

    def test_manifest_rejects_path_escape(self):
        (self.root / 'SOURCE-MANIFEST.json').write_text(json.dumps(
            dict(schemaVersion=1, files={'../outside': '0' * 64})))
        with self.assertRaisesRegex(ValueError, 'Invalid source manifest path'):
            verify.verify(self.root)

    def test_uncommitted_application_changes_are_review_only(self):
        (self.source / 'src/lib.rs').write_bytes(b'pending app change')
        with self.assertRaisesRegex(ValueError, 'must be committed'):
            package.app_files(self.source)
        self.assertEqual(package.app_files(self.source, True)['src/lib.rs'], b'pending app change')
        (self.source / 'src/lib.rs').unlink()
        self.assertNotIn('src/lib.rs',package.app_files(self.source, True))
        with self.assertRaisesRegex(ValueError, 'must be committed'):
            package.app_files(self.source)

    def test_dependency_cache_must_match_locked_hash(self):
        cache = self.root / 'downloads'
        cache.mkdir()
        url = 'https://example.invalid/source.tar.gz'
        (cache / hashlib.sha256(url.encode()).hexdigest()).write_bytes(b'wrong')
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
            download(url, cache, expected=hashlib.sha256(b'expected').digest())

    def test_license_and_public_copy_are_exact(self):
        self.assertEqual((ROOT / 'LICENSE').read_bytes(), (ROOT / 'public/LICENSE.txt').read_bytes())
        self.assertEqual(json.loads((ROOT / 'package.json').read_bytes())['license'], 'AGPL-3.0-only')

    def test_release_source_rejects_a_different_bundled_engine(self):
        folder = self.root / 'simulation/bundles/fixture'
        folder.mkdir(parents=True)
        (folder / 'worker.exe').write_bytes(b'fixture worker')
        digest = hashlib.sha256(b'fixture worker').hexdigest()
        receipt = dict(artifactSha256=digest, sourceBaseCommit=self.revision,
            sourceCommit=self.revision, instrumentation={'sourceSha256':self.lock['sourceSha256']})
        (folder / 'build.json').write_text(json.dumps(receipt))
        (self.root / 'simulation/installed-bundles.json').write_text(json.dumps({'bundles':[
            dict(kind='simulation', artifact='simulation/bundles/fixture/worker.exe', artifact_sha256=digest)]}))
        self.assertEqual(package.bundled_receipts(self.root,self.lock,False), [receipt])
        with self.assertRaisesRegex(ValueError,'Package the simulator'):
            package.bundled_receipts(self.root,{**self.lock,'sourceSha256':'0'*64},True)
        with self.assertRaisesRegex(ValueError,'does not match'):
            package.bundled_receipts(self.root,{**self.lock,'sourceSha256':'0'*64},False)
        (folder / 'worker.exe').write_bytes(b'different worker')
        with self.assertRaisesRegex(ValueError, 'does not match'):
            package.bundled_receipts(self.root,self.lock,False)


if __name__ == '__main__':
    unittest.main()
