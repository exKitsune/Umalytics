"""Custom-race popularity from the race mechanics document, reviewed 2026-11-02.

https://docs.google.com/document/d/15VzW9W2tXBBTibBRbZ8IVpW6HaMX8H0RP03kq6Az7Xg
This predicts setup popularity, never replaces a captured race's recorded ranks.
"""
import math
import re

SPEED = dict(zip('SABCDEFG', (1.05, 1, .9, .8, .6, .4, .2, .1)))
ACCEL = dict(zip('SABCDEFG', (1, 1, 1, 1, 1, .6, .5, .4)))
GROUND = dict(zip('SABCDEFG', (1.05, 1, .9, .8, .7, .5, .3, .1)))
STATIC = {'distance_type', 'ground_type', 'rotation', 'track_id', 'ground_condition',
          'season', 'weather', 'time', 'grade', 'is_basis_distance', 'running_style', 'post_number'}
ATOM = re.compile(r'([a-z][a-z0-9_]*)(==|!=|>=|<=|>|<)(-?\d+)')


def eligible(expression, context):
    # Other conditions describe in-race triggers and do not gate popularity.
    def atom(match):
        key, op, raw = match.groups()
        if key not in STATIC:
            return True
        a, b = context[key], int(raw)
        return {'==': a == b, '!=': a != b, '>=': a >= b, '<=': a <= b, '>': a > b, '<': a < b}[op]
    return any(all(atom(m) for m in ATOM.finditer(clause)) for clause in (expression or '').split('@'))


def standardize(values):
    mean = sum(values) / len(values)
    sd = math.sqrt(sum((v-mean)**2 for v in values) / len(values))
    return [50 + 10*(v-mean)/sd if sd > 1e-10 else 50 for v in values]


def calculate(setup, course, skills, moods=None, gates=None, aptitude=None):
    roster = setup['participants']
    if not roster:
        return []
    moods = moods or [setup.get('moodOverride', {}).get('mood', p['mood']) for p in roster]
    gates = gates or [p['gate'] for p in roster]
    guts = standardize([p['uma']['stats']['guts'] for p in roster])
    wisdom = standardize([p['uma']['stats']['wisdom'] for p in roster])
    raw_judges = []
    for i, p in enumerate(roster):
        raw = p['uma']['stats']
        bonus = [0., 0., 0.]
        context = {'distance_type': course.get('distanceType', 1 if course['distance'] <= 1400 else 2 if course['distance'] <= 1800 else 3 if course['distance'] <= 2400 else 4),
            'ground_type': course['surface'], 'rotation': course['turn'], 'track_id': course['raceTrackId'],
            'ground_condition': setup['ground'], 'season': setup['season'], 'weather': setup['weather'],
            'time': setup['time'], 'grade': setup['grade'], 'is_basis_distance': int(course['distance'] % 400 == 0),
            'running_style': 1 if p['strategy'] == 5 else p['strategy'], 'post_number': gates[i]}
        for equipped in p['uma']['skills']:
            skill = skills.get(str(equipped['id']))
            if not skill or 'popularityBonuses' not in skill:
                raise ValueError(f"Popularity data unavailable for skill {equipped['id']}.")
            branches = skill['branches']
            if branches and not any(eligible(b.get('condition', ''), context) and eligible(b.get('precondition', ''), context) for b in branches):
                continue
            chance = max(.2, 1 - 90 / max(1, raw['wisdom'])) if skill.get('activateLot') else 1
            for row in skill['popularityBonuses']:
                if 1 <= row['stat'] <= 3:
                    bonus[row['stat']-1] += row['value'] * chance
        grades = aptitude(p, course) if aptitude else p
        motivation = 1 + (moods[i]-3)*.02
        speed = (raw['speed']+bonus[0])*motivation*SPEED[grades['distance']]
        stamina = (raw['stamina']+bonus[1])*motivation
        power = (raw['power']+bonus[2])*motivation*ACCEL[grades['distance']]*GROUND[grades['surface']]
        raw_judges.append([speed*math.sqrt(guts[i]), stamina*guts[i]**.8*wisdom[i]**.6, power*math.sqrt(wisdom[i])])
    judges = [standardize([r[j] for r in raw_judges]) for j in range(3)]
    # Stable gate order resolves exact score ties without drawing extra RNG.
    ranks = [[sorted(range(len(roster)), key=lambda i: (-scores[i], gates[i], i)).index(i)+1 for i in range(len(roster))] for scores in judges]
    result = []
    for i, p in enumerate(roster):
        high = any(scores[i] > 70 for scores in judges)
        impacts = []
        for j, scores in enumerate(judges):
            score = scores[i]
            exponent = 1 if score > 55 else .8 if high else score-54
            rank_bonus = {1: 2, 2: 1, 3: .5, 4: .2, 5: .2}.get(ranks[j][i], 0)
            impacts.append(score**exponent + rank_bonus)
        result.append({'id': p['id'], 'score': math.prod(impacts), 'judges': [s[i] for s in judges]})
    order = sorted(range(len(roster)), key=lambda i: (-result[i]['score'], gates[i], i))
    return [{**row, 'rank': order.index(i)+1} for i, row in enumerate(result)]
