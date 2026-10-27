"""Durable custom simulations, isolated from capture verification and its queue."""
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import struct
import tempfile
import threading
import time
import uuid

import sandbox_inputs as inputs
import sandbox_library
from engine_skill_catalog import references
from globalsim_bridge.decision_trace import validate_trace
from globalsim_bridge.runtime import RuntimeConfig, _canonical, _run_worker
from globalsim_bridge.worker_pool import WorkerPool
from globalsim_bridge.cache_storage import summary_bytes, summary_value
from simulation_service import read_json
from skill_automation import SkillAutomation, BackgroundBusy
from storage_gate import database_gate
import run_cursors

def outcome_summary(setup, run, modeled):
    """Compact samples deliberately leave uncomputed analysis fields unknown."""
    results = modeled.get('results')
    roster = setup['participants']
    if not isinstance(results, list) or len(results) != len(roster):
        raise ValueError('Simulator runner results are incomplete.')
    places = []
    runners = []
    for i, (participant, row) in enumerate(zip(roster, results)):
        place, finish = row.get('finishOrder'), row.get('finishTimeRaw')
        if type(place) is not int or not 0 <= place < len(roster) or type(finish) not in (float, int) or not math.isfinite(finish) or finish <= 0:
            raise ValueError('Simulator finish result is invalid.')
        places.append(place)
        runners.append({'id':participant['id'], 'name':participant['uma']['name'], 'slot':i+1,
            'place':place+1, 'time':finish, 'hp':None, 'traffic':None, 'exhausted':None, 'fullSpurt':None,
            'gain':None, 'gainTime':None, 'carryover':None, 'power':None, 'powerTime':None,
            'effectiveness':None, 'metrics':{}, 'skills':[]})
    if len(set(places)) != len(roster):
        raise ValueError('Simulator finish order is invalid.')
    return {**run, 'outcomeOnly':True, 'runners':runners}

