"""Let normal DB work interrupt idle-only compaction without changing its locks."""
from contextlib import contextmanager
import threading
import os


class DatabaseGate:
    def __init__(self):
        self.condition = threading.Condition()
        self.active = self.waiting = 0
        self.exclusive = False

    @contextmanager
    def use(self):
        with self.condition:
            self.waiting += 1
            try:
                self.condition.wait_for(lambda: not self.exclusive)
                self.active += 1
            finally:
                self.waiting -= 1
        try:
            yield
        finally:
            with self.condition:
                self.active -= 1
                self.condition.notify_all()

    @contextmanager
    def idle(self):
        with self.condition:
            acquired = not self.active and not self.exclusive and not self.waiting
            if acquired:
                self.exclusive = True
        try:
            yield acquired
        finally:
            if acquired:
                with self.condition:
                    self.exclusive = False
                    self.condition.notify_all()


_lock = threading.Lock()
_gates = {}


def database_gate(path):
    key = os.path.normcase(str(path.resolve()))
    with _lock:
        return _gates.setdefault(key, DatabaseGate())
