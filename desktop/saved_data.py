"""Delete user storage only, preserving installed executable/browser runtime."""
from pathlib import Path
import shutil
from storage import linked

PRESERVED = {'runtime', 'webview'}

def saved_paths(root):
    root = Path(root).absolute()
    if linked(root) or any(linked(p) for p in root.parents):
        raise ValueError('Linked saved-data directory refused.')
    if root == root.parent:
        raise ValueError('Invalid saved-data directory.')
    paths = []
    for path in root.iterdir():
        if path.name.lower() in PRESERVED:
            continue
        if path.name.lower() == 'cache' and (path / 'webview').exists():
            if linked(path):
                raise ValueError('Linked saved-data cache refused.')
            paths.extend(p for p in path.iterdir() if p.name.lower() != 'webview')
        else:
            paths.append(path)
    for path in paths:
        for item in [path, *path.rglob('*')] if path.is_dir() else [path]:
            if linked(item) or not item.resolve().is_relative_to(root.resolve()):
                raise ValueError('Linked saved data refused. Remove the link before deleting data.')
    return paths

def delete_paths(root, paths):
    root = Path(root).resolve()
    for path in paths:
        if (not path.resolve().is_relative_to(root) or path == root or
                path.relative_to(root).parts[0].lower() in PRESERVED or
                tuple(p.lower() for p in path.relative_to(root).parts[:2]) == ('cache', 'webview') or linked(path)):
            raise ValueError('Invalid saved-data target.')
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink(missing_ok=True)
