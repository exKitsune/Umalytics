"""Data-only skill imports for the audited v74 engine. Unknown mechanics fail closed.

The vocabulary comes from the pinned master table, not from website claims of
support. New combinations/numeric thresholds are allowed; unknown operators,
targeting, scaling and effects are retained as explicit rejection reasons.
"""
from copy import deepcopy
import math
import re

from catalog_transform import overlay, skill_record

CONTRACT = 'v74-skill-import-1'
SOURCE_COMMIT = '231f346a46b569dd4d0f91a0046326275667d1c7'
ATOM = re.compile(r'([a-z][a-z0-9_]*)(==|!=|>=|<=|>|<)(-?\d+)')
BLOCKED = {'is_exist_skill_id'}  # Deliberate upstream no-op, not implemented.
# Metadata-only fields currently supplied by GameTora. A future mechanic at
# the top level must not disappear during normalization.
ROW_FIELDS = set('activation char condition_groups cost desc_en desc_ko desc_tw endesc endesc_needs_retranslation enname evo evo_cond gene_version iconid id inherited jpdesc jpname loc name_en name_ko name_tw parent_skills pre_evo rarity sce_e sup_e sup_hint tid type unreleased versions char_e dataRegion unreleasedGlobal'.split())
CURVES = {
    'stat': [1, 1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08, 1.1],
    'target': [1, 1.01, 1.04, 1.07, 1.1, 1.13, 1.16, 1.19, 1.22, 1.25],
    'accel': [1, 1.02, 1.04, 1.06, 1.08, 1.1, 1.125, 1.15, 1.175, 1.2],
    'other': [1, 1.02, 1.04, 1.06, 1.08, 1.1, 1.12, 1.14, 1.16, 1.18],
}


def catalog_rows(originals):
    """Resolve Global patches before inherited definitions, otherwise retain JP."""
    result = {}
    for original in originals:
        region = 'Global' if original.get('loc', {}).get('en') is not None else 'JP'
        row = overlay(original, original.get('loc', {}).get('en', {}))
        for value in (row, row.get('gene_version')):
            if not value:
                continue
            sid = str(value['id'])
            if not re.fullmatch(r'[1-9]\d{0,9}', sid):
                raise ValueError('Duplicate or invalid engine catalog skill ID')
            candidate = {k: deepcopy(value[k]) for k in ('id', 'rarity', 'activation', 'iconid',
                'condition_groups', 'name_en', 'desc_en', 'enname', 'endesc', 'jpname', 'jpdesc') if k in value}
            candidate.update(dataRegion=region, unreleasedGlobal=region == 'JP' or 'en' in original.get('unreleased', []))
            unknown = set(value) - ROW_FIELDS
            if unknown: candidate['unsupportedFields'] = sorted(unknown)
            if sid in result and result[sid] != candidate:
                raise ValueError('Conflicting engine catalog skill ID: ' + sid)
            result[sid] = candidate
    return result


