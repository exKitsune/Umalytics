"""Component identity inside the signed executable (legacy manifest stays valid)."""
import json
import re
from pathlib import Path

MAGIC = b'UMALYTICS-PART1!'


def read_components(path):
    try:
        with Path(path).open('rb') as stream:
            stream.seek(-20, 2)
            tail = stream.read(20)
            if tail[4:] != MAGIC:
                return None
            size = int.from_bytes(tail[:4], 'little')
            if not 0 < size <= 4096:
                return None
            stream.seek(-20 - size, 2)
            value = json.loads(stream.read(size))
        if (set(value) != {'schemaVersion', 'collectorSha256', 'appVersion', 'buildNumber'}
                or value['schemaVersion'] != 1 or type(value['buildNumber']) is not int
                or value['appVersion'] != f"0.2.{value['buildNumber']}"
                or not re.fullmatch('[0-9a-f]{64}', value['collectorSha256'])):
            return None
        return value
    except (OSError, ValueError, TypeError):
        return None


def append_components(path, collector, info):
    value = {'schemaVersion': 1, 'collectorSha256': collector,
             'appVersion': info['version'], 'buildNumber': info['buildNumber']}
    raw = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    if not re.fullmatch('[0-9a-f]{64}', collector) or read_components(path):
        raise ValueError('Invalid or duplicate component identity.')
    with Path(path).open('ab') as stream:
        stream.write(raw + len(raw).to_bytes(4, 'little') + MAGIC)
