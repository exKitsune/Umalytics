"""Daily GameTora data refresh; simulator imports use separately pinned overlays."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import threading
import time
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from catalog_transform import build, career_fallback
from globalsim_bridge.skill_catalog import catalog_rows
from reference_data import strict_json
from storage import atomic_json, linked

BASE = 'https://gametora.com'
MANIFEST = BASE + '/data/manifests/\u0075mamusume.json'
NAMES = ('skills', 'characters', 'character-cards', 'support-cards')
DAY = 24 * 60 * 60
RETRY = 60 * 60
MAX_FILE = 16 * 1024 * 1024
MAX_SNAPSHOT = 32 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Catalog redirects are not supported.')


def download(url, limit):
    if url != MANIFEST and not re.fullmatch(
            re.escape(BASE) + r'/data/\u0075mamusume/(skills|characters|character-cards|support-cards)\.[a-f0-9]{8,64}\.json', url):
        raise ValueError('Unknown catalog resource.')
    opener = build_opener(ProxyHandler({}), NoRedirect())
    request = Request(url, headers={'User-Agent': 'Umalytics-reference-updater/1', 'Accept': 'application/json'})
    with opener.open(request, timeout=15) as response:
        raw = response.read(limit + 1)
    if not 0 < len(raw) <= limit:
        raise ValueError('Catalog resource exceeds size limit.')
    return raw


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(',', ':')).encode('utf-8')


def utc(stamp):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(stamp))


def validate_payload(payload):
    if not isinstance(payload, dict) or set(payload) not in ({'fallback', 'career'}, {'fallback', 'career', 'engineSkills'}):
        raise ValueError('Invalid saved catalog.')
    if 'engineSkills' in payload and not isinstance(payload['engineSkills'], dict):
        raise ValueError('Invalid engine catalog.')
    for name, fields in [('fallback', ('characters', 'outfits', 'skillNames', 'skills', 'skillTexts', 'source')),
                         ('career', ('prices', 'supports', 'characters', 'skillOwners', 'outfitGlobalReleases', 'source'))]:
        value = payload[name]
        if not isinstance(value, dict) or any(not isinstance(value.get(key), dict) for key in fields):
            raise ValueError('Incomplete saved catalog.')
        if not re.fullmatch('[0-9a-f]{64}', str(value['source'].get('revision', ''))):
            raise ValueError('Invalid saved catalog source.')


class CatalogData:
    def __init__(self, directory, metadata, *, closed=None, fetch=download, clock=time.time):
        self.directory = Path(directory)
        if linked(self.directory):
            raise ValueError('Linked catalog directory refused.')
        self.directory.mkdir(parents=True, exist_ok=True)
        self.metadata = metadata
        self.base_digest = hashlib.sha256(encoded([metadata, 'engine-skills-v2-aptitudes'])).hexdigest()
        self.fetch, self.clock = fetch, clock
        self.closed = closed if closed is not None else threading.Event()
        self.lock, self.refresh_lock = threading.RLock(), threading.Lock()
        self.thread = None
        self.payload = None
        self.revisions = None
        self.cache_base = None
        self.checked_at = self.updated_at = self.error = self.revision = None
        self.next_check = 0
        self._restore()

    def _path(self, name):
        path = self.directory / name
        if linked(path):
            raise ValueError('Linked catalog file refused.')
        return path

    def _read(self, name, limit):
        path = self._path(name)
        if path.stat().st_size > limit:
            raise ValueError('Saved catalog is too large.')
        return strict_json(path.read_bytes())

    def _restore(self):
        try:
            saved = self._read('current.json', MAX_SNAPSHOT)
            if saved.get('schemaVersion') != 1:
                raise ValueError('Unknown saved catalog version.')
            validate_payload(saved['payload'])
            digest = hashlib.sha256(encoded(saved['payload'])).hexdigest()
            if digest != saved['sha256']:
                raise ValueError('Saved catalog digest mismatch.')
            if set(saved['upstreamRevisions']) != set(NAMES) or any(
                    not re.fullmatch('[a-f0-9]{8,64}', str(v)) for v in saved['upstreamRevisions'].values()):
                raise ValueError('Saved upstream revisions are invalid.')
            self.payload, self.revision = saved['payload'], digest
            self.revisions, self.cache_base = saved['upstreamRevisions'], saved.get('baseDigest')
            self.updated_at = saved['updatedAt']
        except (OSError, ValueError, KeyError, TypeError, AttributeError, RecursionError):
            pass  # Keep the bundled data usable; refresh repairs only our cache.
        try:
            state = self._read('status.json', 16384)
            stamp = state['checkedEpoch']
            if type(stamp) not in (int, float) or not 0 <= stamp <= self.clock():
                raise ValueError('Invalid saved check time.')
            self.checked_at = utc(stamp)
            self.error = state.get('error') if isinstance(state.get('error'), str) else None
            if self.payload is not None and self.cache_base == self.base_digest:
                self.next_check = stamp + (RETRY if self.error else DAY)
            elif self.error:
                self.next_check = stamp + RETRY
        except (OSError, ValueError, KeyError, TypeError, AttributeError, RecursionError):
            pass

    def status(self):
        with self.lock:
            return {'schemaVersion': 1, 'revision': self.revision, 'checkedAt': self.checked_at,
                    'updatedAt': self.updated_at, 'error': self.error,
                    'nextCheckAt': utc(self.next_check) if self.next_check else None}

    def snapshot(self):
        with self.lock:
            return {**self.status(), **deepcopy({k:v for k,v in (self.payload or {'fallback': None, 'career': None}).items() if k != 'engineSkills'})}

    def engine_snapshot(self):
        with self.lock:
            return (self.revision, deepcopy(self.payload.get('engineSkills')) if self.payload else None,
                    deepcopy(self.payload['fallback']['source']) if self.payload else None)

    def check(self):
        if self.closed.is_set() or self.clock() < self.next_check or not self.refresh_lock.acquire(blocking=False):
            return False
        stamp = self.clock()
        try:
            with self.lock:
                self.next_check = stamp + RETRY
            manifest = strict_json(self.fetch(MANIFEST, 64 * 1024))
            if not isinstance(manifest, dict):
                raise ValueError('Catalog manifest is invalid.')
            revisions = {name: manifest.get(name) for name in NAMES}
            if any(not isinstance(v, str) or not re.fullmatch('[a-f0-9]{8,64}', v) for v in revisions.values()):
                raise ValueError('Catalog revision is invalid.')
            if revisions != self.revisions or self.payload is None or self.cache_base != self.base_digest:
                catalogs, files = {}, {}
                for name, revision in revisions.items():
                    if self.closed.is_set():
                        return False
                    url = f'{BASE}/data/\u0075mamusume/{name}.{revision}.json'
                    raw = self.fetch(url, MAX_FILE)
                    if len(raw) > MAX_FILE:
                        raise ValueError('Catalog exceeds download limit.')
                    rows = strict_json(raw)
                    if not isinstance(rows, list) or not 0 < len(rows) <= 20000 or any(not isinstance(r, dict) for r in rows):
                        raise ValueError('Invalid catalog records.')
                    catalogs[name] = rows
                    files[name] = {'url': url, 'revision': revision, 'sha256': hashlib.sha256(raw).hexdigest(), 'records': len(rows)}
                source = {'name': 'GameTora public reference catalogs', 'url': BASE + '/\u0075mamusume/skills',
                          'revision': hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(),
                          'license': 'Game metadata © the UM:PD rights holders; community translations via GameTora.', 'files': files}
                payload = {'fallback': build(self.metadata, catalogs, source)['fallback'], 'career': career_fallback(catalogs, source),
                           'engineSkills': catalog_rows(catalogs['skills'])}
                validate_payload(payload)
                digest = hashlib.sha256(encoded(payload)).hexdigest()
                saved = {'schemaVersion': 1, 'baseDigest': self.base_digest, 'upstreamRevisions': revisions,
                         'sha256': digest, 'payload': payload, 'updatedAt': utc(stamp)}
                if len(encoded(saved)) > MAX_SNAPSHOT:
                    raise ValueError('Normalized catalog exceeds size limit.')
                if self.closed.is_set():
                    return False
                atomic_json(self._path('current.json'), saved)
                with self.lock:
                    self.payload, self.revision, self.revisions = payload, digest, revisions
                    self.cache_base, self.updated_at = self.base_digest, utc(stamp)
            with self.lock:
                self.checked_at, self.error, self.next_check = utc(stamp), None, stamp + DAY
            atomic_json(self._path('status.json'), {'checkedEpoch': stamp, 'error': None})
            return True
        except (OSError, ValueError, KeyError, TypeError, OverflowError, AttributeError, RecursionError):
            with self.lock:
                self.checked_at = utc(stamp)
                self.error = 'Catalog refresh failed; using the last available data.'
                self.next_check = stamp + RETRY
            try:
                atomic_json(self._path('status.json'), {'checkedEpoch': stamp, 'error': self.error})
            except (OSError, ValueError):
                pass
            return False
        finally:
            self.refresh_lock.release()

    def start(self):
        with self.lock:
            if self.thread is not None:
                return
            self.thread = threading.Thread(target=self._schedule, name='reference-catalog', daemon=True)
            self.thread.start()

    def _schedule(self):
        while not self.closed.is_set():
            self.check()
            self.closed.wait(60)

    def close(self):
        self.closed.set()
