"""Pure replay decoder and exact observed-versus-modeled comparator.

Binary layout follows exKitsune/Umalytics src/data/binary.ts, originally
adapted from SSHZ.ORG's MIT-licensed RaceDataParser. This module contains no
filesystem access, subprocess execution, input fitting, or engine fallback.
Verified means agreement only for the explicitly compared recorded fields.
"""
from __future__ import annotations

import base64
import binascii
from collections import Counter
import math
import struct
import zlib

COMPARATOR_VERSION = "recorded-observations-v2"
MAX_DECODED = 128 * 1024 * 1024

def f32(number: float) -> float:
    return struct.unpack('<f', struct.pack('<f', number))[0]


def f32bits(number: float) -> int:
    return struct.unpack('<I', struct.pack('<f', number))[0]


def wire_u16(number: float, scale: int) -> int:
    """Float32 value; wider multiply; truncate; saturate to unsigned16.

    This is the explicitly audited GlobalSim replay quantization contract,
    also used by its captured-fixture checker. No tolerance is added.
    """
    if not math.isfinite(number):
        raise ValueError('non-finite simulated wire field')
    clamped = max(0.0, min(65535.0 / scale, number))
    return min(65535, int(f32(clamped) * scale))


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.cursor = 0

    def need(self, size: int):
        if size < 0 or self.cursor + size > len(self.data):
            raise ValueError(f'invalid replay length at byte {self.cursor}, need {size}')

    def unpack(self, fmt: str):
        size = struct.calcsize('<' + fmt)
        self.need(size)
        values = struct.unpack_from('<' + fmt, self.data, self.cursor)
        self.cursor += size
        return values[0] if len(values) == 1 else values

    def integer(self):
        return self.unpack('i')

    def float(self):
        value = self.unpack('f')
        if not math.isfinite(value):
            raise ValueError('non-finite replay float')
        return value

    def skip(self, size: int):
        self.need(size)
        self.cursor += size

    def padding(self):
        self.skip(self.integer())


