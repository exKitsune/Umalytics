"""Check the intended Git source inventory without printing possible secrets."""
from pathlib import Path
import argparse
import re
import subprocess
import sys
from public_json import PATTERN as PUBLIC_NAME_PATTERN

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_PREFIXES = ('backups/', 'captures/', 'research/', '.cache/', 'artifacts/', 'test-output/',
    'node_modules/', 'dist/', 'Umalytics-data/', 'UmaTrace-data/', '.aws/', '.ssh/', '.codex/')
PRIVATE_EXTENSIONS = {'.pem', '.key', '.pfx', '.p12', '.cer', '.crt', '.pcap', '.pcapng',
    '.har', '.etl', '.exe', '.dll', '.pdb', '.sqlite', '.sqlite3', '.db', '.mdb', '.dmp',
    '.msi', '.msix', '.zip', '.7z', '.log'}
PATTERNS = {
    'private-key material': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'GitHub access token': re.compile(rb'(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})'),
    'AWS access key': re.compile(rb'AKIA[0-9A-Z]{16}'),
    'personal Windows path': re.compile(rb'(?i)[A-Z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)[^\\/\s"<>]+'),
    'Windows machine SID': re.compile(rb'S-1-5-21-\d{4,}-\d{4,}-\d{4,}'),
}


def git(*args):
    return subprocess.run(['git', '-c', f'safe.directory={ROOT.as_posix()}', *args],
        cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    inventory = parser.add_mutually_exclusive_group()
    inventory.add_argument('--staged', action='store_true', help='Audit the actual index bytes only.')
    inventory.add_argument('--dist', action='store_true', help='Audit the built public viewer.')
    args = parser.parse_args()
    source = ROOT / 'dist' if args.dist else ROOT
    if args.dist:
        if not (source / 'index.html').is_file():
            raise SystemExit('Build the viewer before auditing its output.')
        files = sorted(path.relative_to(source).as_posix() for path in source.rglob('*') if path.is_file())
    else:
        names = git('ls-files', '--cached', '-z') if args.staged else git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
        files = sorted(set(item.decode('utf-8') for item in names.split(b'\0') if item))
        if not args.staged:
            files = [name for name in files if (source / name).is_file()]
    issues = []
    size = 0
    for name in files:
        path = Path(name)
        if PUBLIC_NAME_PATTERN.search(name):
            issues.append((name, 'public naming in file path'))
        if name.startswith(PRIVATE_PREFIXES) or path.suffix.lower() in PRIVATE_EXTENSIONS or 'target' in path.parts:
            issues.append((name, 'private/generated file path'))
        if name.startswith('docs/') and name.endswith('-investigation.md'):
            issues.append((name, 'machine-specific investigation note'))
        if path.name in ('credentials.json', 'settings.local.json', '.env') or path.name.startswith('.env.') and path.name != '.env.example':
            issues.append((name, 'local credentials/configuration file'))
        raw = git('show', ':' + name) if args.staged else (source / name).read_bytes()
        size += len(raw)
        if any(PUBLIC_NAME_PATTERN.search(raw.decode(encoding, errors='ignore'))
               for encoding in ('utf-8', 'utf-16-le', 'utf-16-be')):
            issues.append((name, 'public naming in file content'))
        for label, pattern in PATTERNS.items():
            if pattern.search(raw):
                issues.append((name, label))
    print(f'Audited {len(files)} files ({size / 1024 / 1024:.2f} MiB).')
    for name, issue in issues:
        print(f'{name}: {issue}')
    if issues:
        print('Possible private material must be reviewed before publication; matched values were not printed.')
    return 1 if issues else 0


if __name__ == '__main__':
    sys.exit(main())
