"""Validate the installed observation schema before exposing modeled decisions."""
import math
import base64
import binascii
import struct

SCHEMA = 'umalytics-decisions-v1'
COMPACT_SCHEMA = 'umalytics-decisions-v2'
SUPPORTED_SCHEMAS = (SCHEMA, COMPACT_SCHEMA)
CORE_INDICES = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,18,19,20,21,22,32]
STATE_INDICES = [23,28,29,30,31,34,35,40,41]
MOTION_COLUMNS = ['tick', 'time', 'horseIndex', 'dt', 'position', 'hp', 'lane', 'targetSpeed',
    'baseTarget', 'sectionModifier', 'paceCoefficient', 'acceleration', 'unclampedSelfSpeed',
    'blockingCap', 'minimumSpeed', 'blockerIndex', 'blockerGap', 'selfSpeed', 'skillAdjustedSpeed',
    'actualSpeed', 'selfClampLoss', 'finalClampLoss', 'phase', 'lastSpurt', 'spurtStart', 'spurtSpeed',
    'spurtResult', 'spurtCalculations', 'rushing', 'downhill', 'paceMode', 'forceIn',
    'forceInCoefficient', 'laneTarget', 'spotStruggle', 'duel', 'conservePower',
    'blockedFrontSeconds', 'blockedSideSeconds', 'blockedAllSeconds', 'nearFrontSeconds', 'nearBehindSeconds', 'overtakeTargetSeconds']


def expand_trace(trace):
    return _decode_compact(trace)


