"""Validate the installed observation schema before exposing modeled decisions."""
import math

SCHEMA = 'umalytics-decisions-v1'
MOTION_COLUMNS = ['tick', 'time', 'horseIndex', 'dt', 'position', 'hp', 'lane', 'targetSpeed',
    'baseTarget', 'sectionModifier', 'paceCoefficient', 'acceleration', 'unclampedSelfSpeed',
    'blockingCap', 'minimumSpeed', 'blockerIndex', 'blockerGap', 'selfSpeed', 'skillAdjustedSpeed',
    'actualSpeed', 'selfClampLoss', 'finalClampLoss', 'phase', 'lastSpurt', 'spurtStart', 'spurtSpeed',
    'spurtResult', 'spurtCalculations', 'rushing', 'downhill', 'paceMode', 'forceIn',
    'forceInCoefficient', 'laneTarget', 'spotStruggle', 'duel', 'conservePower',
    'blockedFrontSeconds', 'blockedSideSeconds', 'blockedAllSeconds', 'nearFrontSeconds', 'nearBehindSeconds', 'overtakeTargetSeconds']


def validate_trace(trace, runners):
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
    def finite(v):
        return type(v) in (float, int) and math.isfinite(v)
    def index(v):
        return finite(v) and v == int(v) and 0 <= v < runners
    previous = 0
    observed = 0
    for event in events:
        if not isinstance(event, dict):
            return 'Invalid decision row.'
        for key in ('sequence', 'lastSequence', 'tick', 'lastTick', 'time', 'lastTime', 'count', 'detail'):
            if not finite(event.get(key)) or event[key] < 0:
                return 'Invalid decision coordinates.'
        if (event['sequence'] <= previous or event['lastSequence'] < event['sequence']
                or event['lastTick'] - event['tick'] + 1 != event['count']
                or event['lastTime'] < event['time'] or event['count'] < 1):
            return 'Invalid decision series.'
        previous = event['sequence']
        observed += event['count']
        if event.get('horseIndex') is not None and not index(event['horseIndex']):
            return 'Invalid decision runner.'
        if not all(isinstance(event.get(k), str) for k in ('kind', 'skillId', 'stage')) or not isinstance(event.get('data'), dict):
            return 'Invalid decision fields.'
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