def decode_scenario(encoded: str) -> dict:
    try:
        compressed = base64.b64decode(''.join(encoded.split()), validate=True)
        inflater = zlib.decompressobj(wbits=47)  # gzip or zlib, like pako Inflate
        data = inflater.decompress(compressed, MAX_DECODED + 1)
    except (binascii.Error, zlib.error) as error:
        raise ValueError('invalid base64/compressed replay') from error
    if len(data) > MAX_DECODED or not inflater.eof:
        raise ValueError('oversized or incomplete compressed replay')
    if inflater.unused_data:
        raise ValueError('additional compressed stream/trailing compressed data')
    reader = Reader(data)
    header_size = reader.integer()
    if not 4 <= header_size <= 4096:
        raise ValueError('unsupported header size')
    version = reader.integer()
    reader.skip(header_size - 4)
    distance_diff_max = reader.float()
    count = reader.integer()
    horse_frame_size = reader.integer()
    horse_result_size = reader.integer()
    if not 1 <= count <= 64 or not 12 <= horse_frame_size <= 4096 or not 31 <= horse_result_size <= 65536:
        raise ValueError('unsupported runner count or record sizes')
    reader.padding()
    frame_count = reader.integer()
    frame_size = reader.integer()
    if not 1 <= frame_count <= 100000 or frame_count * count > 1000000:
        raise ValueError('unsupported frame count')
    if frame_size < 4 + count * horse_frame_size:
        raise ValueError('undersized frame stride')
    reader.need(frame_count * frame_size)
    frames = []
    previous_time = -math.inf
    for _ in range(frame_count):
        frame_start = reader.cursor
        timestamp = reader.float()
        if not 0 <= timestamp <= 3600 or timestamp <= previous_time:
            raise ValueError('invalid frame timestamp ordering')
        previous_time = timestamp
        horses = []
        for slot in range(count):
            start = reader.cursor
            distance = reader.float()
            lane, speed, hp, temptation, blocker = reader.unpack('HHHbb')
            if not -100 <= distance <= 100000:
                raise ValueError('implausible replay position')
            horses.append({'slot': slot, 'pos': distance, 'laneWire': lane,
                           'speedWire': speed, 'hpWire': hp,
                           'temptationMode': temptation,
                           'blockFrontHorseIndex': blocker if -1 <= blocker < count else None})
            reader.cursor = start + horse_frame_size
        reader.cursor = frame_start + frame_size
        frames.append({'t': timestamp, 'horses': horses})
    reader.padding()
    reader.need(count * horse_result_size)
    results = []
    for slot in range(count):
        start = reader.cursor
        rank = reader.integer()
        finish_time = reader.float()
        gap = reader.float()
        delay = reader.float()
        guts, wisdom = reader.unpack('BB')
        spurt = reader.float()
        strategy = reader.unpack('B')
        flags = reader.integer()
        raw = reader.float()
        if not 0 <= rank < count or raw <= 0:
            raise ValueError('invalid final runner record')
        results.append({'slot': slot, 'finishOrder': rank, 'finishTime': finish_time,
                        'finishTimeRaw': raw, 'finishGap': gap, 'startDelayTime': delay,
                        'gutsOrder': guts, 'wizOrder': wisdom,
                        'lastSpurtStartDistance': spurt, 'runningStyle': strategy,
                        'defeatFlags': flags})
        reader.cursor = start + horse_result_size
    reader.padding()
    event_count = reader.integer()
    if not 0 <= event_count <= 100000:
        raise ValueError('invalid event count')
    events = []
    for _ in range(event_count):
        size = reader.unpack('h')
        if size < 6:
            raise ValueError('undersized event')
        reader.need(size)
        start = reader.cursor
        timestamp = reader.float()
        kind, parameters = reader.unpack('bb')
        if not 0 <= timestamp <= 3600 or parameters < 0 or 6 + parameters * 4 > size:
            raise ValueError('invalid event header')
        params = [reader.integer() for _ in range(parameters)]
        events.append({'t': timestamp, 'type': kind, 'params': params})
        reader.cursor = start + size
    warnings = []
    if reader.cursor != len(data):
        warnings.append(f'{len(data)-reader.cursor} trailing decompressed bytes not interpreted')
    if horse_frame_size != 12 or horse_result_size != 31:
        warnings.append('extended record fields skipped')
    return {'runnerCount': count, 'frames': frames, 'results': results, 'events': events,
            'layout': {'headerVersion': version, 'headerSize': header_size,
                       'horseFrameSize': horse_frame_size, 'horseResultSize': horse_result_size,
                       'frameSize': frame_size, 'decodedBytes': len(data),
                       'distanceDiffMax': distance_diff_max}, 'warnings': warnings}


def new_metric():
    return {'capability': 'compared', 'unavailable': 0,
            'compared': 0, 'exact': 0, 'mismatches': 0, 'maxAbsError': 0.0,
            'firstMismatch': None}


def mark_unavailable(metric, location, reason):
    metric['capability'] = 'partially_unavailable'
    metric['unavailable'] += 1
    if 'firstUnavailable' not in metric:
        metric['firstUnavailable'] = dict(location, reason=reason)


def measure(metric, expected, actual, location, *, exact=None):
    metric['compared'] += 1
    equal = actual == expected if exact is None else exact
    metric['exact' if equal else 'mismatches'] += 1
    if isinstance(expected, (float, int)) and isinstance(actual, (float, int)):
        metric['maxAbsError'] = max(metric['maxAbsError'], abs(actual-expected))
    if not equal and metric['firstMismatch'] is None:
        metric['firstMismatch'] = dict(location, expected=expected, actual=actual)
    return equal


