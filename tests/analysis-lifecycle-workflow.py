"""Real worker cancellation, foreground scheduling, and cache-purge publication barriers."""
from dataclasses import replace
import hashlib,importlib.util,json,shutil,sys,tempfile,threading,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'desktop'))
from background_analysis import BackgroundAnalysis
from analysis_cache import AnalysisCache
from globalsim_bridge.runtime import RuntimeConfig,_run_worker,_WorkerFailure
from globalsim_bridge.worker_pool import WorkerPool
spec=importlib.util.spec_from_file_location('fixture',ROOT/'tests/versioned-service-fixture.py');fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
def until(test,message,seconds=15):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  if test():return
  time.sleep(.02)
 raise AssertionError(message)
with tempfile.TemporaryDirectory(prefix='worker-cancellation-') as name:
 folder=Path(name);worker=folder/'worker.py';started=folder/'started'
 worker.write_text("import sys,json,time,os\nfrom pathlib import Path\nfor line in sys.stdin:\n v=json.loads(line)\n if v.get('pause'):\n  Path(v['started']).write_text(str(os.getpid()));time.sleep(30)\n print(json.dumps({'ok':True,'pid':os.getpid()}),flush=True)\n")
 for reusable in (False,True):
  cancel=threading.Event();pool=WorkerPool() if reusable else None
  config=RuntimeConfig(Path(sys.executable),folder,folder,work_root=folder,engine_args=('-u',str(worker)),expected_engine_sha256=hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest(),worker_pool=pool,cancel_event=cancel,timeout_seconds=30,low_priority=True)
  errors=[]
  def run():
   try:_run_worker(config,json.dumps({'pause':True,'started':str(started)}).encode()+b'\n')
   except _WorkerFailure as e:errors.append(e.code)
  thread=threading.Thread(target=run);thread.start();until(started.is_file,'Owned worker never started')
  old_pid=int(started.read_text())
  if pool:
   pool.set_background(False)
   if sys.platform=='win32':
    import ctypes
    kernel=ctypes.WinDLL('kernel32');kernel.GetPriorityClass.argtypes=[ctypes.c_void_p];kernel.GetPriorityClass.restype=ctypes.c_uint32
    assert kernel.GetPriorityClass(int(pool.session.process._handle))==0x20,'Foreground promotion did not change priority'
  began=time.monotonic();cancel.set();thread.join(3)
  assert not thread.is_alive() and errors==['CANCELLED'] and time.monotonic()-began<3
  config=replace(config,cancel_event=threading.Event(),low_priority=False)
  reply,_,_=_run_worker(config,b'{}\n');assert reply['ok'] and reply['pid']!=old_pid
  if pool:pool.close()
  started.unlink()

with tempfile.TemporaryDirectory(prefix='analysis-scheduling-') as name:
 root=Path(name);manifest=json.loads((ROOT/'simulation/installed-bundles.json').read_text());bundle=next(r for r in reversed(manifest['bundles']) if r['kind']=='inference')
 for field in ('artifact','data'):
  target=root/bundle[field];target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/bundle[field],target)
 shutil.copytree(ROOT/'simulation/analysis',root/'simulation/analysis')
 (root/'simulation/installed-bundles.json').write_text(json.dumps({'schemaVersion':1,'bundles':[bundle]}))
 (root/'simulation/engine-registry.json').write_text(json.dumps({'schemaVersion':1,'registryId':'synthetic-lifecycle','eras':[],'engines':[],'futureInferencePolicies':[],'allowReplayInference':True}))
 store=fixture.Store(root);cache=AnalysisCache(store.data_dir);capture=json.loads((ROOT/'tests/fixtures/race.json').read_text())
 def add(name,day):(store.inbox/(name+'.json')).write_text(json.dumps({**capture,'racedAt':f'2026-01-{day:02d}T00:00:00Z'}))
 add('promote',1)
 promote=threading.Event();release=threading.Event();slow=threading.Event();saving=threading.Event();saved_release=threading.Event();starts=[];purge_key=[];seen=set()
 original_run,original_save=BackgroundAnalysis.run,BackgroundAnalysis.save
 def controlled(self,job):
  starts.append(job['raceId'])
  if job['raceId']=='promote~0' and 'promote' not in seen:
   seen.add('promote');promote.set();assert release.wait(5)
  if job['raceId']=='slow~0' and 'slow' not in seen:
   seen.add('slow');slow.set()
   while True:self.checkpoint(job);time.sleep(.01)
  return original_run(self,job)
 def paused_save(self,key,*args,**kwargs):
  if self.active=='purge~0' and 'purge' not in seen:
   seen.add('purge');purge_key.append(key);saving.set();assert saved_release.wait(5)
  return original_save(self,key,*args,**kwargs)
 BackgroundAnalysis.run=controlled;BackgroundAnalysis.save=paused_save
 cache.update({'action':'policy','policy':{'mode':'unlimited','value':1000,'background':True}})
 service=BackgroundAnalysis(store,root)
 body={'revision':bundle['uiRevision']}
 try:
  assert promote.wait(10);service.request('promote~0',body)
  assert service.active_job['foreground'],'Same-race click did not promote active work'
  release.set();until(lambda:service.request('promote~0',body)['phase']=='complete','Promoted job never finished')
  assert starts.count('promote~0')==1,'Promoting the active race duplicated analysis'
  add('slow',3);service.library_changed();assert slow.wait(10)
  add('urgent',2);began=time.monotonic();service.request('urgent~0',body)
  until(lambda:service.request('urgent~0',body)['phase']=='complete','Foreground race remained behind background work')
  assert time.monotonic()-began<5 and not service.failures,'Preemption imposed a failure cooldown'
  add('purge',4);service.library_changed();assert saving.wait(10)
  with store.lock:
   service.changed();cache.update({'action':'policy','policy':{'mode':'unlimited','value':1000,'background':False}});cache.update({'action':'purge'})
  saved_release.set();until(lambda:service.active is None,'Old job never left its publication barrier')
  assert service.read(purge_key[0]) is None and not cache.read()['entries'],'Pre-purge work repopulated the cache'
  until(lambda:service.request('purge~0',body)['phase']=='complete','Fresh analysis could not run after purge')
  # A disk-cache read begun before purge must not restore its old memory entry.
  final=service.request('purge~0',body);service.volatile.clear()
  reading,read_release=threading.Event(),threading.Event();values=[];auth=store.simulation.cache_auth_key
  def blocked_key():reading.set();assert read_release.wait(5);return auth()
  store.simulation.cache_auth_key=blocked_key
  reader=threading.Thread(target=lambda:values.append(service.read(final['key'])));reader.start();assert reading.wait(3)
  with store.lock:service.changed();cache.update({'action':'purge'})
  read_release.set();reader.join(3);store.simulation.cache_auth_key=auth
  assert values==[None] and not service.volatile,'An old cache read resurrected cleared memory'

 finally:
  release.set();saved_release.set();service.close();store.simulation.close();BackgroundAnalysis.run=original_run;BackgroundAnalysis.save=original_save
print('Analysis lifecycle: owned worker cancellation and reuse, priority promotion, foreground preemption, and purge generation barriers passed.')
