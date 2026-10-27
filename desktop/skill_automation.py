"""Durable, bounded skill-only work; ordinary simulations always take priority."""
from copy import deepcopy
from collections import OrderedDict
import json
import math
import threading

import sandbox_inputs as inputs

DEFAULT_PAIRS = 100


class BackgroundBusy(Exception):
    pass


def skill_targets(setup):
    return [(p['id'], s['id']) for p in setup['participants'] for s in p['uma']['skills']]


def removed_skills(setup):
    variants = setup.get('variations')
    if not variants:
        return []
    original = next(p['uma'] for p in setup['participants'] if p['id'] == variants['participantId'])
    inventory = lambda b: sorted((s['id'], s.get('level', 1)) for s in b['skills'])
    result = []
    for index, build in enumerate(variants['builds'], 1):
        if any(original[k] != build[k] for k in ('stats', 'charaId', 'cardId', 'fans', 'careerWins')):
            continue
        before, after = inventory(original), inventory(build)
        missing = set(before) - set(after)
        if len(before) == len(after) + 1 and len(missing) == 1 and set(after).issubset(before):
            result.append((index, variants['participantId'], next(iter(missing))[0]))
    return result


def coverage_pairs(source, jobs):
    """Count distinct complete pairs in the same engine, field and conditions."""
    found = {key: set() for key in skill_targets(source['setup'])}
    def pair(run):
        return (inputs.engine_seed_key(run['seed']), tuple(run['moods']), tuple(run['gates']))
    def valid(run, runner):
        return any(r['id'] == runner and type(r.get('place')) is int and r['place'] > 0
                   and type(r.get('time')) in (int, float) and math.isfinite(r['time']) for r in run['runners'])
    for job in jobs:
        if job.get('engine') != source.get('engine') or job.get('referenceKey') != source.get('referenceKey'):
            continue
        try:
            inputs.validate_impact_source(job['setup'], source['setup'])
        except ValueError:
            continue
        baseline = {pair(r): r for r in job['runs'] if r.get('variantIndex', 0) == 0}
        for variant, runner, skill in removed_skills(job['setup']):
            for run in job['runs']:
                if run.get('variantIndex') != variant or (runner, skill) not in found:
                    continue
                key = pair(run)
                if key in baseline and valid(run, runner) and valid(baseline[key], runner):
                    found[(runner, skill)].add(key)
    return found


def coverage(source, jobs):
    return {key: len(pairs) for key, pairs in coverage_pairs(source, jobs).items()}


