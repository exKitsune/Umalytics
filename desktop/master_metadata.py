"""Public master projections shared by live lookups and offline extraction."""
import sqlite3


def engine_rows(skills):
    """Feed installed definitions through the existing supported-skill compiler."""
    return {sid: {'id': int(sid), 'rarity': skill['rarity'], 'activation': skill['activateLot'],
        'iconid': skill['iconId'], 'name_en': skill['name'], 'desc_en': skill.get('description'),
        'dataRegion': 'Global', 'unreleasedGlobal': False,
        'condition_groups': [{'condition': branch['condition'], 'precondition': branch['precondition'],
            'base_time': branch['rawDuration'], 'time_scale': branch['durationUsage'], 'cd': branch['rawCooldown'],
            'effects': [{'type': effect['type'], 'value': effect['rawValue'], 'value_scale': effect['valueUsage'],
                'target': effect['targetType'], 'target_details': effect['targetValue'],
                'additional_activation': effect['additionalActivateType']} for effect in branch['effects']]}
            for branch in skill['branches']]} for sid, skill in skills.items()}


def metadata(db):
    db.row_factory = sqlite3.Row
    def texts(category):
        return {str(row['index']): row['text'] for row in db.execute(
            'SELECT [index], text FROM text_data WHERE category = ?', (category,))}

    names = texts(6)
    outfits = texts(5)
    skill_names = texts(47)
    skill_descriptions = texts(48)
    skills = {}
    for row in db.execute('SELECT * FROM skill_data'):
        sid = str(row['id'])
        if sid not in skill_names:
            continue
        skills[sid] = {'name': skill_names[sid], 'rarity': row['rarity'],
            'groupId': row['group_id'], 'activateLot': row['activate_lot'],
            'iconId': row['icon_id'], 'description': skill_descriptions.get(sid),
            **({'popularityBonuses': [{'stat': row[f'popularity_add_param_{i}'], 'value': row[f'popularity_add_value_{i}']} for i in (1, 2) if row[f'popularity_add_param_{i}']]} if 'popularity_add_param_1' in row.keys() else {}),
            **({'tagIds': [int(tag) for tag in str(row['tag_id']).split('/') if tag.isdigit()]} if 'tag_id' in row.keys() else {}), 'branches': []}
        for branch in (1, 2):
            condition = row[f'condition_{branch}']
            effects = [{'type': row[f'ability_type_{branch}_{i}'],
                'rawValue': row[f'float_ability_value_{branch}_{i}'],
                'valueUsage': row[f'ability_value_usage_{branch}_{i}'],
                'levelUsage': row[f'ability_value_level_usage_{branch}_{i}'],
                'targetType': row[f'target_type_{branch}_{i}'], 'targetValue': row[f'target_value_{branch}_{i}'],
                'additionalActivateType': row[f'additional_activate_type_{branch}_{i}']} for i in (1, 2, 3)
                if row[f'ability_type_{branch}_{i}'] != 0]
            if condition or effects:
                skills[sid]['branches'].append({'condition': condition, 'branchIndex': branch - 1,
                    'precondition': row[f'precondition_{branch}'], 'rawCooldown': row[f'float_cooldown_time_{branch}'],
                    'rawDuration': row[f'float_ability_time_{branch}'],
                    'durationUsage': row[f'ability_time_usage_{branch}'], 'effects': effects})
    return {'characters': names, 'outfits': outfits, 'trackNames': texts(35), 'skillNames': skill_names, 'skills': skills}


