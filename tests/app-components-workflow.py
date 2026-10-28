"""Isolated component matching, frontend handoff and collector-reopen lifecycle."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from app_components import append_components, read_components
from frontend import DesktopFrontend
from updater import UpdateController

with tempfile.TemporaryDirectory(prefix='umalytics-components-') as directory:
    root = Path(directory)
    resources = root / 'resources/desktop'
    resources.mkdir(parents=True)
    resources.joinpath('build-info.json').write_text(json.dumps({'version': '0.2.0', 'buildNumber': 0}))
    resources.joinpath('update-public-key.txt').write_text('01' * 32)
    data = root / 'data'
    runtime = data / 'runtime/UmalyticsCollector.exe'
    runtime.parent.mkdir(parents=True)
    runtime.write_bytes(b'unchanged collector')
    digest = hashlib.sha256(runtime.read_bytes()).hexdigest()
    old, new = root / 'Umalytics.exe', root / 'new.exe'
    old.write_bytes(b'old app')
    new.write_bytes(b'new app')
    for path, number in ((old, 1), (new, 2)):
        append_components(path, digest, {'version': f'0.2.{number}', 'buildNumber': number})
    active = [True]
    controller = UpdateController(data, old, resources.parent, game_active=lambda: active[0])
    assert controller.can_keep_collector(new)
    controller.collector_sha256 = 'a' * 64
    assert not controller.can_keep_collector(new), 'On-disk hash must not override the running collector identity'
    controller.collector_sha256 = None
    controller.status()
    assert controller.version == '0.2.1'
    runtime.write_bytes(b'tampered collector')
    assert not controller.can_keep_collector(new)
    runtime.write_bytes(b'unchanged collector')
    legacy = root / 'legacy.exe'
    legacy.write_bytes(b'legacy app without component identity')
    assert read_components(legacy) is None and not controller.can_keep_collector(legacy)
    changed = root / 'changed.exe'
    changed.write_bytes(b'changed app')
    append_components(changed, 'a' * 64, {'version': '0.2.3', 'buildNumber': 3})
    assert not controller.can_keep_collector(changed)
    controller.phase, controller.restart_token, controller.helper_started = 'waiting-for-game', 'token', __import__('time').monotonic()
    try:
        controller.restart('token')
        raise AssertionError('Changed collector restarted during game')
    except ValueError:
        pass
    controller.app_only = True
    assert controller.restart('token')['phase'] == 'restarting'
    old.write_bytes(new.read_bytes())
    controller.manifest = {'buildNumber': 2, 'version': '0.2.2', 'bytes': new.stat().st_size}
    assert controller.status()['currentVersion'] == '0.2.2'
    assert controller.phase == 'idle'
    marker = data / 'cache/collector-reopen.json'
    marker.parent.mkdir(parents=True)
    marker.write_text('{}')
    active[0] = False
    assert controller.status()['reopenGameRequired']
    active[0] = True
    assert controller.status()['reopenGameRequired'], 'A game launch must not substitute for update verification'
    marker.unlink()  # The native helper removes this after verified completion.
    assert not controller.status()['reopenGameRequired']
    frontend = DesktopFrontend(data)
    base = data / 'runtime/frontend'
    for name, content in (('a', b'old frontend'), ('b', b'new frontend')):
        folder = base / (name * 64)
        folder.mkdir(parents=True)
        folder.joinpath('index.html').write_bytes(content)
        base.joinpath('current.json').write_text(json.dumps({'schemaVersion': 1, 'bundle': name * 64}))
        assert frontend.asset('/')[0] == content
    assert frontend.asset('/../../UmalyticsCollector.exe') is None
    base.joinpath('current.json').write_text('invalid JSON')
    assert frontend.asset('/')[0] == b'new frontend'
print('Component identity, active-game gating, version handoff, reopen prompt and frontend swap passed.')
