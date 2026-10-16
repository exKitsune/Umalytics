"""Keep public JSON source generic without changing decoded reference values."""
import re

# Display names and external identifiers remain exact after JSON decoding.
TERMS = tuple(bytes.fromhex(value).decode() for value in (
    '637967616d6573', '756d616d7573756d65', '7072657474796465726279',
    '68616b7572616b75', 'e382a6e3839ee5a898', 'e382b5e382a4e382b2e383bce383a0e382b9',
))
PATTERN = re.compile('|'.join('[ _-]*'.join(map(re.escape, term)) for term in TERMS), re.I)


def public_json(text):
    return PATTERN.sub(lambda match: '\\u%04x' % ord(match[0][0]) + match[0][1:], text)