def catalog(db):
    """Public local card facts, without community slugs or guessed release dates."""
    db.row_factory = sqlite3.Row
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    result = {k: {} for k in ('prices', 'supports', 'characters', 'skillOwners', 'outfitGlobalReleases', 'aptitudes')}
    if {'skill_data', 'single_mode_skill_need_point'} <= tables:
        rows = list(db.execute('SELECT s.id,s.group_id,s.group_rate,s.rarity,p.need_skill_point FROM skill_data s LEFT JOIN single_mode_skill_need_point p ON p.id=s.id'))
        groups = {}
        for row in sorted(rows, key=lambda r: (r['group_rate'], r['id'])):
            if row['rarity'] in (1, 2) and row['need_skill_point'] is not None:
                groups.setdefault(row['group_id'], []).append(row)
        for row in rows:
            peers = [r for r in groups.get(row['group_id'], []) if r['group_rate'] <= row['group_rate']]
            steps = [r['id'] for r in peers] if row['rarity'] in (1, 2) and len({r['group_rate'] for r in peers}) == len(peers) else []
            result['prices'][str(row['id'])] = {'cost': row['need_skill_point'], 'steps': steps}
    if {'text_data', 'support_card_data'} <= tables:
        names = {r[0]: r[1] for r in db.execute('SELECT [index],text FROM text_data WHERE category=75')}
        for row in db.execute('SELECT id,chara_id,rarity,support_card_type,command_id FROM support_card_data'):
            result['supports'][str(row['id'])] = {'name': names.get(row['id'], ''), 'charaId': row['chara_id'],
                'rarity': row['rarity'], 'type': row['support_card_type'], 'command': row['command_id']}
    if {'card_data', 'card_rarity_data'} <= tables:
        grades = dict(enumerate('GFEDCBAS', 1))
        columns = ['proper_ground_turf', 'proper_ground_dirt', 'proper_distance_short', 'proper_distance_mile',
                   'proper_distance_middle', 'proper_distance_long', 'proper_running_style_nige',
                   'proper_running_style_senko', 'proper_running_style_sashi', 'proper_running_style_oikomi']
        for row in db.execute('SELECT r.* FROM card_rarity_data r JOIN card_data c ON c.id=r.card_id AND c.default_rarity=r.rarity'):
            values = [grades.get(row[c]) for c in columns]
            if all(values):
                result['aptitudes'][str(row['card_id'])] = values
        if {'skill_set', 'skill_data'} <= tables:
            owners = {}
            rarities = {r[0]: r[1] for r in db.execute('SELECT id,rarity FROM skill_data')}
            for row in db.execute('SELECT r.card_id,s.* FROM card_rarity_data r JOIN skill_set s ON s.id=r.skill_set'):
                for i in range(1, 21):
                    sid = row[f'skill_id{i}']
                    if sid and rarities.get(sid) in (3, 4, 5):
                        owners.setdefault(str(sid), set()).add(row['card_id'])
            result['skillOwners'] = {k: sorted(v) for k, v in owners.items()}
    return result


def courses(db):
    """MDB core properties; corner/slope/path geometry is stored in game assets."""
    columns = {r[1] for r in db.execute('PRAGMA table_info(race_course_set)')}
    if not {'id', 'race_track_id', 'distance', 'ground', 'inout', 'turn', 'float_lane_max', 'course_set_status_id'} <= columns:
        return {}
    statuses = {}
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='race_course_set_status'").fetchone():
        statuses = {r[0]: [v for v in r[1:] if v] for r in db.execute('SELECT course_set_status_id,target_status_1,target_status_2 FROM race_course_set_status')}
    return {str(r['id']): {'raceTrackId': r['race_track_id'], 'distance': r['distance'],
            'surface': r['ground'], 'course': r['inout'], 'turn': r['turn'], 'laneMax': r['float_lane_max'],
            'courseSetStatus': statuses.get(r['course_set_status_id'], [])}
            for r in db.execute('SELECT * FROM race_course_set')}


