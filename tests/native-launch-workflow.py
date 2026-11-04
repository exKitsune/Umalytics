"""Production native game-launch path with an isolated API and harmless child."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time

parser=argparse.ArgumentParser()
parser.add_argument('--harness',type=Path,required=True)
args=parser.parse_args()
harness=args.harness.resolve()
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='native-launch-workflow-') as temporary:
    data=Path(temporary)
    runtime=data/'collector.exe';runtime.write_bytes(b'fixture runtime identity')
    fixture=data/'LauncherFixture.exe'
    compiler=Path(os.environ['WINDIR'])/'Microsoft.NET/Framework/v4.0.30319/csc.exe'
    subprocess.run([str(compiler),'/nologo','/target:exe',f'/out:{fixture}',
        '/reference:System.Runtime.Serialization.dll',str(root/'tests/launcher/LauncherProbe.cs')],check=True,creationflags=subprocess.CREATE_NO_WINDOW)
    digest='a'*64
    status={'app':'UmaTrace','ok':True,'runtimeExecutable':str(runtime),'dataDirectory':str(data),
            'runtimeBuildSha256':digest,'csrfToken':'test-token','proxy':{'running':True,'state':'running','port':43210}}
    registrations=[]
    state={'reject':False,'pending':0}
    class Handler(BaseHTTPRequestHandler):
        protocol_version='HTTP/1.1'
        def log_message(self,*args):pass
        def send(self,value,code=200):
            raw=json.dumps(value).encode();self.send_response(code)
            self.send_header('Content-Length',str(len(raw)));self.send_header('Connection','close');self.end_headers();self.wfile.write(raw)
        def do_GET(self):
            value=status
            if state['pending']:
                state['pending']-=1;value={**status,'proxy':{**status['proxy'],'state':'starting'}}
            self.send(value)
        def do_POST(self):
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            assert self.path=='/api/game/launch-state'
            assert self.headers['Origin']==f'http://127.0.0.1:{server.server_port}'
            assert self.headers['X-UmaTrace-CSRF']=='test-token'
            if state['reject'] and body['active']:self.send({'ok':False},409);return
            registrations.append(body);self.send({'ok':True})
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    output=data/'args.json'
    forwarded=[str(output),'','two words','quote"inside','C:\\ends with slash\\','日本語','%command%','$literal`value','--check']
    env={**os.environ,'HTTP_PROXY':'http://foreign.invalid','https_proxy':'http://foreign.invalid','SSLKEYLOGFILE':'must-not-inherit'}
    def invoke(child=fixture, expected=37):
        output.unlink(missing_ok=True);registrations.clear()
        start=time.perf_counter()
        result=subprocess.run([str(harness),'--launch-game-workflow',str(server.server_port),str(runtime),str(data),digest,'--',str(child),*forwarded],
                              env=env,creationflags=subprocess.CREATE_NO_WINDOW,capture_output=True,timeout=20)
        elapsed=(time.perf_counter()-start)*1000
        assert result.returncode==expected,(result.returncode,result.stderr.decode(errors='replace'))
        return elapsed
    try:
        samples=[]
        for _ in range(5):
            samples.append(invoke())
            record=json.loads(output.read_text())
            assert record['args']==forwarded
            assert not record['console_attached']
            assert Path(record['working_directory']).resolve()==data.resolve()
            assert all(record[k]=='http://127.0.0.1:43210' for k in ('http_proxy','https_proxy','all_proxy'))
            assert record['no_proxy']=='localhost,127.0.0.1,::1'
            assert record['sslkeylogfile'] is None
            assert [r['active'] for r in registrations]==[True,False]
            assert registrations[0]['pid']==registrations[1]['pid']
        state['pending']=3
        assert invoke()>=100, 'Game started before collector readiness'
        for key,value in [('runtimeExecutable',str(fixture)),('dataDirectory',str(data/'foreign')),('runtimeBuildSha256','b'*64)]:
            previous=status[key];status[key]=value
            invoke(expected=1);assert not output.exists() and not registrations
            status[key]=previous
        state['reject']=True
        invoke(expected=1);assert not output.exists() and not registrations
        state['reject']=False
        broken=data/'broken.exe';broken.write_bytes(b'not an executable')
        invoke(broken,1)
        assert [r['active'] for r in registrations]==[True,False], 'Failed launch leaked update exclusion'
        assert env['HTTP_PROXY']=='http://foreign.invalid'
        print(json.dumps({'nativeLauncher':'passed','argumentsAndEnvironment':'passed','foreignRuntimeRejected':'passed',
            'updateExclusion':'passed','failedLaunchUnregistered':'passed','readyWait':'passed','warmLaunchMs':samples}))
    finally:
        server.shutdown();server.server_close();thread.join()
