"""Explicit custom-race inputs. These never authorize a recorded replay match."""
from copy import deepcopy
import random
from globalsim_bridge.adapter import WEATHER, GROUND, SEASON, TIME, GRADE, STYLE

APTITUDE_KEYS = ('turf', 'dirt', 'short', 'mile', 'middle', 'long', 'front', 'pace', 'late', 'end')


def aptitudes(value):
    if not isinstance(value, dict) or set(value) != set(APTITUDE_KEYS) or any(
            not isinstance(g, str) or len(g) != 1 or g not in 'GFEDCBAS' for g in value.values()):
        raise ValueError('Choose all ten valid build aptitudes.')
    return {key: value[key] for key in APTITUDE_KEYS}


def race_aptitudes(participant, course):
    if 'aptitudes' not in participant['uma'] or 'aptitudeOverrides' not in participant:
        return {key: participant[key] for key in ('surface', 'distance', 'strategyAptitude')}
    grades = participant['uma']['aptitudes']
    distance = course.get('distance', 2000)
    keys = {'surface': 'dirt' if course.get('surface') == 2 else 'turf',
            'distance': 'short' if distance <= 1400 else 'mile' if distance <= 1800 else 'middle' if distance <= 2400 else 'long',
            'strategyAptitude': {1:'front', 2:'pace', 3:'late', 4:'end', 5:'front'}[participant['strategy']]}
    return {**{key: grades[value] for key, value in keys.items()}, **participant['aptitudeOverrides']}

def integer(value, name, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f'{name} must be an integer from {low} to {high}.')
    return value

def text(value, name, limit=160):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f'{name} is required (at most {limit} characters).')
    return value.strip()

def boolean(value, name):
    if type(value) is not bool:
        raise ValueError(f'{name} must be a checkbox value.')
    return value

def skills(value):
    if not isinstance(value, list) or len(value) > 100:
        raise ValueError('A build can contain up to 100 skills.')
    result = []
    for row in value:
        if not isinstance(row,dict):raise ValueError('Invalid skill record.')
        result.append({'id': integer(row.get('id'), 'Skill ID', 1, 2**31-1),
                       'level': integer(row.get('level'), 'Skill level', 1, 99)})
    if len({r['id'] for r in result}) != len(result):
        raise ValueError('Duplicate skill in build.')
    return result

def build(value):
    if not isinstance(value, dict):
        raise ValueError('Uma build required.')
    memo = value.get('memo', '')
    if not isinstance(value.get('stats'),dict):raise ValueError('Base stats are required.')
    if not isinstance(memo, str) or len(memo) > 10000:
        raise ValueError('Memo is too long.')
    result = {'id': text(value.get('id'), 'Build ID', 80), 'name': text(value.get('name'), 'Build name'),
        'memo': memo, 'charaId': integer(value.get('charaId'), 'Character', 1, 2**31-1),
        'cardId': integer(value.get('cardId'), 'Outfit', 1, 2**31-1),
        'stats': {key: integer(value.get('stats', {}).get(key), key, 1, 2000) for key in ('speed','stamina','power','guts','wisdom')},
        'skills': skills(value.get('skills')), 'fans': integer(value.get('fans', 0), 'Fans', 0, 2**53-1),
        'careerWins': integer(value.get('careerWins', 0), 'Career wins', 0, 1000)}
    if 'aptitudes' in value:
        result['aptitudes'] = aptitudes(value['aptitudes'])
    return result

def conditions(value):
    result = {'courseId': integer(value.get('courseId'), 'Course', 1, 2**31-1)}
    for key, choices in [('weather', WEATHER), ('ground', GROUND), ('season', SEASON), ('time', TIME), ('grade', GRADE)]:
        if type(value.get(key)) is not int or value[key] not in choices:
            raise ValueError(f'Choose a valid {key}.')
        result[key] = value[key]
    return result

