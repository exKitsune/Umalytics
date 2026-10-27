"""Exercise diagnostics using owned temporary data and disposable child processes."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
import diagnostics


def records(folder):
    return [json.loads(line) for p in (folder / 'logs').glob('*.jsonl') for line in p.read_text().splitlines()]


class DiagnosticsTests(unittest.TestCase):
    def test_bounded_rotation_and_exception_redaction(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            log = diagnostics.DiagnosticLog(folder, 'service', max_bytes=1800, max_files=3)
            (folder / 'logs' / 'keep.txt').write_text('untouched')
            for _ in range(100):
                log.event('heartbeat')
            try:
                raise ValueError('SECRET_TOKEN request-body private trainer ID')
            except ValueError as error:
                log.exception('http_post_failed', error)
            files = list((folder / 'logs').glob('*.jsonl'))
            self.assertEqual(len(files), 3)
            self.assertTrue(all(p.stat().st_size <= 1800 for p in files))
            combined = ''.join(p.read_text() for p in files)
            self.assertNotIn('SECRET_TOKEN', combined)
            self.assertNotIn('request-body', combined)
            self.assertNotIn(str(ROOT), combined)
            error = next(r for r in records(folder) if r['event'] == 'http_post_failed')
            self.assertEqual(error['exceptionType'], 'ValueError')
            self.assertEqual(error['frames'][-1]['file'], Path(__file__).name)
            self.assertEqual((folder / 'logs' / 'keep.txt').read_text(), 'untouched')

    def test_threads_keep_json_lines_intact(self):
        with tempfile.TemporaryDirectory() as directory:
            log = diagnostics.DiagnosticLog(directory, 'service')
            workers = [threading.Thread(target=lambda: [log.event('heartbeat') for _ in range(30)]) for _ in range(8)]
            for thread in workers:
                thread.start()
            for thread in workers:
                thread.join()
            self.assertEqual(len(records(Path(directory))), 241)

    def test_storage_failure_and_links_do_not_break_app(self):
        with tempfile.TemporaryDirectory() as directory:
            log = diagnostics.DiagnosticLog(directory, 'service')
            before = records(Path(directory))
            with patch.object(diagnostics, 'linked', return_value=True):
                log.event('heartbeat')
                self.assertFalse(log.enabled)
            with patch.object(Path, 'open', side_effect=OSError('disk full')):
                log.event('heartbeat')
            self.assertEqual(before, records(Path(directory)))
            log.event('heartbeat')
            self.assertTrue(log.enabled)

    def test_normal_exception_and_abrupt_exit_are_distinguishable(self):
        for mode in ('normal', 'exception', 'thread', 'abrupt'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                child = subprocess.run([sys.executable, __file__, '--child', directory, mode], capture_output=True, timeout=10)
                events = [r['event'] for r in records(Path(directory))]
                self.assertEqual(events[0], 'process_start')
                if mode == 'exception':
                    self.assertEqual(child.returncode, 1)
                    self.assertIn('unhandled_exception', events)
                    self.assertEqual(events[-1], 'process_exit_after_exception')
                elif mode == 'abrupt':
                    self.assertEqual(child.returncode, 7)
                    self.assertNotIn('process_exit', events)
                else:
                    self.assertEqual(child.returncode, 0)
                    self.assertEqual(events[-1], 'process_exit')
                    if mode == 'thread':
                        self.assertIn('thread_exception', events)
                self.assertNotIn('SECRET_TOKEN', json.dumps(records(Path(directory))))

    def test_reveal_only_diagnostics_without_opening_explorer(self):
        import service
        with tempfile.TemporaryDirectory() as directory, patch.object(service, 'reveal_folder', return_value=True) as reveal:
            stub = object.__new__(service.Service)
            stub.data_dir = Path(directory)
            result = stub.reveal_target({'target': 'diagnostics'})
            self.assertEqual(result['path'], str(stub.data_dir / 'logs'))
            reveal.assert_called_once_with(stub.data_dir / 'logs')
            for body in ({'target': '../'}, {'target': 'diagnostics', 'path': 'elsewhere'}):
                with self.assertRaises(ValueError):
                    stub.reveal_target(body)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--child':
        import os
        diagnostics.initialize(sys.argv[2], 'service', '0.2.99')
        def fail():
            raise RuntimeError('SECRET_TOKEN private request payload')
        if sys.argv[3] == 'exception':
            fail()
        elif sys.argv[3] == 'thread':
            thread = threading.Thread(target=fail)
            thread.start()
            thread.join()
        elif sys.argv[3] == 'abrupt':
            os._exit(7)
    else:
        unittest.main()
