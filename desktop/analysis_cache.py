"""Disposable, compressed analysis. Race files and preferences are never touched."""
import base64
from datetime import datetime, timezone
import json
import re
import sqlite3
import threading
from contextlib import contextmanager

DEFAULT_POLICY = {'mode': 'unlimited', 'value': 1000, 'background': False}


class AnalysisCache:
    def __init__(self, data_dir):
        self.path = data_dir / 'cache' / 'analysis.sqlite'
        self.simulation_root = (data_dir / 'cache' / 'globalsim').resolve()
        self.lock = threading.RLock()

    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=15)
        db.execute('CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, race TEXT UNIQUE, revision TEXT, date TEXT, payload BLOB)')
        db.execute('CREATE TABLE IF NOT EXISTS options (key TEXT PRIMARY KEY, value TEXT)')
        try:
            yield db
            db.commit()
        finally:
            db.close()

    @staticmethod
    def identifier(value):
        if not isinstance(value, str) or not re.fullmatch('[a-f0-9]{64}', value):
            raise ValueError('Invalid cache key.')
        return value

    def policy(self, db):
        row = db.execute("SELECT value FROM options WHERE key='policy'").fetchone()
        return json.loads(row[0]) if row else dict(DEFAULT_POLICY)

    def prune(self, db):
        policy = self.policy(db)
        if policy['mode'] == 'unlimited':
            return
        used = 16384
        for index, entry in enumerate(self.inventory(db)):
            used += entry['bytes'] + (0 if '_path' in entry else 4096)
            if (policy['mode'] == 'races' and index >= policy['value']) or (policy['mode'] == 'size' and used > policy['value'] * 1024 * 1024):
                self.remove_entry(db, entry)

    def inventory(self, db):
        entries = [{'key': key, 'raceId': race, 'date': date, 'bytes': size, 'revision': revision}
                   for key, race, date, size, revision in db.execute('SELECT key,race,date,length(payload),revision FROM entries')]
        # Read metadata only. Simulator payloads remain in their own authenticated
        # storage and are never writable through the inference-cache API.
        for path in self.simulation_root.glob('*/globalsim-modeled-v1/*.json'):
            if path.is_symlink() or not path.resolve().is_relative_to(self.simulation_root):
                continue
            try:
                stat = path.stat()
                entries.append({'key': path.stem, 'raceId': path.stem, 'bytes': stat.st_size,
                    'date': datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                    'revision': 'simulation-v1', '_path': path})
            except OSError:
                pass
        return sorted(entries, key=lambda entry: (entry['date'], entry['key']), reverse=True)

    def remove_entry(self, db, entry):
        path = entry.get('_path')
        if path is None:
            db.execute('DELETE FROM entries WHERE key=?', (entry['key'],))
        elif not path.is_symlink() and path.resolve().is_relative_to(self.simulation_root):
            path.unlink(missing_ok=True)

    def read(self, key=None):
        with self.lock, self.connect() as db:
            if key is not None:
                row = db.execute('SELECT payload FROM entries WHERE key=?', (self.identifier(key),)).fetchone()
                return {'payload': base64.b64encode(row[0]).decode('ascii') if row else None}
            rows = self.inventory(db)
            entries = [{key: value for key, value in entry.items() if key != '_path'} for entry in rows]
            return {'policy': self.policy(db), 'entries': entries,
                    'bytes': self.path.stat().st_size + sum(entry['bytes'] for entry in rows if '_path' in entry)}

    def update(self, body):
        with self.lock, self.connect() as db:
            action = body.get('action')
            if action == 'put':
                key = self.identifier(body.get('key'))
                revision = self.identifier(body.get('revision'))
                race, date = body.get('raceId'), body.get('date')
                if not isinstance(race, str) or not 1 <= len(race) <= 300 or not isinstance(date, str) or len(date) > 40:
                    raise ValueError('Invalid cache entry.')
                payload = base64.b64decode(body.get('payload', ''), validate=True)
                if not payload.startswith(b'\x1f\x8b') or len(payload) > 24 * 1024 * 1024:
                    raise ValueError('Invalid cache payload.')
                db.execute('INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?)', (key, race, revision, date, payload))
            elif action == 'policy':
                policy = body.get('policy', {})
                if (set(policy) != {'mode', 'value', 'background'} or policy['mode'] not in ('unlimited', 'races', 'size')
                        or type(policy['value']) is not int or not 1 <= policy['value'] <= 1000000 or type(policy['background']) is not bool):
                    raise ValueError('Invalid cache policy.')
                db.execute("INSERT OR REPLACE INTO options VALUES ('policy',?)", (json.dumps(policy),))
            elif action == 'purge':
                for entry in self.inventory(db):
                    self.remove_entry(db, entry)
            elif action == 'prune':
                pass
            elif action == 'revision':
                db.execute('DELETE FROM entries WHERE revision<>?', (self.identifier(body.get('revision')),))
            elif action == 'remove':
                db.execute('DELETE FROM entries WHERE key=?', (self.identifier(body.get('key')),))
            else:
                raise ValueError('Invalid cache action.')
            self.prune(db)
            db.commit()
            # Reclaim deleted payloads instead of leaving a growing SQLite file.
            if db.execute('PRAGMA freelist_count').fetchone()[0]:
                db.execute('VACUUM')
            policy = self.policy(db)
            if policy['mode'] == 'size':
                while True:
                    rows = self.inventory(db)
                    if self.path.stat().st_size + sum(entry['bytes'] for entry in rows if '_path' in entry) <= policy['value'] * 1024 * 1024 or not rows:
                        break
                    self.remove_entry(db, rows[-1])
                    db.commit()
                    db.execute('VACUUM')
        return self.read()
