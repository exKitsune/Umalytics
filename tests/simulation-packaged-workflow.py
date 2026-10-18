"""Exercise frozen engine resources and production gate without build tools."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]

parser=argparse.ArgumentParser()
parser.add_argument('executable',type=Path)
parser.add_argument('--capture',type=Path)
parser.add_argument('--engine')
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
executable=args.executable.resolve()
opener=build_opener(ProxyHandler({}))
result={'schemaVersion':1,'executableSha256':hashlib.sha256(executable.read_bytes()).hexdigest(),
        'developerToolchainsOnPath':False,'productionAuthorization':'inference_plan'}
with tempfile.TemporaryDirectory(prefix='umalytics-frozen-analysis-') as temporary:
    root=Path(temporary)
    env={key:value for key,value in os.environ.items() if key not in ('PYTHONHOME','PYTHONPATH','NODE_PATH','CARGO_HOME','RUSTUP_HOME')}
    env['PATH']=str(Path(os.environ['SystemRoot'])/'System32')
    flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
    if args.capture:
        capture=args.capture.resolve();before=hashlib.sha256(capture.read_bytes()).hexdigest()
        output=root/'diagnostic.json'
        command=[str(executable),'--diagnose-capture',str(capture),'--diagnose-output',str(output)]
        if args.engine:command+=['--diagnose-engine',args.engine]
        run=subprocess.run(command,
                           env=env,cwd=root,creationflags=flags,timeout=120)
        assert output.is_file(),f'Frozen diagnostic failed ({run.returncode}).'
        report=json.loads(output.read_bytes())
        assert report['diagnosticOnly'] and not report['productAuthorization']
        assert report['status']=='verified',report.get('error')
        assert run.returncode==0
        assert hashlib.sha256(capture.read_bytes()).hexdigest()==before
        result['diagnostic']={'file':capture.name,'fileSha256':before,'status':report['status'],
            'inputSha256':report['inputSha256'],'identities':report['identities'],
            'allComparedChecksPass':report['comparison']['allComparedChecksPass'],'originalUnchanged':True}
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    url=f'http://127.0.0.1:{port}'
    data=root/'data';(data/'races').mkdir(parents=True)
    capture={'title':'Synthetic frozen gate','race_scenario':'synthetic','original_race':{'schemaVersion':1,'observations':[]}}
    (data/'races/synthetic.json').write_text(json.dumps([capture]))
    child=subprocess.Popen([str(executable),'--serve','--no-proxy','--port',str(port),'--data-dir',str(data)],
                           env=env,cwd=root,creationflags=flags)
    health=None
    def request(path,body=None):
        headers={'Origin':url}
        if body is not None:headers.update({'Content-Type':'application/json','X-UmaTrace-CSRF':health['csrfToken']})
        with opener.open(Request(url+'/api/'+path,data=None if body is None else json.dumps(body).encode(),headers=headers),timeout=20) as response:
            return json.load(response)
    try:
        for _ in range(120):
            try:health=request('health');break
            except OSError:
                assert child.poll() is None,'Frozen service exited early.'
                time.sleep(.25)
        assert health and Path(health['dataDirectory']).resolve()==data.resolve()
        status=request('simulation/status');assert status['eras']==[] and status['engines']==[]
        assert {row['kind'] for row in status['installed']}=={'inference','simulation'}
        for row in status['installed']:
            if row['kind']=='inference':
                for field in ('artifact_sha256','data_sha256'):
                    with opener.open(url+'/api/simulation/artifacts/'+row[field]) as response:
                        assert hashlib.sha256(response.read()).hexdigest()==row[field]
        selected=request('races/synthetic~0')
        assert selected['originalRaceEvidenceSha256']
        job=request('simulation/races/synthetic~0',{'expectedEntrySha256':selected['sha256']})
        for _ in range(200):
            job=request('simulation/races/synthetic~0?jobId='+job['jobId'])
            if job['phase']=='complete':break
            time.sleep(.05)
        assert job['report']['mode']=='inference_plan', job['report'].get('error')
        plan=job['report']['inferencePlan']
        assert plan['provisional'] and plan['provisionalPolicy']['kind']=='replay-analysis'
        assert not job['report']['permissions']['simulatedRecordedCapabilities']
        assert not job['report']['permissions']['unversionedInference']
        assert any(n['code']=='PROVISIONAL_REPLAY_INFERENCE' for n in job['report']['notices'])
        authorized=request('simulation/races/synthetic~0/inference',{'jobId':job['jobId']})
        assert authorized['authorized'] and authorized['plan']==plan
        assert authorized['executionPerformed'] is False
        assert len(authorized['cacheKey'])==64 and len(authorized['uiRevision'])==64
        for url_field,hash_field in [('artifactUrl','artifactSha256'),('dataUrl','dataSha256')]:
            with opener.open(url+authorized[url_field]) as response:
                assert hashlib.sha256(response.read()).hexdigest()==plan['engine']['identity'][hash_field]
        assert not (data/'cache/globalsim').exists()
        assert not (data/'cache/simulation-work').exists()
        result.update(installed=status['installed'],provisionalReplayGatePassed=True,
                      versionedInferenceAuthorizationPassed=True,inferenceArtifactPinsPassed=True)
        if args.capture:
            # Copy the real capture into disposable storage. Production trial
            # policy must work in a frozen install with no source/toolchain.
            (data/'races/real.json').write_bytes(args.capture.read_bytes())
            selected=request('races/real')
            job=request('simulation/races/real',{'expectedEntrySha256':selected['sha256']})
            for _ in range(400):
                job=request('simulation/races/real?jobId='+job['jobId'])
                if job['phase']=='complete':break
                time.sleep(.05)
            assert job['report']['mode']=='verified_simulation', job['report'].get('error')
            assert job['report']['compatibility']['mode']=='simulation_trial'
            assert not job['report']['permissions']['inferenceExecutionPlan']
            details=request('simulation/races/real?jobId='+job['jobId']+'&include=payloads')
            sim=details['report']['simulation']
            assert sim['capabilities']['hiddenState']=='simulated_trace'
            assert sim['identities']['code']['sourceSha256']['decisionTrace'] == hashlib.sha256(
                (ROOT/'desktop/globalsim_bridge/decision_trace.py').read_bytes()).hexdigest()
            trace=sim['modeled']['decisionTrace']
            assert trace['complete'] and trace['dropped']==0 and trace['events'] and trace['motion']
            result.update(productionAuthorization='verified_simulation',unknownTrialTracePassed=True,
                          traceEvents=len(trace['events']),traceMotion=len(trace['motion']),
                          traceSchema=trace['schema'])
    finally:
        if health and child.poll() is None:
            request('app/exit',{})
        try:child.wait(timeout=20)
        except subprocess.TimeoutExpired:child.kill();child.wait()
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'passed':True,'output':str(args.output),'diagnostic':result.get('diagnostic',{}).get('status')}))
