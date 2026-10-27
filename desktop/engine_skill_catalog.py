"""Immutable service-owned catalog snapshots for new simulations and captures."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re

from globalsim_bridge.adapter import ReferenceData, canonical
from globalsim_bridge.bundled_skills import ROWS, SOURCE
from globalsim_bridge.skill_catalog import Compiler, CONTRACT, SOURCE_COMMIT
from storage import atomic_json, linked


def sha(value):
    return hashlib.sha256(canonical(value)).hexdigest()


class EngineSkillCatalog:
    def __init__(self, simulation):
        self.simulation = simulation
        self.directory = simulation.service.data_dir / 'engine-skill-catalogs'
        self.memo = None
        self.rejected = {}
        self.display_cache = {}

    def path(self, key, display=False):
        if not re.fullmatch(r'[a-f0-9]{64}', str(key)):
            raise ValueError('Invalid skill catalog identity')
        folder = self.directory / 'display' if display else self.directory
        path = folder / (key + '.json')
        if linked(self.directory) or linked(folder) or linked(path):
            raise ValueError('Linked skill catalog refused')
        return path

    def read(self, key):
        path = self.path(key)
        if path.stat().st_size > 16*1024*1024:
            raise ValueError('Skill catalog too large')
        value = json.loads(path.read_bytes())
        if sha(value) != key:
            raise ValueError('Skill catalog identity changed')
        return value

    def extend(self, manifest):
        candidates = [b for b in manifest['bundles'] if b.get('kind') == 'simulation' and b.get('profile') == 'v74'
                      and b.get('decisionTraceSchema') == 'umalytics-decisions-v1']
        if not candidates: return manifest
        base = candidates[-1]
        build_path = self.simulation.path(base['artifact']).parent / 'build.json'
        if not build_path.is_file(): return manifest
        build = json.loads(build_path.read_bytes())
        if build.get('sourceCommit') != SOURCE_COMMIT or build.get('artifactSha256') != base['artifact_sha256']:
            return manifest  # A new engine revision needs its own reviewed contract.
        catalog = getattr(self.simulation.service, 'catalog', None)
        revision, rows, source = catalog.engine_snapshot() if catalog else (None, None, None)
        stamp = (sha(manifest), revision)
        if self.memo and self.memo[0] == stamp:
            return deepcopy(self.memo[1])
        refs = ReferenceData.load(self.simulation.path(base['appRoot']), self.simulation.path(base['resourceRoot']))
        if refs.fingerprint != base['data_sha256']:
            raise ValueError('Base simulator data changed')
        rows = {**ROWS, **(rows or {})}
        additions, presentation, self.rejected = Compiler(refs.skill_data).additions(rows, refs.skill_data)
        snapshot = dict(contract=CONTRACT, artifact=base['artifact_sha256'], baseData=refs.fingerprint,
            source=source or SOURCE, rows={sid:rows[sid] for sid in additions}, definitions=additions, presentation=presentation)
        key = sha(snapshot)
        path = self.path(key)
        self.directory.mkdir(parents=True, exist_ok=True)
        if not path.exists(): atomic_json(path, snapshot)
        extended = deepcopy(manifest)
        # Retain previous data identities so saved jobs and additional impact
        # samples keep precisely the definitions with which they were started.
        saved = sorted(self.directory.glob('*.json'), key=lambda p: (p.stem == key, p.name))
        by_base = {(b['artifact_sha256'], b['data_sha256']):b for b in candidates}
        for file in saved:
            try:
                value = self.read(file.stem)
                original = by_base.get((value['artifact'], value['baseData']))
                if not original: continue
                original_refs = refs if original == base else ReferenceData.load(self.simulation.path(original['appRoot']), self.simulation.path(original['resourceRoot']))
                updated = original_refs.with_skill_catalog(value)
                extended['bundles'].append({**original, 'engine_id': original['engine_id'] + '-skills-' + file.stem[:16],
                    'data_sha256': updated.fingerprint, 'skillCatalog': file.stem})
            except (ValueError, OSError, KeyError, TypeError):
                if file.stem == key: raise
                continue
        self.memo = (stamp, extended)
        return deepcopy(extended)

    def display_reference(self, base_path, catalog):
        """Persist matching mechanics for dashboard calculations, too."""
        if not catalog: return base_path, hashlib.sha256(base_path.read_bytes()).hexdigest()
        stamp = base_path.stat()
        cache_key = (str(base_path), stamp.st_mtime_ns, stamp.st_size, sha(catalog))
        if cache_key in self.display_cache:
            return self.display_cache[cache_key]
        data = json.loads(base_path.read_bytes())
        for sid, row in catalog['presentation'].items():
            data['metadata']['skills'][sid] = row
            data['metadata']['skillNames'][sid] = row['name']
        data['skillIds'] = sorted(set(data['skillIds']) | catalog['definitions'].keys(), key=int)
        data['engineSkillCatalog'] = sha(catalog)
        raw = canonical(data)
        key = hashlib.sha256(raw).hexdigest()
        path = self.path(key, True)
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            # atomic_json uses its own whitespace; this identity binds bytes.
            from storage import atomic_bytes
            atomic_bytes(path, raw)
        self.display_cache[cache_key] = (path, key)
        while len(self.display_cache) > 8:
            self.display_cache.pop(next(iter(self.display_cache)))
        return path, key


def references(config):
    refs = ReferenceData.load(config.umalytics_root, config.globalsim_root)
    return refs.with_skill_catalog(config.skill_catalog) if getattr(config, "skill_catalog", None) else refs
