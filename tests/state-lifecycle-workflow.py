"""Isolated observer drain, authenticated heartbeats, repairs, settings and race IDs."""
import json,os,socket,sys,tempfile,threading,time
from pathlib import Path
from types import SimpleNamespace
from urllib.request import Request,urlopen,build_opener,ProxyHandler
from urllib.error import HTTPError
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'desktop'),str(ROOT/'scripts/proxy')]
from observer import RaceObserver
from service import Service,LocalServer,make_handler
import service as service_module
from storage import atomic_json

def until(predicate,message,seconds=15):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  if predicate():return
  time.sleep(.02)
 raise AssertionError(message)

def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

# Exercise accepted response -> real extraction -> atomic race files -> graceful drain.
with tempfile.TemporaryDirectory(prefix='capture-drain-') as name:
 o=RaceObserver();o.output_path=name;o._trace=lambda *args,**kwargs:None
 started,release=threading.Event(),threading.Event();original=o._export
 def delayed(*args,**kwargs):started.set();assert release.wait(5);return original(*args,**kwargs)
 o._export=delayed
 o.stage='inspect'
 route='/\x75mamusume/room_match/result'
 for i in range(5):
  f=SimpleNamespace(id=str(i),client_conn=SimpleNamespace(id='fixture-client',sni='api.games.\x75mamusume.com'),request=SimpleNamespace(host_header='api.games.\x75mamusume.com',method='POST',scheme='https',port=443,host='api.games.\x75mamusume.com',path=route),response=SimpleNamespace(status_code=200,raw_content=json.dumps({'data':{'race_scenario':'synthetic-'+str(i)}}).encode(),headers={}))
  o.response(f)
 assert started.wait(2) and len(o.pending)==5
 closed=threading.Thread(target=o.done);closed.start()
 time.sleep(.05);assert closed.is_alive(),'Shutdown did not wait for accepted exports'
 release.set();closed.join(5);assert not closed.is_alive()
 races=[json.loads(p.read_text()) for p in Path(name).glob('*.json')]
 assert len(races)==5 and {r['race_scenario'] for r in races}=={'synthetic-'+str(i) for i in range(5)}
 assert not list(Path(name).glob('*.partial'))

# Unchanged observer status is still delivered as a heartbeat, even if the first is lost.
o=RaceObserver();receiver=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);receiver.bind(('127.0.0.1',0));receiver.settimeout(2)
o.status_udp_port=receiver.getsockname()[1]
o._write_status(force=True);receiver.recvfrom(16384)
o._write_status(force=True);assert json.loads(receiver.recvfrom(16384)[0])['status']['state']=='starting'
o.done();receiver.close()

