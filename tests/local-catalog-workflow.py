"""Read a real SQLite master, prefer it to stale bundles, refresh without network."""
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
from catalog_data import CatalogData
from game_race_data import GameRaceData

with tempfile.TemporaryDirectory(prefix='local-catalog-', dir=ROOT / '.cache') as temporary:
    folder = Path(temporary)
    master = folder / 'master.mdb'
    db = sqlite3.connect(master)
    db.executescript('''
        CREATE TABLE race_instance(id INTEGER,race_id INTEGER,time INTEGER);
        CREATE TABLE race(id INTEGER,course_set INTEGER,grade INTEGER);
        CREATE TABLE race_course_set(id INTEGER);
        INSERT INTO race_course_set VALUES(12345);
        INSERT INTO race VALUES(1,12345,100);
        INSERT INTO race_instance VALUES(1,1,2);
        CREATE TABLE text_data(category INTEGER,[index] INTEGER,text TEXT);
        INSERT INTO text_data VALUES(6,9001,'MDB character'),(5,900101,'MDB outfit'),
          (47,2048,'MDB skill'),(48,2048,'MDB description'),(47,100088,'MDB unique'),(75,70001,'MDB support');
        CREATE TABLE single_mode_skill_need_point(id INTEGER,need_skill_point INTEGER);
        INSERT INTO single_mode_skill_need_point VALUES(2048,180);
        CREATE TABLE support_card_data(id INTEGER,chara_id INTEGER,rarity INTEGER,support_card_type INTEGER,command_id INTEGER);
        INSERT INTO support_card_data VALUES(70001,9001,3,1,106);
        CREATE TABLE card_data(id INTEGER,default_rarity INTEGER);
        INSERT INTO card_data VALUES(900101,3);
        CREATE TABLE private_account(secret TEXT);
        INSERT INTO private_account VALUES('NEVER_EXPORT_PRIVATE');
    ''')
    for column,default in [('race_track_id',10001),('distance',1600),('ground',1),('inout',1),('turn',1),('float_lane_max',15000),('course_set_status_id',0)]:
        db.execute(f'ALTER TABLE race_course_set ADD COLUMN {column} INTEGER DEFAULT {default}')
    columns = ['id INTEGER', 'group_id INTEGER DEFAULT 1', 'group_rate INTEGER DEFAULT 1',
               'rarity INTEGER DEFAULT 1', 'activate_lot INTEGER DEFAULT 1', 'icon_id INTEGER DEFAULT 1']
    for branch in (1, 2):
        columns += [f"condition_{branch} TEXT DEFAULT ''", f"precondition_{branch} TEXT DEFAULT ''",
                    f'float_cooldown_time_{branch} INTEGER DEFAULT 0', f'float_ability_time_{branch} INTEGER DEFAULT 10000',
                    f'ability_time_usage_{branch} INTEGER DEFAULT 1']
        for i in (1, 2, 3):
            columns += [f'{field}_{branch}_{i} INTEGER DEFAULT 0' for field in
                        ('ability_type', 'float_ability_value', 'ability_value_usage', 'ability_value_level_usage',
                         'target_type', 'target_value', 'additional_activate_type')]
    db.execute('CREATE TABLE skill_data(' + ','.join(columns) + ')')
    db.execute("INSERT INTO skill_data(id,condition_1,ability_type_1_1,float_ability_value_1_1) VALUES(2048,'always==1',21,1500)")
    db.execute('INSERT INTO skill_data(id,rarity) VALUES(100088,3)')
    aptitude_columns = ['proper_ground_turf', 'proper_ground_dirt', 'proper_distance_short', 'proper_distance_mile',
        'proper_distance_middle', 'proper_distance_long', 'proper_running_style_nige', 'proper_running_style_senko',
        'proper_running_style_sashi', 'proper_running_style_oikomi']
    db.execute('CREATE TABLE card_rarity_data(card_id INTEGER,rarity INTEGER,skill_set INTEGER,' +
               ','.join(c+' INTEGER DEFAULT 7' for c in aptitude_columns) + ')')
    db.execute('INSERT INTO card_rarity_data(card_id,rarity,skill_set) VALUES(900101,3,99)')
    db.execute('CREATE TABLE skill_set(id INTEGER,' + ','.join(f'skill_id{i} INTEGER DEFAULT 0' for i in range(1,21)) + ')')
    db.execute('INSERT INTO skill_set(id,skill_id1) VALUES(99,100088)')
    db.commit()
    db.close()
    reader = GameRaceData(lambda: (master,))
    stale = {'characters': {'9001': 'STALE'}, 'outfits': {}, 'skillNames': {'2048': 'STALE'}, 'skills': {}}
    now = [1700000000]
    with patch('socket.create_connection', side_effect=AssertionError('External network forbidden')) as network:
        catalog = CatalogData(folder / 'cache', stale, installed=reader.read, clock=lambda: now[0])
        first = catalog.snapshot()
        assert first['mode'] == 'local' and first['networkEnabled'] is False
        assert first['fallback']['characters']['9001'] == 'MDB character'
        assert first['fallback']['skills']['2048']['name'] == 'MDB skill'
        assert first['career']['prices']['2048']['cost'] == 180
        assert first['career']['supports']['70001']['name'] == 'MDB support'
        assert first['career']['aptitudes']['900101'] == ['A'] * 10
        assert first['career']['skillOwners']['100088'] == [900101]
        assert first['nativeCourses']['12345']['distance'] == 1600
        assert first['nativeCourses']['12345']['laneMax'] == 15000
        assert 'NEVER_EXPORT_PRIVATE' not in json.dumps(first)
        live = json.loads(reader.metadata(json.dumps(stale).encode()))
        assert live['skillNames']['2048'] == 'MDB skill'
        before_update = master.stat()
        db = sqlite3.connect(master)
        db.execute("UPDATE text_data SET text='MDB updated' WHERE category=47 AND [index]=2048")
        db.commit()
        db.close()
        # A same-size SQLite commit can share the filesystem's cached timestamp.
        os.utime(master, ns=(before_update.st_atime_ns, before_update.st_mtime_ns))
        assert master.stat().st_size == before_update.st_size
        now[0] += 61
        assert catalog.check()
        assert catalog.snapshot()['fallback']['skillNames']['2048'] == 'MDB updated'
        assert catalog.snapshot()['revision'] != first['revision']
        restored = CatalogData(folder / 'cache', stale, installed=reader.read, clock=lambda: now[0])
        assert restored.snapshot()['fallback']['skillNames']['2048'] == 'MDB updated'
        master.rename(folder / 'uninstalled.mdb')
        now[0] += 61
        assert restored.check()
        assert restored.snapshot()['fallback']['skillNames']['2048'] == 'MDB updated'
        assert network.call_count == 0

print('Local catalog workflow passed: real SQLite, MDB precedence, costs/supports/aptitudes/unique owners, live refresh, restart, missing MDB fallback, no private-table export, and zero network calls.')
