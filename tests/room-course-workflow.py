"""A later replay can take its course from an earlier room response with the same seed or room id."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'proxy'))
from race_extract import api_route, apply_room_bindings, collect_room_bindings, extract_races, remember_room_bindings, trace_api_payload

endpoint = '/\x75mamusume/room_match/result'
room = {'data': {'room_info': {'race_instance_id': 800018, 'random_seed': 1700647490, 'weather': 1, 'season': 4, 'ground_condition': 1},
    'auth': {'token': 'PRIVATE_ROOM_TOKEN'}}}
replay = {'data': {'race_scenario': 'SYNTHETIC_REPLAY', 'random_seed': 1700647490, 'weather': 1, 'season': 4, 'ground_condition': 1,
    'race_horse_data_array': [{'frame_order': 1, 'viewer_id': 'PRIVATE_RUNNER'}]}}
memory = []
remember_room_bindings(memory, collect_room_bindings(room))
races = extract_races(replay, endpoint)
apply_room_bindings(races, memory)
assert len(races) == 1
assert races[0]['race_instance_id'] == 800018
assert races[0]['metadata']['umaTrace']['courseSource'] == 'room-response'
assert '_room_join' not in races[0]
assert 'PRIVATE_ROOM_TOKEN' not in json.dumps(races)
assert 'saved_room_id' not in races[0]

conflict = {'data': {'room_info': {'race_instance_id': 800099, 'random_seed': 1700647490, 'weather': 1, 'season': 4, 'ground_condition': 1}}}
remember_room_bindings(memory, collect_room_bindings(conflict))
ambiguous = extract_races(replay, endpoint)
apply_room_bindings(ambiguous, memory)
assert 'race_instance_id' not in ambiguous[0]

keyed = {'data': {'saved_room_id': 55, 'race_scenario': 'SYNTHETIC_REPLAY', 'weather': 1,
    'race_horse_data_array': [{'frame_order': 1}]}}
room_key = {'data': {'saved_room_id': 55, 'race_instance_id': 800018, 'weather': 1}}
separate = []
remember_room_bindings(separate, collect_room_bindings(room_key))
keyed_races = extract_races(keyed, endpoint)
apply_room_bindings(keyed_races, separate)
assert keyed_races[0]['race_instance_id'] == 800018
assert 'saved_room_id' not in keyed_races[0]

weather = {'data': {'race_scenario': 'SYNTHETIC_REPLAY', 'random_seed': 1700647490, 'weather': 2,
    'race_horse_data_array': [{'frame_order': 1}]}}
weather_races = extract_races(weather, endpoint)
apply_room_bindings(weather_races, [memory[0]])
assert 'race_instance_id' not in weather_races[0]
traced = trace_api_payload({'data': {'room_info': {'race_instance_id': 800018, 'saved_room_id': 55, 'random_seed': 1700647490}, 'auth': {'token': 'PRIVATE_ROOM_TOKEN'}}})
encoded = json.dumps(traced)
assert traced['race_instance_id'] == [800018]
assert 'saved_room_id' in traced['fields'] and 'random_seed' in traced['fields']
assert '55' not in encoded and 'PRIVATE_ROOM_TOKEN' not in encoded and '1700647490' not in encoded
assert api_route('/\x75mamusume/room_match/start?viewer=1') == '/\x75mamusume/room_match/start'
assert api_route('/\x75mamusume/user/123456/profile') == '/\x75mamusume/user/:n/profile'
print(json.dumps({'roomCourseAttached': 'passed', 'ambiguousSeedWithheld': 'passed', 'roomIdNotPersisted': 'passed', 'weatherMismatchWithheld': 'passed', 'apiTraceRedacted': 'passed'}))
