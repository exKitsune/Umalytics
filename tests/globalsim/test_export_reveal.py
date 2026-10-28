"""Headless exports write JSON without launching Explorer."""
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
from service import Service


class ExportRevealTests(unittest.TestCase):
    def test_headless_and_default_exports(self):
        with tempfile.TemporaryDirectory() as folder, patch('service.reveal_file', return_value=True) as reveal:
            host = SimpleNamespace(export_lock=threading.Lock(), prepared_export_directory=lambda: Path(folder))
            body = {'filename': 'export.json', 'content': '{"ok":true}'}
            hidden = Service.export_json(host, {**body, 'reveal': False})
            self.assertFalse(hidden['revealed'])
            self.assertEqual(Path(hidden['path']).read_text(), body['content'])
            reveal.assert_not_called()
            normal = Service.export_json(host, body)
            self.assertTrue(normal['revealed'])
            self.assertEqual(normal['filename'], 'export (1).json')
            reveal.assert_called_once_with(Path(normal['path']))

    def test_invalid_reveal_cannot_write_or_launch(self):
        with tempfile.TemporaryDirectory() as folder, patch('service.reveal_file') as reveal:
            host = SimpleNamespace(export_lock=threading.Lock(), prepared_export_directory=lambda: Path(folder))
            for value in ('false', 0, None):
                with self.assertRaises(ValueError):
                    Service.export_json(host, {'filename': 'export.json', 'content': '{}', 'reveal': value})
            self.assertEqual(list(Path(folder).iterdir()), [])
            reveal.assert_not_called()


if __name__ == '__main__':
    unittest.main()
