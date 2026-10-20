"""Decode career UI artwork from an explicitly supplied cache, read-only."""
import argparse, hashlib, json, re, runpy, sqlite3, sys
from pathlib import Path
from public_json import public_json
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cache',type=Path,required=True);p.add_argument('--output',type=Path,default=Path('public/career'));a=p.parse_args()
cache,output=a.cache.resolve(),a.output.resolve()
if cache==output or cache in output.parents or output in cache.parents:p.error('Output must be separate from the game cache.')
h=runpy.run_path(str(Path(__file__).with_name('extract-course-geometry.py')))
db=h['apsw'].Connection(str(cache/'meta'),flags=h['apsw'].SQLITE_OPEN_READONLY);db.execute("PRAGMA cipher='chacha20'");db.execute("PRAGMA hexkey='"+h['META_KEY']+"'");db.execute('PRAGMA query_only=ON')
rows=list(db.execute("select n,h,e from a where n in ('atlas/rank/rank_tex','atlas/statusrank/statusrank_tex','atlas/common/common_tex') or n like 'supportcard/support%/support_card_s_%'"));db.close()
master=sqlite3.connect((cache/'master/master.mdb').as_uri()+'?mode=ro&immutable=1',uri=True)
race_ids={r[0] for r in master.execute('select distinct thumbnail_id from race where grade=100 and thumbnail_id>0')};master.close()
db=h['apsw'].Connection(str(cache/'meta'),flags=h['apsw'].SQLITE_OPEN_READONLY);db.execute("PRAGMA cipher='chacha20'");db.execute("PRAGMA hexkey='"+h['META_KEY']+"'");db.execute('PRAGMA query_only=ON')
asset_names=[f'race/racetitle/thumb/thum_race_rt_000_{id}_00' for id in sorted(race_ids)]+['uianimation/flash/singlemode/pf_fl_singlemode_badge_knack00']
for name in asset_names:rows.extend(db.execute('select n,h,e from a where n=?',(name,)))
db.close()
output.mkdir(parents=True,exist_ok=True);records=[];missing=0
for name,hashed,key in rows:
 if not re.fullmatch(r'[a-zA-Z0-9]{8,128}',hashed):raise ValueError('Invalid asset hash')
 path=cache/'dat'/hashed[:2]/hashed
 if not path.is_file():missing+=1;continue
 raw=path.read_bytes();env=h['UnityPy'].load(h['decrypt_bundle'](raw,key))
 for obj in env.objects:
  image_name=obj.peek_name() if obj.type.name in ['Sprite','Texture2D'] else ''
  prefixes={'utx_txt_rank_':'rank-','utx_ico_statusrank_':'stat-rank-','utx_ico_charastatus_':'stat-','utx_ico_obtain_':'support-type-'}
  filename=None
  if obj.type.name=='Sprite':
   for prefix,dest in prefixes.items():
    match=re.fullmatch(re.escape(prefix)+r'(\d+)',image_name)
    if match and (prefix!='utx_ico_statusrank_' or name=='atlas/statusrank/statusrank_tex'):filename=dest+str(int(match[1]))+'.png'
  elif obj.type.name=='Texture2D':
   match=re.fullmatch(r'support_card_s_(\d+)',image_name)
   if match:filename='support-'+str(int(match[1]))+'.png'
   race_match=re.fullmatch(r'thum_race_rt_000_(\d+)_00',image_name)
   if race_match:filename='race-'+str(int(race_match[1]))+'.png'
   if image_name=='tx_uTex_fl_singlemode_badge_knack00_0_C':filename='sp.png'
  if filename is None:continue
  destination=output/filename
  if destination.resolve().parent!=output:raise ValueError('Output symlink is outside the destination')
  image=obj.read().image
  if filename=='sp.png':image=image.crop(image.getbbox())
  image.save(destination)
  records.append({'file':filename,'catalogName':name,'bundleSha256':hashlib.sha256(raw).hexdigest(),'sha256':hashlib.sha256(destination.read_bytes()).hexdigest(),'width':image.width,'height':image.height})
(output/'source.json').write_text(public_json(json.dumps({'source':'Installed game asset cache','copyright':'UM:PD rights holders','decoder':'UnityPy '+h['UnityPy'].__version__,'records':records},indent=2))+'\n',encoding='utf-8')
print('Extracted',len(records),'career assets;',missing,'bundles absent')
