"""Run the real no-proxy service for one owning functional-workflow process.

Windows forcibly terminates timed-out Node drivers without running their finally
blocks. The owner identity prevents their disposable Python service from leaking
after cancellation, even when a virtualenv launcher adds another process layer.
"""
import os
from pathlib import Path
import sys
import threading

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
from processes import process_identity
import service
import updater

resources, owner_pid = Path(sys.argv[1]).resolve(), int(sys.argv[2])
arguments = sys.argv[3:]
if '--no-proxy' not in arguments or '--data-dir' not in arguments or '--port' not in arguments:
    raise SystemExit('The functional fixture requires explicit isolated no-proxy storage and port.')
if int(arguments[arguments.index('--port') + 1]) in (4317, 4327):
    raise SystemExit('The functional fixture refuses installed-app ports.')
owner = process_identity(owner_pid)
closed = threading.Event()


class OfflineUpdateController(updater.UpdateController):
    def start(self):
        # These workflows exercise race history/reference persistence. Signed
        # release transport and scheduler behavior have their own whole-service
        # workflows; avoid unrelated GitHub traffic on every synthetic boot.
        pass


updater.UpdateController = OfflineUpdateController


def watch_owner():
    while not closed.wait(.2):
        try:
            if process_identity(owner_pid) == owner:
                continue
        except OSError:
            pass
        # This process owns only disposable no-proxy data; it has no collector
        # descendants or installed app to stop when its workflow is cancelled.
        os._exit(1)


threading.Thread(target=watch_owner, daemon=True).start()
service.RESOURCE_ROOT = resources
sys.argv = [sys.argv[0], *arguments]
try:
    raise SystemExit(service.main())
finally:
    closed.set()