class SandboxService:
    def __init__(self, service):
        self.service = service
        self.path = service.data_dir / 'simulator.sqlite'
        self.lock = threading.RLock()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='custom-simulator')
        self.render_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='simulator-dashboard')
        self.impact_concurrency = min(8, max(1, (os.cpu_count() or 2)//2))
        self.impact_executor = ThreadPoolExecutor(max_workers=self.impact_concurrency, thread_name_prefix='win-impact')
        self.impact_local, self.impact_workers = threading.local(), []
        self.batch_concurrency = min(4, self.impact_concurrency)
        self.batch_executor = ThreadPoolExecutor(max_workers=self.batch_concurrency, thread_name_prefix='batch-analysis')
        self.batch_local, self.batch_workers = threading.local(), []
        self.engine_pool, self.node_pool = WorkerPool(), WorkerPool()
        self.cancelled, self.opening, self.errors = set(), set(), {}
        self.closed = False
        self.foreground_idle = threading.Event()
        self.foreground_idle.set()
        with self.connect() as db:
            db.executescript('CREATE TABLE IF NOT EXISTS documents (kind TEXT, id TEXT, value TEXT, PRIMARY KEY(kind,id));'
                'CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, value TEXT);'
                'CREATE TABLE IF NOT EXISTS runs (job TEXT, n INTEGER, summary TEXT, dashboard BLOB, PRIMARY KEY(job,n));')
            run_cursors.initialize(db)
            for job_id, raw in db.execute('SELECT id,value FROM jobs'):
                value = json.loads(raw)
                if value['phase'] in ('queued', 'running'):
                    value['phase'] = 'interrupted'
                    value['error'] = 'The service stopped. Completed races were retained.'
                    db.execute('UPDATE jobs SET value=? WHERE id=?', (json.dumps(value), job_id))
        self.auto_skills = SkillAutomation(self)

    @contextmanager
    def connect(self):
        with database_gate(self.path).use(), self._connect() as db:
            yield db

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.path, timeout=20)
        try:
            if db.execute('PRAGMA page_count').fetchone()[0] == 0:
                db.execute('PRAGMA auto_vacuum=INCREMENTAL')
            db.execute('PRAGMA journal_mode=WAL')
            with db:
                yield db
        finally:
            db.close()

    def library(self):
        result = {key: [] for key in sandbox_library.KINDS}
        with self.connect() as db:
            for kind, raw in db.execute('SELECT kind,value FROM documents ORDER BY rowid DESC'):
                result[kind].append(json.loads(raw))
        return result

    def save(self, body):
        sandbox_library.save(self.connect, body)
        return self.library()

    def installed(self, expected=None):
        simulation = self.service.simulation
        _, manifest = simulation.config()
        bundles = [b for b in manifest['bundles'] if b['kind']=='simulation' and b.get('profile')=='v74' and b.get('decisionTraceSchema')=='umalytics-decisions-v1']
        if expected:
            bundles = [b for b in bundles if b['artifact_sha256']==expected['artifact_sha256'] and b['data_sha256']==expected['data_sha256']]
        if not bundles:
            raise ValueError('The required simulator is not installed.')
        bundle = bundles[-1]
        binding = simulation.bindings({'bundles':[bundle]}, 'sandbox')[0][bundle['engine_id']]
        config = replace(binding.config, worker_pool=self.engine_pool, cache_root=None, low_priority=True)
        if hashlib.sha256(config.engine_path.read_bytes()).hexdigest() != bundle['artifact_sha256']:
            raise ValueError('Installed simulator failed its integrity check.')
        return bundle, config

    def capabilities(self):
        """Report the definitions pinned to the actual selected simulator bundle."""
        try:
            bundle, config = self.installed()
            refs = references(config)
            unavailable = {sid:issue for sid in refs.skill_data if (issue:=inputs.skill_issue(refs.skill_data,sid))}
            return {'available': True, 'engine': {k:bundle[k] for k in
                    ('engine_id', 'version', 'profile', 'artifact_sha256', 'data_sha256')},
                    'skillIds': sorted(set(refs.skill_data)-unavailable.keys(), key=int),
                    'unavailableSkills': {**getattr(getattr(getattr(getattr(self, 'service', None), 'simulation', None), 'skill_catalog', None), 'rejected', {}), **unavailable}}
        except (ValueError, OSError) as error:
            return {'available': False, 'skillIds': [], 'error': str(error)}

    def job(self, job_id, after=None, include_runs=True):
        if after is not None: inputs.integer(after, 'Run cursor', 0, 2**53-1)
        with self.connect() as db:
            db.execute('BEGIN') # Metadata and run delta share one read snapshot.
            row = db.execute('SELECT value FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not row: raise ValueError('Simulation not found.')
            value = json.loads(row[0])
            completed, cursor = db.execute('SELECT count(*),coalesce(max(coalesce(c.cursor,r.rowid)),0) FROM runs r LEFT JOIN run_cursors c ON c.job=r.job AND c.n=r.n WHERE r.job=?', (job_id,)).fetchone()
            partial = after is not None and after <= cursor
            value['runs'] = [summary_value(r[0]) for r in db.execute('SELECT r.summary FROM runs r LEFT JOIN run_cursors c ON c.job=r.job AND c.n=r.n WHERE r.job=? AND coalesce(c.cursor,r.rowid)>? ORDER BY r.n',
                (job_id, after if partial else 0))] if include_runs else []
            value.update(runCursor=cursor, runsPartial=partial, completed=completed)
            value['readyRuns'] = [r[0] for r in db.execute('SELECT n FROM runs WHERE job=? AND dashboard IS NOT NULL', (job_id,))]
        with self.lock:
            value['opening'] = [index for job,index in self.opening if job==job_id]
            value['openError'] = self.errors.get(job_id)
        return value

    def jobs(self):
        with self.connect() as db:
            return [{'id':row[0], **{k:v for k,v in json.loads(row[1]).items() if k in ('name','phase','createdAt','total','error','impactSourceId','autoImpact')},
                'completed':row[2]} for row in db.execute("SELECT j.id,j.value,(SELECT count(*) FROM runs WHERE job=j.id) FROM jobs j "
                    "WHERE json_extract(j.value,'$.impactSourceId') IS NULL OR json_extract(j.value,'$.phase') IN ('queued','running') "
                    "ORDER BY rowid DESC LIMIT 50")]

    def impacts(self, job_id, include_runs=True):
        self.job(job_id, include_runs=False)
        with self.connect() as db:
            if not include_runs:
                # One snapshot for coverage/resume metadata; never decode the
                # thousands of finished runner summaries merely to count them.
                return [{**json.loads(raw), 'runs':[], 'completed':completed, 'runCursor':cursor, 'runsPartial':False}
                    for raw,completed,cursor in db.execute(
                        "SELECT j.value,count(r.n),coalesce(max(coalesce(c.cursor,r.rowid)),0) FROM jobs j LEFT JOIN runs r ON r.job=j.id LEFT JOIN run_cursors c ON c.job=r.job AND c.n=r.n "
                        "WHERE json_extract(j.value,'$.impactSourceId')=? GROUP BY j.rowid ORDER BY j.rowid", (job_id,))]
            ids = [row[0] for row in db.execute("SELECT id FROM jobs WHERE json_extract(value,'$.impactSourceId')=? ORDER BY rowid", (job_id,))]
        return [self.job(key) for key in ids]

    def write_job(self, value):
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO jobs VALUES (?,?)', (value['id'], json.dumps({k:v for k,v in value.items() if k not in ('runs','readyRuns','opening','completed','openError','runCursor','runsPartial')}, ensure_ascii=False)))

    def submit(self, body, automatic=False):
        setup = inputs.setup(body.get('setup'))
        source = self.job(body['impactSourceId']) if body.get('impactSourceId') else None
        if source:
            inputs.validate_impact_source(setup, source['setup'])
        with self.lock:
            if any(j['phase'] in ('queued','running') and not j.get('autoImpact') for j in self.jobs()):
                if automatic: raise BackgroundBusy()
                raise ValueError('Finish or cancel the current batch before starting another.')
            bundle, config = self.installed(source['engine'] if source else None)
            refs = references(config)
            inputs.prepare(setup, refs) # Reject unsupported fields before creating a job.
            for variant in range(len(setup.get('variations',{}).get('builds',[]))):
                inputs.prepare(setup,refs,(variant+1)*setup['count'])
            value = {'id':str(uuid.uuid4()), 'name':setup['name'], 'setup':setup, 'engine':bundle,
                'phase':'queued', 'createdAt':datetime.now(timezone.utc).isoformat(), 'total':setup['count']*(1+len(setup.get('variations',{}).get('builds',[])))}
            _, manifest = self.service.simulation.config()
            value['referenceKey'] = next(r['data_sha256'] for r in reversed(manifest['bundles']) if r['kind']=='inference')
            if source:
                value['impactSourceId'] = source['id']
                value['referenceKey'] = source['referenceKey']
                if not any(r['kind']=='inference' and r['data_sha256']==source['referenceKey'] for r in manifest['bundles']):
                    raise ValueError('The original analysis reference is no longer installed.')
                # Reserve every planned seed, including cancelled/interrupted
                # attempts. Pinning a race seed does not pin analysis samples.
                with self.connect() as db:
                    related = [json.loads(row[0]) for row in db.execute('SELECT value FROM jobs')]
                used = set()
                for prior in related:
                    if prior['id'] == source['id'] or prior.get('impactSourceId') == source['id']:
                        used.update(prior.get('seedSchedule') or [inputs.scheduled_seed(prior['setup'], i) for i in range(prior['setup']['count'])])
                value['seedSchedule'] = inputs.fresh_seed_schedule(setup['count'], used)
            if automatic:
                value['autoImpact'] = True
            self.write_job(value)
            if automatic:
                return value, config, refs
            self.foreground_idle.clear()
            self.executor.submit(self.run, value, config, refs)
        return self.job(value['id'])

    def from_race(self, body):
        """Use original engine inputs when available, never effective UI stats."""
        from globalsim_bridge.adapter import prepare_capture, WEATHER, GROUND, SEASON, TIME, GRADE, STYLE
        capture, _ = self.service.simulation.selected(body.get('raceId'))
        _, config = self.installed()
        refs = references(config)
        original, audit = prepare_capture(capture, refs)
        draft = deepcopy(body.get('draft'))
        if not isinstance(draft, dict) or not isinstance(draft.get('participants'), list):
            raise ValueError('Setup draft is missing.')
        if original is None:
            return {'setup':draft, 'warnings':[*(body.get('warnings') or []),
                'Original input mapping was incomplete. Confirm all displayed settings before running.']}
        if len(draft['participants']) != len(original['horses']):
            raise ValueError('Captured participant count changed. Reopen the race.')
        draft.update(seed=original['seed'], courseId=original['courseId'], keepSeed=True, shuffleGates=False)
        for key, spec_key, table in [('weather','weather',WEATHER),('ground','groundCondition',GROUND),('season','season',SEASON),('time','time',TIME),('grade','grade',GRADE)]:
            draft[key]=next(k for k,v in table.items() if v==original[spec_key])
        for p,h in zip(draft['participants'], original['horses']):
            p.update(surface=h['surfaceAptitude'], distance=h['distanceAptitude'], strategyAptitude=h['strategyAptitude'],
                strategy=next(k for k,v in STYLE.items() if v[0]==h['strategy']), mood=h['mood']+3, randomizeMood=False,
                gate=h['gateIndex']+1, team=h['teamId'], popularity=h['popularity'])
            p['uma'].update(stats={key:h[key] for key in ('speed','stamina','power','guts','wisdom')},
                skills=[{'id':int(s['skillId']),'level':s['level']} for s in h['skills']], charaId=h['charaId'], fans=h['fans'], careerWins=h['careerWins'])
        return {'setup':inputs.setup(draft), 'warnings':[]}

    def cancel(self, job_id):
        job = self.job(job_id)
        if job.get('autoImpact'):
            self.auto_skills.ensure(job['impactSourceId'], False)
        with self.lock: self.cancelled.add(job_id)
        return {'ok':True}

    def display_context(self, job, config):
        analysis = self.service.analysis_service
        if not analysis.available: raise ValueError('Dashboard analysis runtime is unavailable.')
        _, manifest = self.service.simulation.config()
        reference = next((r for r in reversed(manifest['bundles']) if r['kind']=='inference' and (not job.get('referenceKey') or r['data_sha256']==job['referenceKey'])), None)
        if reference is None:raise ValueError('The saved display reference is no longer installed.')
        reference_path, reference_key = self.service.simulation.skill_catalog.display_reference(analysis.reference_path(reference['data_sha256']), config.skill_catalog)
        folder = self.service.data_dir / 'cache/sandbox-work'
        node_config = RuntimeConfig(Path(analysis.node), analysis.root, analysis.root, work_root=folder,
            engine_args=('--max-old-space-size=2048', str(analysis.worker), '--serve'),
            expected_engine_sha256=hashlib.sha256(Path(analysis.node).read_bytes()).hexdigest(),
            timeout_seconds=180, max_input_bytes=128*1024*1024, max_output_bytes=16384, low_priority=True)
        return reference_path, reference_key, node_config

    def execute(self, job, config, refs, index, summary_only, skill_payload=None, batch_context=None, prepared_inputs=None):
        spec, run = prepared_inputs.prepare(index) if prepared_inputs is not None else inputs.prepare(job['setup'], refs, index, job.get('seedSchedule'))
        saved = next((r for r in job.get('runs', []) if r['index'] == index), None)
        if saved is not None:
            # Replays preserve actual draws even if a future Python version
            # changes its shuffle implementation.
            for key in ('seed','moods','gates'):run[key]=saved[key]
            spec['seed']=run['seed']
            for i,horse in enumerate(spec['horses']):
                horse.update(mood=run['moods'][i]-3, gateIndex=run['gates'][i]-1)
        outcome_only = summary_only and inputs.outcome_only(job, index)
        if outcome_only:
            spec.update(retainAllFrames=False, decisionTrace=False, traceConservePower=False)
        if batch_context is not None:
            if 'skill_payload' not in batch_context:
                batch_context['skill_payload'] = _canonical(refs.skill_data)
            skill_payload = batch_context['skill_payload']
        if skill_payload is not None:
            # This immutable reference snapshot is pinned when the job starts.
            # Encode its large catalog once per worker instead of once per seed.
            if spec.pop('skillData') is not refs.skill_data:
                raise ValueError('Prepared skill definitions changed during the measurement.')
            payload = _canonical(spec)[:-1] + b',"skillData":' + skill_payload + b'}\n'
        else:
            payload = _canonical(spec)+b'\n'
        # The analysis worker consumes binary replay frames directly for single
        # races too; avoid expanding them into Python dictionaries and JSON.
        if not outcome_only and config.worker_protocol == 'binary-v1':
            config = replace(config, retain_binary_frames=True)
        modeled, _, _ = _run_worker(config, payload)
        if 'error' in modeled: raise ValueError(str(modeled['error']))
        binary_frames = modeled.pop('_binary_frames', None)
        if outcome_only:
            return outcome_summary(prepared_inputs.setup_for(index) if prepared_inputs is not None else inputs.variant_setup(job['setup'], index), run, modeled), None
        invalid = validate_trace(modeled.get('decisionTrace'), len(spec['horses']))
        if invalid: raise ValueError(invalid)
        if batch_context is None:
            reference_path, reference_key, node_config = self.display_context(job, config)
        else:
            if 'display' not in batch_context:
                batch_context['display'] = self.display_context(job, config)
            reference_path, reference_key, node_config = batch_context['display']
        folder = self.service.data_dir / 'cache/sandbox-work'
        folder.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='run-', dir=folder) as temporary:
            summary, output = Path(temporary)/'summary.json', Path(temporary)/'dashboard.gz'
            payload = {'kind':'sandbox', 'setup':inputs.variant_setup(job['setup'],index), 'run':run, 'modeled':modeled, 'jobId':job['id'],
                'engineVersion':job['engine']['version'], 'referencePath':str(reference_path), 'referenceKey':reference_key,
                'summaryOnly':summary_only, 'summaryOutput':str(summary), 'output':str(output)}
            if binary_frames is not None:
                count, horses, raw = binary_frames
                frame_path = Path(temporary)/'frames.bin'
                with frame_path.open('wb') as stream:
                    stream.write(struct.pack('<4sII', b'UMAF', count, horses))
                    stream.write(raw)
                payload['framesPath'] = str(frame_path)
            node_pool = batch_context.get('node_pool', self.node_pool) if batch_context is not None else self.node_pool
            reply, _, _ = node_pool.run(node_config, _canonical(payload)+b'\n')
            if reply.get('ok') is not True: raise ValueError(str(reply.get('error', 'Analysis failed.')))
            return read_json(summary), output.read_bytes() if output.exists() else None

    def execute_outcome(self, job, config, refs, index):
        """Each thread owns one reusable process; no engine state is shared."""
        with self.lock:
            if self.closed:
                raise ValueError('The service is shutting down.')
            if not hasattr(self.impact_local, 'pool'):
                self.impact_local.pool = WorkerPool()
                self.impact_workers.append(self.impact_local.pool)
        if getattr(self.impact_local, 'refs', None) is not refs:
            self.impact_local.skill_payload = _canonical(refs.skill_data)
            self.impact_local.refs = refs
            self.impact_local.job_id = None
        if getattr(self.impact_local, 'job_id', None) != job['id']:
            self.impact_local.inputs = inputs.PreparedInputs(job['setup'], refs, job.get('seedSchedule'))
            self.impact_local.job_id = job['id']
        return self.execute(job, replace(config, worker_pool=self.impact_local.pool, decode_frames=False), refs, index, True, self.impact_local.skill_payload, prepared_inputs=self.impact_local.inputs)

    def execute_batch(self, job, config, refs, index):
        """Bounded full-analysis workers keep both engine and Node state private."""
        with self.lock:
            if self.closed:
                raise ValueError('The service is shutting down.')
            if not hasattr(self.batch_local, 'engine_pool'):
                self.batch_local.engine_pool, self.batch_local.node_pool = WorkerPool(), WorkerPool()
                self.batch_workers.extend((self.batch_local.engine_pool, self.batch_local.node_pool))
        if getattr(self.batch_local, 'job_id', None) != job['id']:
            self.batch_local.job_id = job['id']
            self.batch_local.context = {'node_pool': self.batch_local.node_pool}
        return self.execute(job, replace(config, worker_pool=self.batch_local.engine_pool, retain_binary_frames=True), refs, index, True,
                            batch_context=self.batch_local.context)

    def run_batch(self, job, config, refs):
        with self.connect() as db:
            self._run_outcomes(job, config, refs, db, self.batch_executor, self.execute_batch, self.batch_concurrency)

    def save_run(self, job_id, index, result, connection=None):
        summary, packed = result
        if connection is not None:
            connection.execute('INSERT INTO runs VALUES (?,?,?,?)', (job_id,index,summary_bytes(summary),packed))
            connection.execute('INSERT OR IGNORE INTO run_cursors(job,n) VALUES (?,?)', (job_id,index))
            return
        with self.connect() as db:
            db.execute('INSERT INTO runs VALUES (?,?,?,?)', (job_id,index,summary_bytes(summary),packed))
            db.execute('INSERT OR IGNORE INTO run_cursors(job,n) VALUES (?,?)', (job_id,index))

    def run_outcomes(self, job, config, refs):
        # Keep the WAL connection open through the batch. Closing the final
        # connection after every race checkpoints the growing DB every time.
        with self.connect() as db:
            self._run_outcomes(job, config, refs, db)

    def _run_outcomes(self, job, config, refs, db, executor=None, execute=None, concurrency=None):
        executor, execute = executor or self.impact_executor, execute or self.execute_outcome
        concurrency = concurrency or self.impact_concurrency
        saved = {r[0] for r in db.execute('SELECT n FROM runs WHERE job=?', (job['id'],))}
        order, pending = iter(i for i in inputs.execution_order(job) if i not in saved), {}
        exhausted = False
        def fill():
            nonlocal exhausted
            while not self.closed and job['id'] not in self.cancelled and len(pending)<concurrency:
                if job.get('autoImpact') and (not self.foreground_idle.is_set() or self.opening):
                    break
                index = next(order, None)
                if index is None:
                    exhausted = True
                    break
                pending[executor.submit(execute,job,config,refs,index)] = index
        try:
            fill()
            while pending or not exhausted and not self.closed and job['id'] not in self.cancelled:
                if not pending:
                    time.sleep(.05)
                    fill()
                    continue
                done, _ = wait(pending, return_when=FIRST_COMPLETED)
                failure = None
                for future in done:
                    index = pending.pop(future)
                    try:
                        result = future.result()
                    except Exception as error:
                        failure = error
                        continue
                    self.save_run(job['id'], index, result, db)
                db.commit()  # Completed pairs are visible to polling immediately.
                if failure is not None:
                    raise failure
                fill()
        finally:
            # A failed race stops new work; at most the bounded in-flight races
            # finish. Drain them before another job may reuse these workers.
            for future in pending:
                future.cancel()
            if pending:
                wait(pending)

    def run(self, job, config, refs):
        try:
            job['phase']='running'; self.write_job(job)
            if job['total']>1 and inputs.outcome_only(job,0):
                self.run_outcomes(job,config,refs)
            elif job['total']>1 and not job['setup'].get('variations'):
                self.run_batch(job,config,refs)
            else:
                batch_context = {}
                # Keep the WAL open rather than checkpointing after every race.
                with self.connect() as db:
                    for index in inputs.execution_order(job):
                        if self.closed or job['id'] in self.cancelled: break
                        self.save_run(job['id'], index, self.execute(job, config, refs, index, job['total']>1, batch_context=batch_context), db)
                        db.commit()  # Preserve live progress and completed races on failure.
            job['phase']='interrupted' if self.closed else 'cancelled' if job['id'] in self.cancelled else 'complete'
        except Exception as error:
            job.update(phase='interrupted' if self.closed else 'failed', error=str(error)[:1000])
        finally:
            self.write_job(job)
            self.cancelled.discard(job['id'])
            if not job.get('autoImpact'):
                self.foreground_idle.set()
                if job['phase']=='complete' and job['total']>1 and not job.get('impactSourceId') and not job['setup'].get('variations'):
                    self.auto_skills.ensure(job['id'])
                self.auto_skills.wake.set()

    def open_run(self, body):
        job = self.job(body.get('jobId'))
        index = inputs.integer(body.get('index'), 'Race index', 0, job['total']-1)
        if not any(r['index'] == index for r in job['runs']):
            raise ValueError('This race has not finished yet.')
        key = (job['id'], index)
        with self.lock:
            if index not in job['readyRuns'] and key not in self.opening:
                self.errors.pop(job['id'], None)
                self.opening.add(key)
                self.render_executor.submit(self.render, job, index)
        return {'ok':True}

    def render(self, job, index):
        try:
            _, config = self.installed(job['engine'])
            refs = references(config)
            summary, packed = self.execute(job, config, refs, index, False)
            prior = next(r for r in job['runs'] if r['index'] == index)
            if [(r['id'],r['place'],r['time']) for r in summary['runners']] != [(r['id'],r['place'],r['time']) for r in prior['runners']]:
                raise ValueError('Recreated race differs from the saved result. Dashboard was not published.')
            with self.connect() as db:
                db.execute('UPDATE runs SET dashboard=? WHERE job=? AND n=?', (packed,job['id'],index))
        except Exception as error:
            with self.lock:
                self.errors[job['id']] = str(error)[:1000]
        finally:
            with self.lock:
                self.opening.discard((job['id'],index))

    def dashboard(self, job_id, index):
        with self.connect() as db:
            row = db.execute('SELECT dashboard FROM runs WHERE job=? AND n=?', (job_id,index)).fetchone()
        if not row or not row[0]: raise ValueError('Dashboard is not ready.')
        return row[0]

    def close(self):
        self.closed = True
        self.foreground_idle.set()
        self.auto_skills.wake.set()
        self.executor.shutdown(wait=False, cancel_futures=True)
        self.render_executor.shutdown(wait=False, cancel_futures=True)
        self.impact_executor.shutdown(wait=False, cancel_futures=True)
        self.batch_executor.shutdown(wait=False, cancel_futures=True)
        for pool in self.impact_workers:
            pool.close()
        for pool in self.batch_workers:
            pool.close()
        self.engine_pool.close(); self.node_pool.close()
