"""Raw archive fidelity, nonblocking capture, session deletion, and shutdown."""
import base64
import gzip
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/proxy'))
import development_capture as capture


def flow(body, identifier='fixture'):
    message = SimpleNamespace(raw_content=body, method='POST', scheme='https',
        host='fixture.invalid', port=443, path='/fixture', http_version='HTTP/1.1',
        headers=SimpleNamespace(fields=[(b'authorization', b'SYNTHETIC_SECRET')]))
    return SimpleNamespace(id=identifier, request=message, response=None, error=None)


def enable(archive, session):
    archive.flag.parent.mkdir(parents=True, exist_ok=True)
    archive.flag.write_text(json.dumps({'enabled': True, 'session': session}))


with tempfile.TemporaryDirectory(prefix='debug-writer-', dir=ROOT / '.cache') as temporary:
    root = Path(temporary)
    archive = capture.DevelopmentCapture(root / 'snapshot')
    enable(archive, 'first')
    started, release = threading.Event(), threading.Event()
    original_compress = capture.gzip.compress

    def slow_compress(*args, **kwargs):
        started.set()
        assert release.wait(10), 'Writer was never released'
        return original_compress(*args, **kwargs)

    results = []
    capture.gzip.compress = slow_compress
    try:
        item = flow(b'original body')
        archive.submit(item, 'request', results.append)
        assert started.wait(5)
        # Mutating the flow after its hook must not change queued evidence.
        item.request.raw_content = b'changed body'
        item.request.headers.fields[:] = [(b'changed', b'value')]
        item.request.path = '/changed'
        before = time.perf_counter()
        archive.submit(flow(b'next body', 'second'), 'request', results.append)
        enqueue_seconds = time.perf_counter() - before
        assert enqueue_seconds < .2, 'Network hook waited for compression/disk work'
    finally:
        release.set()
        archive.close()
        capture.gzip.compress = original_compress
    records = [json.loads(gzip.decompress(p.read_bytes())) for p in sorted(archive.folder.glob('*.json.gz'))]
    assert [r['flowId'] for r in records] == ['fixture', 'second']
    assert base64.b64decode(records[0]['request']['bodyBase64']) == b'original body'
    assert records[0]['request']['headers'] == [['authorization', 'SYNTHETIC_SECRET']]
    assert records[0]['request']['path'] == '/fixture'
    assert results == ['development_captures_written'] * 2

    # Clear may finish while compression is in flight. Re-enabling capture must
    # not resurrect records from the previous session.
    archive = capture.DevelopmentCapture(root / 'clear')
    enable(archive, 'before-clear')
    started.clear()
    release.clear()
    capture.gzip.compress = slow_compress
    try:
        archive.submit(flow(b'old secret'), 'request', results.append)
        assert started.wait(5)
        with capture.capture_guard(archive.root):
            archive.flag.write_text('{"enabled":false}')
            if archive.folder.exists():
                for path in archive.folder.iterdir():
                    path.unlink()
        enable(archive, 'after-clear')
        archive.submit(flow(b'new secret', 'new-session'), 'request', results.append)
    finally:
        release.set()
        archive.close()
        capture.gzip.compress = original_compress
    records = [json.loads(gzip.decompress(p.read_bytes())) for p in archive.folder.glob('*.json.gz')]
    assert len(records) == 1 and records[0]['flowId'] == 'new-session'

    # A stalled disk cannot grow the queue indefinitely or block the proxy.
    archive = capture.DevelopmentCapture(root / 'bounded')
    enable(archive, 'bounded')
    started.clear()
    release.clear()
    capture.gzip.compress = slow_compress
    counts = []
    try:
        archive.submit(flow(b'x'), 'request', counts.append)
        assert started.wait(5)
        for number in range(140):
            archive.submit(flow(b'x', str(number)), 'request', counts.append)
        assert 'development_captures_dropped' in counts
        assert archive.queue.qsize() == 128
    finally:
        release.set()
        archive.close()
        capture.gzip.compress = original_compress
    assert len(list(archive.folder.glob('*.json.gz'))) == 129
    assert archive.pending_bytes == 0

    # Measure work paid on the network thread with identical synthetic payloads.
    body = os.urandom(512 * 1024)
    direct = capture.DevelopmentCapture(root / 'direct')
    queued = capture.DevelopmentCapture(root / 'queued')
    enable(direct, 'benchmark')
    enable(queued, 'benchmark')
    before = time.perf_counter()
    for number in range(12):
        direct.record(flow(body, str(number)), 'request')
    direct_seconds = time.perf_counter() - before
    before = time.perf_counter()
    for number in range(12):
        queued.submit(flow(body, str(number)), 'request', lambda _: None)
    queued_seconds = time.perf_counter() - before
    queued.close()
    assert len(list(queued.folder.glob('*.json.gz'))) == 12
    print(json.dumps({'workflow': 'passed', 'synchronousHookMs': round(direct_seconds * 1000, 2),
        'queuedHookMs': round(queued_seconds * 1000, 2), 'records': 12,
        'payloadBytesEach': len(body), 'blockedWriterEnqueueMs': round(enqueue_seconds * 1000, 2)}))
