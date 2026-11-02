"""HTTP uninstall/reset workflow using disposable storage and actual protected keys."""
from http.server import BaseHTTPRequestHandler
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
import service
import certificate_trust
from capture_identity import LEAF_KEY, ROOT_CERT

with tempfile.TemporaryDirectory(prefix='saved-data-', dir=ROOT / '.cache') as temporary:
    root = Path(temporary)
    data = root / 'app'
    data.mkdir()
    (data / 'settings.json').write_text(json.dumps({'schemaVersion':1,'startAtLogin':True,'collectionEnabled':False,'preferences':{'theme':'light'}}))
    instance = service.Service(data, no_proxy=True)
    server = service.LocalServer(('127.0.0.1',0), BaseHTTPRequestHandler)
    instance.server = server
    server.RequestHandlerClass = service.make_handler(instance)
    thread = threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    opener = build_opener(ProxyHandler({}))
    def call(path, body=None, authorized=True):
        headers={'Origin':origin}
        if body is not None:
            headers.update({'Content-Type':'application/json','X-UmaTrace-CSRF':instance.csrf if authorized else ''})
        try:
            response=opener.open(Request(origin+path,headers=headers,data=json.dumps(body).encode() if body is not None else None),timeout=40)
        except HTTPError as error:
            response=error
        with response:
            return response.status,json.loads(response.read())
    try:
        settings=call('/api/settings')[1]
        assert 'startAtLogin' not in settings and settings['preferences']['theme']=='light'
        assert call('/api/settings',{'startAtLogin':True})[0]==400
        first=call('/api/certificate/prepare',{})[1]
        assert first['exists'] and (data/'capture'/LEAF_KEY).is_file()
        key=(data/'capture'/LEAF_KEY).read_bytes()
        assert b'PRIVATE KEY' not in key
        assert call('/api/certificate/uninstall',{'sha256':'wrong'})[0]==400
        assert (data/'capture'/LEAF_KEY).read_bytes()==key
        # Only the Windows trust-store boundary is simulated: no real root is installed.
        trusted=True
        def trust(der, install=False, uninstall=False):
            global trusted
            if uninstall: trusted=False
            return trusted if not uninstall else True
        with patch.object(certificate_trust,'current_user_trust',side_effect=trust):
            result=call('/api/certificate/uninstall',{'sha256':first['sha256']})
            assert result[0]==200 and result[1]['exists'] is False, result
            assert trusted is False
        assert not (data/'capture'/LEAF_KEY).exists()
        assert (data/'capture/disabled').exists()
        assert not (data/'capture'/ROOT_CERT).exists()
        second=call('/api/certificate/prepare',{})[1]
        assert second['sha256']!=first['sha256'] and not (data/'capture/disabled').exists()
        # Denying removal preserves keys and pauses capture.
        def deny(der, install=False, uninstall=False): return not uninstall
        with patch.object(certificate_trust,'current_user_trust',side_effect=deny):
            assert call('/api/certificate/uninstall',{'sha256':second['sha256']})[0]==400
        assert (data/'capture'/LEAF_KEY).exists() and (data/'capture/disabled').exists()
        call('/api/certificate/prepare',{})
        (data/'races/fixture.json').write_text('{"secret":"race"}')
        (data/'runtime').mkdir()
        (data/'runtime/keep.exe').write_bytes(b'RUNTIME')
        (data/'webview').mkdir()
        (data/'webview/keep').write_bytes(b'BROWSER')
        (data/'cache/webview').mkdir()
        (data/'cache/webview/keep').write_bytes(b'ACTIVE_BROWSER')
        exported=root/'export.json'
        exported.write_bytes(b'EXPORTED')
        assert call('/api/data/delete',{'confirm':'DELETE ALL DATA'},False)[0]==403
        assert call('/api/data/delete',{})[0]==400
        with patch.object(instance,'game_active',return_value=True):
            assert call('/api/data/delete',{'confirm':'DELETE ALL DATA'})[0]==400
        assert (data/'races/fixture.json').exists()
        # Refuse links rather than following them outside the application data.
        import subprocess
        outside=root/'outside';outside.mkdir();(outside/'keep').write_bytes(b'SAFE')
        junction=data/'linked'
        subprocess.run(['cmd','/c','mklink','/J',str(junction),str(outside)],check=True,capture_output=True)
        try:
            assert call('/api/data/delete',{'confirm':'DELETE ALL DATA'})[0]==400
            assert (outside/'keep').read_bytes()==b'SAFE'
        finally:
            junction.rmdir()
        result=call('/api/data/delete',{'confirm':'DELETE ALL DATA'})
        assert result==(200,{'ok':True}),result
        thread.join(5)
        time.sleep(.2)
        assert set(p.name for p in data.iterdir())=={'runtime','webview','cache'},list(data.iterdir())
        assert list((data/'cache').iterdir())==[data/'cache/webview']
        assert exported.read_bytes()==b'EXPORTED'
        instance.diagnostics.event('test_after_delete')
        assert not (data/'logs').exists(),'Shutdown recreated deleted logs'
        assert (data/'runtime/keep.exe').read_bytes()==b'RUNTIME'
    finally:
        if not instance.closed.is_set():instance.shutdown()
        thread.join(5)
        server.server_close()
        instance.status_socket.close()
print('Saved-data workflow passed: retired login setting, certificate/key removal, denied removal, fresh setup, CSRF/confirmation, active-game guard, linked-path refusal, saved-data deletion and runtime/export preservation.')
