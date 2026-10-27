"""Latest complete, decoded in-game roster, separate from editable Uma builds."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import threading
import uuid

MAX_BYTES = 32 * 1024 * 1024
ROUTES = {'/\x75mamusume/load/index': 'trained_chara',
          '/\x75mamusume/trained_chara/load': 'trained_chara_array'}


def read(path):
    if path.is_symlink() or getattr(path, 'is_junction', lambda: False)():
        return None
    try:
        if path.stat().st_size > MAX_BYTES:
            return None
        value = json.loads(path.read_bytes())
        return value if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.astimezone(timezone.utc).isoformat() if parsed.tzinfo else None
    except (TypeError, ValueError, AttributeError):
        return None


def snapshot(payload, route, captured_at):
    field = ROUTES.get(route)
    data = payload.get('data') if isinstance(payload, dict) else None
    captured_at = timestamp(captured_at)
    if not field or not isinstance(data, dict) or not captured_at:
        return None
    headers = payload.get('data_headers')
    if isinstance(headers, dict) and headers.get('result_code', 1) != 1:
        return None
    if data.get('has_next') or data.get('next_cursor') or data.get('is_partial'):
        return None
    rows = data.get(field)
    if not isinstance(rows, list) or len(rows) > 10000:
        return None
    ids = set()
    for row in rows:
        if not isinstance(row, dict):
            return None
        ident = row.get('trained_chara_id')
        if type(ident) not in (str, int) or not str(ident).isdigit() or int(ident) <= 0 or str(ident) in ids:
            return None
        ids.add(str(ident))
        if any(type(row.get(k)) is not int or row[k] < 0 for k in ('card_id','speed','stamina','power','guts','wiz')):
            return None
        if not isinstance(row.get('skill_array'), list):
            return None
    favorites = data.get('trained_chara_favorite_array')
    if favorites is not None:
        if not isinstance(favorites, list) or len(favorites) > 10000:
            return None
        favorites = [item for item in favorites if isinstance(item, dict)
                     and str(item.get('trained_chara_id')) in ids]
    return {'schemaVersion': 2, 'capturedAt': captured_at, 'sourceRoute': route,
            'count': len(rows), 'veterans': rows, 'favorites': favorites}


def record_veterans(data_dir, payload, route, captured_at):
    value = snapshot(payload, route, captured_at)
    if value is None:
        return False
    folder = Path(data_dir) / 'veterans'
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (folder, *folder.parents)):
        raise ValueError('Linked Veteran directory refused.')
    path = folder / 'latest.json'
    previous = read(path)
    if previous:
        old_time = timestamp(previous.get('capturedAt')) or ''
        if old_time > value['capturedAt'] or old_time == value['capturedAt'] and previous.get('schemaVersion', 1) >= 2:
            return False
    raw = json.dumps(value, ensure_ascii=True, allow_nan=False)
    if len(raw.encode('utf-8')) > MAX_BYTES:
        raise ValueError('Veteran snapshot exceeds storage limit.')
    folder.mkdir(parents=True, exist_ok=True)
    temporary = folder / (uuid.uuid4().hex + '.partial')
    try:
        with temporary.open('x', encoding='utf-8') as stream:
            stream.write(raw)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return True


class VeteranStore:
    def __init__(self, data_dir):
        self.root = Path(data_dir)
        self.lock = threading.Lock()
        self.signature = None
        self.value = {'schemaVersion': 2, 'capturedAt': None, 'count': 0, 'veterans': [], 'favorites': None}

    @staticmethod
    def stamp(path):
        try:
            s = path.stat()
            return s.st_mtime_ns, s.st_size
        except OSError:
            return None

    def get(self, after=None, summary=False):
        with self.lock:
            path = self.root / 'veterans/latest.json'
            trace = self.root / 'cache/api-trace.jsonl'
            signature = self.stamp(path), self.stamp(trace)
            if signature != self.signature:
                # Also recover archives produced before the dedicated roster store.
                candidates = []
                try:
                    with trace.open('rb') as stream:
                        start = max(0, trace.stat().st_size - 16 * 1024 * 1024)
                        stream.seek(start)
                        if start:
                            stream.readline()
                        for line in stream:
                            try:
                                item = json.loads(line)
                                if item.get('route') in ROUTES and timestamp(item.get('at')) and item.get('file'):
                                    candidates.append(item)
                            except (ValueError, AttributeError):
                                pass
                except OSError:
                    pass
                current = read(path)
                for item in sorted(candidates, key=lambda v: timestamp(v['at']), reverse=True):
                    if current:
                        old_time = timestamp(current.get('capturedAt')) or ''
                        if old_time > timestamp(item['at']) or old_time == timestamp(item['at']) and current.get('schemaVersion', 1) >= 2:
                            break
                    name = item['file']
                    if not isinstance(name, str) or Path(name).name != name or not name.endswith('.json'):
                        continue
                    archive = read(self.root / 'cache/responses' / name)
                    if archive and record_veterans(self.root, archive.get('body'), item['route'], item['at']):
                        current = read(path)
                        break
                if current and current.get('schemaVersion') in (1, 2) and isinstance(current.get('veterans'), list):
                    self.value = current
                self.signature = self.stamp(path), self.stamp(trace)
            metadata = {k: v for k, v in self.value.items() if k not in ('veterans', 'favorites')}
            if after and after == self.value.get('capturedAt'):
                return {**metadata, 'unchanged': True}
            return metadata if summary else self.value
