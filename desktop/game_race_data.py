"""Discover the installed Global master and project public race definitions only."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import threading
from contextlib import closing


def master_candidates():
    roots = []
    if os.environ.get('LOCALAPPDATA'):
        roots.append(Path(os.environ['LOCALAPPDATA']).parent / 'LocalLow')
    if os.environ.get('USERPROFILE'):
        roots.append(Path(os.environ['USERPROFILE']) / 'AppData' / 'LocalLow')
    return tuple(dict.fromkeys(root / 'Cygames' / 'umamusume' / 'master' / 'master.mdb' for root in roots))


class GameRaceData:
    def __init__(self, candidates=master_candidates):
        self.candidates = candidates
        self.lock = threading.RLock()
        self.stamp = None
        self.projection = {}
        self.cache = None

    def read(self):
        with self.lock:
            selected = None
            for path in self.candidates():
                try:
                    if path.is_file() and not any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)):
                        stat = path.stat()
                        if 0 < stat.st_size <= 512 * 1024 * 1024:
                            selected = (path, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size)
                            break
                except OSError:
                    continue
            if selected == self.stamp:
                return self.projection
            self.stamp, self.projection, self.cache = selected, {}, None
            if selected is None:
                return self.projection
            path = selected[0]
            try:
                # The client owns this database. Never create it, migrate it,
                # acquire a write lock, or open account/save databases.
                with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro&immutable=1', uri=True, timeout=.1)) as db:
                    db.execute('PRAGMA query_only=ON')
                    db.execute('PRAGMA trusted_schema=OFF')
                    budget = [0]
                    def interrupted():
                        budget[0] += 1
                        return budget[0] > 10000
                    db.set_progress_handler(interrupted, 1000)
                    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                    if not {'race_instance', 'race', 'race_course_set'} <= tables:
                        return self.projection
                    rows = db.execute('SELECT ri.id,r.course_set,r.grade,ri.time FROM race_instance ri JOIN race r ON r.id=ri.race_id JOIN race_course_set c ON c.id=r.course_set LIMIT 100001').fetchall()
                    if len(rows) > 100000 or any(type(v) is not int for row in rows for v in row):
                        return self.projection
                    instances, conditions = {}, {}
                    for iid, course, grade, time in rows:
                        if not 0 < iid <= 2**31-1 or not 0 < course <= 2**31-1:
                            continue
                        instances[str(iid)] = course
                        conditions[str(iid)] = {**({'grade': grade} if 0 <= grade <= 10000 else {}),
                                                **({'time': time} if 1 <= time <= 4 else {})}
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                stat = path.stat()
                if selected[1:] != (stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size):
                    self.stamp = None
                    return self.projection
                self.projection = {'raceInstances': instances, 'raceInstanceConditions': conditions,
                    'installedGameRaceSource': {'sha256': digest, 'tables': 'race_instance JOIN race JOIN race_course_set'}}
            except (OSError, sqlite3.Error, ValueError):
                pass
            return self.projection

    def metadata(self, raw):
        """Fill missing reference IDs; pinned historical definitions keep priority."""
        with self.lock:
            extra = self.read()
            if not extra:
                return raw
            if self.cache is not None and self.cache[0] == raw:
                return self.cache[1]
            base = json.loads(raw)
            for field in ('raceInstances', 'raceInstanceConditions'):
                base[field] = {**extra[field], **base.get(field, {})}
            base['installedGameRaceSource'] = extra['installedGameRaceSource']
            result = json.dumps(base, ensure_ascii=True, separators=(',', ':')).encode('utf-8')
            self.cache = (raw, result)
            return result
