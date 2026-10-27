"""Disposable, compressed analysis. Race files and preferences are never touched."""
import base64
from datetime import datetime, timezone
import json
import re
import sqlite3
import threading
from contextlib import contextmanager
from globalsim_bridge.cache_storage import SHARED, HEX, CACHE_LOCK, blob_path

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
        if db.execute('PRAGMA page_count').fetchone()[0] == 0:
            db.execute('PRAGMA auto_vacuum=INCREMENTAL')
        db.execute('CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, race TEXT UNIQUE, revision TEXT, date TEXT, payload BLOB)')
        db.execute('CREATE TABLE IF NOT EXISTS prepared (key TEXT PRIMARY KEY, race TEXT, revision TEXT, date TEXT, payload BLOB, signature BLOB, summary TEXT)')
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
        # New/optimized databases release a bounded number of free pages during
        # ordinary saves. Older layouts are upgraded by offline maintenance.
        db.execute('PRAGMA incremental_vacuum(64)').fetchall()
        policy = self.policy(db)
        if policy['mode'] == 'unlimited':
            return
        used = 16384
        races = {}
        blobs = set()
        for entry in self.inventory(db):
            index = races.setdefault(entry['raceId'], len(races))
            blob = entry.get('_blob')
            cost = entry.get('_stored_bytes', entry['bytes']) + (0 if '_path' in entry else 4096)
            if blob and blob not in blobs:
                cost += entry['_blob_bytes']
            if (policy['mode'] == 'races' and index >= policy['value']) or (policy['mode'] == 'size' and used + cost > policy['value'] * 1024 * 1024):
                self.remove_entry(db, entry)
            else:
                used += cost
                if blob:
                    blobs.add(blob)
        self.prune_blobs()

    def shared_blob(self, path):
        try:
            if path.stat().st_size > 8192:
                return None
            header = json.loads(path.read_bytes())
            if header.get('storage') != SHARED:
                return None
            blob = blob_path(path, header['modeledSha256'])
            if blob.is_symlink() or blob.parent.is_symlink():
                return None
            return blob
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            return None

    def blob_files(self):
        root = self.simulation_root / 'modeled-blobs-v1'
        if root.is_symlink():
            return []
        return [p for p in root.glob('*.json.gz') if HEX.fullmatch(p.name[:-8]) and not p.is_symlink()]

    def prune_blobs(self):
        # A writer publishes its blob and header under this same lock. Never
        # collect a blob in the interval between those two atomic writes.
        with CACHE_LOCK:
            referenced = {blob for path in self.simulation_root.glob('*/globalsim-modeled-v1/*.json')
                          if not path.is_symlink() and (blob := self.shared_blob(path)) is not None}
            for path in self.blob_files():
                if path not in referenced:
                    path.unlink(missing_ok=True)

    def inventory(self, db):
        entries = [{'key': key, 'raceId': race, 'date': date, 'bytes': size, 'revision': revision}
                   for key, race, date, size, revision in db.execute('SELECT key,race,date,length(payload),revision FROM entries')]
        entries += [dict(key=key, raceId=race, date=date, bytes=size, revision=revision, _prepared=True)
                    for key, race, date, size, revision in db.execute('SELECT key,race,date,length(payload),revision FROM prepared')]
        # Read metadata only. Simulator payloads remain in their own authenticated
        # storage and are never writable through the inference-cache API.
        for path in self.simulation_root.glob('*/globalsim-modeled-v1/*.json'):
            if path.is_symlink() or not path.resolve().is_relative_to(self.simulation_root):
                continue
            try:
                stat = path.stat()
                entry = {'key': path.stem, 'raceId': path.stem, 'bytes': stat.st_size, '_stored_bytes': stat.st_size,
                    'date': datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                    'revision': 'simulation-v1', '_path': path}
                blob = self.shared_blob(path)
                if blob and blob.is_file():
                    entry.update(_blob=blob, _blob_bytes=blob.stat().st_size)
                entries.append(entry)
            except OSError:
                pass
        entries.sort(key=lambda entry: (entry['date'], entry['key']), reverse=True)
        seen = set()
        for entry in entries:
            blob = entry.get('_blob')
            if blob and blob not in seen:
                entry['bytes'] += entry['_blob_bytes']
                seen.add(blob)
        return entries

    def remove_entry(self, db, entry):
        path = entry.get('_path')
        if entry.get('_prepared'):
            db.execute('DELETE FROM prepared WHERE key=?', (entry['key'],))
        elif path is None:
            db.execute('DELETE FROM entries WHERE key=?', (entry['key'],))
        elif not path.is_symlink() and path.resolve().is_relative_to(self.simulation_root):
            path.unlink(missing_ok=True)

    def read(self, key=None):
        with self.lock, self.connect() as db:
            if key is not None:
                row = db.execute('SELECT payload FROM entries WHERE key=?', (self.identifier(key),)).fetchone()
                return {'payload': base64.b64encode(row[0]).decode('ascii') if row else None}
            rows = self.inventory(db)
            entries = [{key: value for key, value in entry.items() if not key.startswith('_')} for entry in rows]
            return {'policy': self.policy(db), 'entries': entries,
                    'bytes': self.disk_bytes(rows)}

    def disk_bytes(self, rows):
        return self.path.stat().st_size + sum(entry['_stored_bytes'] for entry in rows if '_path' in entry) + sum(p.stat().st_size for p in self.blob_files())

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
            self.prune_blobs()
            db.commit()
            # Reclaim deleted payloads instead of leaving a growing SQLite file.
            if db.execute('PRAGMA freelist_count').fetchone()[0]:
                db.execute('VACUUM')
            policy = self.policy(db)
            if policy['mode'] == 'size':
                while True:
                    rows = self.inventory(db)
                    if self.disk_bytes(rows) <= policy['value'] * 1024 * 1024 or not rows:
                        break
                    self.remove_entry(db, rows[-1])
                    self.prune_blobs()
                    db.commit()
                    db.execute('VACUUM')
        return self.read()