def career(db, digest=None):
    db.row_factory = sqlite3.Row
    texts=lambda category:{str(r[0]):r[1] for r in db.execute('select [index],text from text_data where category=?',(category,))}
    labels=['G','G+','F','F+','E','E+','D','D+','C','C+','B','B+','A','A+','S','S+','SS','SS+']
    labels += [f'{rank}{n or ""}' for rank in ['UG','UF','UE','UD','UC','UB','UA','US'] for n in range(10)]
    skills={str(r['id']):{'cost':r['need_skill_point'],'group':r['group_id'],'order':r['group_rate'],'rarity':r['rarity']} for r in db.execute('select s.id,s.group_id,s.group_rate,s.rarity,p.need_skill_point from skill_data s left join single_mode_skill_need_point p on p.id=s.id')}
    names=texts(75)
    supports={str(r['id']):{'name':names.get(str(r['id']),f"Support {r['id']}"),'charaId':r['chara_id'],'rarity':r['rarity'],'type':r['support_card_type'],'command':r['command_id']} for r in db.execute('select * from support_card_data')}
    factor_names=texts(147)
    effects={}
    for r in db.execute('select factor_group_id,target_type,value_1 from succession_factor_effect where target_type=41'): effects.setdefault(r[0],set()).add(r[2])
    factors={str(r['factor_id']):{'name':factor_names.get(str(r['factor_id']),f"Factor {r['factor_id']}"),'group':r['factor_group_id'],'stars':r['rarity'],'type':r['factor_type'],'skillIds':sorted(effects.get(r['factor_group_id'],[]))} for r in db.execute('select * from succession_factor')}
    relations={}
    for r in db.execute('select m.chara_id,m.relation_type,r.relation_point from succession_relation_member m join succession_relation r on r.relation_type=m.relation_type'): relations.setdefault(str(r[0]),{})[str(r[1])]=r[2]
    race_names=texts(28)
    programs={str(r['id']):{'name':race_names.get(str(r['race_instance_id']),f"Race {r['race_id']}"),'raceId':r['race_id'],'grade':r['grade'],'courseId':r['course_set'],'month':r['month'],'half':r['half']} for r in db.execute('select p.id,p.race_instance_id,p.month,p.half,r.id race_id,r.grade,r.course_set from single_mode_program p join race_instance i on i.id=p.race_instance_id join race r on r.id=i.race_id')}
    turns={}
    for r in db.execute('select s.id,t.turn,t.year,t.month,t.half from single_mode_scenario s join single_mode_turn t on t.turn_set_id=s.turn_set_id'):
     turns.setdefault(str(r[0]),{})[str(r[1])]=list(r)[2:]
    g1_instances={r[0]:race_names.get(str(r[0]),f'Race {r[0]}') for r in db.execute('select i.id from race_instance i join race r on r.id=i.race_id where r.grade=100')}
    g1_artwork={r[0]:r[1] for r in db.execute('select i.id,r.thumbnail_id from race_instance i join race r on r.id=i.race_id where r.grade=100 and r.thumbnail_id>0')}
    win_names=texts(111);wins={}
    for r in db.execute('select * from single_mode_wins_saddle'):
     instances=[r[f'race_instance_id_{i}'] for i in range(1,9) if r[f'race_instance_id_{i}']]
     if instances and all(i in g1_instances for i in instances):
      wins[str(r['id'])]={'name':win_names.get(str(r['id']),''),'races':instances,'condition':r['condition']}
    result={'schema':2,'source':{'name':'Installed Global public master career tables','sha256':digest},'ranks':[{'id':r['id'],'min':r['min_value'],'max':r['max_value'],'label':labels[r['id']-1] if 0<r['id']<=len(labels) else str(r['id'])} for r in db.execute('select * from single_mode_rank')],'skills':skills,'supports':supports,'supportLevels':{str(rarity):[list(r) for r in db.execute('select level,total_exp from support_card_level where rarity=? order by level',(rarity,))] for rarity in [1,2,3]},'scenarios':texts(237),'epithets':texts(130),'factors':factors,'programs':programs,'saddles':win_names,'relations':relations,'turns':turns,'g1Races':g1_instances,'g1Wins':wins}
    result['g1Artwork']=g1_artwork
    return result
