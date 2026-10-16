"""One-time cleanup after the new root snapshot has a working public release."""
import argparse
import json
import os
import re
from urllib.error import HTTPError
from urllib.request import Request, urlopen

REPOSITORY = "exKitsune/Umalytics"
API_ROOT = f"https://api.github.com/repos/{REPOSITORY}"
LEGACY_VERSION = re.compile(r"v0\.2\.(\d+)$")


def api(path, method="GET", data=None):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "Umalytics-maintenance"}
    if token := os.environ.get("GH_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = Request(f"{API_ROOT}/{path}", headers=headers, method=method,
                      data=json.dumps(data).encode() if data is not None else None)
    try:
        with urlopen(request, timeout=30) as response:
            body = response.read()
            return json.loads(body) if body else None
    except HTTPError as error:
        if method == "DELETE" and error.code == 404:
            return None
        raise


def pages(path, key=None):
    result = []
    for page in range(1, 101):
        response = api(f"{path}?per_page=100&page={page}")
        items = response[key] if key else response
        result.extend(items)
        if len(items) < 100:
            return result
    raise RuntimeError("Unexpectedly large cleanup inventory; stopping.")


def legacy(tag, current_number):
    match = LEGACY_VERSION.fullmatch(tag)
    return bool(match and int(match[1]) < current_number)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--apply", action="store_true", help="Delete the verified legacy entries; otherwise only list them.")
    args = parser.parse_args()
    commit = api(f"commits/{args.commit}")
    if commit["parents"]:
        print("Ordinary commit; no history cleanup needed.")
        return
    if api("commits/master")["sha"] != args.commit:
        raise RuntimeError("The root snapshot is no longer master; stopping.")
    current_run = api(f"actions/runs/{args.run_id}")
    if current_run["head_sha"] != args.commit or current_run["run_number"] <= 10:
        raise RuntimeError("The release run does not match the new snapshot.")
    release = api("releases/latest")
    expected_tag = f"v0.2.{current_run['run_number']}"
    if release["tag_name"] != expected_tag or release["draft"] or release["prerelease"]:
        raise RuntimeError("The new public release is not ready.")
    if api(f"commits/{expected_tag}")["sha"] != args.commit:
        raise RuntimeError("The new release points to another commit.")
    required_assets = {"Umalytics.exe", "release-manifest.json", "release-manifest.sig"}
    if not required_assets <= {asset["name"] for asset in release["assets"] if asset["size"] > 0}:
        raise RuntimeError("The new release is missing its executable or signed manifest.")

    releases = [item for item in pages("releases") if legacy(item["tag_name"], current_run["run_number"])]
    tags = [item for item in pages("tags") if legacy(item["name"], current_run["run_number"])]
    runs = [item for item in pages("actions/runs", "workflow_runs")
            if item["id"] != args.run_id and item["created_at"] < current_run["created_at"]
            and item["head_sha"] != args.commit]
    if any(item["status"] != "completed" for item in runs):
        raise RuntimeError("An older workflow is still running; stopping.")
    deployments = [item for item in pages("deployments") if item["environment"] == "github-pages"]
    current_deployments = [item for item in deployments if item["sha"] == args.commit]
    if not current_deployments:
        raise RuntimeError("The new site's deployment is not ready.")
    current_deployment = max(current_deployments, key=lambda item: item["id"])
    statuses = api(f"deployments/{current_deployment['id']}/statuses?per_page=1")
    if not statuses or statuses[0]["state"] != "success":
        raise RuntimeError("The new site's deployment has not succeeded.")
    old_deployments = [item for item in deployments if item["sha"] != args.commit
                       and item["created_at"] < current_run["created_at"]]
    print(json.dumps({"apply": args.apply, "keepRelease": expected_tag,
                      "removeReleases": [item["tag_name"] for item in releases],
                      "removeTags": [item["name"] for item in tags], "removeWorkflowRuns": len(runs),
                      "removeDeployments": len(old_deployments)}))
    if not args.apply:
        return
    if not os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_REPOSITORY") != REPOSITORY:
        raise RuntimeError("Apply is restricted to this repository's authenticated workflow.")
    if api("commits/master")["sha"] != args.commit:
        raise RuntimeError("Master changed during the cleanup inventory; stopping.")
    # Release removal must precede tag removal, including for immutable releases.
    for item in releases:
        api(f"releases/{item['id']}", "DELETE")
    for item in tags:
        api(f"git/refs/tags/{item['name']}", "DELETE")
    # Retire historical records only; keep the successfully published current site.
    for item in old_deployments:
        api(f"deployments/{item['id']}/statuses", "POST", {"state": "inactive", "auto_inactive": False})
        api(f"deployments/{item['id']}", "DELETE")
    for item in runs:
        api(f"actions/runs/{item['id']}", "DELETE")
    print("Legacy releases, tags, deployments and workflow runs removed.")


if __name__ == "__main__":
    main()
