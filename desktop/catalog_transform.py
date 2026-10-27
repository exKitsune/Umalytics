"""Normalize public catalogs for presentation; installed mechanics retain priority."""
from datetime import date
import re


def overlay(base, patch):
    """Regional objects patch fields; condition/effect arrays replace whole lists."""
    result = dict(base)
    for key, value in patch.items():
        result[key] = overlay(result[key], value) if isinstance(value, dict) and isinstance(result.get(key), dict) else value
    return result


def text(*values):
    """Empty translations must not hide available English or native JP text."""
    return next((value.strip() for value in values if isinstance(value, str) and value.strip()), None)


def skill_text(row, region):
    return {
        'name': text(row.get('name_en') if region == 'Global' else row.get('enname'),
                     row.get('name_en'), row.get('enname'), row.get('jpname')),
        'description': text(row.get('desc_en') if region == 'Global' else row.get('endesc'),
                            row.get('desc_en'), row.get('endesc'), row.get('jpdesc')),
    }


def skill_record(row, region):
    labels = skill_text(row, region)
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
    return {'name': labels['name'] or f"Skill {row['id']}", 'rarity': row['rarity'], 'activateLot': row.get('activation'),
        'iconId': row.get('iconid'), 'description': labels['description'],
        'dataRegion': region, 'branches': branches}


def build(metadata, catalogs, source):
    fallback = {'characters': {}, 'outfits': {}, 'skillNames': {}, 'skills': {}, 'skillTexts': {}, 'source': source}
    for row in catalogs['characters']:
        key = str(row['char_id'])
        if not text(metadata['characters'].get(key)):
            fallback['characters'][key] = text(row.get('name_en'), row.get('name_ja')) or f'Character {key}'
    for row in catalogs['character-cards']:
        key = str(row['card_id'])
        if not text(metadata['outfits'].get(key)):
            fallback['outfits'][key] = text(row.get('title_en_gl'), row.get('title'), row.get('title_jp')) or f'Outfit {key}'
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
                fallback['skills'][key] = {**skill_record(candidate, region),
                    'unreleasedGlobal': region == 'JP' or 'en' in original.get('unreleased', [])}
            labels = skill_text(candidate, region)
            if not text(metadata['skillNames'].get(key)) and labels['name']:
                fallback['skillNames'][key] = labels['name']
            # Text may fill a blank inside an installed record; mechanics may not.
            if key in metadata['skills']:
                missing = {field: value for field, value in labels.items()
                           if value and not text(metadata['skills'][key].get(field))}
                if missing:
                    fallback['skillTexts'][key] = missing
    return {**metadata, 'fallback': fallback}


def career_fallback(catalogs, source):
    """Presentation facts only. Ambiguous acquisition chains stay unavailable."""
    rows = {}
    for original in catalogs['skills']:
        row = overlay(original, original.get('loc', {}).get('en', {}))
        for value in (row, row.get('gene_version')):
            if value:
                rows[value['id']] = value
    prices = {}
    for sid, row in rows.items():
        cost, rarity = row.get('cost'), row['rarity']
        if cost is None:
            if rarity in (3, 4, 5):
                prices[str(sid)] = {'cost': None, 'steps': []}
            continue
        if type(cost) is not int or cost < 0:
            raise ValueError('Invalid SP cost')
        variants = [rows.get(id) for id in row.get('versions', [])]
        steps = None
        if not variants:
            steps = [sid]
        elif rarity == 2 and len(variants) == 1 and variants[0] and variants[0]['rarity'] == 1:
            steps = [variants[0]['id'], sid]
        elif rarity == 1 and all(v and v['rarity'] == 2 for v in variants):
            steps = [sid]
        # Do not guess ordering for green upgrades, negatives or evolved chains.
        prices[str(sid)] = {'cost': cost, 'steps': steps}
    supports = {}
    commands = {'speed': 101, 'stamina': 105, 'power': 102, 'guts': 103, 'intelligence': 106}
    for row in catalogs['support-cards']:
        title = text(row.get('title_en'), row.get('title_ja')) or ''
        name = text(row.get('char_name'), row.get('name_jp')) or f"Support {row['support_id']}"
        supports[str(row['support_id'])] = {
            'name': f"{title} {name}".strip(), 'charaId': row['char_id'],
            'rarity': row['rarity'], 'type': 2 if row['type'] == 'friend' else 3 if row['type'] == 'group' else 1,
            'command': commands.get(row['type'], 0), 'slug': row['url_name'],
        }
    characters = {str(row['card_id']): row['url_name'] for row in catalogs['character-cards']}
    outfit_releases = {}
    for row in catalogs['character-cards']:
        released = row.get('release_en')
        if released is not None:
            if not isinstance(released, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', released):
                raise ValueError('Invalid Global outfit release date')
            date.fromisoformat(released)
        # A translated name or JP release does not establish Global availability.
        outfit_releases[str(row['card_id'])] = released
    for slug in [*characters.values(), *(s['slug'] for s in supports.values())]:
        if not re.fullmatch(r'[0-9]+-[a-z0-9-]+', slug):
            raise ValueError('Invalid canonical GameTora slug')
    owners = {}
    for original in catalogs['skills']:
        row = overlay(original, original.get('loc', {}).get('en', {}))
        cards = row.get('char', [])
        if cards and row.get('rarity') in (3, 4, 5):
            owners[str(row['id'])] = cards
            if row.get('gene_version'):
                owners[str(row['gene_version']['id'])] = cards
    return {'source': source, 'prices': prices, 'supports': supports, 'characters': characters, 'skillOwners': owners,
            'outfitGlobalReleases': outfit_releases}
