"""Stage a locally built pinned Windows worker and exact offline resources."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
from globalsim_bridge.adapter import ReferenceData, GLOBALSIM_COMMIT, APP_BASELINE_PINS, ENGINE_FILE_PINS

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--engine', type=Path, required=True)
    args = parser.parse_args()
    git = ['git', '-c', 'safe.directory=' + args.source.resolve().as_posix(), '-C', str(args.source)]
    revision = subprocess.check_output([*git, 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output([*git, 'diff', '--name-only', 'HEAD'], text=True).strip()
    if revision != GLOBALSIM_COMMIT or dirty:
        raise ValueError('Simulator resources must be the unmodified pinned checkout.')
    binary = args.engine.read_bytes()
    if not binary.startswith(b'MZ'):
        raise ValueError('Windows packaging requires a Windows PE worker.')
    import importlib.util
    module_spec = importlib.util.spec_from_file_location('prepare_simulator', ROOT / 'scripts/prepare-simulator.py')
    prepare_module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(prepare_module)
    instrumentation = json.loads((ROOT / '.cache/globalsim-traced/instrumentation.json').read_text())
    if any(instrumentation.get(k) != v for k, v in prepare_module.instrumentation().items()):
        raise ValueError('Simulator instrumentation does not match the reviewed patch.')
    staged = ROOT / '.cache/globalsim-traced'
    source_hash = hashlib.sha256(b''.join(p.relative_to(staged).as_posix().encode() + b'\0' + p.read_bytes()
        for p in sorted((staged / 'src').rglob('*')) if p.is_file())).hexdigest()
    if source_hash != instrumentation['sourceSha256'] or b'umalytics-decisions-v1' not in binary:
        raise ValueError('Prepared source changed or worker lacks decision instrumentation.')
    artifact = hashlib.sha256(binary).hexdigest()
    references = ReferenceData.load(ROOT, args.source)
    ident = 'globalsim-v74-win-' + artifact[:16]
    relative = Path('simulation/bundles') / ident
    target = ROOT / relative
    target.mkdir(parents=True, exist_ok=True)
    (target / 'worker.exe').write_bytes(binary)
    for path in APP_BASELINE_PINS:
        dest = target / 'app' / path; dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / path, dest)
    for path in ENGINE_FILE_PINS:
        dest = target / 'engine' / path; dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.source / path, dest)
    shutil.copytree(args.source / 'data/course_geometry', target / 'engine/data/course_geometry', dirs_exist_ok=True)
    for path in args.source.glob('*LICENSE*'):
        if path.is_file():
            shutil.copyfile(path, target / path.name)
        elif path.is_dir():
            shutil.copytree(path, target / path.name, dirs_exist_ok=True)
    (target / 'build.json').write_text(json.dumps({'upstreamCommit': revision, 'artifactSha256': artifact,
        'dataIdentity': references.identity, 'instrumentation': instrumentation, 'cargoLockSha256': hashlib.sha256((ROOT/'simulation/simulator-worker/Cargo.lock').read_bytes()).hexdigest()}, indent=2), encoding='utf-8')
    manifest_path = ROOT / 'simulation/installed-bundles.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'schemaVersion': 1, 'bundles': []}
    row = dict(kind='simulation', engine_id=ident, version='efc2decd-v74', profile='v74', artifact_sha256=artifact,
        decisionTraceSchema='umalytics-decisions-v1', instrumentationSha256=instrumentation['sha256'],
        data_sha256=references.fingerprint, artifact=(relative/'worker.exe').as_posix(),
        appRoot=(relative/'app').as_posix(), resourceRoot=(relative/'engine').as_posix())
    manifest['bundles'] = [item for item in manifest['bundles'] if item['engine_id'] != ident] + [row]
    manifest_path.write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(row, indent=2))

if __name__ == '__main__':
    main()
