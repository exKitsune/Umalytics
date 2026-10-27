"""Library-only organization. Never changes captured races or setup snapshots."""
from datetime import datetime, timezone
import json
import re
import sandbox_inputs as inputs

KINDS = ('umas', 'folders', 'setups', 'conditions', 'templates')
ICONS = ('folder', 'race', 'trophy', 'star', 'flask', 'heart')

def tags(value):
    if not isinstance(value, list) or len(value) > 24:
        raise ValueError('Use up to 24 tags per Uma.')
    result, seen = [], set()
    for item in value:
        item = inputs.text(item, 'Tag', 40)
        if item.casefold() not in seen:
            result.append(item)
            seen.add(item.casefold())
    return result

def folder(value):
    if not isinstance(value, dict):
        raise ValueError('Invalid folder record.')
    color = value.get('color', '#8bc783')
    if not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
        raise ValueError('Choose a valid folder color.')
    if value.get('icon', 'folder') not in ICONS:
        raise ValueError('Choose a valid folder icon.')
    return {'id': inputs.text(value.get('id'), 'Folder ID', 80),
            'name': inputs.text(value.get('name'), 'Folder name', 60),
            'color': color, 'icon': value.get('icon', 'folder')}

def read(db, kind, key):
    row = db.execute('SELECT value FROM documents WHERE kind=? AND id=?', (kind, key)).fetchone()
    return json.loads(row[0]) if row else None

def put(db, kind, value):
    if db.execute('SELECT count(*) FROM documents').fetchone()[0] >= 5000 and not read(db, kind, value['id']):
        raise ValueError('Library limit reached (5,000 entries).')
    db.execute('INSERT OR REPLACE INTO documents VALUES (?,?,?)', (kind, value['id'], json.dumps(value, ensure_ascii=False)))

def save_uma(db, value, now):
    cleaned = inputs.build(value)
    old = read(db, 'umas', cleaned['id']) or {}
    # An editor opened from an older setup must not discard library organization.
    meta = {**old, **value}
    folder_id = meta.get('folderId', '')
    if not isinstance(folder_id, str):
        raise ValueError('Invalid folder ID.')
    if folder_id:
        folder_id = inputs.text(folder_id, 'Folder ID', 80)
    cleaned.update(folderId=folder_id if folder_id and read(db, 'folders', folder_id) else '',
                   tags=tags(meta.get('tags', [])),
                   favorite=inputs.boolean(meta.get('favorite', False), 'Favorite'),
                   archived=inputs.boolean(meta.get('archived', False), 'Archived'),
                   createdAt=old.get('createdAt') or now, updatedAt=now)
    if meta.get('variantOf'):
        cleaned['variantOf'] = inputs.text(meta['variantOf'], 'Original build ID', 80)
    put(db, 'umas', cleaned)

def save(connect, body):
    kind = body.get('collection')
    if kind not in KINDS:
        raise ValueError('Unknown library collection.')
    now = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        if body.get('action') == 'import' and kind == 'umas':
            records, folders = body.get('records'), body.get('folders', [])
            if not isinstance(records, list) or not 1 <= len(records) <= 5000 or not isinstance(folders, list) or len(folders) > 5000:
                raise ValueError('Choose a valid Uma library export.')
            # Imports get new identities; existing builds and folder names remain intact.
            import uuid
            mapped = {}
            for raw in folders:
                item = folder(raw)
                existing = next((json.loads(row[0]) for row in db.execute("SELECT value FROM documents WHERE kind='folders'")
                                 if json.loads(row[0])['name'].casefold() == item['name'].casefold()), None)
                new_id = existing['id'] if existing else str(uuid.uuid4())
                mapped[item['id']] = new_id
                if not existing:
                    put(db, 'folders', {**item, 'id': new_id})
            for raw in records:
                if not isinstance(raw, dict):
                    raise ValueError('Invalid Uma record.')
                save_uma(db, {**raw, 'id': str(uuid.uuid4()), 'folderId': mapped.get(raw.get('folderId'), ''), 'variantOf': ''}, now)
        elif body.get('action') == 'bulk' and kind == 'umas':
            ids, patch = body.get('ids'), body.get('patch')
            if not isinstance(ids, list) or not 1 <= len(ids) <= 5000 or not isinstance(patch, dict) or not patch:
                raise ValueError('Select Umas and an action.')
            if set(patch) - {'folderId', 'favorite', 'archived', 'addTags', 'removeTags'}:
                raise ValueError('Unknown library action.')
            if patch.get('folderId') and not read(db, 'folders', inputs.text(patch['folderId'], 'Folder ID', 80)):
                raise ValueError('This folder no longer exists.')
            for key in dict.fromkeys(inputs.text(key, 'Build ID', 80) for key in ids):
                value = read(db, 'umas', key)
                if not value:
                    raise ValueError('A selected Uma no longer exists. Refresh the library.')
                updated = {**value, **{k: v for k, v in patch.items() if k not in ('addTags', 'removeTags')}}
                if 'addTags' in patch:
                    updated['tags'] = tags(value.get('tags', []) + tags(patch['addTags']))
                if 'removeTags' in patch:
                    removed = {t.casefold() for t in tags(patch['removeTags'])}
                    updated['tags'] = [t for t in updated.get('tags', []) if t.casefold() not in removed]
                save_uma(db, updated, now)
        elif body.get('remove'):
            key = inputs.text(body['remove'], 'ID', 80)
            if kind == 'folders':
                for raw, in db.execute("SELECT value FROM documents WHERE kind='umas'").fetchall():
                    value = json.loads(raw)
                    if value.get('folderId') == key:
                        save_uma(db, {**value, 'folderId': ''}, now)
            db.execute('DELETE FROM documents WHERE kind=? AND id=?', (kind, key))
        else:
            value = body.get('record', {})
            if not isinstance(value, dict):
                raise ValueError('Invalid library record.')
            if kind == 'umas':
                save_uma(db, value, now)
            else:
                if kind == 'folders':
                    value = folder(value)
                    if any(json.loads(raw)['name'].casefold() == value['name'].casefold() and key != value['id']
                           for key, raw in db.execute("SELECT id,value FROM documents WHERE kind='folders'")):
                        raise ValueError('A folder with that name already exists.')
                elif kind == 'setups':
                    value = inputs.setup(value)
                else:
                    value = {'id': inputs.text(value.get('id'), 'ID', 80), 'name': inputs.text(value.get('name'), 'Name'),
                             **(inputs.conditions(value) if kind == 'conditions' else {'skills': inputs.skills(value.get('skills'))})}
                put(db, kind, value)
