"""Authenticate a saved source archive and its app-owned compact observer overlay."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

from simulator_source import source_lock, verify_source

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM_REVISION = source_lock()['upstreamRevision']


def instrumentation():
    files = ['simulation/instrumentation/engine.patch', 'simulation/instrumentation/decision_trace.rs', 'simulation/instrumentation/compact-trace.patch']
    pins = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files}
    identity = hashlib.sha256(json.dumps(pins, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'upstreamCommit': UPSTREAM_REVISION, 'schema': 'umalytics-decisions-v2', 'files': pins, 'sha256': identity}


def validate_prepared_source(stage):
    identity = json.loads((stage / 'instrumentation.json').read_text(encoding='utf-8'))
    if any(identity.get(k) != v for k, v in instrumentation().items()):
        raise ValueError('Saved instrumentation does not match the reviewed patch.')
    actual = hashlib.sha256(b''.join(
        p.relative_to(stage).as_posix().encode() + b'\0' + p.read_bytes()
        for p in sorted((stage / 'src').rglob('*')) if p.is_file())).hexdigest()
    lock = source_lock()
    if actual != identity.get('sourceSha256') or actual != lock.get('preparedSourceSha256', lock['sourceSha256']):
        raise ValueError('Saved instrumented source differs from the reviewed source hash.')
    return identity


def prepare(source):
    source = source.resolve()
    revision = verify_source(source)['revision']
    git = ['git', '-c', 'safe.directory=' + source.as_posix(), '-C', str(source)]
    archive = subprocess.check_output([*git, 'archive', revision])
    target = ROOT / '.cache/globalsim-traced'
    target.parent.mkdir(exist_ok=True)
    # The private repository already contains tracing. Never reapply its patch
    # or copy uncommitted files; only replace this exact task-owned build cache.
    with tempfile.TemporaryDirectory(prefix='trace-source-', dir=target.parent) as temporary:
        stage = Path(temporary)
        with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
            bundle.extractall(stage, filter='data')
        # Authenticate the saved source before applying the app-owned observer
        # overlay. The private checkout and its original tracing stay untouched.
        baseline = hashlib.sha256(b''.join(p.relative_to(stage).as_posix().encode() + b'\0' + p.read_bytes()
            for p in sorted((stage / 'src').rglob('*')) if p.is_file())).hexdigest()
        if baseline != source_lock()['sourceSha256']:
            raise ValueError('Saved source differs from the reviewed source hash.')
        shutil.copyfile(ROOT / 'simulation/instrumentation/decision_trace.rs', stage / 'src/decision_trace.rs')
        patch = ROOT / 'simulation/instrumentation/compact-trace.patch'
        subprocess.run(['git', 'apply', '--unidiff-zero', '--check', str(patch)], cwd=stage, check=True, capture_output=True)
        subprocess.run(['git', 'apply', '--unidiff-zero', str(patch)], cwd=stage, check=True, capture_output=True)
        digest = hashlib.sha256(b''.join(p.relative_to(stage).as_posix().encode() + b'\0' + p.read_bytes()
            for p in sorted((stage / 'src').rglob('*')) if p.is_file())).hexdigest()
        (stage / 'instrumentation.json').write_text(json.dumps({**instrumentation(), 'sourceSha256': digest}), encoding='utf-8')
        identity = validate_prepared_source(stage)
        if target.resolve() != ROOT.resolve() / '.cache/globalsim-traced' or target.is_symlink():
            raise ValueError('Unsafe simulator source cache path')
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(stage, target)
    return identity


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    print(json.dumps(prepare(parser.parse_args().source), indent=2))
