"""Bounded service-owned jobs, installed bundles, and fresh authorizations."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
from globalsim_bridge import (RuntimeConfig, SimulatorBinding, InferenceBinding,
    evaluate_for_analysis, revalidate_inference_plan, select_compatibility)
from globalsim_bridge.adapter import _external_context
from globalsim_bridge.versioning import canonical
from race_evidence import map_evidence, capture_hash


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def read_json(path):
    from reference_data import strict_json
    return strict_json(path.read_bytes())


class StaleAnalysis(ValueError):
    pass


class QueueFull(ValueError):
    pass


class SimulationService:
    def __init__(self, service, root):
        self.service, self.root = service, Path(root)
        self.lock = threading.RLock()
        self.jobs = {}
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='race-analysis')
        self.closed = False

    def config(self):
        registry = read_json(self.root / 'simulation/engine-registry.json')
        manifest_path = self.root / 'simulation/installed-bundles.json'
        manifest = read_json(manifest_path) if manifest_path.exists() else {'schemaVersion': 1, 'bundles': []}
        if manifest.get('schemaVersion') != 1 or not isinstance(manifest.get('bundles'), list):
            raise ValueError('Invalid installed bundle manifest.')
        if registry.get('allowUnknownVersionSimulation') is True:
            candidates = [row for row in manifest['bundles'] if row.get('kind') == 'simulation'
                          and row.get('profile') == 'v74' and row.get('decisionTraceSchema') == 'umalytics-decisions-v1']
            # The last packaged trace-capable build is the preferred trial. This
            # is app-owned configuration; browser/capture inputs cannot select it.
            registry = {**registry, 'unknownVersionSimulators': [{
                'engineId': row['engine_id'], 'version': row['version'], 'profile': row['profile'],
                'identity': {'artifactSha256': row['artifact_sha256'], 'dataSha256': row['data_sha256']},
                'region': 'global', 'modes': ['practice', 'team-trials', 'champions-meeting'],
                'reference': 'User-authorized unknown-version trial; replay agreement required; no date coverage claimed.'
            } for row in candidates[-1:]]}
        if registry.get('allowReplayInference') is True:
            candidates = [row for row in manifest['bundles'] if row.get('kind') == 'inference']
            if candidates:
                row = candidates[-1]
                registry = {**registry, 'replayInference': {'engineId': row['engine_id'], 'version': row['version'], 'profile': row['profile'],
                    'identity': {'artifactSha256': row['artifact_sha256'], 'dataSha256': row['data_sha256']}}}
        return registry, manifest

    def path(self, relative):
        if not isinstance(relative, str):
            raise ValueError('Invalid bundle path.')
        path = (self.root / relative).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise ValueError('Bundle path leaves installed resources.')
        return path

    def bindings(self, manifest, namespace):
        simulators, inferences = {}, {}
        for row in manifest['bundles']:
            kwargs = {key: row[key] for key in ('engine_id', 'version', 'profile', 'artifact_sha256', 'data_sha256')}
            if row['kind'] == 'simulation':
                if row['profile'] != 'v74':
                    continue  # This adapter implements exactly the audited profile.
                binding = SimulatorBinding(**kwargs, config=RuntimeConfig(
                    engine_path=self.path(row['artifact']), umalytics_root=self.path(row['appRoot']),
                    globalsim_root=self.path(row['resourceRoot']),
                    expected_engine_sha256=row['artifact_sha256'],
                    decision_trace_schema=row.get('decisionTraceSchema'),
                    cache_auth_key=self.cache_auth_key(),
                    cache_root=self.service.data_dir / 'cache/globalsim' / namespace,
                    work_root=self.service.data_dir / 'cache/simulation-work'))
                simulators[binding.engine_id] = binding
            elif row['kind'] == 'inference':
                binding = InferenceBinding(**kwargs)
                inferences[binding.engine_id] = binding
        return simulators, inferences

    def cache_auth_key(self):
        """Persist across restarts, outside the disposable/browser-writable cache."""
        path = self.service.data_dir / 'simulation-cache.key'
        try:
            with self.lock:
                path.parent.mkdir(parents=True, exist_ok=True)
                try:
                    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
                        stream.write(secrets.token_bytes(32))
                        stream.flush()
                        os.fsync(stream.fileno())
                except FileExistsError:
                    pass
                with path.open('rb') as stream:
                    key = stream.read(33)
            return key if len(key) == 32 else None
        except OSError:
            return None  # Analysis still works when persistent caching is unavailable.

    def selected(self, race_id, expected=None):
        if not isinstance(race_id, str) or not re.fullmatch(r'[A-Za-z0-9_.~-]{1,240}', race_id) or '..' in race_id:
            raise ValueError('Invalid stored race ID.')
        rows = self.service.races(1, race_id)
        if len(rows) != 1:
            raise StaleAnalysis('Stored race no longer exists.')
        row = rows[0]
        if expected is not None and row['sha256'] != expected:
            raise StaleAnalysis('Selected race changed. Reopen it from the library.')
        capture = row['data']
        # Service.races already selected ~index. Never apply that index again.
        if isinstance(capture, list) and len(capture) == 1:
            capture = capture[0]
        if not isinstance(capture, dict):
            raise ValueError('Select a single stored race entry.')
        return capture, row['sha256']

    def snapshot(self, race_id, expected, context):
        capture, entry_hash = self.selected(race_id, expected)
        registry, manifest = self.config()
        sidecar_path = self.service.data_dir / 'analysis-evidence' / (capture_hash(capture) + '.json')
        sidecar = read_json(sidecar_path) if sidecar_path.is_file() else None
        evidence, notes = map_evidence(capture, registry, sidecar)
        selection = select_compatibility(capture_hash(capture), evidence, registry)
        identity = digest({'selection': selection, 'context': context, 'manifest': manifest,
                           'sidecar': sidecar, 'mapper': 1})
        return dict(capture=capture, entry_hash=entry_hash, registry=registry, manifest=manifest,
                    evidence=evidence, notes=notes, identity=identity, context=context)

    def status(self):
        try:
            registry, manifest = self.config()
            return {'schemaVersion': 1, 'registryId': registry.get('registryId'),
                    'configurationSha256': digest([registry, manifest]),
                    'eras': registry.get('eras', []), 'engines': registry.get('engines', []),
                    'installed': [{k: row[k] for k in ('engine_id', 'kind', 'version', 'profile', 'artifact_sha256', 'data_sha256')}
                                  for row in manifest['bundles']]}
        except (OSError, ValueError, TypeError, KeyError):
            return {'schemaVersion': 1, 'available': False, 'reason': 'Engine configuration is unavailable.'}

    def submit(self, race_id, body):
        if set(body) - {'expectedEntrySha256', 'context'} or not re.fullmatch(r'[a-f0-9]{64}', str(body.get('expectedEntrySha256', ''))):
            raise ValueError('Only expectedEntrySha256 and independently sourced context are accepted.')
        context = _external_context(body.get('context')) or None
        snap = self.snapshot(race_id, body['expectedEntrySha256'], context)
        with self.lock:
            if self.closed:
                raise QueueFull('Analysis service is shutting down.')
            for job in self.jobs.values():
                if job['raceId'] == race_id and job['identity'] == snap['identity'] and job['phase'] in ('queued', 'running'):
                    return self.project(job)
            if sum(j['phase'] in ('queued', 'running') for j in self.jobs.values()) >= 2:
                raise QueueFull('Analysis is busy. Recorded replay remains available; retry shortly.')
            for ident in list(self.jobs):
                if len(self.jobs) < 8:
                    break
                if self.jobs[ident]['phase'] == 'complete':
                    del self.jobs[ident]
            job = dict(schemaVersion=1, jobId=secrets.token_hex(16), raceId=race_id,
                       entrySha256=snap['entry_hash'], phase='queued', report=None,
                       identity=snap['identity'], snapshot=snap)
            self.jobs[job['jobId']] = job
            self.executor.submit(self.run, job)
            return self.project(job)

    def run(self, job):
        with self.lock:
            job['phase'] = 'running'
        snap = job['snapshot']
        try:
            # A queued job may have waited while the capture or policy changed.
            # Recheck before binding resources, opening caches or launching a worker.
            current = self.snapshot(job['raceId'], job['entrySha256'], snap['context'])
            if current['identity'] != job['identity']:
                raise StaleAnalysis('Queued selection changed before execution.')
            decision = select_compatibility(capture_hash(snap['capture']), snap['evidence'], snap['registry'])
            sims, infers = self.bindings(snap['manifest'], snap['identity']) if decision['mode'] != 'recorded_only' else ({}, {})
            report = evaluate_for_analysis(snap['capture'], snap['registry'], sims,
                evidence=snap['evidence'], context=snap['context'], inference_bindings=infers)
            report['applicationEvidenceNotes'] = snap['notes']
            if (report.get('simulation') or {}).get('cacheKey'):
                try:
                    self.trim_simulation_cache()
                except (OSError, sqlite3.Error):
                    pass
            # Recompute before publishing. Artifact files are measured separately
            # on inference authorization; simulator runtime measures its binary.
            current = self.snapshot(job['raceId'], job['entrySha256'], snap['context'])
            if current['identity'] != job['identity']:
                raise StaleAnalysis('Evidence or support configuration changed during evaluation.')
        except Exception as error:
            report = evaluate_for_analysis(snap['capture'], {}, {}, evidence=None)
            report['applicationEvidenceNotes'] = [str(error)]
        with self.lock:
            job.update(phase='complete', report=report)

    def trim_simulation_cache(self):
        from analysis_cache import AnalysisCache
        with self.service.lock:
            AnalysisCache(self.service.data_dir).update({'action': 'prune'})

    def project(self, job, payloads=False):
        out = {key: job[key] for key in ('schemaVersion', 'jobId', 'raceId', 'entrySha256', 'phase')}
        report = job['report']
        if report and not payloads:
            report = {key: value for key, value in report.items() if key != 'observed'}
            if report.get('simulation'):
                report['simulation'] = {key: value for key, value in report['simulation'].items() if key not in ('observed', 'modeled')}
        return dict(out, report=report)

    def get_job(self, race_id, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None or job['raceId'] != race_id:
                raise StaleAnalysis('Analysis job does not belong to this race.')
        current = self.snapshot(race_id, job['entrySha256'], job['snapshot']['context'])
        if current['identity'] != job['identity']:
            raise StaleAnalysis('Race evidence or engine configuration changed; reopen the race.')
        if job['report'] and job['report']['mode'] == 'verified_simulation':
            from globalsim_bridge.adapter import ReferenceData
            sims, _ = self.bindings(current['manifest'], current['identity'])
            binding = sims[job['report']['binding']['simulation']['engineId']]
            if (hashlib.sha256(binding.config.engine_path.read_bytes()).hexdigest() != binding.artifact_sha256
                or ReferenceData.load(binding.config.umalytics_root, binding.config.globalsim_root).fingerprint != binding.data_sha256):
                raise StaleAnalysis('Simulator artifacts changed; previous comparison is no longer authorized.')
        return job, current

    def get(self, race_id, job_id, payloads=False):
        job, _ = self.get_job(race_id, job_id)
        # Previously verified output is never reused as fresh authorization. A
        # polling result is the current job only; each open submits a new gate.
        return self.project(job, payloads)

    def authorize(self, race_id, body):
        if set(body) != {'jobId'}:
            raise ValueError('Only a service-owned jobId is accepted.')
        job, snap = self.get_job(race_id, body['jobId'])
        report = job['report']
        if not report or report['mode'] != 'inference_plan':
            raise ValueError('No eligible inference plan.')
        _, bindings = self.bindings(snap['manifest'], snap['identity'])
        plan = report['inferencePlan']
        row = next(row for row in snap['manifest']['bundles'] if row['engine_id'] == plan['engine']['engineId'] and row['kind'] == 'inference')
        artifact = self.path(row['artifact']).read_bytes()
        data = self.path(row['data']).read_bytes()
        auth = revalidate_inference_plan(plan, snap['capture'], snap['registry'], bindings,
            evidence=snap['evidence'], context=snap['context'],
            measured_artifact_sha256=hashlib.sha256(artifact).hexdigest(),
            measured_data_sha256=hashlib.sha256(data).hexdigest())
        if not auth['authorized']:
            raise StaleAnalysis('Installed inference artifacts or authorization changed.')
        # All URLs are derived from manifest entries, never request paths.
        auth.update(artifactUrl='/api/simulation/artifacts/' + plan['engine']['identity']['artifactSha256'],
                    dataUrl='/api/simulation/artifacts/' + plan['engine']['identity']['dataSha256'],
                    uiRevision=row.get('uiRevision'), cacheKey=digest([snap['identity'], plan]))
        return auth

    def artifact(self, sha):
        if not re.fullmatch(r'[a-f0-9]{64}', sha):
            raise ValueError('Invalid artifact identity.')
        _, manifest = self.config()
        for row in manifest['bundles']:
            if row['kind'] != 'inference':
                continue
            for field, pin, kind in [('artifact', 'artifact_sha256', 'text/javascript'), ('data', 'data_sha256', 'application/json')]:
                if row[pin] == sha:
                    raw = self.path(row[field]).read_bytes()
                    if hashlib.sha256(raw).hexdigest() != sha:
                        raise StaleAnalysis('Installed artifact identity mismatch.')
                    return raw, kind
        raise ValueError('Artifact is not installed.')

    def close(self):
        with self.lock:
            self.closed = True
        self.executor.shutdown(wait=False, cancel_futures=True)
