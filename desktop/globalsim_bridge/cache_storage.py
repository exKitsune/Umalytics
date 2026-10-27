"""Lossless, bounded cache storage. Authentication stays with the runtime gate."""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import zlib

SHARED = 'shared-gzip-v1'
HEX = re.compile(r'[a-f0-9]{64}')
CACHE_LOCK = threading.RLock()


def unpack(raw, limit):
    if len(raw) > limit + 8192:
        raise ValueError('Stored cache exceeds size limit.')
    if raw.startswith(b'\x1f\x8b'):
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
                raw = stream.read(limit + 1)
        except (OSError, EOFError, zlib.error) as error:
            raise ValueError('Invalid compressed cache.') from error
    if len(raw) > limit:
        raise ValueError('Expanded cache exceeds size limit.')
    return raw


def atomic_bytes(path, raw):
    path = Path(path)
    if path.is_symlink() or path.parent.is_symlink():
        raise ValueError('Linked cache file refused.')
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix='pending-', dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def blob_path(path, digest):
    path = Path(path)
    if path.parent.name != 'globalsim-modeled-v1':
        raise ValueError('Unexpected modeled cache directory.')
    if not isinstance(digest, str) or HEX.fullmatch(digest) is None:
        raise ValueError('Invalid modeled cache digest.')
    return path.parent.parent.parent / 'modeled-blobs-v1' / (digest + '.json.gz')


def read_blob(path, entry, limit):
    blob = blob_path(path, entry['modeledSha256'])
    if blob.is_symlink() or blob.parent.is_symlink() or blob.stat().st_size > limit + 8192:
        raise ValueError('Invalid modeled cache blob.')
    with blob.open('rb') as stream:
        raw = unpack(stream.read(limit + 8193), limit)
    if hashlib.sha256(raw).hexdigest() != entry['modeledSha256']:
        raise ValueError('Modeled cache blob changed.')
    return raw


def write_shared(path, metadata, model_bytes):
    with CACHE_LOCK:
        _write_shared(path, metadata, model_bytes)


def _write_shared(path, metadata, model_bytes):
    digest = hashlib.sha256(model_bytes).hexdigest()
    if metadata['modeledSha256'] != digest:
        raise ValueError('Modeled cache digest changed.')
    blob = blob_path(path, digest)
    # Identical payloads share a file across engine/context namespaces. The
    # per-key authenticated header is committed only after the blob is durable.
    # Rewriting a corrupt existing blob also repairs future cache misses.
    if not blob.is_file() or blob.is_symlink():
        atomic_bytes(blob, gzip.compress(model_bytes, compresslevel=3, mtime=0))
    else:
        try:
            read_blob(path, metadata, len(model_bytes))
        except (OSError, ValueError, EOFError):
            atomic_bytes(blob, gzip.compress(model_bytes, compresslevel=3, mtime=0))
    header = {k: v for k, v in metadata.items() if k != 'modeled'}
    header['storage'] = SHARED
    atomic_bytes(path, json.dumps(header, sort_keys=True, separators=(',', ':')).encode())


def summary_bytes(summary):
    raw = json.dumps(summary).encode()
    packed = gzip.compress(raw, compresslevel=1, mtime=0)
    return packed if len(packed) < len(raw) else raw


def summary_value(raw):
    return json.loads(unpack(raw, 4 * 1024 * 1024) if isinstance(raw, bytes) else raw)