def counter_result(expected: Counter, actual: Counter, labels: list[str]) -> dict:
    missing, extra = expected-actual, actual-expected
    def examples(counter):
        return [dict(zip(labels, key), count=number) for key, number in sorted(counter.items())[:20]]
    time_index = labels.index('t') if 't' in labels else None
    def first(counter):
        if not counter:
            return None
        key = min(counter, key=lambda key: (key[time_index], key) if time_index is not None else key)
        return dict(zip(labels, key), count=counter[key])
    return {'capability': 'compared', 'observed': sum(expected.values()),
            'simulated': sum(actual.values()), 'matched': sum((expected & actual).values()),
            'missing': sum(missing.values()), 'extra': sum(extra.values()),
            'exact': expected == actual, 'missingExamples': examples(missing),
            'extraExamples': examples(extra), 'firstMissing': first(missing),
            'firstExtra': first(extra)}


def compare_events(observed, simulated, slot_map):
    skills = [e for e in observed if e['type'] == 3 and len(e['params']) >= 5
              and (e['params'][2] != -1 or e['t'] == 0)]
    key = lambda e: (slot_map[int(e['horseIndex'])], int(e['skillId']), f32(e['t']))
    starts_expected = Counter((e['params'][0], e['params'][1], e['t']) for e in skills)
    result = {}
    if 'skillEvents' in simulated:
        actual = [e for e in simulated['skillEvents'] if str(e['skillId']).isdigit()]
        result['skillStarts'] = counter_result(starts_expected, Counter(key(e) for e in actual),
                                               ['slot', 'skillId', 't'])
        duration = lambda e: -1 if e['t'] <= 0 else int(f32(e['duration']) * 10000.0)
        result['skillRecordedDurations'] = counter_result(
            Counter((e['params'][0], e['params'][1], e['t'], e['params'][2]) for e in skills),
            Counter((*key(e), duration(e)) for e in actual), ['slot', 'skillId', 't', 'durationWire'])
    else:
        result['skillStarts'] = {'capability': 'unavailable', 'reason': 'engine has no skillEvents'}
        result['skillRecordedDurations'] = {'capability': 'unavailable'}
    if 'skillDetailEvents' in simulated:
        result['skillDetails'] = counter_result(
            Counter((e['params'][0], e['params'][1], e['t'], e['params'][3]) for e in skills),
            Counter((*key(e), e['detailIndex']) for e in simulated['skillDetailEvents']),
            ['slot', 'skillId', 't', 'detailIndex'])
    else:
        result['skillDetails'] = {'capability': 'unavailable'}
    if 'skillTargetEvents' in simulated:
        masks = Counter()
        unobservable = 0
        for e in simulated['skillTargetEvents']:
            if e['t'] <= 0:
                mask = 0
            elif not e['abilityTargets'] or e['abilityTargets'][0] is None:
                unobservable += 1
                continue
            else:
                mask = sum(1 << slot_map[int(i)] for i in set(e['abilityTargets'][0])) & 0xffffffff
            masks[(*key(e), e['detailIndex'], mask)] += 1
        result['skillVisualRecipients'] = counter_result(
            Counter((e['params'][0], e['params'][1], e['t'], e['params'][3], e['params'][4] & 0xffffffff)
                    for e in skills), masks, ['slot', 'skillId', 't', 'detailIndex', 'mask'])
        result['skillVisualRecipients']['unobservableSimulatedSelections'] = unobservable
    else:
        result['skillVisualRecipients'] = {'capability': 'unavailable'}
    if 'competitionEvents' in simulated and 'conservePowerEvents' in simulated:
        expected = Counter((e['type'], e['params'][0], e['t']) for e in observed
                           if e['type'] in (4, 5, 6) and e['params'])
        actual = Counter((int(e['type']), slot_map[int(e['horseIndex'])], f32(e['t']))
                         for e in simulated['competitionEvents'] if e['type'] in (4, 5))
        actual.update((6, slot_map[int(e['horseIndex'])], f32(e['t']))
                      for e in simulated['conservePowerEvents'])
        result['competitionStarts'] = counter_result(expected, actual, ['type', 'slot', 't'])
    else:
        result['competitionStarts'] = {'capability': 'unavailable'}
    result['uninterpretedEventTypes'] = dict(Counter(str(e['type']) for e in observed
                                                    if e['type'] not in (3, 4, 5, 6)))
    result['uninterpretedAdditionalSkillParameters'] = dict(Counter(str(e['params'][5:])
        for e in skills if len(e['params']) > 5))
    return result