def setup(value):
    if not isinstance(value, dict) or value.get('schemaVersion') != 1:
        raise ValueError('Unsupported simulator setup format.')
    roster = value.get('participants')
    if not isinstance(roster, list) or not 1 <= len(roster) <= 18:
        raise ValueError('Add between 1 and 18 participants.')
    result = {**conditions(value), 'schemaVersion': 1, 'id': text(value.get('id'), 'Setup ID', 80),
        'name': text(value.get('name'), 'Setup name'), 'seed': integer(value.get('seed'), 'Seed', -(2**31), 2**31-1),
        'keepSeed': boolean(value.get('keepSeed'), 'Keep seed'), 'shuffleGates': boolean(value.get('shuffleGates'), 'Shuffle gates'),
        'count': integer(value.get('count'), 'Race count', 1, 1000), 'participants': []}
    override = value.get('moodOverride')
    if override is not None:
        if not isinstance(override, dict) or override.get('mode') not in ('fixed', 'random'):
            raise ValueError('Choose a valid shared mood mode.')
        result['moodOverride'] = {'mode': override['mode']}
        if override['mode'] == 'fixed':
            result['moodOverride']['mood'] = integer(override.get('mood'), 'Shared mood', 1, 5)
    for row in roster:
        if not isinstance(row,dict):raise ValueError('Invalid participant record.')
        p = {'id': text(row.get('id'), 'Participant ID', 80), 'uma': build(row.get('uma')),
            'strategy': integer(row.get('strategy'), 'Strategy', 1, 5), 'mood': integer(row.get('mood'), 'Mood', 1, 5),
            'randomizeMood': boolean(row.get('randomizeMood'), 'Randomize mood'),
            'gate': integer(row.get('gate'), 'Gate', 1, len(roster)), 'team': None if row.get('team') is None else integer(row['team'], 'Team', 0, 2**31-1),
            'popularity': integer(row.get('popularity'), 'Popularity', 1, len(roster))}
        for key in ('surface', 'distance', 'strategyAptitude'):
            if row.get(key) not in list('GFEDCBAS'):
                raise ValueError(f'Choose a valid {key} aptitude.')
            p[key] = row[key]
        if row.get('trainer') is not None:
            p['trainer'] = text(row['trainer'], 'Trainer name')
        if 'aptitudeOverrides' in row:
            overrides = row['aptitudeOverrides']
            if not isinstance(overrides, dict) or set(overrides) - {'surface', 'distance', 'strategyAptitude'} or any(
                    not isinstance(g, str) or len(g) != 1 or g not in 'GFEDCBAS' for g in overrides.values()):
                raise ValueError('Choose valid race aptitude overrides.')
            p['aptitudeOverrides'] = dict(overrides)
        result['participants'].append(p)
    if len({p['id'] for p in result['participants']}) != len(roster):
        raise ValueError('Participant IDs must be unique.')
    if len({p['gate'] for p in result['participants']}) != len(roster):
        raise ValueError('Assign each gate exactly once.')
    if len({p['popularity'] for p in result['participants']}) != len(roster):
        raise ValueError('Assign each popularity rank exactly once.')
    if value.get('variations') is not None:
        variants=value['variations']
        if not isinstance(variants,dict) or variants.get('participantId') not in {p['id'] for p in result['participants']}:
            raise ValueError('Select a participant for this comparison.')
        builds=variants.get('builds')
        if not isinstance(builds,list) or not 1<=len(builds)<=20 or result['count']*(len(builds)+1)>1000:
            raise ValueError('Comparisons allow up to 20 alternatives and 1,000 total races.')
        result['variations']={'participantId':variants['participantId'],'builds':[build(v) for v in builds]}
    return result

