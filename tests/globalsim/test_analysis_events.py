import sys
from pathlib import Path
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
from analysis_events import AnalysisEvents, watch_directory


class EventsTests(unittest.TestCase):
    def test_no_lost_notification_before_or_during_wait(self):
        events = AnalysisEvents()
        events.publish('library')
        first = events.wait(0, 0)
        self.assertEqual(first, {'revision': 1, 'library': 1, 'analysis': 0})
        result = []
        waiter = threading.Thread(target=lambda: result.append(events.wait(first['revision'], 2)))
        waiter.start()
        events.publish('analysis')
        waiter.join(2)
        self.assertEqual(result, [{'revision': 2, 'library': 1, 'analysis': 1}])
        self.assertEqual(events.wait(2, 0), result[0])
        with self.assertRaises(ValueError):
            events.wait(-1, 0)

    def test_external_file_notifies_and_watcher_closes(self):
        with tempfile.TemporaryDirectory() as folder:
            closed, changed = threading.Event(), threading.Event()
            path = Path(folder)
            watcher = watch_directory(path, closed, changed.set)
            try:
                # Exercise atomic capture publication, including watcher startup.
                for index in range(10):
                    temporary = path / 'race.partial'
                    temporary.write_text(str(index))
                    temporary.replace(path / 'race.json')
                    if changed.wait(.15):
                        break
                self.assertTrue(changed.is_set())
            finally:
                closed.set()
                watcher.join(2)
                self.assertFalse(watcher.is_alive())


if __name__ == '__main__':
    unittest.main()
