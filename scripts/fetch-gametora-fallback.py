"""Add public GameTora catalogs without replacing installed Global definitions.

The manifest selects immutable public JSON URLs. --catalog-dir replays a saved
snapshot offline; no site JavaScript is executed. Only reference facts are kept.
"""
import argparse
import hashlib
import json
from public_json import public_json
import re
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "desktop"))
from catalog_transform import build, career_fallback

BASE = 'https://gametora.com'
NAMES = ('skills', 'characters', 'character-cards')


def read_json(raw):
    return json.loads(raw.decode('utf-8'))


def download(url):
    from catalog_data import download
    return download(url, 16 * 1024 * 1024)



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata', type=Path, default=Path('public/data/metadata.json'))
    parser.add_argument('--catalog-dir', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--career-output', type=Path, help='Also refresh SP costs, support facts and canonical links.')
    args = parser.parse_args()
    manifest_raw = (args.catalog_dir / 'manifest.json').read_bytes() if args.catalog_dir else download(BASE + '/data/manifests/\x75mamusume.json')
    manifest, catalogs, files = read_json(manifest_raw), {}, {}
    for name in (*NAMES, *(('support-cards',) if args.career_output else ())):
        revision = manifest[name]
        if not isinstance(revision, str) or not re.fullmatch(r'[a-f0-9]{8,64}', revision):
            raise ValueError('Invalid catalog revision.')
        url = f'{BASE}/data/\x75mamusume/{name}.{revision}.json'
        raw = (args.catalog_dir / f'{name}.json').read_bytes() if args.catalog_dir else download(url)
        catalogs[name] = read_json(raw)
        if not isinstance(catalogs[name], list) or not 0 < len(catalogs[name]) <= 20000:
            raise ValueError('Invalid catalog size.')
        files[name] = {'url': url, 'revision': revision, 'sha256': hashlib.sha256(raw).hexdigest(), 'records': len(catalogs[name])}
    source = {'name': 'GameTora public reference catalogs', 'url': BASE + '/\x75mamusume/skills',
        'revision': hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(),
        'license': 'Game metadata © the UM:PD rights holders; community translations via GameTora.', 'files': files}
    result = build(read_json(args.metadata.read_bytes()), catalogs, source)
    output = args.output or args.metadata
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(public_json(json.dumps(result, ensure_ascii=False, separators=(',', ':'))), encoding='utf8')
    if args.career_output:
        args.career_output.write_text(public_json(json.dumps(career_fallback(catalogs, source), ensure_ascii=False, separators=(',', ':')))+'\n', encoding='utf8')
    fallback = result['fallback']
    print(json.dumps({'globalDefinitions': len(result['skills']), 'fallbackDefinitions': len(fallback['skills']),
        'fallbackGlobal': sum(s['dataRegion'] == 'Global' for s in fallback['skills'].values()),
        'fallbackJP': sum(s['dataRegion'] == 'JP' for s in fallback['skills'].values()),
        'fallbackCharacters': len(fallback['characters']), 'fallbackOutfits': len(fallback['outfits'])}))


if __name__ == '__main__':
    main()
