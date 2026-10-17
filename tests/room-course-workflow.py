"""A later replay can take its course from an earlier room response with the same seed or room id."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'proxy'))
from race_extract import api_route, apply_race_times, apply_room_bindings, collect_race_times, collect_room_bindings, extract_races, remember_race_times, remember_room_bindings, saved_replay_route, stamp_race_clocks, trace_api_payload

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
traced = trace_api_payload({'data': {'room_info': {'race_instance_id': 800018, 'saved_room_id': 55, 'random_seed': 1700647490, 'save_time': '2026-10-01 12:30:00'}, 'auth': {'token': 'PRIVATE_ROOM_TOKEN'}}})
encoded = json.dumps(traced)
assert traced['body']['data']['room_info']['saved_room_id'] == 55
assert traced['body']['data']['room_info']['random_seed'] == 1700647490
assert traced['body']['data']['room_info']['save_time'] == '2026-10-01 12:30:00'
assert 'auth' not in traced['body']['data']
assert 'PRIVATE_ROOM_TOKEN' not in encoded
saved_list = {'data': {'race_result_array': [
    {'saved_room_id': 55, 'race_instance_id': 800002, 'start_time': '2026-10-01 12:30:00',
     'trained_chara_array': [{'create_time': '2020-01-01 00:00:00'}]}]}}
replay_saved = {'data': {'race_scenario': 'SYNTHETIC_REPLAY', 'saved_room_id': 55, 'weather': 1,
    'race_horse_data_array': [{'frame_order': 1}],
    'trained_chara_array': [{'create_time': '2020-01-01 00:00:00'}]}}
time_memory = []
remember_race_times(time_memory, collect_race_times(saved_list))
saved_races = extract_races(replay_saved, endpoint)
assert 'raced_at' not in saved_races[0]
apply_race_times(saved_races, time_memory)
assert saved_races[0]['raced_at'] == '2026-10-01T12:30:00'
assert saved_races[0]['raced_at'] != '2020-01-01T00:00:00'
direct = extract_races({'data': {'race_scenario': 'SYNTHETIC_REPLAY', 'race_instance_id': 800002,
    'race_result': {'start_time': '2026-10-02 08:15:00', 'saved_room_id': 9},
    'race_horse_data_array': [{'frame_order': 1}]}}, endpoint)
assert direct[0]['raced_at'] == '2026-10-02T08:15:00'
timed = trace_api_payload(saved_list)
assert timed['body']['data']['race_result_array'][0]['start_time'] == '2026-10-01 12:30:00'
assert timed['body']['data']['race_result_array'][0]['trained_chara_array'][0]['create_time'] == '2020-01-01 00:00:00'
live = extract_races({'data': {'race_scenario': 'SYNTHETIC_REPLAY', 'race_instance_id': 511501,
    'race_horse_data_array': [{'frame_order': 1}]}}, endpoint, captured_at='2026-10-17T22:43:03.700575+00:00')
stamp_race_clocks(live, '2026-10-17T22:43:03.700575+00:00', False)
assert live[0]['raced_at'] == '2026-10-17T22:43:03Z'
assert live[0]['raced_at_source'] == 'capture'
assert live[0]['saved_replay'] is False
assert live[0]['race_designation'] == 'room-live'
replay_only = extract_races({'data': {'race_scenario': 'SYNTHETIC_REPLAY', 'race_instance_id': 510801,
    'race_horse_data_array': [{'frame_order': 1}]}}, endpoint, captured_at='2026-10-17T22:43:34.645287+00:00')
stamp_race_clocks(replay_only, '2026-10-17T22:43:34.645287+00:00', True)
assert 'raced_at' not in replay_only[0]
assert replay_only[0]['saved_replay'] is True
stamp_race_clocks(direct, '2026-10-17T22:45:46.648963+00:00', True)
assert direct[0]['raced_at'] == '2026-10-02T08:15:00'
assert direct[0]['raced_at_source'] == 'game'
assert direct[0]['saved_replay'] is True
practice_list = {'data': {'saved_race_array': [
    {'race_instance_id': 510801, 'save_time': '2026-10-17 20:52:52', 'practice_race_id': 9},
    {'race_instance_id': 511501, 'save_time': '2026-10-17 22:43:03', 'practice_race_id': 10}]}}
practice_endpoint = '/\x75mamusume/practice_race/race_replay'
practice_memory = []
remember_race_times(practice_memory, collect_race_times(practice_list))
practice_replay = extract_races({'data': {'race_scenario': 'SYNTHETIC_REPLAY', 'race_instance_id': 510801,
    'race_horse_data_array': [{'frame_order': 1}]}}, practice_endpoint)
assert practice_replay[0]['race_mode'] == 'practice'
stamp_race_clocks(practice_replay, None, saved_replay_route(practice_endpoint))
apply_race_times(practice_replay, practice_memory)
stamp_race_clocks(practice_replay, '2026-10-17T23:02:00+00:00', True)
assert practice_replay[0]['saved_replay'] is True
assert practice_replay[0]['race_designation'] == 'practice-saved'
assert practice_replay[0]['raced_at'] == '2026-10-17T20:52:52'
assert practice_replay[0]['raced_at_source'] == 'game'
room_endpoint = '/\x75mamusume/room_match/get_saved_race_result'
room_replay = extract_races({'data': {'race_scenario': 'SYNTHETIC_REPLAY', 'race_instance_id': 510801,
    'race_horse_data_array': [{'frame_order': 1}]}}, room_endpoint)
stamp_race_clocks(room_replay, None, True)
apply_race_times(room_replay, practice_memory)
assert room_replay[0]['race_mode'] == 'room'
assert room_replay[0]['race_designation'] == 'room-saved'
assert 'raced_at' not in room_replay[0]
duplicate = {'data': {'saved_race_array': [
    {'race_instance_id': 510801, 'save_time': '2026-10-17 20:52:52'},
    {'race_instance_id': 510801, 'save_time': '2026-10-18 01:00:00'}]}}
duplicate_memory = []
remember_race_times(duplicate_memory, collect_race_times(duplicate))
ambiguous_practice = extract_races({'data': {'race_scenario': 'SYNTHETIC_REPLAY', 'race_instance_id': 510801,
    'race_horse_data_array': [{'frame_order': 1}]}}, practice_endpoint)
stamp_race_clocks(ambiguous_practice, None, True)
apply_race_times(ambiguous_practice, duplicate_memory)
assert 'raced_at' not in ambiguous_practice[0]
assert api_route('/\x75mamusume/room_match/start?viewer=1') == '/\x75mamusume/room_match/start'
assert api_route('/\x75mamusume/user/123456/profile') == '/\x75mamusume/user/:n/profile'
print(json.dumps({'roomCourseAttached': 'passed', 'ambiguousSeedWithheld': 'passed', 'roomIdNotPersisted': 'passed', 'weatherMismatchWithheld': 'passed', 'apiTraceRedacted': 'passed', 'raceTimeAttached': 'passed', 'liveCaptureClock': 'passed', 'practiceSaveTime': 'passed'}))
