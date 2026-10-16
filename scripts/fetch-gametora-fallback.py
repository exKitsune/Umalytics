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
from urllib.request import urlopen

BASE = 'https://gametora.com'
NAMES = ('skills', 'characters', 'character-cards')


def read_json(raw):
    return json.loads(raw.decode('utf-8'))


def download(url):
    with urlopen(url, timeout=30) as response:
        raw = response.read(16 * 1024 * 1024 + 1)
    if len(raw) > 16 * 1024 * 1024:
        raise ValueError('Catalog exceeds download limit.')
    return raw


def overlay(base, patch):
    """Regional objects patch fields; condition/effect arrays replace whole lists."""
    result = dict(base)
    for key, value in patch.items():
        result[key] = overlay(result[key], value) if isinstance(value, dict) and isinstance(result.get(key), dict) else value
    return result


def skill_record(row, region):
    name = (row.get('name_en') if region == 'Global' else row.get('enname')) or row.get('name_en') or row.get('jpname') or f"Skill {row['id']}"
    branches = []
    for index, group in enumerate(row.get('condition_groups', [])):
        if not isinstance(group.get('condition'), str) or not isinstance(group.get('base_time'), int):
            raise ValueError(f"Incomplete skill branch: {row['id']}")
        effects = []
        for effect in group.get('effects', []):
            if not isinstance(effect.get('type'), int) or not isinstance(effect.get('value'), (int, float)):
                raise ValueError(f"Incomplete skill effect: {row['id']}")
            effects.append({'type': effect['type'], 'rawValue': effect['value'],
                'valueUsage': effect.get('value_scale', 1), 'levelUsage': 1,
                'targetType': effect.get('target', 1), 'targetValue': effect.get('target_details', 0),
                'additionalActivateType': effect.get('additional_activation', 0)})
        branches.append({'branchIndex': index, 'condition': group['condition'],
            'precondition': group.get('precondition', ''), 'rawDuration': group['base_time'],
            'durationUsage': group.get('time_scale', 1), 'rawCooldown': group.get('cd', 5000000), 'effects': effects})
    if not branches:
        raise ValueError(f"Skill has no branches: {row['id']}")
    return {'name': name, 'rarity': row['rarity'], 'activateLot': row.get('activation'),
        'iconId': row.get('iconid'), 'description': (row.get('desc_en') if region == 'Global' else row.get('endesc')) or row.get('desc_en') or row.get('jpdesc'),
        'dataRegion': region, 'branches': branches}


def build(metadata, catalogs, source):
    fallback = {'characters': {}, 'outfits': {}, 'skillNames': {}, 'skills': {}, 'source': source}
    for row in catalogs['characters']:
        key = str(row['char_id'])
        if key not in metadata['characters']:
            fallback['characters'][key] = row.get('name_en') or row.get('name_ja') or f'Character {key}'
    for row in catalogs['character-cards']:
        key = str(row['card_id'])
        if key not in metadata['outfits']:
            fallback['outfits'][key] = row.get('title_en_gl') or row.get('title') or row.get('title_jp') or f'Outfit {key}'
    for original in catalogs['skills']:
        localized = original.get('loc', {}).get('en')
        region = 'Global' if localized is not None else 'JP'
        row = overlay(original, localized or {})
        for candidate in (row, row.get('gene_version')):
            if not candidate:
                continue
            key = str(candidate['id'])
            if not re.fullmatch(r'\d{1,12}', key):
                raise ValueError('Invalid skill ID.')
            if key not in metadata['skills']:
                fallback['skills'][key] = skill_record(candidate, region)
            if key not in metadata['skillNames']:
                fallback['skillNames'][key] = skill_record(candidate, region)['name']
    return {**metadata, 'fallback': fallback}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata', type=Path, default=Path('public/data/metadata.json'))
    parser.add_argument('--catalog-dir', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    manifest_raw = (args.catalog_dir / 'manifest.json').read_bytes() if args.catalog_dir else download(BASE + '/data/manifests/\x75mamusume.json')
    manifest, catalogs, files = read_json(manifest_raw), {}, {}
    for name in NAMES:
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
    fallback = result['fallback']
    print(json.dumps({'globalDefinitions': len(result['skills']), 'fallbackDefinitions': len(fallback['skills']),
        'fallbackGlobal': sum(s['dataRegion'] == 'Global' for s in fallback['skills'].values()),
        'fallbackJP': sum(s['dataRegion'] == 'JP' for s in fallback['skills'].values()),
        'fallbackCharacters': len(fallback['characters']), 'fallbackOutfits': len(fallback['outfits'])}))


if __name__ == '__main__':
    main()
