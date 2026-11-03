"""Validate the saved simulator checkout without fetching or changing its files."""
import argparse
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def source_lock():
    lock = json.loads((ROOT / 'simulation/source-lock.json').read_text(encoding='utf-8'))
    if (lock.get('schemaVersion') != 1
            or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', lock.get('repository', ''))
            or not re.fullmatch(r'[0-9a-f]{40}', lock.get('revision', ''))
            or not re.fullmatch(r'[0-9a-f]{40}', lock.get('upstreamRevision', ''))
            or not re.fullmatch(r'[0-9a-f]{64}', lock.get('sourceSha256', ''))
            or 'preparedSourceSha256' in lock and not re.fullmatch(r'[0-9a-f]{64}', lock['preparedSourceSha256'])):
        raise ValueError('Invalid saved simulator source lock.')
    return lock


def source_git(source, *args):
    source = Path(source).resolve()
    return subprocess.check_output(['git', '-c', 'safe.directory=' + source.as_posix(),
                                    '-C', str(source), *args], stderr=subprocess.PIPE)


def source_digest(source):
    import hashlib
    source = Path(source)
    return hashlib.sha256(b''.join(
        p.relative_to(source).as_posix().encode() + b'\0' + p.read_bytes()
        for p in sorted((source / 'src').rglob('*')) if p.is_file())).hexdigest()


def verify_source(source, revision=None, *, development=False):
    source = Path(source).resolve()
    lock = source_lock()
    expected = revision or lock['revision']
    missing = (f'Saved simulator checkout required at {source}. Restore the local backup '
               f'or check out {lock["repository"]} at {expected}; no upstream fetch is attempted.')
    if not source.is_dir():
        raise ValueError(missing)
    if revision is None and lock.get('pendingReview') and not development:
        raise ValueError('Simulator changes await user review. Use --development for local review builds; releases require an approved committed pin.')
    try:
        top = Path(source_git(source, 'rev-parse', '--show-toplevel').decode().strip()).resolve()
        if top != source:
            raise ValueError(missing)
        actual = source_git(source, 'rev-parse', 'HEAD').decode().strip()
        if actual != expected:
            raise ValueError(f'Saved simulator revision mismatch: expected {expected}, got {actual}.')
        if development:
            # Only the exact pending source snapshot may bypass cleanliness.
            # Cargo inputs, assets and all other tracked files still match HEAD.
            if not lock.get('pendingReview') or revision is not None:
                raise ValueError('Development staging requires a pending-review source lock.')
            changed = source_git(source, 'diff', 'HEAD', '--name-only').decode().splitlines()
            untracked = source_git(source, 'ls-files', '--others', '--exclude-standard').decode().splitlines()
            if any(not (p.startswith('src/') or p in ('instrumentation.json', '.gitattributes', 'NOTICE')) for p in changed + untracked):
                raise ValueError('Development source contains changes outside the pinned instrumentation files.')
            if source_digest(source) != lock['sourceSha256']:
                raise ValueError('Development source differs from the pending-review source hash.')
        elif source_git(source, 'status', '--porcelain', '--untracked-files=all').strip():
            raise ValueError('Saved simulator checkout contains local changes; originals were left untouched.')
        tree = source_git(source, 'rev-parse', 'HEAD^{tree}').decode().strip()
    except subprocess.CalledProcessError as error:
        raise ValueError(missing) from error
    return {'repository': lock['repository'], 'revision': actual, 'tree': tree,
            **({'development': True, 'sourceSha256': lock['sourceSha256']} if development else {})}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / '.cache/globalsim-saved')
    parser.add_argument('--development', action='store_true')
    parser.add_argument('--github-output', type=Path,
                        help='Emit locked repository/ref for the private checkout step; no source required.')
    args = parser.parse_args()
    if args.github_output:
        lock = source_lock()
        with args.github_output.open('a', encoding='utf-8') as output:
            output.write(f'repository={lock["repository"]}\nrevision={lock["revision"]}\n')
    else:
        print(json.dumps(verify_source(args.source, development=args.development), indent=2))
