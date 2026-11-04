"""Disposable collector transport fixture; never uses a certificate or game."""
import argparse,json,os,socket,time,subprocess,sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--collector',action='store_true');p.add_argument('--nested',action='store_true');p.add_argument('--stage');p.add_argument('--proxy-port',type=int);p.add_argument('--status-port',type=int);p.add_argument('--data-dir',type=Path);a=p.parse_args()
assert a.proxy_port not in (4317,4327) and a.data_dir.name=='isolated-data'
if os.name=='nt' and (a.data_dir/'cache/fixture-nested').exists() and not a.nested:
 child=subprocess.Popen([sys.executable,__file__,*sys.argv[1:],'--nested'],creationflags=subprocess.CREATE_NO_WINDOW)
 raise SystemExit(child.wait())
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
(a.data_dir/'cache/fixture-started').write_text(str(os.getpid()))
while True:
 if (a.data_dir/'cache/fixture-stall').exists():time.sleep(.1);continue
 if (a.data_dir/'cache/collector.stop').exists():
  if (a.data_dir/'cache/fixture-drain').exists():
   end=time.monotonic()+9
   while time.monotonic()<end:
    s.sendto(json.dumps({'token':os.environ['UMATRACE_STATUS_TOKEN'],'status':{'state':'draining','stage':a.stage,'races_written':5,'activeGameConnections':0}}).encode(),('127.0.0.1',a.status_port));time.sleep(.1)
   (a.data_dir/'cache/fixture-drained').touch()
  break
 s.sendto(json.dumps({'token':os.environ['UMATRACE_STATUS_TOKEN'],'status':{'state':'running','stage':a.stage,'races_written':0,'activeGameConnections':0}}).encode(),('127.0.0.1',a.status_port))
 time.sleep(.1)
