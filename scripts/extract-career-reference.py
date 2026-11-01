"""Read public career UI facts from a selected master; never changes simulator data."""
import argparse, hashlib, json, sqlite3
from pathlib import Path
from public_json import public_json
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
import master_metadata

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--master',type=Path,required=True)
p.add_argument('--output',type=Path,default=Path('src/data/career-reference.json'))
a=p.parse_args()
master=a.master.resolve(strict=True)
if a.output.resolve()==master or master.parent in a.output.resolve().parents: p.error('Output must be outside the source master directory.')
db=sqlite3.connect(master.as_uri()+'?mode=ro&immutable=1',uri=True);db.row_factory=sqlite3.Row
result=master_metadata.career(db, hashlib.sha256(master.read_bytes()).hexdigest())

a.output.parent.mkdir(parents=True,exist_ok=True)
a.output.write_text(public_json(json.dumps(result,ensure_ascii=False,separators=(',',':')))+'\n',encoding='utf-8')
print('Career reference:',len(result['skills']),'skills,',len(result['supports']),'supports,',len(result['factors']),'factors,',len(result['programs']),'races')
