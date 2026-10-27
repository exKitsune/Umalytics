from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
import sandbox_inputs as inputs
from sandbox_service import SandboxService, outcome_summary
from globalsim_bridge.runtime import RuntimeConfig
from test_adapter import references

def setup():
    uma = {'id':'uma', 'name':'Build', 'memo':'Notes', 'charaId':1001, 'cardId':100101,
        'stats':dict(speed=1200, stamina=900, power=1000, guts=600, wisdom=800), 'skills':[{'id':11,'level':1}], 'fans':10000, 'careerWins':8}
    return {'schemaVersion':1, 'id':'setup', 'name':'Test', 'courseId':101, 'weather':1, 'ground':1,
        'season':1, 'time':2, 'grade':100, 'seed':123, 'keepSeed':False, 'shuffleGates':True, 'count':3,
        'participants':[{'id':str(i), 'uma':deepcopy(uma), 'surface':'A', 'distance':'S', 'strategyAptitude':'A',
            'strategy':2, 'mood':3, 'randomizeMood':True, 'gate':i+1, 'team':i, 'popularity':i+1} for i in range(9)]}

class CustomInputs(unittest.TestCase):
    def test_saved_aptitudes_and_race_overrides_are_independent(self):
        value=setup();grades=dict(zip(inputs.APTITUDE_KEYS,['A','F','B','S','A','E','C','A','B','G']))
        for p in value['participants']:
            p['uma']['aptitudes']=deepcopy(grades);p['aptitudeOverrides']={}
        value['participants'][0]['aptitudeOverrides']={'distance':'B'}
        cleaned=inputs.setup(value);spec,_=inputs.prepare(cleaned,references())
        self.assertEqual(spec['horses'][0]['distanceAptitude'],'B')
        self.assertEqual(spec['horses'][1]['distanceAptitude'],'S')
        self.assertTrue(all(p['uma']['aptitudes']['mile']=='S' for p in cleaned['participants']))
        changed=references();changed.course_data['101'].update(surface=2,distance=2500)
        spec,_=inputs.prepare(cleaned,changed)
        self.assertEqual(spec['horses'][0]['distanceAptitude'],'B')
        self.assertEqual(spec['horses'][1]['distanceAptitude'],'E')
        self.assertEqual(spec['horses'][1]['surfaceAptitude'],'F')
        with tempfile.TemporaryDirectory() as folder:
            store=SandboxService(SimpleNamespace(data_dir=Path(folder)))
            try:
                store.save({'collection':'umas','record':cleaned['participants'][0]['uma']})
                store.save({'collection':'setups','record':cleaned})
                library=store.library();self.assertEqual(library['umas'][0]['aptitudes'],grades)
                self.assertEqual(library['setups'][0]['participants'][0]['aptitudeOverrides'],{'distance':'B'})
            finally:store.close()
        bad=deepcopy(value);bad['participants'][0]['uma']['aptitudes']['mile']='SS'
        with self.assertRaises(ValueError):inputs.setup(bad)
        bad=deepcopy(value);bad['participants'][0]['aptitudeOverrides']={'unknown':'S'}
        with self.assertRaises(ValueError):inputs.setup(bad)

    def test_outcome_payload_reuses_only_its_pinned_catalog(self):
        import json
        from globalsim_bridge.runtime import _canonical
        value=inputs.setup(setup());variant=deepcopy(value['participants'][0]['uma']);variant['skills']=[]
        value['variations']={'participantId':'0','builds':[variant]}
        job={'id':'measurement','setup':value,'impactSourceId':'original'}
        refs=references()
        with tempfile.TemporaryDirectory() as folder:
            store=SandboxService(SimpleNamespace(data_dir=Path(folder)))
            try:
                def worker(config,payload):
                    actual=json.loads(payload);expected,_=inputs.prepare(value,refs,4)
                    expected.update(retainAllFrames=False,decisionTrace=False,traceConservePower=False)
                    self.assertEqual(actual,expected)
                    return {'results':[{'finishOrder':i,'finishTimeRaw':60+i} for i in range(9)]},.01,''
                with patch('sandbox_service._run_worker',side_effect=worker):
                    result,_=store.execute(job,None,refs,4,True,_canonical(refs.skill_data))
                    self.assertTrue(result['outcomeOnly'])
            finally:store.close()

    def test_shared_mood_overrides_preserve_individual_choices_and_pairing(self):
        value=setup();value['participants'][0].update(mood=1,randomizeMood=False)
        original=deepcopy(value['participants'])
        value['moodOverride']={'mode':'fixed','mood':5}
        saved=inputs.setup(value)
        spec,run=inputs.prepare(saved,references())
        self.assertEqual(run['moods'],[5]*9)
        self.assertEqual([h['mood'] for h in spec['horses']],[2]*9)
        self.assertEqual(saved['participants'],original)
        value['moodOverride']={'mode':'random'}
        saved=inputs.setup(value)
        _,random_run=inputs.prepare(saved,references())
        self.assertEqual(random_run,inputs.prepare(saved,references())[1])
        individually_random=deepcopy(value);individually_random.pop('moodOverride')
        for runner in individually_random['participants']:runner['randomizeMood']=True
        self.assertEqual(random_run['moods'],inputs.prepare(individually_random,references())[1]['moods'])
        self.assertGreater(len(set(random_run['moods'])),1,'Each runner draws independently')
        changed=deepcopy(saved['participants'][0]['uma']);changed['stats']['speed']+=50
        saved['variations']={'participantId':'0','builds':[changed]}
        paired=inputs.prepare(saved,references(),saved['count'])[1]
        self.assertEqual((paired['moods'],paired['gates']),(random_run['moods'],random_run['gates']))
        value.pop('moodOverride')
        self.assertNotIn('moodOverride',inputs.setup(value),'Old setups remain unchanged')
        self.assertEqual(inputs.prepare(value,references())[1]['moods'][0],1)

    def test_shared_mood_validation(self):
        for override in ({'mode':'fixed','mood':0},{'mode':'fixed','mood':6},{'mode':'fixed','mood':True},{'mode':'fixed'},{'mode':'both'},True):
            with self.subTest(override=override),self.assertRaises(ValueError):
                inputs.setup({**setup(),'moodOverride':override})

    def test_exchange_races_use_the_venue_not_surface_or_grade(self):
        refs=references();value=setup()
        refs.skill_data['11']['alternatives'][0]['condition']='is_dirtgrade==1'
        for track,expected in [(10101,True),(10103,True),(10104,True),(10105,True),(10006,False),(10008,False)]:
            for surface in (1,2):
                for grade in (100,300):
                    refs.course_data['101'].update(raceTrackId=track,surface=surface)
                    value['grade']=grade
                    spec,_=inputs.prepare(value,refs)
                    self.assertEqual(spec['isDirtGrade'],expected)
                    self.assertEqual(spec['horses'][0]['skills'][0]['skillId'],'11')

    def test_solo_teams_and_unique_popularity(self):
        value=setup()
        value['participants'][0]['team']=None
        value['participants'][1]['team']=None
        value['participants'][2]['team']=2**31-1
        value['participants'][3]['team']=2**31-1
        spec,_=inputs.prepare(inputs.setup(value),references())
        teams=[h['teamId'] for h in spec['horses']]
        self.assertEqual(teams[:2],[0,1])
        self.assertEqual(teams[2],teams[3])
        self.assertEqual(len(set(teams)),8)
        value['participants'][1]['popularity']=1
        with self.assertRaisesRegex(ValueError,'popularity'):
            inputs.setup(value)

    def test_future_loh_capture_category_is_distinct_from_engine_support(self):
        sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'/'proxy'))
        from race_extract import classify_race,collection_settings
        from globalsim_bridge.adapter import SUPPORTED_CATEGORIES
        for group in ('heroes','league_of_heroes'):
            self.assertEqual(classify_race('/\u0075mamusume/'+group+'/race'),('league-of-heroes','endpoint'))
        self.assertFalse(collection_settings({'categories':{'league-of-heroes':False}})['league-of-heroes'])
        self.assertNotIn('league-of-heroes',SUPPORTED_CATEGORIES,'Capture classification must not assert future engine compatibility')

    def test_outcome_fast_path_skips_analysis_on_both_sides_but_preserves_full_batches(self):
        value=setup();variant=deepcopy(value['participants'][0]['uma']);variant['stats']['speed']+=25
        value['variations']={'participantId':'0','builds':[variant]}
        job={'setup':value,'impactSourceId':'source'}
        self.assertTrue(inputs.outcome_only(job,0))
        self.assertTrue(inputs.outcome_only(job,value['count']))
        self.assertFalse(inputs.outcome_only({'setup':value},0))
        variant['stats']['speed']-=25;variant['skills']=[]
        self.assertTrue(inputs.outcome_only(job,0),'Skill baseline only needs outcomes, just like the changed run')
        self.assertTrue(inputs.outcome_only(job,value['count']))
        variant['stats']['speed']+=25
        self.assertFalse(inputs.outcome_only(job,value['count']),'Do not optimize confounded changes as isolated measurements')

    def test_outcomes_never_invent_missing_metrics(self):
        value=setup();results=[{'finishOrder':i,'finishTimeRaw':60+i} for i in range(9)]
        result=outcome_summary(value,{'index':0},{'results':results})
        self.assertTrue(result['outcomeOnly']);self.assertEqual(result['runners'][0]['place'],1)
        for key in ('traffic','hp','exhausted','fullSpurt','gain','carryover','effectiveness'):
            self.assertIsNone(result['runners'][0][key])
        for key, invalid in [('finishOrder',1),('finishOrder',True),('finishTimeRaw',float('nan'))]:
            broken=deepcopy(results);broken[0][key]=invalid
            with self.assertRaises(ValueError):outcome_summary(value,{}, {'results':broken})

    def test_skill_comparison_never_enters_analysis_on_either_side(self):
        value=setup();changed=deepcopy(value['participants'][0]['uma']);changed['skills']=[]
        value['variations']={'participantId':'0','builds':[changed]}
        job={'setup':inputs.setup(value),'impactSourceId':'source'}
        with tempfile.TemporaryDirectory() as folder:
            store=SandboxService(SimpleNamespace(data_dir=Path(folder)))
            def worker(config,payload):
                import json
                spec=json.loads(payload)
                for key in ('retainAllFrames','decisionTrace','traceConservePower'):
                    self.assertFalse(spec[key])
                return {'results':[{'finishOrder':i,'finishTimeRaw':60+i} for i in range(9)]},.01,''
            try:
                with patch('sandbox_service._run_worker',side_effect=worker),patch('sandbox_service.validate_trace',side_effect=AssertionError('Trace analysis must not run')):
                    for index in (0,value['count']):
                        summary,packed=store.execute(job,None,references(),index,True)
                        self.assertTrue(summary['outcomeOnly']);self.assertIsNone(packed)
            finally:store.close()

    def test_parallel_outcomes_are_bounded_and_cancellation_retains_inflight_results(self):
        value=setup();value['count']=4;changed=deepcopy(value['participants'][0]['uma']);changed['skills']=[]
        value['variations']={'participantId':'0','builds':[changed]}
        job={'id':'parallel','phase':'queued','setup':inputs.setup(value),'impactSourceId':'source','total':8,'seedSchedule':[1,2,3,4]}
        with tempfile.TemporaryDirectory() as folder:
            with patch('sandbox_service.os.cpu_count',return_value=8):
                store=SandboxService(SimpleNamespace(data_dir=Path(folder)))
            arrived,release=threading.Event(),threading.Event();pools=set();guard=threading.Lock()
            def execute(j,config,refs,index,summary_only,skill_payload=None):
                with guard:
                    pools.add(id(config.worker_pool))
                    if len(pools)==4:arrived.set()
                if not release.wait(5):raise AssertionError('Test workers were not released')
                self.assertTrue(summary_only)
                self.assertFalse(config.decode_frames)
                self.assertIsNotNone(skill_payload)
                return {'index':index,'seed':index,'runners':[]},None
            config=RuntimeConfig(Path(folder)/'engine',Path(folder),Path(folder))
            thread=threading.Thread(target=store.run,args=(job,config,references()))
            try:
                with patch.object(store,'execute',side_effect=execute):
                    thread.start();self.assertTrue(arrived.wait(5),'Four independent workers started')
                    store.cancel(job['id']);release.set();thread.join(5)
                self.assertFalse(thread.is_alive())
                saved=store.job(job['id']);self.assertEqual(saved['phase'],'cancelled')
                self.assertEqual([r['index'] for r in saved['runs']],[0,1,4,5])
                self.assertEqual(len(pools),4)
            finally:release.set();thread.join(5);store.close()

    def test_incremental_progress_handles_interleaved_indices_and_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            host=SimpleNamespace(data_dir=Path(folder));store=SandboxService(host)
            store.write_job({'id':'job','phase':'complete','total':6,'setup':setup()})
            def insert(index):
                with store.connect() as db:db.execute('INSERT INTO runs VALUES (?,?,?,?)',('job',index,'{"index":'+str(index)+'}',None))
            try:
                insert(0);insert(3);first=store.job('job')
                insert(1);insert(4);delta=store.job('job',first['runCursor'])
                self.assertEqual([r['index'] for r in delta['runs']],[1,4])
                self.assertEqual(delta['completed'],4);self.assertTrue(delta['runsPartial'])
                self.assertEqual(store.job('job',delta['runCursor'])['runs'],[])
                self.assertEqual(store.job('job',include_runs=False)['runs'],[])
                with self.assertRaises(ValueError):store.job('job',-1)
                self.assertFalse(store.job('job',2**40)['runsPartial'],'Invalid future cursor gets a full snapshot')
            finally:store.close()
            store=SandboxService(host)
            try:
                self.assertEqual(store.job('job',delta['runCursor'])['runs'],[],'A durable cursor survives service restart')
                insert(2);self.assertEqual([r['index'] for r in store.job('job',delta['runCursor'])['runs']],[2])
            finally:store.close()

    def test_fresh_samples_ignore_pinning_and_survive_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            bundle={'kind':'simulation','version':'test','artifact_sha256':'engine','data_sha256':'engine-data'}
            manifest={'bundles':[bundle,{'kind':'inference','data_sha256':'reference'}]}
            host=SimpleNamespace(data_dir=Path(folder),simulation=SimpleNamespace(config=lambda:(None,manifest)))
            original=inputs.setup(setup());original['keepSeed']=True
            changed=deepcopy(original);changed['count']=5
            alternate=deepcopy(original['participants'][0]['uma']);alternate['stats']['speed']+=25
            changed['variations']={'participantId':'0','builds':[alternate]}
            store=SandboxService(host)
            store.write_job({'id':'source','phase':'complete','total':3,'setup':original,'engine':bundle,'referenceKey':'reference'})
            def submit():
                with patch.object(store,'installed',return_value=(bundle,SimpleNamespace(umalytics_root=Path(folder),globalsim_root=Path(folder)))),patch('engine_skill_catalog.ReferenceData.load',return_value=references()),patch.object(store.executor,'submit'):
                    return store.submit({'setup':changed,'impactSourceId':'source'})
            try:
                first=submit();self.assertEqual(len(first['seedSchedule']),5)
                self.assertTrue(all(0<s<2**31-1 for s in first['seedSchedule']))
                self.assertEqual(first['setup']['seed'],original['seed'])
                self.assertTrue(first['setup']['keepSeed'])
                first['phase']='cancelled';store.write_job(first)
            finally:store.close()
            store=SandboxService(host)
            try:
                second=submit()
                reserved={inputs.engine_seed_key(inputs.scheduled_seed(original,i)) for i in range(original['count'])}|set(first['seedSchedule'])
                self.assertTrue(set(second['seedSchedule']).isdisjoint(reserved),'All reserved samples, even cancelled ones, remain excluded after restart')
                for i in range(5):
                    a,am=inputs.prepare(second['setup'],references(),i,second['seedSchedule'])
                    b,bm=inputs.prepare(second['setup'],references(),i+5,second['seedSchedule'])
                    self.assertEqual(am['seed'],bm['seed']);self.assertEqual(am['moods'],bm['moods']);self.assertEqual(am['gates'],bm['gates'])
                    self.assertEqual(a['horses'][1:],b['horses'][1:])
                self.assertEqual(store.job('source')['setup'],original)
            finally:store.close()

    def test_rng_seed_aliases_and_interleaved_curve_order(self):
        self.assertEqual(inputs.engine_seed_key(-123),inputs.engine_seed_key(123))
        self.assertEqual(inputs.engine_seed_key(-2**31),inputs.engine_seed_key(2**31-1))
        self.assertEqual(inputs.execution_order({'total':6,'setup':{'count':2},'seedSchedule':[1,2]}),[0,2,4,1,3,5])
        self.assertEqual(inputs.execution_order({'total':6,'setup':{'count':2}}),list(range(6)))
        # Force a mirrored collision before accepting a genuinely new draw.
        with patch('sandbox_inputs.random.SystemRandom') as rng:
            rng.return_value.randrange.side_effect=[123,456,456,789]
            self.assertEqual(inputs.fresh_seed_schedule(2,{-123}),[456,789])

    def test_partial_interleaved_races_are_indexed_by_run_id(self):
        with tempfile.TemporaryDirectory() as folder:
            store=SandboxService(SimpleNamespace(data_dir=Path(folder)))
            value=inputs.setup(setup());value['count']=2
            alternate=deepcopy(value['participants'][0]['uma']);alternate['stats']['speed']+=25
            value['variations']={'participantId':'0','builds':[alternate]}
            job={'id':'curve','phase':'queued','total':4,'setup':value,'seedSchedule':[123,456],'engine':{}}
            store.write_job(job)
            def execute(j,config,refs,index,summary_only):
                if index==2:store.cancelled.add(j['id'])
                return {'index':index,'seed':123,'runners':[{'id':'0','place':1,'time':50+index}]},None
            try:
                with patch.object(store,'execute',side_effect=execute):store.run(job,None,None)
                saved=store.job('curve')
                self.assertEqual([r['index'] for r in saved['runs']],[0,2])
                self.assertEqual(saved['phase'],'cancelled')
                with patch.object(store.render_executor,'submit'):
                    store.open_run({'jobId':'curve','index':2})
                    with self.assertRaisesRegex(ValueError,'not finished'):store.open_run({'jobId':'curve','index':1})
                with patch.object(store,'installed',return_value=({},SimpleNamespace(umalytics_root=Path(folder),globalsim_root=Path(folder)))),patch('engine_skill_catalog.ReferenceData.load'),patch.object(store,'execute',return_value=(saved['runs'][1],b'dashboard')):
                    store.render(saved,2)
                self.assertEqual(store.dashboard('curve',2),b'dashboard')
            finally:store.close()

    def test_only_unique_skills_have_effect_levels(self):
        value=setup()
        value['participants'][0]['uma']['skills']=[{'id':11,'level':5},{'id':22,'level':4}]
        spec,_=inputs.prepare(inputs.setup(value),references())
        self.assertEqual([s['level'] for s in spec['horses'][0]['skills']],[1,4])

    def test_impact_measurement_must_keep_source_field(self):
        original=inputs.setup(setup());changed=deepcopy(original)
        alternate=deepcopy(changed['participants'][0]['uma']);alternate['stats']['speed']+=20
        changed['count']=10;changed['variations']={'participantId':'0','builds':[alternate]}
        inputs.validate_impact_source(changed,original)
        for key,value in [('weather',2),('seed',456),('shuffleGates',False)]:
            bad=deepcopy(changed);bad[key]=value
            with self.assertRaises(ValueError):inputs.validate_impact_source(bad,original)
        bad=deepcopy(changed);bad['participants'][1]['uma']['stats']['power']+=20
        with self.assertRaises(ValueError):inputs.validate_impact_source(bad,original)

    def test_seed_mood_gate_reproducibility_and_independence(self):
        value=inputs.setup(setup());refs=references()
        first,meta=inputs.prepare(value,refs,0)
        self.assertEqual((first,meta),inputs.prepare(value,refs,0))
        self.assertEqual(meta['seed'],123)
        self.assertEqual(sorted(meta['gates']),list(range(1,10)))
        self.assertEqual(len({inputs.prepare(value,refs,i)[1]['seed'] for i in range(1000)}),1000)
        value['shuffleGates']=False
        self.assertEqual(inputs.prepare(value,refs,0)[1]['moods'],meta['moods'])
        value['shuffleGates']=True
        for p in value['participants']:p['randomizeMood']=False
        fixed,again=inputs.prepare(value,refs,0)
        self.assertEqual(again['gates'],meta['gates'])
        self.assertEqual(again['moods'],[3]*9)
        self.assertTrue(fixed['wisdomChecks'])
        self.assertEqual(fixed['horses'][0]['mood'],0)
        self.assertEqual(fixed['horses'][0]['distanceAptitude'],'S')

    def test_limits_and_unsupported_inputs_fail_explicitly(self):
        for key,value in [('seed',2**31),('count',1001),('weather',None),('shuffleGates',1)]:
            bad=setup();bad[key]=value
            with self.assertRaises(ValueError):inputs.setup(bad)
        bad=setup();bad['participants'][1]['gate']=1
        with self.assertRaises(ValueError):inputs.setup(bad)
        bad=setup();bad['participants'][0]['uma']['skills']=[{'id':9999,'level':1}]
        with self.assertRaisesRegex(ValueError,'not supported'):inputs.prepare(inputs.setup(bad),references())
        bad=setup();bad['participants'][0]['uma']['stats']['speed']=None
        with self.assertRaises(ValueError):inputs.setup(bad)

    def test_variants_pair_seeds_and_conditions_without_mutating_base(self):
        value=setup();alternate=deepcopy(value['participants'][0]['uma']);alternate['stats']['stamina']=500
        value['variations']={'participantId':'0','builds':[alternate]};value=inputs.setup(value)
        original,first=inputs.prepare(value,references(),1)
        variant,second=inputs.prepare(value,references(),value['count']+1)
        self.assertEqual(first['seed'],second['seed']);self.assertEqual(first['moods'],second['moods']);self.assertEqual(first['gates'],second['gates'])
        self.assertEqual(original['horses'][0]['stamina'],900);self.assertEqual(variant['horses'][0]['stamina'],500)
        self.assertEqual(value['participants'][0]['uma']['stats']['stamina'],900)
        self.assertEqual(variant['horses'][1:],original['horses'][1:])

    def test_library_organization_is_atomic_and_does_not_change_setups(self):
        with tempfile.TemporaryDirectory() as folder:
            service=SimpleNamespace(data_dir=Path(folder))
            store=SandboxService(service)
            try:
                race=setup();uma=race['participants'][0]['uma']
                directory={'id':'sprint','name':'Sprint tests','color':'#7cb9ed','icon':'race'}
                store.save({'collection':'folders','record':directory})
                store.save({'collection':'setups','record':race})
                for key in ['first','second']:
                    store.save({'collection':'umas','record':{**uma,'id':key,'folderId':'sprint','tags':['Sprint','sprint','Ready'],'favorite':True}})
                rows={u['id']:u for u in store.library()['umas']}
                self.assertEqual(rows['first']['tags'],['Sprint','Ready'])
                created=rows['first']['createdAt']
                # Loading an old setup then saving must not discard organization.
                store.save({'collection':'umas','record':{**uma,'id':'first'}})
                self.assertEqual(next(u for u in store.library()['umas'] if u['id']=='first')['folderId'],'sprint')
                with self.assertRaises(ValueError):
                    store.save({'collection':'umas','action':'bulk','ids':['first','missing'],'patch':{'archived':True}})
                self.assertFalse(any(u['archived'] for u in store.library()['umas']),'Failed bulk mutations roll back completely')
                store.save({'collection':'umas','action':'bulk','ids':['first','second'],'patch':{'archived':True,'addTags':['Experiment'],'removeTags':['READY']}})
                self.assertTrue(all(u['archived'] and u['tags']==['Sprint','Experiment'] for u in store.library()['umas']))
                store.save({'collection':'folders','remove':'sprint'})
                self.assertTrue(all(u['folderId']=='' for u in store.library()['umas']))
                self.assertEqual(next(u for u in store.library()['umas'] if u['id']=='first')['createdAt'],created)
                self.assertEqual(store.library()['setups'][0],inputs.setup(race))
            finally:store.close()
            reopened=SandboxService(service)
            try:
                self.assertEqual(len(reopened.library()['umas']),2)
                self.assertTrue(all(u['favorite'] and u['archived'] for u in reopened.library()['umas']))
            finally:reopened.close()

    def test_library_import_and_validation_preserve_existing_builds(self):
        with tempfile.TemporaryDirectory() as folder:
            store=SandboxService(SimpleNamespace(data_dir=Path(folder)))
            try:
                uma=setup()['participants'][0]['uma']
                directory={'id':'sprint','name':'Sprint','color':'#7cb9ed','icon':'race'}
                store.save({'collection':'folders','record':directory})
                store.save({'collection':'umas','record':uma})
                imported={**uma,'folderId':'external','favorite':True,'tags':['Ready'],'stats':{**uma['stats'],'speed':800}}
                bundle={'collection':'umas','action':'import','records':[imported],'folders':[{**directory,'id':'external'}]}
                store.save(bundle)
                saved=store.library()
                self.assertEqual(len(saved['folders']),1,'Reuse local folders by name')
                original=next(u for u in saved['umas'] if u['id']==uma['id'])
                copy=next(u for u in saved['umas'] if u['id']!=uma['id'])
                self.assertEqual(original['stats']['speed'],1200)
                self.assertEqual(copy['stats']['speed'],800)
                self.assertEqual(copy['folderId'],'sprint')
                self.assertTrue(copy['favorite'])
                self.assertNotIn('folderId',inputs.build(copy),'Library metadata never enters engine setup snapshots')
                for invalid in [
                    {'collection':'folders','record':{**directory,'id':'other','name':'SPRINT'}},
                    {'collection':'folders','record':{**directory,'color':'red;position:fixed'}},
                    {'collection':'umas','record':{**uma,'tags':['x'*41]}},
                    {'collection':'umas','record':{**uma,'favorite':'yes'}},
                    {'collection':'umas','action':'bulk','ids':[uma['id']],'patch':{'folderId':'missing'}},
                    {**bundle,'records':[imported,None]},
                ]:
                    with self.assertRaises(ValueError):store.save(invalid)
                self.assertEqual(store.library(),saved,'Invalid imports and metadata are atomic')
            finally:store.close()

    def test_library_keeps_builds_separate_and_survives_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            service=SimpleNamespace(data_dir=Path(folder))
            store=SandboxService(service)
            try:
                value=inputs.setup(setup());uma=value['participants'][0]['uma']
                grades=dict(zip(inputs.APTITUDE_KEYS,['A','F','B','S','A','E','C','A','B','G']))
                store.save({'collection':'umas','record':{**uma,'mood':5,'strategy':4,'aptitudes':grades}})
                store.save({'collection':'setups','record':value})
                uma['stats']['speed']=500
                store.save({'collection':'umas','record':uma})
                saved=store.library()
                self.assertNotIn('mood',saved['umas'][0]);self.assertNotIn('strategy',saved['umas'][0])
                self.assertEqual(saved['umas'][0]['aptitudes'],grades,'Older editor payloads must preserve saved aptitudes')
                self.assertEqual(saved['setups'][0]['participants'][0]['uma']['stats']['speed'],1200)
                store.write_job({'id':'job','phase':'running','total':3,'setup':value})
                store.write_job({'id':'impact','phase':'complete','total':6,'setup':value,'impactSourceId':'job'})
            finally:store.close()
            second=SandboxService(service)
            try:
                self.assertEqual(second.library()['umas'][0]['stats']['speed'],500)
                self.assertEqual(second.job('job')['phase'],'interrupted')
                self.assertEqual([j['id'] for j in second.impacts('job')],['impact'])
                self.assertEqual([j['id'] for j in second.jobs()],['job'],'Completed measurements must not crowd out race history')
                second.save({'collection':'umas','remove':uma['id']})
                self.assertEqual(second.library()['umas'],[])
            finally:second.close()

if __name__=='__main__':unittest.main()