def next_setup(source, counts):
    """Share one baseline across up to nine isolated skill removals."""
    pending = [key for key in skill_targets(source['setup']) if counts.get(key, 0) < DEFAULT_PAIRS]
    if not pending:
        return None
    runner, skill = pending[0]
    count = DEFAULT_PAIRS - counts.get((runner, skill), 0)
    targets = [sid for pid, sid in pending if pid == runner and DEFAULT_PAIRS-counts.get((pid, sid), 0) == count][:min(20, 1000//count-1)]
    setup = deepcopy(source['setup'])
    original = next(p['uma'] for p in setup['participants'] if p['id'] == runner)
    builds = []
    for sid in targets:
        build = deepcopy(original)
        build['skills'] = [s for s in build['skills'] if s['id'] != sid]
        build['name'] = f"{build['name']} · without skill {sid}"
        builds.append(build)
    setup.update(count=count, variations={'participantId': runner, 'builds': builds})
    return setup


def impact_view(job):
    """The impact UI only needs the compared runner's outcomes, not the field."""
    runner = job['setup'].get('variations', {}).get('participantId')
    if not runner:
        return job
    return {**job, 'runs': [{**run, 'runners': [{k: r[k] for k in ('id','place','time','skills') if k in r}
        for r in run['runners'] if r['id'] == runner]} for run in job['runs']]}


class SkillAutomation:
    def __init__(self, store):
        self.store = store
        self.wake = threading.Event()
        self.thread = None
        self.coverage_cache = OrderedDict()
        with store.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS skill_automation (source TEXT PRIMARY KEY, value TEXT)')

    def start(self):
        with self.store.lock:
            if self.thread is not None or self.store.closed:
                return
            self.thread = threading.Thread(target=self.loop, name='automatic-skill-impact', daemon=True)
            self.thread.start()
            self.wake.set()

    def read(self, source_id):
        with self.store.connect() as db:
            row = db.execute('SELECT value FROM skill_automation WHERE source=?', (source_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def write(self, source_id, **patch):
        with self.store.lock, self.store.connect() as db:
            row = db.execute('SELECT value FROM skill_automation WHERE source=?', (source_id,)).fetchone()
            value = {**(json.loads(row[0]) if row else {}), **patch}
            db.execute('INSERT OR REPLACE INTO skill_automation VALUES (?,?)', (source_id, json.dumps(value)))

    def ensure(self, source_id, enabled=None):
        source = self.store.job(source_id, include_runs=False)
        if source.get('impactSourceId') or source['setup'].get('variations') or source['total'] < 2:
            raise ValueError('Automatic skill impact is available for ordinary multi-race batches.')
        if enabled is not None and type(enabled) is not bool:
            raise ValueError('Enabled must be a boolean.')
        with self.store.lock:
            previous = self.read(source_id)
            if previous is None:
                self.write(source_id, enabled=True if enabled is None else enabled, completeSkills=0,
                    totalSkills=len(skill_targets(source['setup'])), error=None)
            elif enabled is not None:
                self.write(source_id, enabled=enabled, error=None)
            if enabled is False:
                for job in self.store.jobs():
                    if job.get('autoImpact') and job.get('impactSourceId') == source_id:
                        self.store.cancelled.add(job['id'])
            self.wake.set()
        return self.status(source_id)

    def status(self, source_id):
        value = self.read(source_id)
        if value is None:
            return None
        with self.store.connect() as db:
            jobs = [{'id':row[0], 'phase':json.loads(row[1])['phase'], 'completed':row[2],
                     'total':json.loads(row[1])['total'], 'autoImpact':json.loads(row[1]).get('autoImpact', False)}
                for row in db.execute("SELECT j.id,j.value,(SELECT count(*) FROM runs WHERE job=j.id) FROM jobs j WHERE json_extract(j.value,'$.impactSourceId')=? ORDER BY j.rowid", (source_id,))]
        active = next((j for j in jobs if j['autoImpact'] and j['phase'] in ('queued','running')), None)
        phase = 'error' if value.get('error') else 'paused' if not value['enabled'] else 'complete' if value.get('completeSkills') == value.get('totalSkills') else 'waiting' if not self.store.foreground_idle.is_set() else 'running' if active else 'queued'
        return {**value, 'phase':phase, 'pairs':DEFAULT_PAIRS, 'activeJob':active, 'jobs':jobs}

    def loop(self):
        while not self.store.closed:
            self.wake.wait(1)
            self.wake.clear()
            if self.store.closed:
                break
            maintenance = getattr(getattr(self.store, 'service', None), 'storage_optimizer', None)
            if maintenance and maintenance.reserving_databases:
                continue
            with self.store.connect() as db:
                requests = [(r[0], json.loads(r[1])) for r in db.execute('SELECT source,value FROM skill_automation ORDER BY rowid DESC')]
            for source_id, request in requests:
                if self.store.closed or not self.store.foreground_idle.is_set():
                    break
                if not request.get('enabled') or request.get('error') or request.get('completeSkills') == request.get('totalSkills'):
                    continue
                try:
                    self.process(source_id)
                except BackgroundBusy:
                    break
                except Exception as error:
                    self.write(source_id, error=str(error)[:1000])

    def process(self, source_id):
        source = self.store.job(source_id, include_runs=False)
        if source['phase'] != 'complete':
            return
        counts, jobs = self.sample_counts(source)
        self.write(source_id, completeSkills=sum(n >= DEFAULT_PAIRS for n in counts.values()))
        setup = next_setup(source, counts)
        if setup is None:
            return
        # Interrupted jobs retain their exact reserved seed schedule. Only fill
        # missing indices, so service restarts and pause/resume never reroll them.
        resume = next((j for j in jobs if j.get('autoImpact') and j['phase'] in ('queued','interrupted','cancelled')
            and j['completed'] < j['total'] and any(counts.get((pid,sid),0)<DEFAULT_PAIRS for _,pid,sid in removed_skills(j['setup']))), None)
        with self.store.lock:
            request = self.read(source_id)
            if not request['enabled'] or self.store.closed:
                return
            if not self.store.foreground_idle.is_set():
                raise BackgroundBusy()
            if resume:
                from engine_skill_catalog import references
                _, config = self.store.installed(resume['engine'])
                refs = references(config)
                job = resume
                job.pop('error', None)
                self.store.cancelled.discard(job['id'])
            else:
                job, config, refs = self.store.submit({'setup':setup, 'impactSourceId':source_id}, automatic=True)
        self.store.run(job, config, refs)
        if job['phase'] == 'failed':
            raise ValueError(job.get('error', 'Skill-impact simulation failed.'))
        counts, _ = self.sample_counts(source)
        self.write(source_id, completeSkills=sum(n >= DEFAULT_PAIRS for n in counts.values()))
        self.wake.set()

    def sample_counts(self, source):
        """Reuse completed job coverage, preserving cross-job pair deduplication."""
        jobs = self.store.impacts(source['id'], include_runs=False)
        found = {key:set() for key in skill_targets(source['setup'])}
        for job in jobs:
            key = source['id'], job['id']
            signature = json.dumps([source['setup'], source.get('engine'), source.get('referenceKey'),
                job['setup'], job.get('engine'), job.get('referenceKey'), job.get('runCursor')], sort_keys=True)
            cached = self.coverage_cache.get(key)
            if cached is None or cached[0] != signature:
                pairs = coverage_pairs(source, [self.store.job(job['id'])])
                cached = signature, {k:v for k,v in pairs.items() if v}
                self.coverage_cache[key] = cached
            self.coverage_cache.move_to_end(key)
            while len(self.coverage_cache) > 64:
                self.coverage_cache.popitem(last=False)
            for target, pairs in cached[1].items():
                if target in found:
                    found[target].update(pairs)
        return {key:len(pairs) for key,pairs in found.items()}, jobs
