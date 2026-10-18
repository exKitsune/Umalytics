import hashlib
import json
from pathlib import Path
import sys
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'desktop'))
from service import Service
raw=sys.stdin.buffer.read()
race=json.loads(raw)
with tempfile.TemporaryDirectory() as directory:
    service=Service.__new__(Service)
    service.inbox=Path(directory);service._race_metadata={};service._summary_reference_key=None
    service.summary_reference=lambda:({}, {})
    service.summary_course=lambda entry,reference:{}
    ident='local-'+hashlib.sha256(raw).hexdigest()
    service.import_race({'id':ident,'race':race})
    print(json.dumps(service.races(1,ident)[0]['data']))
