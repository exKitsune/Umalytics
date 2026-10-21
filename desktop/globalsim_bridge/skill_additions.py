"""Reviewed additions to the frozen v74 skill table; never overwrite its rows.

Global Sweep Tosho 30128 released 2026-10-20. Both definitions use conditions
already implemented by v74. They remain subject to the complete replay match.
No runtime website lookup or JP mechanics fallback is used by the simulator.
"""
SOURCE = {
    'url': 'https://gametora.com/data/\u0075mamusume/skills.8f4de2d0.json',
    'region': 'Global',
    'release': '2026-10-20',
    'support': 'https://gametora.com/\u0075mamusume/supports/30128-sweep-tosho',
}


def definitions():
    return {
        sid: {
            'rarity': rarity, 'wisdomCheck': 1, 'priority': 0,
            'tags': [], 'isGeneralSkill': True,
            'alternatives': [{
                'condition': 'running_style==4&phase_firsthalf_random==2',
                'precondition': 'distance_rate>=66&order_rate_out50_continue==1&temptation_count==0',
                'baseDuration': 12000, 'durationUsage': 1, 'cooldown': 5000000,
                'effects': [{'type': 31, 'target': 1, 'targetValue': 0,
                             'additionalActivate': 0, 'valueUsage': 1, 'modifier': modifier,
                             'levelModifiers': [1, 1.01, 1.04, 1.07, 1.1, 1.13, 1.16, 1.19, 1.22, 1.25]}],
            }],
        }
        for sid, rarity, modifier in [('202491', 2, 4000), ('202492', 1, 2000)]
    }