def variant_setup(value,index):
    variants=value.get('variations')
    if not variants or index<value['count']: return value
    result=deepcopy(value)
    target=next(p for p in result['participants'] if p['id']==variants['participantId'])
    target['uma']=deepcopy(variants['builds'][index//value['count']-1])
    return result

def validate_impact_source(value, source):
    """A linked measurement must preserve the source field and conditions."""
    ignored = {'count', 'variations'}
    if not value.get('variations') or {k:v for k,v in value.items() if k not in ignored} != {k:v for k,v in source.items() if k not in ignored}:
        raise ValueError('Win-impact measurements must use the original race setup.')

def scheduled_seed(value, index):
    return ((value['seed'] + index * 0x9e3779b9 + 2**31) % 2**32) - 2**31

def engine_seed_key(seed):
    # RetailRandom, like System.Random, initializes from the signed magnitude.
    return min(abs(seed), 2**31-1)

def fresh_seed_schedule(count, used):
    excluded = {engine_seed_key(seed) for seed in used}
    draw = random.SystemRandom()
    seeds = []
    while len(seeds) < count:
        seed = draw.randrange(1, 2**31-1)
        if seed not in excluded:
            seeds.append(seed)
            excluded.add(seed)
    return seeds

def execution_order(job):
    # Keep stable run indices, but finish each comparison pair/curve sample
    # before starting the next seed so partial results are immediately useful.
    if job.get('seedSchedule'):
        count = job['setup']['count']
        return [variant*count+sample for sample in range(count) for variant in range(job['total']//count)]
    return list(range(job['total']))

def outcome_only(job, index):
    """Both sides of isolated win-impact comparisons need finish outcomes only.

    Ordinary batches and unrecognized build comparisons retain full summaries.
    """
    value = job['setup']
    variants = value.get('variations')
    if not job.get('impactSourceId') or not variants:
        return False
    base = next(p['uma'] for p in value['participants'] if p['id'] == variants['participantId'])
    inventory = lambda b: sorted((s['id'], s.get('level', 1)) for s in b['skills'])
    original = inventory(base)
    for other in variants['builds']:
        if any(base[k] != other[k] for k in ('charaId','cardId','fans','careerWins')):
            return False
        changed = sum(base['stats'][k] != other['stats'][k] for k in base['stats'])
        equipped = inventory(other)
        if changed == 1 and original == equipped:
            continue
        if changed == 0 and len(original) == len(equipped)+1 and set(equipped).issubset(original):
            continue
        else:
            return False
    return True

def skill_issue(definitions, skill_id):
    definition = definitions.get(str(skill_id))
    if not definition:
        return 'Missing from the installed simulator skill definitions.'
    return None


# GameTora: exchange races at Ooi, Kawasaki, Funabashi and Morioka.
# This is a venue condition, not a dirt-surface or G1/G2/G3 grade test.
DIRT_GRADE_TRACK_IDS = frozenset((10101, 10103, 10104, 10105))


def run_draws(value, index=0, seed_schedule=None):
    variant_index=index//value['count'] if value.get('variations') else 0
    seed_index=index%value['count'] if value.get('variations') else index
    seed = seed_schedule[seed_index] if seed_schedule is not None else scheduled_seed(value, seed_index)
    gates = [p['gate'] for p in value['participants']]
    if value['shuffleGates']:
        random.Random(seed ^ 0x67617465).shuffle(gates)
    override = value.get('moodOverride') or {}
    moods = [override['mood'] if override.get('mode') == 'fixed' else
        random.Random(f'{seed}:mood:{i}').randint(1, 5) if override.get('mode') == 'random' or p['randomizeMood'] else p['mood']
        for i,p in enumerate(value['participants'])]
    label=value['variations']['builds'][variant_index-1]['name'] if variant_index else 'Baseline'
    return {'index':index, 'seed':seed, 'moods':moods, 'gates':gates, 'variantIndex':variant_index, 'variantLabel':label}


def prepare(value, refs, index=0, seed_schedule=None):
    """Seed schedules are independent of batch size, mood and gate settings."""
    run = run_draws(value,index,seed_schedule)
    value=variant_setup(value,index)
    seed, moods, gates = run['seed'], run['moods'], run['gates']
    course = refs.course_data.get(str(value['courseId']))
    if not isinstance(course, dict):
        raise ValueError('This course is not supported by the installed simulator.')
    horses = []
    used_teams = {p['team'] for p in value['participants'] if p['team'] is not None}
    next_solo_team = 0
    for i,p in enumerate(value['participants']):
        uma = p['uma']; inventory = []
        grades = race_aptitudes(p, course)
        for s in uma['skills']:
            definition = refs.skill_data.get(str(s['id']))
            issue = skill_issue(refs.skill_data, s['id'])
            if issue:
                raise ValueError(f"{uma['name']}: skill {s['id']} is not supported. {issue}")
            unique = definition.get('rarity') in (3,4,5)
            inventory.append({'skillId':str(s['id']), 'level':s['level'] if unique else 1, 'isUnique':unique})
        team = p['team']
        if team is None:
            while next_solo_team in used_teams:
                next_solo_team += 1
            team = next_solo_team
            used_teams.add(team)
            next_solo_team += 1
        horses.append({**uma['stats'], 'strategy':STYLE[p['strategy']][0], 'gateIndex':gates[i]-1, 'teamRank':0,
            'mood':moods[i]-3, 'teamId':team, 'popularity':p['popularity'], 'charaId':uma['charaId'],
            'fans':uma['fans'], 'careerWins':uma['careerWins'], 'skills':inventory,
            'distanceAptitude':grades['distance'], 'surfaceAptitude':grades['surface'], 'strategyAptitude':grades['strategyAptitude']})
    spec = deepcopy(refs.settings)
    spec.update({'seed':seed, 'courseId':value['courseId'], 'weather':WEATHER[value['weather']],
        'groundCondition':GROUND[value['ground']], 'season':SEASON[value['season']], 'time':TIME[value['time']], 'grade':GRADE[value['grade']],
        'isDirtGrade':course.get('raceTrackId') in DIRT_GRADE_TRACK_IDS,
        'singleMode':False, 'wisdomChecks':True, 'playerHorseIndex':0, 'experimentalRetailStartup':False,
        'experimentalLaterStaminaMechanics':False, 'retainAllFrames':True, 'decisionTrace':True, 'traceConservePower':True,
        'horses':horses, 'skillData':refs.skill_data})
    return spec, run


class PreparedInputs:
    """Job-local immutable templates; only seed, mood and gate draws vary.

    Returned horse dictionaries are new. Skill definitions and static skill
    inventories are read-only and shared only inside the owning worker.
    """
    def __init__(self, value, refs, seed_schedule=None):
        self.value, self.refs = deepcopy(value), refs
        self.seed_schedule = tuple(seed_schedule) if seed_schedule is not None else None
        self.templates, self.views = {}, {}

    def setup_for(self, index):
        variant=index//self.value['count'] if self.value.get('variations') else 0
        if variant not in self.views:
            self.views[variant]=variant_setup(self.value,index)
        return self.views[variant]

    def prepare(self, index):
        run=run_draws(self.value,index,self.seed_schedule)
        variant=run['variantIndex']
        if variant not in self.templates:
            self.templates[variant]=prepare(self.value,self.refs,index,self.seed_schedule)[0]
        template=self.templates[variant]
        return {**template, 'seed':run['seed'], 'horses':[
            {**horse, 'mood':run['moods'][i]-3, 'gateIndex':run['gates'][i]-1}
            for i,horse in enumerate(template['horses'])]}, run
