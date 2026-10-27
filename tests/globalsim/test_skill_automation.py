from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from test_adapter import references
from test_sandbox import setup
import sandbox_inputs as inputs
from sandbox_service import SandboxService
from skill_automation import coverage, next_setup, removed_skills, impact_view, BackgroundBusy, DEFAULT_PAIRS


def source():
    draft = inputs.setup(setup())
    draft['participants'] = draft['participants'][:2]
    for p in draft['participants']:
        p['uma']['skills'] = [{'id':11,'level':1},{'id':22,'level':3}]
    return {'id':'source','phase':'complete','name':'Fixture','createdAt':'2026-10-26',
        'setup':draft,'total':draft['count'],'engine':{'kind':'simulation','artifact_sha256':'engine','data_sha256':'data','version':'test'},'referenceKey':'ref'}


class AutomaticSkills(unittest.TestCase):
    def test_cached_coverage_reloads_changed_jobs_and_keeps_pair_deduplication(self):
        original=source();planned=next_setup(original,{})
        def run(index,variant,seed):
            return {'index':index,'variantIndex':variant,'seed':seed,'moods':[3,3],'gates':[1,2],
                'runners':[{'id':'0','place':1,'time':50},{'id':'1','place':2,'time':51}]}
        with tempfile.TemporaryDirectory() as folder:
            store=SandboxService(SimpleNamespace(data_dir=Path(folder)))
            try:
                store.write_job(original)
                for key,seed in [('a',42),('b',-42)]:
                    store.write_job({**original,'id':key,'setup':planned,'impactSourceId':'source','total':300})
                    for item in [run(0,0,seed),run(100,1,seed)]:store.save_run(key,item['index'],(item,None))
                expected=coverage(original,store.impacts('source'))
                self.assertEqual(store.auto_skills.sample_counts(original)[0],expected)
                with patch.object(store,'job',wraps=store.job) as read:
                    self.assertEqual(store.auto_skills.sample_counts(original)[0][('0',11)],1)
                    self.assertFalse(any(call.kwargs.get('include_runs',True) for call in read.call_args_list),'Unchanged jobs do not reread outcome rows')
                store.save_run('a',200,(run(200,2,42),None))
                self.assertEqual(store.auto_skills.sample_counts(original)[0],coverage(original,store.impacts('source')))
                changed=deepcopy(original);changed['engine']['artifact_sha256']='different'
                self.assertTrue(all(n==0 for n in store.auto_skills.sample_counts(changed)[0].values()))
            finally:store.close()

    def test_plan_shares_baseline_but_never_changes_stats_or_race_context(self):
        original = source()
        planned = next_setup(original, {('0',11):500})
        self.assertEqual(DEFAULT_PAIRS,100)
        self.assertEqual(planned['count'],100)
        self.assertEqual(removed_skills(planned),[(1,'0',22)])
        inputs.validate_impact_source(planned, original['setup'])
        self.assertTrue(inputs.outcome_only({'setup':planned,'impactSourceId':'source'},0))
        self.assertEqual(planned['participants'],original['setup']['participants'])
        group = next_setup(original,{})
        self.assertEqual(len(group['variations']['builds']),2)
        self.assertEqual(group['count']*(1+len(group['variations']['builds'])),300)
        self.assertEqual(next_setup(original,{(pid,sid):100 for pid in ('0','1') for sid in (11,22)}),None)

    def test_coverage_uses_complete_unique_pairs_and_matching_engine(self):
        original=source();planned=next_setup(original,{})
        run=lambda variant,seed:{'index':variant*100,'variantIndex':variant,'seed':seed,'moods':[3,3],'gates':[1,2],
            'runners':[{'id':'0','place':1,'time':50,'skills':[]},{'id':'1','place':2,'time':51,'skills':[]}]}
        job={**original,'setup':planned,'runs':[run(0,42),run(1,42),run(2,43)]}
        repeated={**job,'runs':[run(0,-42),run(1,-42)]}
        self.assertEqual(coverage(original,[job,repeated])[('0',11)],1)
        self.assertEqual(coverage(original,[job])[('0',22)],0,'An unpaired result cannot count')
        self.assertEqual(coverage(original,[{**job,'engine':{}}])[('0',11)],0)
        self.assertEqual(len(impact_view(job)['runs'][0]['runners']),1)

    def test_pause_resume_keeps_seeds_and_fills_only_missing_runs(self):
        with tempfile.TemporaryDirectory() as folder, patch('skill_automation.DEFAULT_PAIRS',5):
            original=source();manifest={'bundles':[original['engine'],{'kind':'inference','data_sha256':'ref'}]}
            host=SimpleNamespace(data_dir=Path(folder),simulation=SimpleNamespace(config=lambda:(None,manifest)))
            store=SandboxService(host);store.write_job(original);store.impact_concurrency=1
            config=SimpleNamespace(umalytics_root=Path(folder),globalsim_root=Path(folder))
            refs=references();seen=[]
            def outcome(job,config,refs,index):
                _, run=inputs.prepare(job['setup'],refs,index,job['seedSchedule']);seen.append(index)
                if len(seen)==1:store.auto_skills.ensure('source',False)
                return {**run,'runners':[{'id':'0','place':1,'time':50,'skills':[]},{'id':'1','place':2,'time':51,'skills':[]}]},None
            try:
                with patch.object(store,'installed',return_value=(original['engine'],config)),patch('engine_skill_catalog.ReferenceData.load',return_value=refs),patch.object(store,'execute_outcome',side_effect=outcome):
                    store.auto_skills.ensure('source')
                    store.auto_skills.process('source')
                    first=store.impacts('source')[0]
                    self.assertEqual(first['phase'],'cancelled')
                    self.assertEqual(first['completed'],1)
                    self.assertFalse(store.auto_skills.ensure('source')['enabled'],'Reopening results respects pause')
                    store.auto_skills.ensure('source',True)
                    store.auto_skills.process('source')
                    resumed=store.impacts('source')[0]
                    self.assertEqual(resumed['phase'],'complete')
                    self.assertEqual(resumed['seedSchedule'],first['seedSchedule'])
                    self.assertEqual(len(seen),len(set(seen)))
                    self.assertEqual(store.auto_skills.status('source')['completeSkills'],2)
                    store.foreground_idle.clear()
                    with self.assertRaises(BackgroundBusy):store.auto_skills.process('source')
                    store.foreground_idle.set()
            finally:store.close()
            reopened=SandboxService(host)
            try:
                self.assertEqual(reopened.auto_skills.status('source')['completeSkills'],2)
                self.assertEqual(len(reopened.impacts('source')),1)
            finally:reopened.close()

    def test_background_yields_between_bounded_inflight_races(self):
        with tempfile.TemporaryDirectory() as folder:
            store=SandboxService(SimpleNamespace(data_dir=Path(folder)))
            original=source();planned=next_setup(original,{})
            planned['count']=2
            job={**original,'id':'auto','setup':planned,'phase':'queued','total':6,'autoImpact':True,'impactSourceId':'source','seedSchedule':[10,20]}
            store.write_job(job);store.impact_concurrency=1
            entered,release=threading.Event(),threading.Event();seen=[]
            def outcome(job,config,refs,index):
                seen.append(index)
                if len(seen)==1:entered.set();release.wait(3)
                return {'index':index,'runners':[]},None
            try:
                with patch.object(store,'execute_outcome',side_effect=outcome):
                    worker=threading.Thread(target=store.run_outcomes,args=(job,None,None));worker.start()
                    self.assertTrue(entered.wait(3));store.foreground_idle.clear();release.set();time.sleep(.12)
                    self.assertEqual(len(seen),1,'Foreground work stops new background submissions')
                    self.assertEqual(store.job('auto')['completed'],1,'Progress commits while the batch connection stays open')
                    store.foreground_idle.set();worker.join(4);self.assertFalse(worker.is_alive())
                    self.assertEqual(len(seen),6)
            finally:release.set();store.close()


if __name__=='__main__':unittest.main()
