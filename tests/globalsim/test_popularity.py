from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
from sandbox_popularity import calculate, eligible, standardize
import sandbox_inputs as inputs
from test_sandbox import setup
from test_adapter import references


class Popularity(unittest.TestCase):
    def data(self):
        value = inputs.setup(setup())
        value['autoPopularity'] = True
        refs = references()
        refs.course_data['101'].update(turn=2, raceTrackId=10001)
        refs.metadata['skills'] = {'11': {'activateLot': 1, 'popularityBonuses': [{'stat': 2, 'value': 60}],
            'branches': [{'condition': 'distance_type==2&phase==1', 'precondition': ''}]}}
        return value, refs

    def test_equal_field_and_single_runner_are_finite_and_unique(self):
        self.assertEqual(standardize([600,600]), [50,50])
        value, refs = self.data()
        ranks = inputs.popularity_for(value, refs)
        self.assertEqual([r['rank'] for r in ranks], list(range(1,10)))
        self.assertTrue(all(r['judges'] == [50,50,50] for r in ranks))
        value['participants'] = value['participants'][:1]
        self.assertEqual(inputs.popularity_for(value, refs)[0]['rank'], 1)

    def test_static_conditions_only_and_alternatives(self):
        context = {'distance_type': 2, 'weather': 1}
        self.assertTrue(eligible('distance_type==2&phase==3', context))
        self.assertFalse(eligible('distance_type==1&phase==3', context))
        self.assertTrue(eligible('distance_type==1@weather==1', context))
        self.assertFalse(eligible('distance_type==1@weather==2', context))

    def test_raw_wisdom_skill_probability_and_eligibility(self):
        value, refs = self.data()
        value['participants'] = value['participants'][:2]
        for p in value['participants']:
            p['uma']['stats']['wisdom'] = 1000
        value['participants'][1]['uma']['skills'] = []
        # At raw wisdom 1000, Maestro adds 54.6 stamina; 1000+54.6 beats 1050.
        value['participants'][0]['uma']['stats']['stamina'] = 1000
        value['participants'][1]['uma']['stats']['stamina'] = 1050
        result = inputs.popularity_for(value, refs)
        self.assertEqual(result[0]['judges'][1], 60)
        refs.metadata['skills']['11']['branches'][0]['condition'] = 'distance_type==1'
        self.assertAlmostEqual(inputs.popularity_for(value, refs)[0]['judges'][1], 40)

    def test_guts_wisdom_skill_bonuses_do_not_apply(self):
        value, refs = self.data()
        before = inputs.popularity_for(value, refs)
        refs.metadata['skills']['11']['popularityBonuses'] += [{'stat':4,'value':9999},{'stat':5,'value':9999}]
        self.assertEqual(before, inputs.popularity_for(value, refs))

    def test_draws_variations_and_cached_inputs_match(self):
        value, refs = self.data()
        alternate = deepcopy(value['participants'][0]['uma'])
        alternate['stats']['speed'] = 1900
        value['variations'] = {'participantId':'0', 'builds':[alternate]}
        prepared = inputs.PreparedInputs(value, refs)
        for i in range(6):
            spec, run = prepared.prepare(i)
            self.assertEqual((spec,run), inputs.prepare(value, refs, i))
            expected = inputs.popularity_for(inputs.variant_setup(value,i), refs, run['moods'], run['gates'])
            self.assertEqual([h['popularity'] for h in spec['horses']], [r['rank'] for r in expected])
            self.assertEqual(run['popularities'], [h['popularity'] for h in spec['horses']])

    def test_teams_and_auto_flag_roundtrip(self):
        value, _ = self.data()
        value['teams'] = [{'id':0,'name':'Friends'}, {'id':12,'name':'Empty team'}]
        self.assertEqual(inputs.setup(json.loads(json.dumps(value))), value)
        value['teams'].append({'id':0,'name':'Duplicate'})
        with self.assertRaises(ValueError):
            inputs.setup(value)

    def test_unknown_bonus_metadata_is_explicit(self):
        value, refs = self.data()
        refs.metadata['skills']['11'].pop('popularityBonuses')
        with self.assertRaisesRegex(ValueError,'Popularity data unavailable'):
            inputs.popularity_for(value, refs)


if __name__ == '__main__':
    unittest.main()