def _decode_compact(trace, runners=None):
    """Decode the versioned wire shape; existing analysis keeps its exact layout.

    Only unused columns become zero. Near-runner timers are booleans because
    dashboard consumers use their positive/nonpositive state, not their value.
    State transitions must coincide with an actual motion tick; no interpolation.
    """
    if not isinstance(trace, dict) or trace.get('schema') != COMPACT_SCHEMA:
        return trace
    count = trace.get('motionCount')
    if type(count) is not int or not 0 < count <= 100000:
        raise ValueError('Invalid compact motion count.')
    expected = count * len(CORE_INDICES) * 8
    encoded = trace.get('motionData')
    if (trace.get('motionIndices') != CORE_INDICES or trace.get('stateIndices') != STATE_INDICES
            or any(type(i) is not int for i in trace.get('motionIndices', []) + trace.get('stateIndices', []))
            or trace.get('motionEncoding') != 'f64le-base64' or not isinstance(encoded, str)
            or len(encoded) != 4 * ((expected + 2) // 3)):
        raise ValueError('Invalid compact motion encoding.')
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError('Invalid compact motion bytes.') from error
    if len(raw) != expected:
        raise ValueError('Invalid compact motion size.')
    strings, packed, states = (trace.get(k) for k in ('strings', 'events', 'states'))
    if (not isinstance(strings, list) or len(strings) > 100000 or any(not isinstance(s, str) for s in strings)
            or sum(len(s) for s in strings) > 2*1024*1024 or not isinstance(packed, list)
            or len(packed) > 250000 or not isinstance(states, list) or len(states) > 100000):
        raise ValueError('Invalid compact trace tables.')
    events = []
    names = ['sequence','lastSequence','tick','lastTick','time','lastTime','count','horseIndex','stage','skillId','detail','kind','data']
    for row in packed:
        if not isinstance(row, list) or len(row) != 13:
            raise ValueError('Invalid compact event.')
        row = row.copy()
        if any(type(row[i]) is not int or not 0 <= row[i] <= 2**53-1 for i in (0,1,2,3,6,10)):
            raise ValueError('Invalid compact event coordinates.')
        if row[7] is not None and (type(row[7]) is not int or not 0 <= row[7] < 64):
            raise ValueError('Invalid compact event runner.')
        for column in (8,9,11):
            i = row[column]
            if type(i) is not int or not 0 <= i < len(strings):
                raise ValueError('Invalid compact string index.')
            row[column] = strings[i]
        events.append(dict(zip(names, row)))
    histories = {}
    for row in states:
        if (not isinstance(row, list) or len(row) != 12 or any(type(v) not in (int,float) or not math.isfinite(v) for v in row)
                or any(v < 0 or v != int(v) for v in (row[0],row[2])) or row[1] < 0
                or any(v != int(v) for v in row[3:])
                or any(row[i] not in (0,1) for i in (3,5,7,8,9,10,11)) or not 0 <= row[4] <= 4 or not 0 <= row[6] <= 5):
            raise ValueError('Invalid compact state transition.')
        history = histories.setdefault(row[2], [])
        if history and row[0] <= history[-1][0]:
            raise ValueError('Unordered compact state transitions.')
        history.append(row)
    if runners is not None:
        if trace.get('complete') is not True or trace.get('dropped') != 0:
            raise ValueError('Trace is incomplete or exceeded its observation limit.')
        if not events:
            raise ValueError('Trace has no decision or movement observations.')
        error, observed = _validate_events(events, runners)
        if error:
            raise ValueError(error)
    cursors, used, motion = {}, set(), []
    previous_ticks = {}
    for core in struct.iter_unpack('<23d', raw):
        horse, tick, timestamp = core[2], core[0], core[1]
        if runners is None:
            row = [0.] * len(MOTION_COLUMNS)
            for column, value in zip(CORE_INDICES, core):
                row[column] = value
        else:
            if not all(map(math.isfinite, core)):
                raise ValueError('Invalid motion row.')
            if (horse != int(horse) or not 0 <= horse < runners
                    or core[15] != -1 and (core[15] != int(core[15]) or not 0 <= core[15] < runners)):
                raise ValueError('Invalid motion runner or blocker.')
            if tick <= previous_ticks.get(horse, -1) or core[3] <= 0 or core[19] < 0 or core[20] < 0:
                raise ValueError('Invalid motion timing or speed loss.')
            previous_ticks[horse] = tick
        history = histories.get(horse, [])
        index = cursors.get(horse, 0)
        while index < len(history) and history[index][0] <= tick:
            if history[index][0] != tick or history[index][1] != timestamp:
                raise ValueError('State transition lacks its motion tick.')
            index += 1
        if not index:
            raise ValueError('Missing initial compact state.')
        cursors[horse] = index
        used.add(horse)
        if runners is None:
            for column, value in zip(STATE_INDICES, history[index-1][3:]):
                row[column] = value
            motion.append(row)
    if used != histories.keys() or any(cursors[k] != len(v) for k,v in histories.items()):
        raise ValueError('Orphan compact state transition.')
    if runners is not None:
        if len(used) != runners or observed + count != trace.get('observations'):
            raise ValueError('Trace coverage or observation count is incomplete.')
        return None
    return {**trace, 'schema': SCHEMA, 'events': events, 'motion': motion, 'motionColumns': MOTION_COLUMNS}


def _validate_events(events, runners):
    def finite(v):
        return type(v) in (float, int) and math.isfinite(v)
    def index(v):
        return finite(v) and v == int(v) and 0 <= v < runners
    previous = 0
    observed = 0
    for event in events:
        if not isinstance(event, dict):
            return 'Invalid decision row.', 0
        for key in ('sequence', 'lastSequence', 'tick', 'lastTick', 'time', 'lastTime', 'count', 'detail'):
            if not finite(event.get(key)) or event[key] < 0:
                return 'Invalid decision coordinates.', 0
        if (event['sequence'] <= previous or event['lastSequence'] < event['sequence']
                or event['lastTick'] - event['tick'] + 1 != event['count']
                or event['lastTime'] < event['time'] or event['count'] < 1):
            return 'Invalid decision series.', 0
        previous = event['sequence']
        observed += event['count']
        if event.get('horseIndex') is not None and not index(event['horseIndex']):
            return 'Invalid decision runner.', 0
        if not all(isinstance(event.get(k), str) for k in ('kind', 'skillId', 'stage')) or not isinstance(event.get('data'), dict):
            return 'Invalid decision fields.', 0
    return None, observed


def validate_trace(trace, runners):
    try:
        if isinstance(trace, dict) and trace.get('schema') == COMPACT_SCHEMA:
            return _decode_compact(trace, runners)
        trace = expand_trace(trace)
    except (ValueError, TypeError, OverflowError) as error:
        return str(error)
    if not isinstance(trace, dict) or trace.get('schema') != SCHEMA:
        return 'Missing or unsupported trace schema.'
    if trace.get('complete') is not True or trace.get('dropped') != 0:
        return 'Trace is incomplete or exceeded its observation limit.'
    if trace.get('motionColumns') != MOTION_COLUMNS:
        return 'Motion columns differ from the installed schema.'
    events, motion = trace.get('events'), trace.get('motion')
    if not isinstance(events, list) or not isinstance(motion, list) or not events or not motion:
        return 'Trace has no decision or movement observations.'
    if len(events) > 250000 or len(motion) > 100000:
        return 'Trace exceeds its row limit.'
    error, observed = _validate_events(events, runners)
    if error:
        return error
    def index(v):
        return type(v) in (int, float) and math.isfinite(v) and v == int(v) and 0 <= v < runners
    seen = set()
    previous_ticks = {}
    numeric_types = {float, int}
    width = len(MOTION_COLUMNS)
    for row in motion:
        # C-level type/finite scans avoid a Python callback for every numeric cell.
        # Exact types still reject booleans and numeric-looking strings.
        if not isinstance(row, list) or len(row) != width or not set(map(type, row)) <= numeric_types or not all(map(math.isfinite, row)):
            return 'Invalid motion row.'
        tick, _, horse = row[:3]
        if not index(horse) or row[15] != -1 and not index(row[15]):
            return 'Invalid motion runner or blocker.'
        if tick <= previous_ticks.get(horse, -1) or row[3] <= 0 or row[20] < 0 or row[21] < 0:
            return 'Invalid motion timing or speed loss.'
        previous_ticks[horse] = tick
        seen.add(horse)
    if len(seen) != runners or observed + len(motion) != trace.get('observations'):
        return 'Trace coverage or observation count is incomplete.'
    return None
