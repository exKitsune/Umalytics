"""Per-user app paths and conservative, byte-preserving migrations."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import uuid


def linked(path):
    return path.is_symlink() or getattr(path, 'is_junction', lambda: False)()


def atomic_bytes(path, raw):
    if linked(path):
        raise ValueError('Linked storage file refused.')
    if path.is_file() and path.read_bytes() == raw:
        return False
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.partial')
    try:
        with temporary.open('xb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return True


def atomic_json(path, data):
    return atomic_bytes(path, json.dumps(data, ensure_ascii=False, allow_nan=False).encode('utf-8'))


def default_data_directory():
    # The native shell migrates legacy data before passing this explicitly.
    # Development remains isolated from the installed application's storage.
    if getattr(sys, 'frozen', False):
        base = Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData' / 'Local'))
        if not base.is_absolute():
            raise ValueError('Local AppData must be an absolute path.')
        return base / 'Umalytics'
    return Path(__file__).resolve().parents[1] / '.cache' / 'application-data'


def prepare_storage(directory):
    directory = Path(directory)
    if linked(directory):
        raise ValueError('Linked data directory refused.')
    directory.mkdir(parents=True, exist_ok=True)
    for name in ('races', 'capture', 'cache'):
        folder = directory / name
        if linked(folder):
            raise ValueError('Linked storage directory refused.')
        folder.mkdir(exist_ok=True)
    migrate_capture(directory)
    return directory


def migrate_capture(directory):
    """Rename only the collector's recognized files after a verified copy.

    A conflicting CA is an error, never a reason to create a new identity.
    Unknown files remain in place for manual inspection.
    """
    old, new = directory / 'proxy', directory / 'capture'
    if linked(old):
        raise ValueError('Linked legacy capture directory refused.')
    if not old.is_dir():
        return
    suffixes = ('ca.pem', 'ca.p12', 'ca-cert.pem', 'ca-cert.cer', 'ca-cert.p12', 'dhparam.pem')
    originals = []
    for suffix in suffixes:
        source = old / ('mitmproxy-' + suffix)
        target = new / ('umalytics-' + suffix)
        if not source.exists():
            continue
        if linked(source) or not source.is_file() or source.stat().st_size > 1024 * 1024:
            raise ValueError('Unexpected legacy capture file.')
        raw = source.read_bytes()
        if linked(target) or target.exists() and target.read_bytes() != raw:
            raise ValueError('Conflicting capture identity; original files were preserved.')
        atomic_bytes(target, raw)
        if target.read_bytes() != raw or source.read_bytes() != raw:
            raise ValueError('Capture migration verification failed.')
        originals.append((source, target, hashlib.sha256(raw).digest()))
    # Complete and verify all files before removing any originals.
    for source, target, digest in originals:
        if hashlib.sha256(source.read_bytes()).digest() != digest or hashlib.sha256(target.read_bytes()).digest() != digest:
            raise ValueError('Capture migration changed during verification.')
    for source, _, _ in originals:
        source.unlink()
    if not any(old.iterdir()):
        old.rmdir()


def cleanup_legacy_notices(directory, embedded):
    """Only delete copies whose exact text is present in the embedded notice."""
    report = []
    standalone = directory / 'THIRD-PARTY-NOTICES.txt'
    if standalone.is_file() and not linked(standalone):
        if standalone.read_bytes() == embedded:
            standalone.unlink()
        else:
            report.append('Legacy THIRD-PARTY-NOTICES.txt retained: its contents differ from embedded notices.')
    folder = directory / 'licenses'
    if not folder.exists():
        return report
    if linked(folder):
        return report + ['Legacy licenses retained: linked directory.']
    # Old generated trees are recognized by their inventory and leaf content.
    files = list(folder.rglob('*'))
    if any(linked(path) for path in files):
        return report + ['Legacy licenses retained: linked entries.']
    leaves = [path for path in files if path.is_file()]
    inventory = folder / 'DEPENDENCIES.txt'
    recognized = inventory in leaves and (folder / 'Python-LICENSE.txt') in leaves
    if recognized:
        lines = inventory.read_bytes().splitlines()
        recognized = bool(lines) and all(line and line in embedded and line.startswith((b'Python ', b'Python package ', b'Frontend ', b'Rust crate ')) for line in lines)
    def generated_notice(path):
        relative = path.relative_to(folder)
        if relative.as_posix() in ('DEPENDENCIES.txt', 'Python-LICENSE.txt'):
            return True
        return (len(relative.parts) == 3 and relative.parts[0] in ('python', 'frontend', 'rust')
                and re.search(r'(LICENSE|LICENCE|COPYING|NOTICE)', path.name, re.I))
    recognized = recognized and all(
        path.stat().st_size <= 8 * 1024 * 1024 and generated_notice(path)
        and (path == inventory or path.read_bytes() in embedded) for path in leaves)
    if recognized:
        for path in leaves:
            path.unlink()
        for path in sorted((p for p in files if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
            path.rmdir()
        folder.rmdir()
    else:
        report.append('Legacy licenses retained: generated provenance or embedded content could not be verified.')
    return report
