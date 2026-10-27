"""Offline, lossless storage migration; only superseded dashboards are optional."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
import time
from contextlib import closing

from globalsim_bridge.cache_storage import HEX, SHARED, summary_bytes, summary_value, write_shared
from globalsim_bridge.runtime import _read_cache, _canonical


def storage_bytes(root):
    targets = [root / 'cache/analysis.sqlite', root / 'simulator.sqlite']
    targets += [p for p in (root / 'cache/globalsim').rglob('*') if p.is_file() and not p.is_symlink()]
    return sum(p.stat().st_size for p in targets if p.is_file())


def optimize(root, latest_dashboards=False, plain_summaries=False):
    """Caller must stop services using this directory. Races/builds are untouched."""
    root = Path(root)
    if root.is_symlink():
        raise ValueError('Linked data directory refused.')
    started = time.monotonic()
    result = dict(beforeBytes=storage_bytes(root), migratedModels=0, packedRuns=0, restoredRuns=0,
                  obsoleteDashboards=0, skipped=0)
    secret = root / 'simulation-cache.key'
    auth = secret.read_bytes() if secret.is_file() and not secret.is_symlink() else None
    if auth is not None and len(auth) != 32:
        raise ValueError('Invalid installation cache key.')
    if latest_dashboards and auth is None:
        raise ValueError('Cache key required to identify authenticated dashboards.')
    native = root / 'cache/globalsim'
    for path in native.glob('*/globalsim-modeled-v1/*.json'):
        if path.is_symlink() or not path.resolve().is_relative_to(native.resolve()) or not HEX.fullmatch(path.stem):
            continue
        try:
            if path.stat().st_size > 64 * 1024 * 1024 + 8192:
                raise ValueError('Cache is too large.')
            stamp = path.stat()
            header = json.loads(path.read_bytes())
            if header.get('storage') == SHARED:
                continue
            # Never convert checksum-only data into an authenticated trace.
            model = _read_cache(path, path.stem, 64 * 1024 * 1024, auth)
            if model is None:
                raise ValueError('Invalid modeled cache.')
            write_shared(path, header, _canonical(model))
            os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
            result['migratedModels'] += 1
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            result['skipped'] += 1
    analysis = root / 'cache/analysis.sqlite'
    if analysis.is_file():
        if latest_dashboards and auth is None:
            raise ValueError('Cache key required to identify authenticated dashboards.')
        with closing(sqlite3.connect(analysis)) as db:
            seen = set()
            rows = db.execute('SELECT key,summary,payload,signature FROM prepared ORDER BY rowid DESC').fetchall() if latest_dashboards else []
            for key, summary, packed, signature in rows:
                if (not isinstance(signature, bytes) or not isinstance(packed, bytes)
                        or not hmac.compare_digest(signature, hmac.digest(auth, key.encode() + summary.encode() + packed, 'sha256'))):
                    result['skipped'] += 1
                    continue
                capture = json.loads(summary).get('entrySha256')
                if not isinstance(capture, str) or not HEX.fullmatch(capture):
                    continue
                if capture in seen:
                    db.execute('DELETE FROM prepared WHERE key=?', (key,))
                    result['obsoleteDashboards'] += 1
                seen.add(capture)
            db.commit()
            db.execute('PRAGMA auto_vacuum=INCREMENTAL')
            db.execute('VACUUM')
    simulator = root / 'simulator.sqlite'
    if simulator.is_file():
        with closing(sqlite3.connect(simulator)) as db:
            cursor = db.execute('SELECT job,n,summary FROM runs')
            while rows := cursor.fetchmany(256):
                updates = []
                for job, index, raw in rows:
                    if plain_summaries:
                        if isinstance(raw, bytes):
                            updates.append((json.dumps(summary_value(raw)), job, index))
                        continue
                    if isinstance(raw, bytes) and raw.startswith(b'\x1f\x8b'):
                        continue
                    try:
                        packed = summary_bytes(summary_value(raw))
                    except (ValueError, TypeError):
                        result['skipped'] += 1
                        continue
                    original_bytes = len(raw.encode()) if isinstance(raw, str) else len(raw)
                    if len(packed) < original_bytes:
                        updates.append((packed, job, index))
                db.executemany('UPDATE runs SET summary=? WHERE job=? AND n=?', updates)
                result['restoredRuns' if plain_summaries else 'packedRuns'] += len(updates)
            db.commit()
            db.execute('PRAGMA auto_vacuum=INCREMENTAL')
            db.execute('VACUUM')
    result.update(afterBytes=storage_bytes(root), seconds=round(time.monotonic() - started, 2))
    return result
