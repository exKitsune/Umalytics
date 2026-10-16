"""Decode generic character portraits from a supplied game cache, read-only.

Uses the same catalog/decrypt helpers and pinned dependencies as course geometry.
Never fetches assets, launches the game, or writes into the input cache.
"""
from pathlib import Path
import argparse
import hashlib
import json
from public_json import public_json
import re
import runpy

HELPERS = runpy.run_path(str(Path(__file__).with_name('extract-course-geometry.py')))
apsw, UnityPy = HELPERS['apsw'], HELPERS['UnityPy']
ICON = re.compile(r'^chara/chr(\d+)/chr_icon_(\d+)$')
OUTFIT_ICON = re.compile(r'^chara/chr(\d+)/trained_chr_icon_(\d+)_(\d+)_02$')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def image_details(image):
    image = image.convert('RGBA')
    alpha = image.getchannel('A').histogram()
    return {'width': image.width, 'height': image.height,
            'rgbaSha256': digest(image.tobytes()),
            'transparentPixels': alpha[0], 'partialAlphaPixels': sum(alpha[1:255])}


def decode_icon(raw, key, name):
    env = UnityPy.load(HELPERS['decrypt_bundle'](raw, key))
    sprites, textures = [], []
    for obj in env.objects:
        if obj.type.name not in ('Sprite', 'Texture2D') or obj.peek_name() != name:
            continue
        parsed = obj.read()
        (sprites if obj.type.name == 'Sprite' else textures).append(parsed)
    if len(sprites) > 1 or not sprites and len(textures) != 1:
        raise ValueError('Expected one exact-named portrait image.')
    if sprites:
        sprite = sprites[0]
        # UnityPy SpriteHelper resolves atlas render data, rectangle crop,
        # packing rotation, split alpha and tight mesh masking. Unresolved
        # dependency pointers raise an error; no entire-atlas fallback is used.
        image = sprite.image.convert('RGBA')
        details = {'sourceType': 'Sprite', 'decodePolicy':
                   'UnityPy SpriteHelper atlas/crop/rotation/split-alpha/mesh-mask'}
    else:
        texture = textures[0]
        if not (0 < texture.m_Width <= 4096 and 0 < texture.m_Height <= 4096):
            raise ValueError('Portrait texture exceeds dimension bounds.')
        image = texture.image.convert('RGBA')
        details = {'sourceType': 'Texture2D', 'textureFormat': int(texture.m_TextureFormat),
                   'decodePolicy': 'Full exact-named texture; native alpha retained; no crop or matte'}
    if not (0 < image.width <= 4096 and 0 < image.height <= 4096):
        raise ValueError('Decoded portrait exceeds dimension bounds.')
    return image, details


