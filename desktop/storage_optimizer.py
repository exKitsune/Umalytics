"""Versioned, resumable idle-time upgrades for existing local storage."""
from contextlib import closing
import hmac
import json
import os
from pathlib import Path
import sqlite3
import threading

from storage import atomic_json, linked
from storage_gate import database_gate
from storage_maintenance import convert_model, storage_bytes
from globalsim_bridge.cache_storage import HEX, summary_bytes, summary_value
import run_cursors

# Append a named step for a future optimization; never reuse an ID for new work.
# Each release also cheaply rescans formats, covering data written after rollback.
STEPS = (
    ('models-v1', 'Compressing cached races', 'models'),
    ('dashboards-v1', 'Removing superseded dashboards', 'dashboards'),
    ('cursors-v1', 'Preparing simulator history', 'cursors'),
    ('summaries-v1', 'Compressing simulator history', 'summaries'),
    ('analysis-layout-v1', 'Reclaiming analysis storage', 'analysis_layout'),
    ('simulator-layout-v1', 'Reclaiming simulator storage', 'simulator_layout'),
)


class StorageOptimizer:
    def __init__(self, service, build, *, idle=None, startup_delay=10):
        self.service, self.root, self.build = service, Path(service.data_dir), build
        self.path = self.root / 'storage-optimization.json'
        self.stop = threading.Event()
        self.thread = None
        self.startup_delay = startup_delay
        self.idle = idle or self._idle
        self.phase, self.stage, self.done, self.total = 'pending', '', 0, 0
        self.compacting = False
        self.paths = None
        saved = {}
        try:
            if not linked(self.path) and self.path.stat().st_size <= 1024 * 1024:
                saved = json.loads(self.path.read_bytes())
        except (OSError, ValueError):
            pass
        plan = [row[0] for row in STEPS]
        if (not isinstance(saved, dict) or saved.get('schemaVersion') != 1
                or saved.get('build') != build or saved.get('plan') != plan
                or not isinstance(saved.get('progress'), dict) or not isinstance(saved.get('counts'), dict)
                or not isinstance(saved.get('completed'), list)
                or any(not isinstance(key,str) for key in saved.get('completed', []))
                or any(type(value) is not int or value < 0 for value in saved.get('counts', {}).values())):
            saved = dict(schemaVersion=1, build=build, plan=plan, completed=[], progress={},
                         counts=dict(models=0, runs=0, dashboards=0, skipped=0))
        self.state = saved
        for key in ('models','runs','dashboards','skipped'):
            self.state['counts'].setdefault(key,0)
        if all(key in saved['completed'] for key in plan):
            self.phase = 'complete'

    @property
    def reserving_databases(self):
        completed = self.state['completed']
        return self.phase not in ('complete', 'stopped', 'failed') and all(key in completed for key,_,_ in STEPS[:4])

    def status(self):
        return dict(phase=self.phase, stage=self.stage, done=self.done, total=self.total,
                    reclaimedBytes=self.state.get('reclaimedBytes', 0),
                    skipped=self.state['counts'].get('skipped', 0))

    def _idle(self):
        update = self.root / 'cache/update'
        # A new service can answer health checks before the updater commits.
        # Leave persistent data alone while rollback to the old app is possible.
        if (update/'backup').exists() and not (update/'success.json').is_file():
            return False
        if self.service.game_active():
            return False
        analysis, sandbox = self.service.analysis_service, self.service.sandbox
        if analysis.active or not sandbox.foreground_idle.is_set() or sandbox.opening:
            return False
        return not any(database_gate(p).active for p in (self.root/'cache/analysis.sqlite', self.root/'simulator.sqlite'))

    def stopped(self):
        return self.stop.is_set() or self.service.closed.is_set()

    def start(self):
        if self.thread is None and self.phase != 'complete':
            self.thread = threading.Thread(target=self.loop, name='storage-optimization', daemon=True)
            self.thread.start()

    def close(self):
        self.stop.set()
        if self.thread and self.thread is not threading.current_thread():
            self.thread.join(timeout=5)

    def loop(self):
        if self.stop.wait(self.startup_delay):
            return
        if os.name == 'nt':
            # Lower only this worker's CPU/IO priority, never the collector.
            try:
                import ctypes
                from ctypes import wintypes
                kernel = ctypes.WinDLL('kernel32', use_last_error=True)
                kernel.GetCurrentThread.restype = wintypes.HANDLE
                kernel.SetThreadPriority.argtypes = [wintypes.HANDLE, ctypes.c_int]
                kernel.SetThreadPriority(kernel.GetCurrentThread(), 0x00010000)
            except (OSError, AttributeError):
                pass
        while not self.stopped():
            if self.service.server is None:
                self.stop.wait(.5)
                continue
            try:
                self.tick()
                if self.phase == 'complete':
                    return
                self.stop.wait(.05 if self.phase == 'running' else .5)
            except Exception as error:
                self.phase = 'failed'
                self.service.diagnostics.exception('storage_optimization_failed', error)
                # Data and per-step checkpoints remain usable; retry transient
                # filesystem failures without affecting collection or analysis.
                if self.stop.wait(30):
                    return
        if self.phase != 'complete':
            self.phase = 'stopped'

    def tick(self):
        if self.stopped():
            self.phase = 'stopped'
            return
        if self.phase == 'complete':
            return
        if not self.idle():
            self.phase = 'waiting'
            return
        remaining = next((row for row in STEPS if row[0] not in self.state['completed']), None)
        if remaining is None:
            self.state['afterBytes'] = storage_bytes(self.root)
            self.state['reclaimedBytes'] = max(0, self.state.get('beforeBytes', self.state['afterBytes']) - self.state['afterBytes'])
            atomic_json(self.path, self.state)
            self.phase = 'complete'
            self.service.diagnostics.event('storage_optimization_complete', count=sum(self.state['counts'].values()))
            return
        if 'beforeBytes' not in self.state:
            self.state['beforeBytes'] = storage_bytes(self.root)
        key, self.stage, handler = remaining
        progress = self.state['progress'].setdefault(key, {})
        if not isinstance(progress, dict):
            self.state['progress'][key] = progress = {}
        self.phase = 'running'
        try:
            finished = getattr(self, '_' + handler)(progress)
        except sqlite3.OperationalError as error:
            if any(word in str(error).lower() for word in ('locked', 'busy', 'interrupted')):
                self.phase = 'waiting'
                return
            raise
        if finished:
            self.state['completed'].append(key)
            self.done = self.total = 0
        atomic_json(self.path, self.state)

    def _models(self, progress):
        native = self.root / 'cache/globalsim'
        if self.paths is None:
            self.paths = sorted(p.relative_to(native).as_posix() for p in native.glob('*/globalsim-modeled-v1/*.json')
                                if not linked(p) and p.resolve().is_relative_to(native.resolve()) and HEX.fullmatch(p.stem))
        self.total = len(self.paths)
        self.done = progress.get('done', 0)
        import bisect
        after = progress.get('after', '')
        index = bisect.bisect_right(self.paths, after if isinstance(after,str) else '')
        if index == len(self.paths):
            return True
        # Rescanning already shared headers is cheap; convert at most one large
        # legacy payload per unit so foreground work can take over promptly.
        for index in range(index,min(index+32,len(self.paths))):
            relative = self.paths[index]
            path = native / relative
            spent = False
            try:
                if path.exists() and not linked(path) and path.resolve().is_relative_to(native.resolve()):
                    spent = convert_model(path, self.service.simulation.cache_auth_key())
                    self.state['counts']['models'] += int(spent)
            except FileNotFoundError:
                pass
            except (ValueError, TypeError, KeyError, AttributeError):
                self.state['counts']['skipped'] += 1
                spent = True
            progress.update(after=relative, done=index + 1)
            self.done = index + 1
            if spent:
                break
        return False

    def _dashboards(self, progress):
        path = self.root / 'cache/analysis.sqlite'
        if not path.is_file():
            return True
        with database_gate(path).use(), closing(sqlite3.connect(path, timeout=.1)) as db:
            if 'before' not in progress:
                seen = set()
                duplicate = False
                for (text,) in db.execute('SELECT summary FROM prepared'):
                    try:
                        capture = json.loads(text).get('entrySha256')
                    except (ValueError,AttributeError):
                        continue
                    if isinstance(capture,str) and HEX.fullmatch(capture):
                        if capture in seen:
                            duplicate = True
                            break
                        seen.add(capture)
                if not duplicate:
                    return True
            before = progress.get('before',2**63-1)
            row = db.execute('SELECT rowid,key,summary,payload,signature FROM prepared WHERE rowid<? ORDER BY rowid DESC LIMIT 1', (before if type(before) is int else 2**63-1,)).fetchone()
            if row is None:
                return True
            rowid, key, text, payload, signature = row
            auth = self.service.simulation.cache_auth_key()
            valid = auth and isinstance(signature, bytes) and isinstance(payload, bytes) and hmac.compare_digest(signature, hmac.digest(auth, key.encode() + text.encode() + payload, 'sha256'))
            seen = {s for s in progress.get('seen', []) if isinstance(s,str) and HEX.fullmatch(s)} if isinstance(progress.get('seen',[]),list) else set()
            if valid:
                try:
                    capture = json.loads(text).get('entrySha256')
                except (ValueError,AttributeError):
                    capture = None
                if isinstance(capture, str) and HEX.fullmatch(capture):
                    if capture in seen:
                        deleted = db.execute('DELETE FROM prepared WHERE key=? AND signature=?', (key, signature)).rowcount
                        db.commit()
                        self.state['counts']['dashboards'] += deleted
                    seen.add(capture)
            else:
                self.state['counts']['skipped'] += 1
            progress.update(before=rowid, seen=sorted(seen))
        return False

    def _cursors(self, progress):
        path = self.root / 'simulator.sqlite'
        if not path.is_file():
            return True
        with database_gate(path).use(), closing(sqlite3.connect(path, timeout=.1)) as db:
            run_cursors.initialize(db)
            filled = run_cursors.fill_batch(db)
            db.commit()
        return filled == 0

    def _summaries(self, progress):
        path = self.root / 'simulator.sqlite'
        if not path.is_file():
            return True
        with database_gate(path).use(), closing(sqlite3.connect(path, timeout=.1)) as db:
            after = progress.get('after',0)
            rows = db.execute("SELECT rowid,job,n,summary FROM runs WHERE rowid>? AND typeof(summary)='text' ORDER BY rowid LIMIT 256", (after if type(after) is int else 0,)).fetchall()
            if not rows:
                return True
            changed = skipped = 0
            for rowid, job, n, raw in rows:
                if isinstance(raw, bytes) and raw.startswith(b'\x1f\x8b'):
                    continue
                try:
                    packed = summary_bytes(summary_value(raw))
                except (ValueError, TypeError):
                    skipped += 1
                    continue
                if len(packed) < (len(raw.encode()) if isinstance(raw, str) else len(raw)):
                    changed += db.execute('UPDATE runs SET summary=? WHERE job=? AND n=? AND summary=?', (packed, job, n, raw)).rowcount
            db.commit()
            self.state['counts']['runs'] += changed
            self.state['counts']['skipped'] += skipped
            progress['after'] = rows[-1][0]
        return False

    def _analysis_layout(self, progress):
        return self._compact(self.root / 'cache/analysis.sqlite')

    def _simulator_layout(self, progress):
        return self._compact(self.root / 'simulator.sqlite')

    def _compact(self, path):
        if not path.is_file():
            return True
        gate = database_gate(path)
        with gate.idle() as acquired:
            if not acquired:
                self.phase = 'waiting'
                return False
            self.compacting = True
            try:
                with closing(sqlite3.connect(path, timeout=.1)) as db:
                    db.set_progress_handler(lambda: int(self.stopped() or gate.waiting > 0), 1000)
                    mode = db.execute('PRAGMA auto_vacuum').fetchone()[0]
                    free = db.execute('PRAGMA freelist_count').fetchone()[0]
                    size = db.execute('PRAGMA page_size').fetchone()[0]
                    if mode != 2 or free * size >= 16 * 1024 * 1024:
                        db.execute('PRAGMA auto_vacuum=INCREMENTAL')
                        db.execute('VACUUM')
            finally:
                self.compacting = False
        return True
