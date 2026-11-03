"""Package exact application/GlobalSim source and dependency sources beside releases."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import zipfile

from simulator_source import verify_source, source_lock, source_git
from source_dependencies import collect

ROOT = Path(__file__).resolve().parents[1]
STAMPED = {'desktop/build-info.json', 'package.json', 'package-lock.json',
           'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json'}
# generate_icon.py runs with the locked build Pillow version. Its encoded PNG
# and ICO bytes can differ from the checked-in assets; export the built bytes.
GENERATED = {'src-tauri/icons/icon.ico', 'src-tauri/icons/icon.png', 'src-tauri/icons/icon.rgba'}


def git(root, *args, data=None):
    return subprocess.check_output(['git', '-c', 'safe.directory=' + root.as_posix(),
                                   '-C', str(root), *args], input=data, stderr=subprocess.PIPE)


def app_files(root, development=False):
    changed = set(git(root, 'diff', 'HEAD', '--name-only').decode().splitlines())
    untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')
    if not development and (changed - STAMPED - GENERATED or any(untracked)):
        raise ValueError('Release source must be committed; only version stamping and generated icons may change tracked files')
    names = git(root, 'ls-files', '-z').decode().split('\0')
    if development:
        names += untracked
    deleted = set(git(root, 'ls-files', '--deleted', '-z').decode().split('\0')) if development else set()
    return {name: (root / name).read_bytes() for name in sorted(set(names) - deleted) if name}


def bundled_receipts(root, lock, development):
    receipts = []
    manifest = json.loads((root / 'simulation/installed-bundles.json').read_bytes())
    for row in manifest['bundles']:
        if row.get('kind') != 'simulation':
            continue
        artifact = (root / row['artifact']).resolve()
        if not artifact.is_relative_to((root / 'simulation/bundles').resolve()):
            raise ValueError('Simulator artifact is outside its bundle directory')
        receipt = json.loads((artifact.parent / 'build.json').read_bytes())
        digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
        if digest != row['artifact_sha256'] or digest != receipt['artifactSha256']:
            raise ValueError('Bundled simulator does not match exported source')
        # Local QA retains old workers for saved jobs. A development archive
        # exports the current source snapshot, without those historical binaries.
        # Release packaging still requires matching source for every bundled worker.
        if development and receipt['instrumentation']['sourceSha256'] != lock['sourceSha256']:
            continue
        if (receipt.get('sourceBaseCommit') != lock['revision']
                or receipt['instrumentation']['sourceSha256'] != lock['sourceSha256']
                or bool(receipt.get('development')) != development
                or (not development and receipt.get('sourceCommit') != lock['revision'])):
            raise ValueError('Bundled simulator does not match exported source')
        receipts.append(receipt)
    if not receipts:
        raise ValueError('Package the simulator before exporting release source')
    return receipts


def simulator_files(source, revision, development=False):
    """Export a checkout with only the pinned commit/tree, never private history/remotes."""
    result = {}
    with tarfile.open(fileobj=io.BytesIO(source_git(source, 'archive', revision))) as archive:
        for member in archive:
            if member.isfile():
                result[member.name] = archive.extractfile(member).read()
            elif not member.isdir():
                raise ValueError('Unsupported simulator archive member: ' + member.name)
    if development:
        result = {name: raw for name, raw in result.items() if not name.startswith('src/')}
        result.update({p.relative_to(source).as_posix(): p.read_bytes()
                       for p in (source / 'src').rglob('*') if p.is_file()})
        for name in ('instrumentation.json', 'NOTICE'):
            result[name] = (source / name).read_bytes()
    objects = source_git(source, 'rev-list', '--objects', revision + '^{tree}').splitlines()
    ids = b'\n'.join([revision.encode(), *(row.split(b' ', 1)[0] for row in objects)]) + b'\n'
    pack = subprocess.check_output(
        ['git', '-c', 'safe.directory=' + source.as_posix(), '-C', str(source),
         'pack-objects', '--stdout'], input=ids, stderr=subprocess.PIPE)
    with tempfile.TemporaryDirectory(prefix='source-objects-') as folder:
        bare = Path(folder)
        git(bare, 'init', '--bare', '--quiet')
        git(bare, 'index-pack', '--stdin', data=pack)
        for path in (bare / 'objects/pack').iterdir():
            result['.git/objects/pack/' + path.name] = path.read_bytes()
    result['.git/HEAD'] = (revision + '\n').encode()
    result['.git/shallow'] = (revision + '\n').encode()
    result['.git/config'] = b'[core]\nrepositoryformatversion = 0\nbare = false\nautocrlf = false\n'
    # An index matching the base tree is needed for cleanliness/development
    # verification after extraction. Generate it using only the exported objects.
    with tempfile.TemporaryDirectory(prefix='source-index-') as folder:
        checkout = Path(folder)
        for name, raw in result.items():
            if name.startswith('.git/'):
                path = checkout / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
        (checkout / '.git/refs').mkdir()
        git(checkout, 'read-tree', revision)
        result['.git/index'] = (checkout / '.git/index').read_bytes()
    return {'.cache/globalsim-saved/' + name: raw for name, raw in result.items()}


def write_archive(output, files, metadata):
    metadata = dict(metadata, files={name: hashlib.sha256(raw).hexdigest()
                                    for name, raw in sorted(files.items())})
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix('.partial')
    with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            archive.writestr('Umalytics/' + name, raw)
        # Git needs this empty directory for repository discovery.
        archive.writestr('Umalytics/.cache/globalsim-saved/.git/refs/', b'')
        archive.writestr('Umalytics/SOURCE-MANIFEST.json', json.dumps(metadata, indent=2) + '\n')
    with zipfile.ZipFile(temporary) as archive:
        if archive.testzip():
            raise ValueError('Source archive verification failed')
    temporary.replace(output)
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / '.cache/globalsim-saved')
    parser.add_argument('--output', type=Path, default=ROOT / '.cache/dist/Umalytics-source.zip')
    parser.add_argument('--development', action='store_true')
    args = parser.parse_args()
    source = args.source.resolve()
    verified = verify_source(source, development=args.development)
    receipts = bundled_receipts(ROOT, source_lock(), args.development)
    files = app_files(ROOT, args.development)
    for required in ('LICENSE', 'NOTICE', 'docs/licensing.md', 'scripts/rebuild-source.ps1'):
        if required not in files:
            raise ValueError('Required source/legal file is missing: ' + required)
    files.update(simulator_files(source, verified['revision'], args.development))
    print('Collecting exact dependency sources...', flush=True)
    dependencies, inventory = collect(ROOT)
    files.update({name: path.read_bytes() for name, path in dependencies.items()})
    files['dependency-sources/python/requirements.txt'] = ('\n'.join(
        f"{row['name']}=={row['version']}" for row in inventory if row['kind'] == 'python') + '\n').encode()
    metadata = dict(schemaVersion=1, development=args.development,
                    applicationCommit=git(ROOT, 'rev-parse', 'HEAD').decode().strip(),
                    build=json.loads((ROOT / 'desktop/build-info.json').read_bytes()),
                    simulator=source_lock(), simulatorBuilds=receipts, dependencies=inventory)
    if not args.development and metadata['build']['commit'] != metadata['applicationCommit']:
        raise ValueError('Build commit differs from the application source checkout')
    metadata = write_archive(args.output, files, metadata)
    print(f"Packaged {len(metadata['files'])} source files: {args.output}")


if __name__ == '__main__':
    main()