def compare_png(image, path):
    from PIL import Image
    other = Image.open(path).convert('RGBA')
    result = {'pngSha256': digest(path.read_bytes()), 'sameDimensions': image.size == other.size}
    if image.size == other.size:
        a, b = image.convert('RGBA').tobytes(), other.tobytes()
        result.update(sameRgbaPixels=a == b,
                      changedPixels=sum(a[i:i + 4] != b[i:i + 4] for i in range(0, len(a), 4)),
                      maxChannelDifference=max(abs(x - y) for x, y in zip(a, b)))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True, help='Root containing meta and dat.')
    parser.add_argument('--output', type=Path, required=True, help='Separate output directory.')
    parser.add_argument('--character-ids', type=int, nargs='+')
    parser.add_argument('--outfit-map', type=Path, help='Explicit card ID to trained portrait PNG mapping; IDs are not assumed equal.')
    parser.add_argument('--card-ids', type=int, nargs='+', help='Select card IDs from --outfit-map.')
    parser.add_argument('--compare', type=Path, help='Optional existing PNG directory; read-only.')
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args()
    if args.card_ids and not args.outfit_map:
        parser.error('--card-ids requires an explicit --outfit-map.')
    outfit_map = None
    if args.outfit_map:
        if args.outfit_map.stat().st_size > 256 * 1024:
            parser.error('Outfit map exceeds its size bound.')
        outfit_map = json.loads(args.outfit_map.read_text(encoding='utf-8-sig'))
        if (not isinstance(outfit_map, dict) or len(outfit_map) > 4096
                or any(not re.fullmatch(r'[1-9]\d{5}', card) or not isinstance(name, str)
                       or not re.fullmatch(r'trained_chr_icon_\d+_\d+_02\.png', name)
                       for card, name in outfit_map.items())
                or len(set(outfit_map.values())) != len(outfit_map)):
            parser.error('Outfit map must contain unique, bounded card ID and portrait filename pairs.')
    cache, output = args.cache.resolve(), args.output.resolve()
    if args.outfit_map and (output == args.outfit_map.resolve().parent or output in args.outfit_map.resolve().parents
                           or args.outfit_map.resolve().parent in output.parents):
        parser.error('Output must be separate from the supplied outfit-map directory.')
    if output == cache or cache in output.parents or output in cache.parents:
        parser.error('Output must be separate from the source cache and its parent directories.')
    compare = args.compare.resolve() if args.compare else None
    if compare and (output == compare or compare in output.parents or output in compare.parents):
        parser.error('Output must be separate from comparison inputs.')
    catalog = cache / 'meta'
    if not catalog.is_file() or not (cache / 'dat').is_dir():
        parser.error('Cache must contain meta and dat.')
    conn = apsw.Connection(str(catalog), flags=apsw.SQLITE_OPEN_READONLY)
    try:
        conn.execute("PRAGMA cipher='chacha20'")
        conn.execute("PRAGMA hexkey='" + HELPERS['META_KEY'] + "'")
        conn.execute('PRAGMA query_only=ON')
        pattern = 'chara/chr%/trained_chr_icon_%_02' if outfit_map is not None else 'chara/chr%/chr_icon_%'
        rows = list(conn.execute('SELECT n,h,e FROM a WHERE n LIKE ? LIMIT 4097', (pattern,)))
    finally:
        conn.close()
    if len(rows) > 4096:
        parser.error('Portrait catalog query exceeded its bound.')
    chosen = []
    cards_by_filename = {name: int(card) for card, name in (outfit_map or {}).items()}
    for name, asset_hash, key in rows:
        match = (OUTFIT_ICON if outfit_map is not None else ICON).fullmatch(name)
        if not match or match[1] != match[2]:
            continue
        chara_id = int(match[1])
        if chara_id <= 0:  # chr0000 is a placeholder, not a character portrait.
            continue
        if args.character_ids and chara_id not in args.character_ids:
            continue
        filename = name.rsplit('/', 1)[-1] + '.png'
        card_id = cards_by_filename.get(filename) if outfit_map is not None else None
        if outfit_map is not None and (card_id is None or card_id // 100 != chara_id
                                     or args.card_ids and card_id not in args.card_ids):
            continue
        if not re.fullmatch(r'[A-Za-z0-9]{8,128}', asset_hash):
            parser.error('Invalid asset hash in catalog.')
        chosen.append((chara_id, card_id, filename, name, asset_hash, key))
    destinations = [output / item[2] for item in chosen] + [output / 'portrait-source.json']
    if any(path.resolve().parent != output for path in destinations):
        parser.error('Output files must remain inside the separate output directory; symbolic links are rejected.')
    if not args.overwrite and any(path.exists() for path in destinations):
        parser.error('Output files already exist; choose a new directory or explicit --overwrite.')
    output.mkdir(parents=True, exist_ok=True)
    records = []
    for chara_id, card_id, filename, name, asset_hash, key in sorted(chosen, key=lambda item: item[2]):
        record = {'characterId': chara_id, 'catalogName': name, 'assetHash': asset_hash}
        if card_id is not None:
            record['cardId'] = card_id
        source = cache / 'dat' / asset_hash[:2] / asset_hash
        if not source.is_file():
            records.append({**record, 'status': 'not-downloaded'})
            continue
        if source.stat().st_size > 64 * 1024 * 1024:
            parser.error('Portrait bundle exceeds its size bound.')
        raw = source.read_bytes()
        record.update(bundleSha256=digest(raw), bundleBytes=len(raw))
        try:
            image, details = decode_icon(raw, key, filename.removesuffix('.png'))
        except Exception as exc:
            records.append({**record, 'status': 'unsupported', 'errorType': type(exc).__name__})
            continue
        destination = output / filename
        image.save(destination, format='PNG')
        record.update(status='extracted', pngSha256=digest(destination.read_bytes()),
                      **details, **image_details(image))
        if compare and (compare / destination.name).is_file():
            record['comparison'] = compare_png(image, compare / destination.name)
        records.append(record)
    report = {'schemaVersion': 1, 'source': 'Supplied installed-game asset catalog and bundles',
              'catalogSha256': HELPERS['file_sha'](catalog),
              'decoder': {'UnityPy': UnityPy.__version__, 'dependencyPin': 'scripts/requirements-geometry.txt'},
              'artworkCopyright': 'the UM:PD rights holders', 'records': records}
    if args.outfit_map:
        report['mappingSource'] = {'kind': 'Supplied explicit card-to-portrait map', 'sha256': digest(args.outfit_map.read_bytes())}
    (output / 'portrait-source.json').write_text(public_json(json.dumps(report, indent=2) + '\n'), encoding='utf-8')
    counts = {status: sum(r['status'] == status for r in records)
              for status in ('extracted', 'not-downloaded', 'unsupported')}
    print(json.dumps({'selected': len(records), **counts}))
    return 0 if counts['extracted'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
