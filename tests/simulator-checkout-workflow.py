"""Exercise real Git checkout conversion for byte-pinned instrumentation inputs."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
INPUTS = ('simulation/instrumentation/engine.patch',
          'simulation/instrumentation/decision_trace.rs')


def main():
    expected = {name: (ROOT / name).read_bytes() for name in INPUTS}
    # Isolate the temporary index and configuration from the developer's checkout.
    environment = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    (ROOT / '.cache').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='sim-checkout-', dir=ROOT / '.cache') as temporary:
        base = Path(temporary)
        repository = base / 'repository'
        repository.mkdir()

        def git(*args):
            return subprocess.run(['git', '-c', 'safe.directory=' + repository.as_posix(),
                '-C', str(repository), *args], env=environment, check=True,
                capture_output=True, timeout=30)

        git('init', '--quiet')
        for name in ('.gitattributes', *INPUTS):
            target = repository / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((ROOT / name).read_bytes())
        git('-c', 'core.autocrlf=false', 'add', '--', '.gitattributes', *INPUTS)
        for mode in ('false', 'true', 'input'):
            checkout = base / mode
            checkout.mkdir()
            git('-c', 'core.autocrlf=' + mode, 'checkout-index', '--all',
                '--prefix=' + checkout.as_posix() + '/')
            for name, original in expected.items():
                assert (checkout / name).read_bytes() == original, (
                    f'core.autocrlf={mode} changed pinned input bytes: {name}')
    print(json.dumps({'checkoutModes': ['false', 'true', 'input'], 'byteIdentity': 'passed',
                      'sha256': {name: hashlib.sha256(raw).hexdigest() for name, raw in expected.items()}}))


if __name__ == '__main__':
    main()
