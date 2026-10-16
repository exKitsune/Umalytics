"""Whole CLI portrait extraction, reproducibility and known pixel-origin check.

Requires the explicitly supplied installed cache; it is not a public CI fixture.
No source cache files, bundles or decoded game images are committed by this test.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--upstream', type=Path, default=ROOT / 'public/portraits')
    args = parser.parse_args()
    cache = args.cache.resolve()
    catalog_before = sha(cache / 'meta')
    temp_root = (ROOT / '.cache').resolve()
    temp_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='portrait-cli-system-', dir=temp_root) as temporary:
        temporary = Path(temporary).resolve()
        # Bound the TemporaryDirectory cleanup target before any recursive cleanup.
        if temporary.parent != temp_root or not temporary.name.startswith('portrait-cli-system-'):
            raise ValueError('Unexpected temporary test directory.')
        outputs = []
        for name in ('first', 'repeat'):
            destination = temporary / name
            run = subprocess.run([sys.executable, str(ROOT / 'scripts/extract-portraits.py'),
                                  '--cache', str(cache), '--output', str(destination),
                                  '--character-ids', '1001'], cwd=ROOT, check=True,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            summary = json.loads(run.stdout)
            assert summary == {'selected': 1, 'extracted': 1, 'not-downloaded': 0, 'unsupported': 0}
            outputs.append(destination)
        report = json.loads((outputs[0] / 'portrait-source.json').read_text(encoding='utf-8'))
        record, = report['records']
        extracted = outputs[0] / 'chr_icon_1001.png'
        repeated = outputs[1] / 'chr_icon_1001.png'
        assert extracted.read_bytes() == repeated.read_bytes(), 'Repeated CLI extraction changed PNG bytes.'
        image = Image.open(extracted)
        assert image.mode == 'RGBA' and image.size == (256, 256), 'Portrait crop or alpha changed.'
        assert hashlib.sha256(image.tobytes()).hexdigest() == record['rgbaSha256']
        assert sha(extracted) == record['pngSha256']
        upstream = args.upstream / 'chr_icon_1001.png'
        other = Image.open(upstream).convert('RGBA')
        assert sha(upstream) == '0eb7253da4de341e11b287a1ea04ff26c7f0f2b460ba5f6db7fcb42d5a72ab37', 'Upstream reference changed.'
        assert record['bundleSha256'] == '2eda8d912a0fd97f1d82cf6275c500fa8ca46eb765d5248ca616e8f3808e183b', 'Installed portrait version changed; re-review pixel-origin anchor.'
        assert image.size == other.size
        a, b = image.tobytes(), other.tobytes()
        changed = sum(a[i:i + 4] != b[i:i + 4] for i in range(0, len(a), 4))
        assert changed == 1, 'Known installed/upstream portrait variance changed.'
        bundle = cache / 'dat' / record['assetHash'][:2] / record['assetHash']
        assert sha(bundle) == record['bundleSha256']
        assert sha(cache / 'meta') == catalog_before, 'The source catalog changed during the workflow.'
        outfit_outputs = []
        for name in ('outfit-first', 'outfit-repeat'):
            destination = temporary / name
            run = subprocess.run([sys.executable, str(ROOT / 'scripts/extract-portraits.py'),
                                  '--cache', str(cache), '--output', str(destination),
                                  '--outfit-map', str(ROOT / 'src/data/outfit-portraits.json'), '--card-ids', '100103'],
                                 cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            assert json.loads(run.stdout) == {'selected': 1, 'extracted': 1, 'not-downloaded': 0, 'unsupported': 0}
            outfit_outputs.append(destination)
        outfit_name = 'trained_chr_icon_1001_100102_02.png'
        assert (outfit_outputs[0] / outfit_name).read_bytes() == (outfit_outputs[1] / outfit_name).read_bytes()
        commander = Image.open(outfit_outputs[0] / outfit_name).convert('RGBA')
        published = Image.open(args.upstream / outfit_name).convert('RGBA')
        assert commander.size == published.size == (256, 256) and commander.tobytes() == published.tobytes()
        outfit_record, = json.loads((outfit_outputs[0] / 'portrait-source.json').read_text(encoding='utf-8'))['records']
        assert outfit_record['cardId'] == 100103 and outfit_record['characterId'] == 1001
        assert outfit_record['bundleSha256'] == '585032dfaf83acee0c3992a565a84fb72833bd6b0f166b4822c5dcc73954ab91'
        assert sha(cache / 'meta') == catalog_before
        # The real CLI must reject writing either source or comparison inputs.
        for destination, extra in ((cache, []), (args.upstream, ['--compare', str(args.upstream)])):
            rejected = subprocess.run([sys.executable, str(ROOT / 'scripts/extract-portraits.py'),
                                       '--cache', str(cache), '--output', str(destination),
                                       '--character-ids', '1001', *extra], cwd=ROOT,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            assert rejected.returncode != 0, 'CLI accepted an input directory as output.'
        print(json.dumps({'workflow': 'CLI extraction → repeated extraction → independent pixel comparison',
                          'characterId': 1001, 'size': [256, 256], 'mode': 'RGBA',
                          'changedUpstreamPixels': changed, 'totalPixels': 65536,
                          'commanderCard': 100103, 'commanderOutfitPixels': 'exact',
                          'sourceUnchanged': True, 'outputGuardsPassed': True}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
