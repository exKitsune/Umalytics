"""Packed frontend integrity, compatibility, cache invalidation and concurrency."""
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from frontend import DesktopFrontend

with tempfile.TemporaryDirectory() as temporary:
    data=Path(temporary)
    root=data/'runtime/frontend'
    def bundle(assets):
        packed=bytearray(); entries={}
        for name, raw in assets.items():
            compressed=gzip.compress(raw)
            entries[name]=[len(packed),len(compressed),len(raw),hashlib.sha256(raw).hexdigest()]
            packed.extend(compressed)
        manifest=json.dumps(entries).encode()
        folder=root/hashlib.sha256(manifest).hexdigest()
        folder.mkdir(parents=True,exist_ok=True)
        (folder/'manifest.json').write_bytes(manifest)
        (folder/'assets.pack').write_bytes(packed)
        (root/'current.json').write_text(json.dumps({'schemaVersion':2,'bundle':folder.name}))
        return folder
    folder=bundle({'index.html':b'<html>first</html>','assets/app.js':b'const ok=true;','image.png':b'png'})
    frontend=DesktopFrontend(data)
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert all(x[0]==b'<html>first</html>' for x in pool.map(lambda _:frontend.asset('/'),range(40)))
    assert frontend.asset('/assets/app.js')[0]==b'const ok=true;'
    assert frontend.asset('/missing') is None
    assert frontend.asset('/../../settings.json') is None
    assert frontend.asset('/assets\\app.js') is None
    pack=folder/'assets.pack'; good=pack.read_bytes()
    pack.write_bytes(b'broken'+good[6:])
    assert frontend.asset('/') is None, 'Cached content survived a changed archive'
    pack.write_bytes(good)
    assert frontend.asset('/')[0]==b'<html>first</html>'
    manifest=folder/'manifest.json'; saved=manifest.read_bytes()
    manifest.write_bytes(saved.replace(b'index.html',b'other.html'))
    assert frontend.asset('/') is None, 'Unverified manifest accepted'
    manifest.write_bytes(saved)
    assert frontend.asset('/')[0]==b'<html>first</html>'
    bundle({'index.html':b'<html>next</html>'})
    assert frontend.asset('/')[0]==b'<html>next</html>'
    (root/'current.json').write_text('incomplete')
    assert frontend.asset('/')[0]==b'<html>next</html>'
    for invalid in ('[]', 'null', '42'):
        (root/'current.json').write_text(invalid)
        assert frontend.asset('/')[0]==b'<html>next</html>'
    legacy=root/('a'*64); legacy.mkdir(); (legacy/'index.html').write_bytes(b'legacy')
    (root/'current.json').write_text(json.dumps({'schemaVersion':1,'bundle':legacy.name}))
    assert frontend.asset('/')[0]==b'legacy'
    # A valid manifest cannot request an unbounded decompression or out-of-file read.
    for entry in ([0,20,33*1024*1024,'a'*64],[999999,10,2,'a'*64],[-1,10,2,'a'*64]):
        raw=json.dumps({'index.html':entry}).encode(); path=root/hashlib.sha256(raw).hexdigest()
        path.mkdir(); (path/'manifest.json').write_bytes(raw); (path/'assets.pack').write_bytes(b'x'*20)
        (root/'current.json').write_text(json.dumps({'schemaVersion':2,'bundle':path.name}))
        assert frontend.asset('/') is None
print('Packed frontend: verified content, bounded reads, concurrent requests, repair, swaps and legacy compatibility passed.')