class Compiler:
    def __init__(self, installed):
        self.ops, self.effects, self.durations = set(), set(), set()
        for skill in installed.values():
            for alt in skill['alternatives']:
                for expression in (alt['condition'], alt.get('precondition', '')):
                    for name, op, _ in ATOM.findall(expression):
                        if name not in BLOCKED: self.ops.add((name, op))
                self.durations.add(alt.get('durationUsage', 1))
                for e in alt['effects']:
                    self.effects.add((e['type'], e['target'], e.get('targetValue', 0),
                        e.get('additionalActivate', 0), e.get('valueUsage', 1)))
        # Implemented comparison variants absent from the frozen master rows.
        self.ops.add(('distance_type', '!='))

    def expression(self, value, optional=False):
        if value == '' and optional: return value
        if not isinstance(value, str) or not 1 <= len(value) <= 4096:
            raise ValueError('Invalid condition expression')
        for part in re.split(r'[&@]', value):
            atom = ATOM.fullmatch(part)
            if not atom or atom.group(1, 2) not in self.ops:
                raise ValueError('Unsupported condition: ' + part[:100])
            name, _, number = atom.groups()
            number = int(number)
            if abs(number) > 100000000:
                raise ValueError('Condition threshold out of range')
            if (name.startswith('phase') and number not in range(4)) or (name == 'always' and number != 1):
                raise ValueError('Unsupported condition value: ' + part)
        return value

    def compile(self, row):
        if row.get('unsupportedFields'):
            raise ValueError('Unknown skill fields: ' + ', '.join(row['unsupportedFields']))
        rarity, activation = row.get('rarity'), row.get('activation')
        if type(rarity) is not int or rarity not in (1, 2, 3, 4, 5, 6) or type(activation) is not int or activation not in (0, 1):
            raise ValueError('Unsupported rarity or activation check')
        groups = row.get('condition_groups')
        if not isinstance(groups, list) or not 1 <= len(groups) <= 16:
            raise ValueError('Missing activation branches')
        alternatives = []
        for group in groups:
            if set(group) - {'condition', 'precondition', 'base_time', 'time_scale', 'cd', 'effects'}:
                raise ValueError('Unknown branch fields')
            duration, cooldown, usage = group.get('base_time'), group.get('cd', 5000000), group.get('time_scale', 1)
            if type(duration) is not int or not -1 <= duration <= 10000000 or type(cooldown) is not int or not 0 <= cooldown <= 10000000 or type(usage) is not int or usage not in self.durations:
                raise ValueError('Unsupported duration or cooldown')
            effects = []
            if not isinstance(group.get('effects'), list) or not 1 <= len(group['effects']) <= 8:
                raise ValueError('Missing skill effects')
            for raw in group['effects']:
                if set(raw) - {'type', 'value', 'target', 'target_details', 'additional_activation', 'value_scale'}:
                    raise ValueError('Unknown effect fields')
                signature = (raw.get('type'), raw.get('target', 1), raw.get('target_details', 0), raw.get('additional_activation', 0), raw.get('value_scale', 1))
                if any(type(v) is not int for v in signature) or signature not in self.effects:
                    raise ValueError('Unsupported effect/target/scaling: ' + str(signature))
                value = raw.get('value')
                if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 100000000:
                    raise ValueError('Invalid effect value')
                kind = signature[0]
                curve = [1]*10 if kind == 37 else CURVES['stat' if kind in range(1, 6) else 'target' if kind == 27 else 'accel' if kind == 31 else 'other']
                effects.append(dict(type=kind, target=signature[1], targetValue=signature[2], additionalActivate=signature[3], valueUsage=signature[4], modifier=value, levelModifiers=curve))
            alternatives.append(dict(condition=self.expression(group.get('condition')), precondition=self.expression(group.get('precondition', ''), True),
                baseDuration=duration, durationUsage=usage, cooldown=cooldown, effects=effects))
        # v74's green-category bit affects skill interactions. Icons alone are
        # insufficient: negatives and event-only buffs reuse green icons, while
        # Runaway/Racing Spirit use other icons. This matches every pinned row:
        # permanent positive stat/Runaway effects in the learned-skill ID range.
        green = 200000 <= row['id'] < 300000 and all(a['baseDuration'] == -1 for a in alternatives) and any(
            (1 <= e['type'] <= 5 and e['modifier'] > 0) or e['type'] == 6 for a in alternatives for e in a['effects'])
        return dict(rarity=rarity, wisdomCheck=activation, priority=0, tags=[601] if green else [],
                    isGeneralSkill=rarity not in (3, 4, 5), alternatives=alternatives)

    def additions(self, rows, installed):
        accepted, rejected, presentation = {}, {}, {}
        for sid, row in rows.items():
            if sid in installed: continue
            try:
                if type(row.get('id')) is not int or str(row['id']) != sid:
                    raise ValueError('Skill ID does not match its catalog key')
                accepted[sid] = self.compile(row)
                presentation[sid] = {**skill_record(row, row['dataRegion']), 'unreleasedGlobal': row['unreleasedGlobal']}
            except (ValueError, KeyError, TypeError, AttributeError) as error:
                accepted.pop(sid, None)
                rejected[sid] = str(error)
        return accepted, presentation, rejected
