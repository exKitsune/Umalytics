"""Discover the installed Global master and project public reference tables."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import threading
from contextlib import closing
from copy import deepcopy
import master_metadata


def merge_metadata(base, extra):
    result = dict(base)
    for field in ('raceInstances', 'raceInstanceConditions', 'racePrograms', 'characters', 'outfits', 'trackNames', 'skillNames', 'skills'):
        result[field] = {**extra.get(field, {}), **base.get(field, {})}
    if extra.get('installedGameRaceSource'):
        result['installedGameRaceSource'] = extra['installedGameRaceSource']
        result['installedGameSkillIds'] = list(extra.get('skills', {}))
    return result


def master_candidates():
    roots = []
    if os.environ.get('LOCALAPPDATA'):
        roots.append(Path(os.environ['LOCALAPPDATA']).parent / 'LocalLow')
    if os.environ.get('USERPROFILE'):
        roots.append(Path(os.environ['USERPROFILE']) / 'AppData' / 'LocalLow')
    return tuple(dict.fromkeys(root / '\x43ygames' / '\x75mamusume' / 'master' / 'master.mdb' for root in roots))


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
                    programs = {}
                    if 'single_mode_program' in tables:
                        programs = {str(pid): iid for pid, iid in db.execute(
                            'SELECT id,race_instance_id FROM single_mode_program LIMIT 100001')
                            if type(pid) is int and type(iid) is int and 0 < pid <= 2**31-1 and str(iid) in instances}
                    metadata = {}
                    if {'text_data', 'skill_data'} <= tables:
                        try:
                            metadata = master_metadata.metadata(db)
                        except (sqlite3.Error, KeyError, IndexError, TypeError, ValueError):
                            pass
                    career = {}
                    career_tables = {'text_data', 'skill_data', 'single_mode_skill_need_point', 'support_card_data',
                        'succession_factor_effect', 'succession_factor', 'succession_relation_member', 'succession_relation',
                        'single_mode_program', 'single_mode_scenario', 'single_mode_turn', 'single_mode_wins_saddle',
                        'single_mode_rank', 'support_card_level'}
                    if career_tables <= tables:
                        try:
                            career = master_metadata.career(db)
                        except (sqlite3.Error, KeyError, IndexError, TypeError, ValueError):
                            pass
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                stat = path.stat()
                if selected[1:] != (stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size):
                    self.stamp = None
                    return self.projection
                if career:
                    career['source']['sha256'] = digest
                self.projection = {**metadata, 'career': career,
                    'raceInstances': instances, 'raceInstanceConditions': conditions, 'racePrograms': programs,
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
            base = merge_metadata(json.loads(raw), extra)
            result = json.dumps(base, ensure_ascii=True, separators=(',', ':')).encode('utf-8')
            self.cache = (raw, result)
            return result

    def context(self, capture, supplied=None, projection=None):
        """Bind missing simulator context to preserved IDs and a measured master.

        Capture bytes, user facts and pinned simulator mechanics are never
        rewritten. The simulator still checks all independent facts for conflicts.
        """
        from globalsim_bridge.adapter import normalize_capture, InputError, COURSE_ID_ALIASES
        result = deepcopy(supplied or {})
        extra = self.read() if projection is None else projection
        if not extra:
            return result or None
        try:
            raw = normalize_capture(capture)
        except InputError:
            return result or None
        instance = raw.get('race_instance_id', result.get('raceInstanceId'))
        program = raw.get('race_program_id')
        if instance is None and type(program) is int:
            instance = extra.get('racePrograms', {}).get(str(program))
        if type(instance) is not int or instance <= 0:
            return result or None
        key = str(instance)
        conditions = extra.get('raceInstanceConditions', {}).get(key, {})
        values = {'courseId': extra.get('raceInstances', {}).get(key),
                  'grade': conditions.get('grade'), 'time': conditions.get('time')}
        course = raw.get('race_course_set')
        if raw.get('race_course_id') is not None or raw.get('course_id') is not None or type(course) is int or (
                isinstance(course, dict) and any(course.get(alias) is not None for alias in COURSE_ID_ALIASES)):
            values.pop('courseId', None)
        if raw.get('race_grade') is not None:
            values.pop('grade', None)
        if raw.get('race_instance_id') is None and 'raceInstanceId' not in result:
            values['raceInstanceId'] = instance
        for field, value in values.items():
            if value is None or field in result:
                continue
            result[field] = value
            result.setdefault('provenance', {})[field] = {'source': 'upstream-recorded',
                'reference': f"Installed Global master SHA-256 {extra['installedGameRaceSource']['sha256']}; "
                             f"race_instance.id={instance}" + (f'; single_mode_program.id={program}' if program else '')}
        return result or None
