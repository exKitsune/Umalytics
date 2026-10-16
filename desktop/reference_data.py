"""Bounded, hash-verified updates of reference data from the user's repository."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import time
import uuid
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

BASE = 'https://raw.githubusercontent.com/exKitsune/Umalytics/master/public/data/'
FILES = {'metadata.json': 8 * 1024 * 1024, 'courses.json': 2 * 1024 * 1024,
         'course-geometry.json': 16 * 1024 * 1024,
         'simulator-skill-ids.json': 2 * 1024 * 1024, 'reference-source.json': 64 * 1024,
         'NOTICE.txt': 256 * 1024, 'UMA-TOOLS-LICENSE.txt': 256 * 1024}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Reference download redirect refused.')


def strict_json(raw):
    def invalid(value):
        raise ValueError('Nonfinite JSON value.')
    return json.loads(raw.decode('utf-8-sig'), parse_constant=invalid)


def validate_snapshot(manifest_raw, contents):
    if len(manifest_raw) > 64 * 1024:
        raise ValueError('Reference manifest is too large.')
    manifest = strict_json(manifest_raw)
    if not isinstance(manifest, dict) or manifest.get('schemaVersion') != 1 or set(manifest.get('files', {})) != set(FILES):
        raise ValueError('Reference manifest schema is invalid.')
    if set(contents) != set(FILES):
        raise ValueError('Reference snapshot is incomplete.')
    for name, limit in FILES.items():
        expected = manifest['files'][name]
        raw = contents[name]
        if (not isinstance(expected, dict) or not isinstance(expected.get('bytes'), int)
                or not 0 < expected['bytes'] <= limit or len(raw) != expected['bytes']
                or not isinstance(expected.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', expected['sha256'])
                or hashlib.sha256(raw).hexdigest() != expected['sha256']):
            raise ValueError('Reference file hash or length did not match the manifest.')
        if name.endswith('.json'):
            value = strict_json(raw)
            if name == 'simulator-skill-ids.json':
                if not isinstance(value, list) or any(not isinstance(skill, str) or not re.fullmatch(r'\d{1,12}', skill) for skill in value):
                    raise ValueError('Simulator skill ID schema is invalid.')
            elif not isinstance(value, dict):
                raise ValueError('Reference JSON root must be an object.')
            if name == 'metadata.json' and (value.get('schemaVersion') != 1 or any(not isinstance(value.get(k), dict) for k in ('characters', 'skillNames', 'skills'))):
                raise ValueError('Reference metadata schema is invalid.')
            if name == 'course-geometry.json':
                validate_geometry(value)
        else:
            raw.decode('utf-8')
    return manifest


def validate_geometry(value):
    paths, courses = value.get('paths'), value.get('courses')
    if value.get('schemaVersion') != 1 or not isinstance(paths, dict) or not isinstance(courses, dict) or len(paths) > 1000:
        raise ValueError('Course geometry schema is invalid.')
    for path in paths.values():
        if not isinstance(path, dict):
            raise ValueError('Course path schema is invalid.')
        distance, points = path.get('distance'), path.get('points')
        if (type(distance) not in (int, float) or not 0 < distance <= 10000
                or not isinstance(points, list) or not 2 <= len(points) <= 4097
                or any(not isinstance(p, list) or len(p) != 3
                       or any(type(n) not in (int, float) or not -100000 <= n <= 100000 for n in p) for p in points)):
            raise ValueError('Course path coordinates are invalid.')
    for binding in courses.values():
        if (not isinstance(binding, dict) or not isinstance(binding.get('path'), str)
                or binding['path'] not in paths
                or ('loop' in binding and (not isinstance(binding['loop'], str) or binding['loop'] not in paths))):
            raise ValueError('Course path reference is invalid.')


class ReferenceData:
    """One active snapshot at data/, with one bounded recovery transaction."""
    NAMES = (*FILES, 'update-manifest.json', 'active.json')

    def __init__(self, directory, bundled_assets):
        from storage import linked
        self.directory = Path(directory)
        if linked(self.directory):
            raise ValueError('Linked reference directory refused.')
        self.directory.mkdir(parents=True, exist_ok=True)
        self.assets = {}
        self.status = {'source': 'bundled', 'updatedAt': None}
        self.opener = build_opener(ProxyHandler({}), NoRedirect())
        self.bundled_digest = None
        self._recover()
        bundled = None
        try:
            manifest = bundled_assets['/data/update-manifest.json'][0]
            contents = {name: bundled_assets['/data/' + name][0] for name in FILES}
            validate_snapshot(manifest, contents)
            self.bundled_digest = hashlib.sha256(manifest).hexdigest()
            bundled = (manifest, contents)
        except (OSError, ValueError, KeyError, TypeError):
            pass
        try:
            active = strict_json((self.directory / 'active.json').read_bytes())
            digest = active['manifestSha256']
            if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
                raise ValueError('Invalid snapshot identity.')
            try:
                manifest, contents = self._read_snapshot(self.directory, digest)
                legacy = False
            except (OSError, ValueError, KeyError, TypeError):
                manifest, contents = self._read_snapshot(self.directory / digest, digest)
                legacy = True
            # Every saved reference update belongs to the release that accepted
            # it. Old repository snapshots must not override a newer app bundle.
            new_bundle = bundled is not None and active.get('bundledManifestSha256') != self.bundled_digest
            if new_bundle:
                self.activate(*bundled, 'bundled')
            elif legacy:
                self.activate(manifest, contents, active.get('source', 'repository'))
            else:
                self.assets, self.status = contents, active
            self._cleanup_legacy()
            return
        except (OSError, ValueError, KeyError, TypeError):
            pass
        if bundled is not None:
            self.activate(*bundled, 'bundled')
            self._cleanup_legacy()

    def _read_snapshot(self, folder, digest=None):
        from storage import linked
        if linked(folder) or any(linked(folder / name) for name in self.NAMES):
            raise ValueError('Linked reference snapshot refused.')
        if any((folder / name).stat().st_size > FILES.get(name, 64 * 1024) for name in (*FILES, 'update-manifest.json')):
            raise ValueError('Reference snapshot exceeds file limits.')
        manifest = (folder / 'update-manifest.json').read_bytes()
        contents = {name: (folder / name).read_bytes() for name in FILES}
        validate_snapshot(manifest, contents)
        if digest is not None and hashlib.sha256(manifest).hexdigest() != digest:
            raise ValueError('Reference manifest identity mismatch.')
        return manifest, contents

    def _transaction(self):
        from storage import linked
        path = self.directory / '.umalytics-transaction'
        if linked(path):
            raise ValueError('Linked reference transaction refused.')
        return path

    def _recover(self):
        transaction = self._transaction()
        if not transaction.exists():
            return
        # Only our complete, closed inventory can authorize cleanup/rollback.
        from storage import linked, atomic_bytes
        entries = list(transaction.rglob('*'))
        if any(linked(path) for path in entries):
            raise ValueError('Linked reference recovery entry refused.')
        if not (transaction / 'journal.json').exists():
            # The initial journal is staged before any active file is touched.
            if all(path.is_file() and re.fullmatch(r'journal\.json\.[0-9a-f]{32}\.partial', path.name) for path in entries):
                shutil.rmtree(transaction)
                return
            raise ValueError('Unrecognized reference transaction preserved.')
        journal = strict_json((transaction / 'journal.json').read_bytes())
        if (journal.get('schemaVersion') != 1 or journal.get('phase') not in ('staging', 'prepared', 'committed')
                or not isinstance(journal.get('previous'), dict)
                or set(journal['previous']) - set(self.NAMES)):
            raise ValueError('Reference recovery journal is invalid.')
        allowed = {'journal.json', 'before', 'after'} | {f'{side}/{name}' for side in ('before', 'after') for name in self.NAMES}
        def generated(path):
            relative = path.relative_to(transaction).as_posix()
            if relative in allowed:
                return True
            base = re.sub(r'\.[0-9a-f]{32}\.partial$', '', relative)
            return base != relative and base in allowed and path.is_file() and path.stat().st_size <= 32 * 1024 * 1024
        if any(not generated(path) for path in entries):
            raise ValueError('Unknown reference recovery entry preserved.')
        if journal['phase'] == 'prepared':
            # Verify every backup before changing any active file.
            previous = {}
            for name, digest in journal['previous'].items():
                raw = (transaction / 'before' / name).read_bytes()
                if hashlib.sha256(raw).hexdigest() != digest:
                    raise ValueError('Reference rollback verification failed.')
                previous[name] = raw
            for name in self.NAMES:
                target = self.directory / name
                if name in previous:
                    atomic_bytes(target, previous[name])
                elif target.exists():
                    if linked(target) or not target.is_file():
                        raise ValueError('Invalid reference rollback target.')
                    target.unlink()
        shutil.rmtree(transaction)

    def _cleanup_legacy(self):
        from storage import linked
        # Hashed directories are removed only when every byte is accounted for
        # by a valid generated manifest. Unknown/user directories survive.
        for folder in self.directory.iterdir():
            digest_name = bool(re.fullmatch('[0-9a-f]{64}', folder.name))
            old_staging = bool(re.fullmatch(r'snapshot-[0-9a-f]{32}\.partial', folder.name))
            if not (digest_name or old_staging) or linked(folder) or not folder.is_dir():
                continue
            try:
                if set(path.name for path in folder.iterdir()) != set(FILES) | {'update-manifest.json'}:
                    continue
                self._read_snapshot(folder, folder.name if digest_name else None)
                shutil.rmtree(folder)
            except (OSError, ValueError, KeyError, TypeError):
                continue

    def activate(self, manifest, contents, source):
        from storage import atomic_bytes, atomic_json, linked
        validate_snapshot(manifest, contents)
        self._recover()
        digest = hashlib.sha256(manifest).hexdigest()
        status = {'source': source, 'manifestSha256': digest,
                  'bundledManifestSha256': self.bundled_digest,
                  'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
        files = dict(contents, **{'update-manifest.json': manifest,
                    'active.json': json.dumps(status).encode('utf-8')})
        # A complete unchanged bundle needs no writes, including active.json.
        if self.assets == contents and self.status.get('manifestSha256') == digest and self.status.get('source') == source:
            return self.status
        transaction = self._transaction()
        transaction.mkdir()
        atomic_json(transaction / 'journal.json', {'schemaVersion': 1, 'phase': 'staging', 'previous': {}})
        (transaction / 'before').mkdir()
        (transaction / 'after').mkdir()
        previous = {}
        try:
            for name in self.NAMES:
                target = self.directory / name
                if linked(target) or target.exists() and not target.is_file():
                    raise ValueError('Invalid reference storage target.')
                if target.exists():
                    raw = target.read_bytes()
                    if len(raw) > FILES.get(name, 64 * 1024):
                        raise ValueError('Existing reference file is too large.')
                    atomic_bytes(transaction / 'before' / name, raw)
                    previous[name] = hashlib.sha256(raw).hexdigest()
                atomic_bytes(transaction / 'after' / name, files[name])
            journal = {'schemaVersion': 1, 'phase': 'prepared', 'previous': previous}
            atomic_json(transaction / 'journal.json', journal)
            for name in self.NAMES:
                (transaction / 'after' / name).replace(self.directory / name)
            self._read_snapshot(self.directory, digest)
            journal['phase'] = 'committed'
            atomic_json(transaction / 'journal.json', journal)
            self.assets, self.status = dict(contents), status
            self._recover()
            self._cleanup_legacy()
            return status
        except BaseException:
            if (transaction / 'journal.json').is_file():
                self._recover()
            else:
                # No active files are touched before the complete journal.
                shutil.rmtree(transaction)
            raise

    def download(self, name, limit):
        request = Request(BASE + name, headers={'User-Agent': 'Umalytics-reference-updater/1', 'Accept': 'application/json,text/plain'})
        with self.opener.open(request, timeout=15) as response:
            raw = response.read(limit + 1)
        if len(raw) > limit:
            raise ValueError('Reference download is too large.')
        return raw

    def update(self):
        manifest_raw = self.download('update-manifest.json', 64 * 1024)
        manifest = strict_json(manifest_raw)
        if not isinstance(manifest, dict) or manifest.get('schemaVersion') != 1 or set(manifest.get('files', {})) != set(FILES):
            raise ValueError('Reference manifest schema is invalid.')
        contents = {name: self.download(name, limit) for name, limit in FILES.items()}
        return self.activate(manifest_raw, contents, 'repository')
