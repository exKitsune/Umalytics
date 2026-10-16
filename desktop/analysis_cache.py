"""Disposable, compressed analysis. Race files and preferences are never touched."""
import base64
import json
import re
import sqlite3
import threading
from contextlib import contextmanager

DEFAULT_POLICY = {'mode': 'unlimited', 'value': 1000, 'background': True}


class AnalysisCache:
    def __init__(self, data_dir):
        self.path = data_dir / 'cache' / 'analysis.sqlite'
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
        for index, (key, size) in enumerate(db.execute('SELECT key,length(payload) FROM entries ORDER BY date DESC,key').fetchall()):
            used += size + 4096
            if (policy['mode'] == 'races' and index >= policy['value']) or (policy['mode'] == 'size' and used > policy['value'] * 1024 * 1024):
                db.execute('DELETE FROM entries WHERE key=?', (key,))

    def read(self, key=None):
        with self.lock, self.connect() as db:
            if key is not None:
                row = db.execute('SELECT payload FROM entries WHERE key=?', (self.identifier(key),)).fetchone()
                return {'payload': base64.b64encode(row[0]).decode('ascii') if row else None}
            entries = [{'key': key, 'raceId': race, 'date': date, 'bytes': size, 'revision': revision} for key, race, date, size, revision in db.execute('SELECT key,race,date,length(payload),revision FROM entries ORDER BY date DESC')]
            return {'policy': self.policy(db), 'entries': entries, 'bytes': self.path.stat().st_size}

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
                db.execute('DELETE FROM entries')
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
                while self.path.stat().st_size > policy['value'] * 1024 * 1024:
                    oldest = db.execute('SELECT key FROM entries ORDER BY date,key LIMIT 1').fetchone()
                    if not oldest:
                        break
                    db.execute('DELETE FROM entries WHERE key=?', oldest)
                    db.commit()
                    db.execute('VACUUM')
        return self.read()
