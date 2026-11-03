"""Catalog compiler, immutable revisions and installed-engine integration."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'desktop'))
from globalsim_bridge.adapter import ReferenceData, canonical
from globalsim_bridge.bundled_skills import ROWS
from globalsim_bridge.skill_catalog import Compiler, catalog_rows, CONTRACT, audited_build
from engine_skill_catalog import EngineSkillCatalog, references
from simulation_service import SimulationService
from sandbox_inputs import prepare
from globalsim_bridge.runtime import _run_worker, _canonical


def fixture():
    """Small contract fixture independent of an optional packaged engine."""
    return {'1': {'alternatives': [dict(condition='&'.join([
        'always==1', 'phase==1', 'phase>=2', 'distance_rate>=40', 'distance_rate<=50',
        'order_rate>=30', 'order_rate<=80', 'corner!=0', 'remain_distance>=399',
        'remain_distance<=401', 'order<=3', 'is_lastspurt==1', 'ground_type==2',
        'blocked_side_continuetime>=2', 'grade==100', 'popularity<=3',
        'distance_type==4', 'is_finalcorner_laterhalf==1']), durationUsage=1,
        effects=[dict(type=t,target=1,targetValue=0,additionalActivate=0,valueUsage=1)
                 for t in (1,9,22,27,31)])]}}


class SkillCompilerTests(unittest.TestCase):
    def setUp(self): self.compiler = Compiler(fixture())

    def test_release_engine_pin_has_an_audited_skill_import_contract(self):
        lock=json.loads((ROOT/'simulation/source-lock.json').read_bytes())
        self.assertTrue(audited_build({'sourceCommit': None if lock.get('pendingReview') else lock['revision'],
            'upstreamCommit': lock['upstreamRevision'], 'instrumentation': {'sourceSha256': lock['sourceSha256']}}),
            'Audit the skill import contract when changing the engine; do not silently disable imports')
        self.assertFalse(audited_build({'sourceCommit':None}), 'An absent receipt must never count as an audited build')

    def test_nine_complete_definitions_and_level_scaling(self):
        accepted, presentation, rejected = self.compiler.additions(ROWS, fixture())
        self.assertEqual(set(accepted), set(ROWS)); self.assertEqual(rejected, {})
        self.assertEqual(accepted['110671']['wisdomCheck'], 0)
        self.assertFalse(accepted['110671']['isGeneralSkill'])
        self.assertEqual(accepted['910671']['wisdomCheck'], 1)
        self.assertTrue(accepted['910671']['isGeneralSkill'])
        effects = accepted['110671']['alternatives'][0]['effects']
        self.assertEqual([e['type'] for e in effects], [27,9])
        self.assertEqual([e['levelModifiers'][5] for e in effects], [1.13,1.1])
        self.assertEqual(len(accepted['100471']['alternatives']), 2)
        self.assertIn('grade==100&popularity<=3', accepted['100471']['alternatives'][0]['condition'])
        self.assertEqual(accepted['900991']['alternatives'][0]['precondition'], 'phase==1&blocked_side_continuetime>=2&corner!=0')
        self.assertEqual(accepted['110161']['alternatives'][1]['precondition'], '')
        self.assertEqual(presentation['910681']['branches'][0]['rawDuration'], 24000)

    def test_future_supported_definition_is_accepted_without_id_whitelist(self):
        row = deepcopy(ROWS['110671']);row['id']=1234567
        row['condition_groups'][0]['condition']='distance_rate>=42&distance_rate<=56&order_rate<=77'
        row['condition_groups'][0]['effects'][0]['value']=3750
        accepted, _, rejected = self.compiler.additions({'1234567':row}, fixture())
        self.assertFalse(rejected);self.assertEqual(accepted['1234567']['alternatives'][0]['effects'][0]['modifier'],3750)
        self.assertFalse(self.compiler.additions({'1234567':row},{'1234567':{}})[0], 'Installed definitions are never overwritten')

    def test_unknown_branch_effect_target_or_operator_rejects_whole_skill(self):
        mutations = [lambda g:g.update(condition='is_exist_skill_id==100101'),
            lambda g:g.update(condition='future_condition==1'),lambda g:g.update(condition='phase!=2'),
            lambda g:g.update(future_scale=1),lambda g:g['effects'].append({'type':999,'value':1}),
            lambda g:g['effects'][0].update(value_scale=999),lambda g:g['effects'][0].update(target=99),
            lambda g:g['effects'][0].update(value=float('nan'))]
        for change in mutations:
            row=deepcopy(ROWS['110161']);change(row['condition_groups'][1])
            accepted, _, rejected=self.compiler.additions({'110161':row},fixture())
            self.assertFalse(accepted);self.assertIn('110161',rejected)

    def test_passive_tags_do_not_depend_on_icon_color(self):
        row=deepcopy(ROWS['110671']);row.update(id=202999,iconid=20181)
        row['condition_groups']=[{'condition':'always==1','base_time':-1,'effects':[{'type':1,'value':400000}]}]
        self.assertEqual(self.compiler.compile(row)['tags'],[601])
        row['condition_groups'][0]['effects'][0]['value']=-400000;row['iconid']=10014
        self.assertEqual(self.compiler.compile(row)['tags'],[])
        row['condition_groups'][0]['effects'][0]['value']=400000;row['id']=1200999
        self.assertEqual(self.compiler.compile(row)['tags'],[])

    def test_global_patch_inheritance_and_japanese_fallback(self):
        row=deepcopy(ROWS['110671']);row.pop('dataRegion');row.pop('unreleasedGlobal')
        inherited=deepcopy(ROWS['910671']);row['gene_version']=inherited
        row['loc']={'en':{'condition_groups':[{'condition':'phase>=2','base_time':40000,'effects':[{'type':27,'value':2500}]}]}}
        rows=catalog_rows([row]);self.assertEqual(rows['110671']['condition_groups'][0]['base_time'],40000)
        self.assertEqual(rows['910671']['dataRegion'],'Global')
        del row['loc'];self.assertEqual(catalog_rows([row])['110671']['dataRegion'],'JP')


class DisplayReferenceConcurrencyTests(unittest.TestCase):
    def test_parallel_races_publish_the_reference_once(self):
        from concurrent.futures import ThreadPoolExecutor
        import threading, time
        from unittest.mock import patch
        from storage import atomic_bytes
        with tempfile.TemporaryDirectory(dir=ROOT/'.cache') as folder:
            base=Path(folder)/'base.json'
            base.write_text(json.dumps({'metadata':{'skills':{},'skillNames':{}},'skillIds':[]}))
            catalog=EngineSkillCatalog(SimpleNamespace(service=SimpleNamespace(data_dir=Path(folder))))
            start=threading.Barrier(8)
            publishing=threading.Lock()
            def write(path,raw):
                if not publishing.acquire(blocking=False):
                    raise PermissionError('Concurrent Windows reference replacement')
                try:
                    time.sleep(.03)
                    return atomic_bytes(path,raw)
                finally:publishing.release()
            def run(_):
                start.wait(timeout=5)
                return catalog.display_reference(base,{'definitions':{},'presentation':{}})
            with patch('storage.atomic_bytes',side_effect=write) as writes, ThreadPoolExecutor(max_workers=8) as pool:
                results=list(pool.map(run,range(8)))
            self.assertEqual(len(set(results)),1)
            self.assertEqual(writes.call_count,1)
            path,key=results[0]
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),key)


class InstalledCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path=ROOT/'simulation/installed-bundles.json'
        if not path.exists():raise unittest.SkipTest('Installed engine integration requires a packaged worker')
        cls.base=next((r for r in reversed(json.loads(path.read_bytes())['bundles']) if r['kind']=='simulation' and r.get('persistentWorker')),None)
        if not cls.base or not (ROOT/cls.base['artifact']).is_file():raise unittest.SkipTest('Packaged worker unavailable')

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=ROOT/'.cache');self.addCleanup(self.temp.cleanup)
        self.rows=deepcopy(ROWS);self.revision='initial'
        service=SimpleNamespace(data_dir=Path(self.temp.name),catalog=SimpleNamespace(engine_snapshot=lambda:(self.revision,self.rows,{'url':'fixture'})))
        self.sim=SimulationService(service,ROOT);self.addCleanup(self.sim.close)

    def current(self):
        _,manifest=self.sim.config();bundle=[r for r in manifest['bundles'] if r['kind']=='simulation'][-1]
        config=self.sim.bindings({'bundles':[bundle]},'test')[0][bundle['engine_id']].config
        return manifest,bundle,config,references(config)

    def test_revision_pins_and_matching_display_reference(self):
        manifest,first,config,refs=self.current();self.assertEqual(refs.fingerprint,first['data_sha256'])
        self.rows['1234567']=deepcopy(ROWS['110671']);self.rows['1234567']['id']=1234567;self.revision='next'
        manifest,second,_,updated=self.current()
        self.assertNotEqual(first['data_sha256'],second['data_sha256']);self.assertIn(first,manifest['bundles'])
        self.assertNotIn('1234567',refs.skill_data);self.assertIn('1234567',updated.skill_data)
        inference=next(r for r in reversed(manifest['bundles']) if r['kind']=='inference')
        path,key=self.sim.skill_catalog.display_reference(ROOT/inference['data'],config.skill_catalog)
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),key)
        self.assertEqual(json.loads(path.read_bytes())['metadata']['skills']['900991']['branches'][0]['effects'][0]['rawValue'],700)
        # A restarted service retains old catalog identities even offline.
        self.sim.skill_catalog=EngineSkillCatalog(self.sim)
        self.assertIn(first,self.current()[0]['bundles'])

    def test_engine_loads_every_branch_and_emits_definition_and_wit_traces(self):
        _,_,config,refs=self.current()
        from test_sandbox import setup
        value=setup();value['courseId']=10506
        ids=list(ROWS)
        for i,p in enumerate(value['participants']):
            p['uma']['skills']=[{'id':int(ids[i]),'level':6 if int(ids[i])<900000 else 1}]
        spec,_=prepare(value,refs);spec['retainAllFrames']=False
        modeled,_,_=_run_worker(config,_canonical(spec)+b'\n')
        self.assertNotIn('error',modeled);self.assertEqual(len(modeled['results']),9)
        from globalsim_bridge.decision_trace import expand_trace
        events=expand_trace(modeled['decisionTrace'])['events']
        for sid in ids:
            definitions=[e for e in events if e['kind']=='skill-definition' and e['skillId']==sid]
            self.assertEqual(len(definitions),len(refs.skill_data[sid]['alternatives']),sid)
            self.assertTrue(any(e['kind']=='skill-wit' and e['skillId']==sid for e in events),sid)
        self.assertTrue(modeled['decisionTrace']['complete'])

    def test_all_twelve_activation_branches_fire_on_eligible_fields(self):
        _,_,config,refs=self.current()
        from test_sandbox import setup
        value=setup();value['participants']=[deepcopy(value['participants'][0]) for _ in range(18)]
        value.update(keepSeed=True,shuffleGates=False,seed=1)
        for i,p in enumerate(value['participants']):
            p.update(id=str(i),gate=i+1,popularity=i+1,strategy=2,team=i,randomizeMood=False)
            p['uma']['stats'].update(speed=1200,stamina=1600,power=1000,guts=800,wisdom=1200)
            p['uma']['skills']=[{'id':int(sid),'level':6 if int(sid)<900000 else 1} for sid in ROWS]
        seen=set()
        for course in (10506,10613):
            value['courseId']=course
            spec,_=prepare(value,refs);spec.update(retainAllFrames=False,decisionTrace=False)
            modeled,_,_=_run_worker(config,_canonical(spec)+b'\n')
            self.assertNotIn('error',modeled)
            seen.update((str(e['skillId']),e['detailIndex']) for e in modeled['skillDetailEvents'] if str(e['skillId']) in ROWS)
        expected={(sid,i) for sid in ROWS for i in range(len(refs.skill_data[sid]['alternatives']))}
        self.assertEqual(seen,expected)

    def test_future_skill_reaches_the_real_dashboard_worker(self):
        import gzip,shutil
        from sandbox_service import SandboxService
        from test_sandbox import setup
        if not shutil.which('node') or not (ROOT/'simulation/analysis/worker.mjs').exists():
            self.skipTest('Built dashboard worker required')
        future=deepcopy(ROWS['110671']);future.update(id=1234567,name_en='Future supported skill')
        self.rows['1234567']=future;self.revision='future'
        manifest,bundle,config,refs=self.current()
        inference=next(r for r in reversed(manifest['bundles']) if r['kind']=='inference')
        service=self.sim.service;service.simulation=self.sim
        service.analysis_service=SimpleNamespace(available=True,node=shutil.which('node'),root=ROOT,
            worker=ROOT/'simulation/analysis/worker.mjs',reference_path=lambda key:ROOT/inference['data'])
        store=SandboxService(service);self.addCleanup(store.close)
        value=setup();value['courseId']=10506
        for p in value['participants']:p['uma']['skills']=[{'id':1234567,'level':1}]
        job={'id':'catalog-dashboard-test','setup':value,'engine':bundle,'referenceKey':inference['data_sha256']}
        summary,packed=store.execute(job,config,refs,0,False)
        if bundle.get('decisionTraceSchema') == 'umalytics-decisions-v2':
            from unittest.mock import patch
            def diagnostic_worker(config,payload):
                request=json.loads(payload);request['traceDiagnostics']=True
                return _run_worker(config,_canonical(request)+b'\n')
            with patch('sandbox_service._run_worker',side_effect=diagnostic_worker):
                diagnostic_summary,diagnostic_packed=store.execute(job,config,refs,0,False)
            def clean(value):
                if isinstance(value,dict):return {k:clean(v) for k,v in value.items() if k not in ('sequence','lastSequence')}
                return [clean(v) for v in value] if isinstance(value,list) else value
            self.assertEqual(clean(summary),clean(diagnostic_summary))
            self.assertEqual(clean(json.loads(gzip.decompress(packed))),clean(json.loads(gzip.decompress(diagnostic_packed))))
        self.assertEqual(len(summary['runners']),9)
        dashboard=json.loads(gzip.decompress(packed));path=self.sim.skill_catalog.path(dashboard['referenceKey'],True)
        display=json.loads(path.read_bytes())
        self.assertEqual(display['metadata']['skills']['1234567']['name'],'Future supported skill')
        self.assertIn('1234567',display['skillIds'])
        self.assertTrue(any(s['id']==1234567 for r in summary['runners'] for s in r['skills']))

    def test_tampered_snapshot_is_rejected(self):
        _,bundle,config,_=self.current();path=self.sim.skill_catalog.path(bundle['skillCatalog'])
        value=json.loads(path.read_bytes());value['definitions']['110671']['alternatives'][0]['effects'][0]['modifier']=9999
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError,'identity changed'):self.sim.bindings({'bundles':[bundle]},'test')

    def test_installed_master_new_skill_refreshes_worker_without_replacing_old_snapshot(self):
        import os, sqlite3
        from game_race_data import GameRaceData
        from globalsim_bridge.decision_trace import expand_trace
        from test_sandbox import setup
        master=Path(self.temp.name)/'master.mdb'
        db=sqlite3.connect(master)
        db.executescript('''
            CREATE TABLE race_instance(id INTEGER,race_id INTEGER,time INTEGER);
            CREATE TABLE race(id INTEGER,course_set INTEGER,grade INTEGER);
            CREATE TABLE race_course_set(id INTEGER);
            CREATE TABLE text_data(category INTEGER,[index] INTEGER,text TEXT);
            INSERT INTO text_data VALUES(47,202999,'Future installed skill');
        ''')
        columns=['id INTEGER','group_id INTEGER DEFAULT 1','rarity INTEGER DEFAULT 1',
                 'activate_lot INTEGER DEFAULT 0','icon_id INTEGER DEFAULT 10011']
        for branch in (1,2):
            columns += [f"condition_{branch} TEXT DEFAULT ''",f"precondition_{branch} TEXT DEFAULT ''",
                        f'float_cooldown_time_{branch} INTEGER DEFAULT 5000000',
                        f'float_ability_time_{branch} INTEGER DEFAULT -1',f'ability_time_usage_{branch} INTEGER DEFAULT 1']
            for i in (1,2,3):
                columns += [f'{field}_{branch}_{i} INTEGER DEFAULT {default}' for field,default in
                    [('ability_type',0),('float_ability_value',0),('ability_value_usage',1),
                     ('ability_value_level_usage',0),('target_type',1),('target_value',0),('additional_activate_type',0)]]
        db.execute('CREATE TABLE skill_data('+','.join(columns)+')')
        db.execute("INSERT INTO skill_data(id,condition_1,ability_type_1_1,float_ability_value_1_1) VALUES(202999,'always==1',1,400000)")
        db.commit();db.close()
        reader=GameRaceData(lambda:(master,))
        self.sim.service.game_race_data=reader
        _,first,config,refs=self.current()
        self.assertIn('202999',refs.skill_data)
        self.assertEqual(refs.skill_data['202999']['alternatives'][0]['effects'][0]['modifier'],400000)
        self.assertEqual(config.skill_catalog['presentation']['202999']['name'],'Future installed skill')
        value=setup()
        value['courseId']=10506
        for participant in value['participants']:participant['uma']['skills']=[{'id':202999,'level':1}]
        spec,_=prepare(value,refs);spec['retainAllFrames']=False
        modeled,_,_=_run_worker(config,_canonical(spec)+b'\n')
        self.assertNotIn('error',modeled)
        events=expand_trace(modeled['decisionTrace'])['events']
        self.assertTrue(any(e['kind']=='skill-definition' and e['skillId']=='202999' for e in events))
        stamp=master.stat()
        db=sqlite3.connect(master)
        db.execute('UPDATE skill_data SET float_ability_value_1_1=500000 WHERE id=202999')
        db.execute("INSERT INTO text_data VALUES(47,203999,'Unsupported future mechanic')")
        db.execute("INSERT INTO skill_data(id,condition_1,ability_type_1_1,float_ability_value_1_1) VALUES(203999,'future_condition==1',1,400000)")
        db.commit();db.close()
        os.utime(master,ns=(stamp.st_atime_ns,stamp.st_mtime_ns))
        manifest,second,_,updated=self.current()
        self.assertNotEqual(first['data_sha256'],second['data_sha256'])
        self.assertIn(first,manifest['bundles'])
        self.assertEqual(refs.skill_data['202999']['alternatives'][0]['effects'][0]['modifier'],400000)
        self.assertEqual(updated.skill_data['202999']['alternatives'][0]['effects'][0]['modifier'],500000)
        self.assertNotIn('203999',updated.skill_data)
        self.assertIn('Unsupported condition',self.sim.skill_catalog.rejected['203999'])


if __name__=='__main__':unittest.main()