with tempfile.TemporaryDirectory(prefix='state-lifecycle-') as name:
 data=Path(name)/'isolated-data';app=Service(data,no_proxy=True,proxy_port=port())
 app.game_active=lambda:False;app.updater.game_active=app.game_active
 server=LocalServer(('127.0.0.1',0),make_handler(app));app.server=server
 assert server.server_port not in (4317,4327)
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 opener=build_opener(ProxyHandler({}));url=f'http://127.0.0.1:{server.server_port}'
 def api(path,body=None):
  headers={'Origin':url,'X-UmaTrace-CSRF':app.csrf,'Content-Type':'application/json'}
  request=Request(url+'/api/'+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
  try:
   with opener.open(request,timeout=5) as response:return response.status,json.load(response)
  except HTTPError as e:return e.code,json.load(e)
 supervisor=None
 try:
  before=api('settings')[1];disk=app.settings_path.read_bytes()
  assert api('settings',{'collectionEnabled':False,'exportDirectory':'relative-folder'})[0]==400
  assert api('settings')[1]==before and app.settings_path.read_bytes()==disk
  def denied(path,*args,**kwargs):
   if path==app.settings_path:raise OSError('synthetic disk failure')
   return atomic_json(path,*args,**kwargs)
  with patch.object(service_module,'atomic_json',denied):
   assert api('settings',{'collectionEnabled':False})[0]==500
   assert api('preferences',{'theme':'light'})[0]==500
  assert api('settings')[1]==before and app.settings_path.read_bytes()==disk
  assert api('settings',{'anonymizeExports':False})[0]==200

  app.inbox.joinpath('bundle.json').write_text(json.dumps([{'title':x} for x in ['A','B','C']]))
  rows=api('races?summary=1')[1]['races'];prior=next(r for r in rows if r['id']=='bundle~1')
  tags={'capture-bundle~1':['B-tag'],'capture-bundle~2':['C-tag']}
  assert api('preferences',{'raceTags':tags})[0]==200
  assert api('races/delete',{'id':'bundle~0'})[0]==200
  rows=api('races?summary=1')[1]['races'];assert {r['id'] for r in rows}=={'bundle~1','bundle~2'}
  assert next(r for r in rows if r['id']=='bundle~1')['sha256']==prior['sha256']
  assert api('races/bundle~1')[1]['data'][0]['title']=='B'
  assert api('preferences')[1]['raceTags']==tags
  assert api('races/delete',{'id':'bundle~0'})[0]==400
  assert api('races/delete',{'id':'bundle~1'})[0]==200
  assert api('races/bundle~2')[1]['data'][0]['title']=='C'
  assert api('races/delete',{'id':'bundle~2'})[0]==200 and not app.inbox.joinpath('bundle.json').exists()

  # Repair through the actual API resumes the same supervisor after startup failed.
  calls=[]
  def ensure():
   calls.append(1)
   if len(calls)==1:raise ValueError('synthetic certificate fault')
  app.ensure_certificate=ensure;app.certificate=lambda **kwargs:{'exists':True,'trusted':False}
  app.no_proxy=False
  def command(*args):return [sys.executable,str(ROOT/'tests/collector-lifecycle-child.py'),*args]
  if os.name=='nt':(data/'cache/fixture-nested').touch()
  with patch.object(service_module,'command',command):
   supervisor=threading.Thread(target=app.supervise,daemon=True);supervisor.start()
   until(lambda:app.proxy_state=='certificate_error','Certificate fault was not surfaced')
   time.sleep(1.1);assert len(calls)==1 and supervisor.is_alive(),'Supervisor retried prompts or exited'
   import capture_store
   with patch.object(capture_store,'load_store',lambda *a,**k:None):assert api('certificate/prepare',{})[0]==200
   until(lambda:app.proxy_status()['listening'],'Certificate repair did not restart collection')
   child=app.proxy;assert child is not None
   nested=int((data/'cache/fixture-started').read_text())
   if os.name=='nt':assert nested!=child.pid,'The bootloader-style fixture did not fork'
   # Malformed/unauthenticated updates cannot extend a collector lease.
   time.sleep(.2);previous=app.collector_status_at
   sender=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
   sender.sendto(json.dumps({'token':'wrong','status':{'state':'running'}}).encode(),app.status_socket.getsockname());sender.close()
   # Force a synthetic transport stall; only this owned test child is terminated.
   with app.lock:
    (data/'cache/fixture-stall').touch()
    until(lambda:app.proxy_status()['state']=='stalled','Stale collector was still reported ready',9)
    status=api('health')[1]['proxy'];assert not status['listening'] and not status['gameConnected']
    (data/'cache/fixture-stall').unlink()
    # A fresh heartbeat recovers a transient stall before supervision intervenes.
    until(lambda:app.proxy_status()['listening'],'Fresh heartbeat did not recover readiness')
   assert app.proxy is child and child.poll() is None
   # A persistent stall is restarted by the supervisor, using only its own child.
   (data/'cache/fixture-stall').touch()
   until(lambda:child.poll() is not None,'Stalled child was not stopped',20)
   if os.name=='nt':
    import ctypes
    kernel=ctypes.WinDLL('kernel32');kernel.OpenProcess.argtypes=[ctypes.c_uint32,ctypes.c_int,ctypes.c_uint32];kernel.OpenProcess.restype=ctypes.c_void_p;kernel.WaitForSingleObject.argtypes=[ctypes.c_void_p,ctypes.c_uint32];kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    handle=kernel.OpenProcess(0x100000,False,nested)
    if handle:
     try:assert kernel.WaitForSingleObject(handle,0)==0,'A frozen-worker descendant was left running'
     finally:kernel.CloseHandle(handle)
   (data/'cache/fixture-stall').unlink(missing_ok=True)
   until(lambda:app.proxy is not None and app.proxy is not child and app.proxy_status()['listening'],'Collector did not restart',20)
   (data/'cache/fixture-drain').touch()
   app.closed.set();supervisor.join(12);assert not supervisor.is_alive()
   assert (data/'cache/fixture-drained').exists(),'Service killed a fresh drain after its normal stop timeout'
 finally:
  app.shutdown();server.shutdown();server.server_close();app.status_socket.close()
  if supervisor:supervisor.join(12)
print('State lifecycle: accepted exports drained; fresh authenticated heartbeats, stalled-child recovery, certificate repair, atomic settings, and stable race IDs passed.')
