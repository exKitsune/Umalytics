"""Full capture stays opt-in and retains undecodable wire bytes locally."""
import base64
import gzip
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/proxy'))
import development_capture as capture


def flow():
    request = SimpleNamespace(raw_content=b'UNSUPPORTED\x00REQUEST', method='POST', scheme='https', host='example.invalid', port=443,
                              path='/trained/load?test=1', http_version='HTTP/2',
                              headers=SimpleNamespace(fields=[(b'authorization', b'PRIVATE_TEST_TOKEN'), (b'x-repeat', b'1'), (b'x-repeat', b'2')]))
    response = SimpleNamespace(raw_content=b'\xff\x00UNSUPPORTED_RESPONSE', status_code=500, reason='fixture',
                               headers=SimpleNamespace(fields=[(b'content-type', b'application/octet-stream')]))
    return SimpleNamespace(id='fixture-flow', request=request, response=response, error=None)


class CaptureTests(unittest.TestCase):
    def test_opt_in_and_exact_wire_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = capture.DevelopmentCapture(directory)
            sample = flow()
            archive.record(sample, 'response')
            self.assertFalse(archive.folder.exists())
            archive.flag.parent.mkdir()
            archive.flag.write_text('{"enabled":true}')
            archive.record(sample, 'request')
            archive.record(sample, 'response')
            files = sorted(archive.folder.glob('*.json.gz'))
            self.assertEqual(len(files), 2)
            result = json.loads(gzip.decompress(files[-1].read_bytes()))
            self.assertEqual(base64.b64decode(result['request']['bodyBase64']), sample.request.raw_content)
            self.assertEqual(base64.b64decode(result['response']['bodyBase64']), sample.response.raw_content)
            self.assertEqual(result['request']['headers'], [['authorization', 'PRIVATE_TEST_TOKEN'], ['x-repeat','1'], ['x-repeat','2']])
            self.assertEqual(result['response']['status_code'], 500)
            archive.flag.write_text('{"enabled":false}')
            archive.record(sample, 'response')
            self.assertEqual(len(list(archive.folder.glob('*'))), 2)

    def test_missing_and_oversized_bodies_are_explicit(self):
        sample = flow()
        sample.response.raw_content = None
        self.assertEqual(capture.DevelopmentCapture.message(sample.response)['bodyUnavailable'], 'streamed_or_absent')
        with patch.object(capture, 'MAX_BODY', 2):
            result = capture.DevelopmentCapture.message(sample.request)
        self.assertIsNone(result['bodyBase64'])
        self.assertEqual(result['bodyUnavailable'], 'size_limit')
        self.assertEqual(result['bodyBytes'], len(sample.request.raw_content))

    def test_non_post_transport_error_preserves_request(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = capture.DevelopmentCapture(directory)
            archive.flag.parent.mkdir()
            archive.flag.write_text('{"enabled":true}')
            sample = flow()
            sample.request.method = 'GET'
            sample.response = None
            sample.error = 'fixture connection closed'
            archive.record(sample, 'error')
            result = json.loads(gzip.decompress(next(archive.folder.glob('*.json.gz')).read_bytes()))
            self.assertEqual(result['request']['method'], 'GET')
            self.assertEqual(result['transportError'], 'fixture connection closed')
            self.assertIsNone(result['response'])

    def test_linked_or_invalid_flag_cannot_enable_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = capture.DevelopmentCapture(directory)
            archive.flag.parent.mkdir()
            for value in ('{"enabled":"true"}', '[]', 'bad', 'x'*1025):
                archive.flag.write_text(value)
                self.assertFalse(archive.enabled())
            archive.flag.write_text('{"enabled":true}')
            with patch.object(capture, 'regular', return_value=False):
                self.assertFalse(archive.enabled())

    def test_retention_leaves_other_files_alone(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = capture.DevelopmentCapture(directory)
            archive.flag.parent.mkdir()
            archive.flag.write_text('{"enabled":true}')
            sample = flow()
            sample.response.raw_content = os.urandom(1200)
            archive.folder.mkdir()
            other = archive.folder / 'other.json.gz'
            other.write_bytes(b'preserve')
            with patch.object(capture, 'MAX_STORAGE', 4500):
                for _ in range(8):
                    archive.record(sample, 'response')
            files = [p for p in archive.folder.glob('*.json.gz') if p != other]
            self.assertEqual(other.read_bytes(), b'preserve')
            self.assertTrue(1 <= len(files) < 8)
            self.assertLessEqual(sum(p.stat().st_size for p in files), 4500)


if __name__ == '__main__':
    unittest.main()
