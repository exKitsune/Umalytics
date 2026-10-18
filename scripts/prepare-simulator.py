"""Reproduce the instrumented source from a pinned upstream Git archive."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'efc2decdfeaff227ada0e9847f5deceb42c3b97f'


def instrumentation():
    files = ['simulation/instrumentation/engine.patch', 'simulation/instrumentation/decision_trace.rs']
    pins = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files}
    identity = hashlib.sha256(json.dumps(pins, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'upstreamCommit': REVISION, 'schema': 'umalytics-decisions-v1', 'files': pins, 'sha256': identity}


def prepare(source):
    source = source.resolve()
    git = ['git', '-c', 'safe.directory=' + source.as_posix(), '-C', str(source)]
    archive = subprocess.check_output([*git, 'archive', REVISION])
    target = ROOT / '.cache/globalsim-traced'
    target.parent.mkdir(exist_ok=True)
    # Build in a fresh temporary directory; never apply a patch twice or copy
    # uncommitted upstream files. Only replace this exact task-owned source cache.
    with tempfile.TemporaryDirectory(prefix='trace-source-', dir=target.parent) as temporary:
        stage = Path(temporary)
        with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
            bundle.extractall(stage, filter='data')
        subprocess.run(['git', 'apply', '--check', str(ROOT / 'simulation/instrumentation/engine.patch')], cwd=stage, check=True, env={**os.environ, 'GIT_CEILING_DIRECTORIES': str(stage.parent)})
        subprocess.run(['git', 'apply', str(ROOT / 'simulation/instrumentation/engine.patch')], cwd=stage, check=True, env={**os.environ, 'GIT_CEILING_DIRECTORIES': str(stage.parent)})
        shutil.copyfile(ROOT / 'simulation/instrumentation/decision_trace.rs', stage / 'src/decision_trace.rs')
        identity = instrumentation()
        identity['sourceSha256'] = hashlib.sha256(b''.join(
            p.relative_to(stage).as_posix().encode() + b'\0' + p.read_bytes()
            for p in sorted((stage / 'src').rglob('*')) if p.is_file())).hexdigest()
        (stage / 'instrumentation.json').write_text(json.dumps(identity, indent=2) + '\n', encoding='utf-8')
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