def compare_observations(observed, simulated, initial, capture):
    if 'error' in simulated:
        return {'status': 'engine_error', 'error': simulated['error']}
    n = observed['runnerCount']
    frame_orders = [int(h['frame_order']) for h in capture['race_horse_data_array']]
    if sorted(frame_orders) != list(range(1, n+1)):
        raise ValueError('capture frame_order is not a complete runner permutation')
    slot_map = {i: int(h['gateIndex']) for i, h in enumerate(initial['horses'])}
    if sorted(slot_map.values()) != list(range(n)):
        raise ValueError('input gateIndex is not the zero-based capture frame_order permutation')
    if len(simulated.get('results', [])) != n:
        raise ValueError('simulated result roster size differs')
    index_for_slot = {slot: i for i, slot in slot_map.items()}
    result_fields = ('finishTimeRaw', 'finishOrder', 'startDelayTime',
                     'lastSpurtStartDistance', 'runningStyle', 'gutsOrder', 'wizOrder')
    float_fields = {'finishTimeRaw', 'startDelayTime', 'lastSpurtStartDistance'}
    results = {key: new_metric() for key in result_fields}
    result_rows = []
    for slot, row in enumerate(observed['results']):
        actual = simulated['results'][index_for_slot[slot]]
        diffs = {}
        for name in result_fields:
            expected, got = row[name], actual.get(name)
            equal = got is not None and (f32bits(got) == f32bits(expected) if name in float_fields else got == expected)
            measure(results[name], expected, got, {'slot': slot, 'frameOrder': slot+1}, exact=equal)
            if not equal:
                diffs[name] = {'expected': expected, 'actual': got}
        result_rows.append({'slot': slot, 'frameOrder': slot+1,
                            'officialFinishOrder': row['finishOrder']+1,
                            'simulatedFinishOrder': actual['finishOrder']+1,
                            'officialFinishTimeRaw': row['finishTimeRaw'],
                            'simulatedFinishTimeRaw': actual['finishTimeRaw'],
                            'differences': diffs})

    frame_fields = ('pos', 'speed', 'hp', 'lane', 'temptationMode', 'blockFrontHorseIndex')
    frame_stats = {key: new_metric() for key in frame_fields}
    frame_map = {}
    for frame in simulated.get('frames', []):
        k = f32bits(frame['t'])
        if k in frame_map:
            raise ValueError('duplicate simulated float32 frame timestamp')
        frame_map[k] = frame
    observed_pre_finish = compared_samples = exact_samples = skipped_after_finish = 0
    unavailable_samples = unavailable_field_samples = simulator_already_finished = 0
    time_missing = []
    first_divergence = None
    for frame in observed['frames']:
        t = frame['t']
        eligible = [slot for slot in range(n) if t <= observed['results'][slot]['finishTimeRaw']]
        observed_pre_finish += len(eligible)
        skipped_after_finish += n-len(eligible)
        if not eligible:
            continue
        actual_frame = frame_map.get(f32bits(t))
        if actual_frame is None:
            unavailable_samples += len(eligible)
            nearest = min((abs(f['t']-t), f['t']) for f in simulated['frames']) if simulated.get('frames') else (None,None)
            time_missing.append({'t': t, 'eligibleRunners': len(eligible), 'nearestSimulatedTime': nearest[1], 'nearestTimeDifference': nearest[0]})
            continue
        if len(actual_frame['horses']) != n:
            raise ValueError('simulated frame roster size differs')
        for slot in eligible:
            row = frame['horses'][slot]
            got = actual_frame['horses'][index_for_slot[slot]]
            compared_samples += 1
            if t > simulated['results'][index_for_slot[slot]]['finishTimeRaw']:
                simulator_already_finished += 1
            expected = {'pos': row['pos'], 'speed': row['speedWire']/100, 'hp': row['hpWire'],
                        'lane': row['laneWire']/10000, 'temptationMode': row['temptationMode'],
                        'blockFrontHorseIndex': row['blockFrontHorseIndex']}
            exact = True
            unavailable = False
            for field in frame_fields:
                loc = {'t': t, 'slot': slot, 'frameOrder': slot+1}
                if field not in got or got[field] is None or expected[field] is None:
                    reason = 'missing simulated field' if field not in got or got[field] is None else 'uninterpreted official field'
                    mark_unavailable(frame_stats[field], loc, reason)
                    unavailable = True
                    exact = False
                    continue
                value = got[field]
                if field == 'pos':
                    value = f32(value)
                elif field in ('speed','hp','lane'):
                    scale = {'speed': 100, 'hp': 1, 'lane': 10000}[field]
                    value = wire_u16(value, scale)/scale
                elif field == 'blockFrontHorseIndex':
                    if value != int(value) or not -1 <= value < n:
                        mark_unavailable(frame_stats[field],loc,'invalid simulated blocker index')
                        unavailable = True
                        exact = False
                        continue
                    value = -1 if value == -1 else slot_map[int(value)]
                eq = measure(frame_stats[field], expected[field], value, loc)
                if not eq:
                    exact = False
                    if first_divergence is None:
                        first_divergence = dict(loc, field=field, expected=expected[field], actual=value)
            unavailable_field_samples += int(unavailable)
            exact_samples += int(exact)
    events = compare_events(observed['events'], simulated, slot_map)
    required_events = ('skillStarts','skillRecordedDurations','skillDetails',
                       'skillVisualRecipients','competitionStarts')
    missing_capabilities = ['events.'+key for key in required_events
                            if events.get(key,{}).get('capability') != 'compared']
    missing_capabilities.extend('frames.'+key for key in frame_fields
                                if frame_stats[key]['unavailable'] > 0)
    all_results = all(m['mismatches'] == 0 for m in results.values())
    all_frames = (unavailable_samples == 0 and unavailable_field_samples == 0
                  and exact_samples == observed_pre_finish
                  and all(m['compared'] == observed_pre_finish for m in frame_stats.values()))
    all_events = all(events.get(key,{}).get('capability') == 'compared'
                     and events[key].get('exact',False) for key in required_events)
    core_ok = (results['finishTimeRaw']['mismatches'] == 0 and results['finishOrder']['mismatches'] == 0
               and all_frames and events.get('skillStarts',{}).get('exact',False))
    return {'status': ('exact' if all_results and all_frames and all_events
                       else 'incomplete_comparison' if missing_capabilities else 'mismatch'),
            'corePass': core_ok, 'allComparedChecksPass': all_results and all_frames and all_events,
            'missingRequiredCapabilities': missing_capabilities,
            'runnerCount': n, 'runnerMapping': [{'inputIndex': i, 'officialSlot': slot, 'frameOrder': slot+1}
                                               for i,slot in slot_map.items()],
            'results': results, 'runnerResults': result_rows,
            'frames': {'observedFrameCount': len(observed['frames']), 'simulatedFrameCount': len(simulated.get('frames',[])),
                       'scope': 'Every available official pre-finish sample; simulated post-finish rows remain counted when official runner is unfinished.',
                       'observedPreFinishRunnerSamples': observed_pre_finish,
                       'comparedRunnerSamples': compared_samples, 'exactRunnerSamples': exact_samples,
                       'unavailableRunnerSamples': unavailable_samples,
                       'unavailableFieldRunnerSamples': unavailable_field_samples,
                       'simulatorAlreadyFinishedSamples': simulator_already_finished,
                       'excludedOfficialPostFinishRunnerSamples': skipped_after_finish,
                       'missingTimestampCount': len(time_missing), 'missingTimestampExamples': time_missing[:20],
                       'firstDivergence': first_divergence, 'fields': frame_stats},
            'events': events,
            'comparisonLimits': ['No hidden/unsampled state comparison.',
                'Displayed finishTime, finishGap and defeatFlags lack a validated equivalent in this engine output and are not compared.',
                'Skill masks describe the first visual ability recipient set, not every gameplay receiver.',
                'Event type 0 and additional skill parameters are retained but not mechanically interpreted.']}
