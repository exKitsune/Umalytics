"""Exercise the maintenance command against a local GitHub-shaped API."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

spec = importlib.util.spec_from_file_location("retirement", Path(__file__).resolve().parents[1] / "scripts/retire-legacy-history.py")
command = importlib.util.module_from_spec(spec)
spec.loader.exec_module(command)
snapshot = "a" * 40
older = "b" * 40
assets = [{"name": name, "size": 1} for name in ("Umalytics.exe", "release-manifest.json", "release-manifest.sig")]
state = {}
deleted = []
inactivated = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        key = self.path.lstrip("/")
        if key not in state:
            self.send_error(404)
            return
        body = json.dumps(state[key]).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_DELETE(self):
        assert self.headers["Authorization"] == "Bearer fixture-token"
        if self.path.startswith('/deployments/'):
            assert int(self.path.split('/')[2]) in inactivated
        deleted.append(self.path.lstrip("/"))
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        assert self.headers["Authorization"] == "Bearer fixture-token"
        assert self.headers['Content-Type'] == 'application/json'
        assert self.path == '/deployments/7/statuses'
        assert json.loads(self.rfile.read(int(self.headers['Content-Length']))) == {'state': 'inactive', 'auto_inactive': False}
        inactivated.append(7)
        self.send_response(201)
        self.end_headers()


def reset():
    deleted.clear()
    inactivated.clear()
    state.clear()
    state.update({
        f"commits/{snapshot}": {"parents": []},
        "commits/master": {"sha": snapshot},
        "commits/v0.2.11": {"sha": snapshot},
        "actions/runs/11": {"head_sha": snapshot, "run_number": 11, "created_at": "2026-10-16T04:00:00Z"},
        "releases/latest": {"tag_name": "v0.2.11", "draft": False, "prerelease": False, "assets": assets},
        "releases?per_page=100&page=1": [{"id": n, "tag_name": f"v0.2.{n}"} for n in (7, 10, 11, 12)],
        "tags?per_page=100&page=1": [{"name": tag} for tag in ("v0.2.7", "v0.2.10", "v0.2.11", "v0.2.12", "keep")],
        "deployments?per_page=100&page=1": [
            {"id": 7, "sha": older, "environment": "github-pages", "created_at": "2026-10-15T04:00:00Z"},
            {"id": 11, "sha": snapshot, "environment": "github-pages", "created_at": "2026-10-16T04:10:00Z"},
            {"id": 12, "sha": older, "environment": "github-pages", "created_at": "2026-10-16T05:00:00Z"},
            {"id": 6, "sha": older, "environment": "other", "created_at": "2026-10-15T04:00:00Z"},
        ],
        "deployments/11/statuses?per_page=1": [{"state": "success"}],
        "actions/runs?per_page=100&page=1": {"workflow_runs": [
            {"id": 7, "head_sha": older, "created_at": "2026-10-15T04:00:00Z", "status": "completed"},
            {"id": 11, "head_sha": snapshot, "created_at": "2026-10-16T04:00:00Z", "status": "in_progress"},
            {"id": 12, "head_sha": older, "created_at": "2026-10-16T05:00:00Z", "status": "in_progress"},
        ]},
    })


def run(apply=False, failure=False):
    sys.argv = ["retire-legacy-history.py", "--commit", snapshot, "--run-id", "11"] + (["--apply"] if apply else [])
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            command.main()
    except RuntimeError:
        assert failure
        assert not deleted
        assert not inactivated
    else:
        assert not failure


with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    command.API_ROOT = f"http://127.0.0.1:{server.server_port}"
    os.environ["GH_TOKEN"] = "fixture-token"
    os.environ["GITHUB_REPOSITORY"] = command.REPOSITORY
    reset()
    run()
    assert not deleted
    assert not inactivated
    run(apply=True)
    assert deleted == ["releases/7", "releases/10", "git/refs/tags/v0.2.7", "git/refs/tags/v0.2.10", "deployments/7", "actions/runs/7"]
    assert inactivated == [7]
    # A second root snapshot must retire releases after the first cleanup too.
    reset()
    state['actions/runs/11']['run_number'] = 17
    state['commits/v0.2.17'] = {'sha': snapshot}
    state['releases/latest']['tag_name'] = 'v0.2.17'
    run(apply=True)
    assert deleted == ['releases/7', 'releases/10', 'releases/11', 'releases/12',
                       'git/refs/tags/v0.2.7', 'git/refs/tags/v0.2.10',
                       'git/refs/tags/v0.2.11', 'git/refs/tags/v0.2.12', 'deployments/7', 'actions/runs/7']
    reset()
    state[f"commits/{snapshot}"]["parents"] = [{"sha": older}]
    run(apply=True)
    assert not deleted
    for key, value in (("commits/master", {"sha": older}), ("commits/v0.2.11", {"sha": older}),
                       ("releases/latest", {"tag_name": "v0.2.10", "draft": False, "prerelease": False, "assets": assets})):
        reset()
        state[key] = value
        run(apply=True, failure=True)
    reset()
    state["releases/latest"]["assets"] = assets[:1]
    run(apply=True, failure=True)
    reset()
    state["actions/runs?per_page=100&page=1"]["workflow_runs"][0]["status"] = "in_progress"
    run(apply=True, failure=True)
    for statuses in ([], [{"state": "failure"}], [{"state": "inactive"}], [{"state": "pending"}]):
        reset()
        state['deployments/11/statuses?per_page=1'] = statuses
        run(apply=True, failure=True)
    reset()
    state['deployments?per_page=100&page=1'] = []
    run(apply=True, failure=True)
    reset()
    os.environ.pop("GH_TOKEN")
    run(apply=True, failure=True)
    server.shutdown()
    worker.join()
print("History retirement workflow passed: dry-run, bounded cleanup, release and site gates, authentication.")
