"""Exercise publication auditing and JSON generation in a disposable Git repo."""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from public_json import TERMS, public_json


with tempfile.TemporaryDirectory(prefix='public-inventory-') as directory:
    folder = Path(directory)
    (folder / '.gitignore').write_text('__pycache__/\n*.pyc\n', encoding='utf-8')
    (folder / 'scripts').mkdir()
    for name in ('audit-public-files.py', 'public_json.py', 'public-json.mjs'):
        shutil.copyfile(ROOT / 'scripts' / name, folder / 'scripts' / name)
    subprocess.run(['git', 'init', '-q', str(folder)], check=True)

    def audit(staged=False, success=True):
        result = subprocess.run([sys.executable, str(folder / 'scripts/audit-public-files.py')]
                                + (['--staged'] if staged else []), cwd=folder,
                                capture_output=True, text=True)
        assert (result.returncode == 0) == success, result.stdout + result.stderr
        return result.stdout

    values = {'names': list(TERMS), 'mixed': [v.upper() for v in TERMS],
              'links': ['https://example.test/' + value for value in TERMS],
              'numbers': [1, 2.5, None], 'literal': r'\u1234'}
    encoded = public_json(json.dumps(values, ensure_ascii=False, indent=2))
    assert json.loads(encoded) == values
    catalog = folder / 'catalog.json'
    catalog.write_text(encoded, encoding='utf-8')
    node = subprocess.run(['node', '--input-type=module', '-e',
        "import {readFileSync} from 'node:fs'; import {publicJson} from './scripts/public-json.mjs';"
        "process.stdout.write(publicJson(JSON.stringify(JSON.parse(readFileSync('catalog.json','utf8')))));"],
        cwd=folder, check=True, capture_output=True, text=True, encoding='utf-8')
    assert json.loads(node.stdout) == values
    (folder / 'node-output.json').write_text(node.stdout, encoding='utf-8')
    audit()
    subprocess.run(['git', 'add', '.'], cwd=folder, check=True)
    audit(staged=True)

    # An unstaged leak does not alter the index audit; staging it must fail.
    catalog.write_text(json.dumps(values, ensure_ascii=False), encoding='utf-8')
    audit(success=False)
    audit(staged=True)
    subprocess.run(['git', 'add', 'catalog.json'], cwd=folder, check=True)
    assert 'public naming in file content' in audit(staged=True, success=False)
    catalog.write_text(encoded, encoding='utf-8')
    subprocess.run(['git', 'add', 'catalog.json'], cwd=folder, check=True)

    asset = folder / 'image.dat'
    for encoding in ('utf-8', 'utf-16-le', 'utf-16-be'):
        asset.write_bytes(TERMS[0].encode(encoding))
        audit(success=False)
    asset.unlink()
    named = folder / (TERMS[1] + '.txt')
    named.write_text('Generic contents', encoding='utf-8')
    assert 'public naming in file path' in audit(success=False)
    named.unlink()
    audit()
    audit(staged=True)

print('Publication workflow passed: source/index gates, binary text, filenames and lossless JSON.')
