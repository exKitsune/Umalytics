"""Extract cached course lane arrays read-only; all output stays outside game files.

Requires UnityPy and apsw-sqlite3mc. Course maps use installed master rows and
explicit catalog name tokens; normal/story curves remain separate. No game runs.
"""
from pathlib import Path
from datetime import datetime,timezone
import argparse
import hashlib
import json
from public_json import public_json
import math
import re
import sqlite3
import struct

WORKSPACE=Path(__file__).resolve().parents[1]
import apsw
import UnityPy

ASSET_RE=re.compile(r'^race/course/(\d+)/pos/(an_pos_race(\d+)_(\d+)_(\d+)_(\d+)_(\d+)_(\d+))$')
BASE=bytes.fromhex('532b4631e4a7b9473e7cfb')
# Public static Global asset-catalog key; source is recorded below. Not user auth.
META_KEY='c753a5e8f5f78294f7fef57df4a14ffbf9a896cea1d4e09947e0d904e7fde8eaf0'


def sha(data):
 return hashlib.sha256(data).hexdigest()


def file_sha(path):
 digest=hashlib.sha256()
 with path.open('rb') as stream:
  while chunk:=stream.read(1024*1024):digest.update(chunk)
 return digest.hexdigest()


def decrypt_bundle(raw,key):
 if not key:return raw
 mask=bytes(a^b for a in BASE for b in struct.pack('<q',key))
 result=bytearray(raw)
 for index in range(256,len(result)):result[index]^=mask[index%88]
 return bytes(result)


def read_lane(data):
 env=UnityPy.load(data)
 scripts={o.path_id:o.read_typetree() for o in env.objects if o.type.name=='MonoScript'}
 matches=[]
 for obj in env.objects:
  if obj.type.name!='MonoBehaviour':continue
  tree=obj.read_typetree()
  script=scripts.get(tree.get('m_Script',{}).get('m_PathID'),{})
  if script.get('m_ClassName')!='CourseLaneAnim':continue
  keys=tree['key']
  counts={k:len(keys[k]) for k in ('valueX','valueY','valueZ','rotation')}
  if counts['valueX']!=counts['valueZ'] or counts['rotation']!=counts['valueX'] or counts['valueY'] not in (0,counts['valueX']) or not 2<=counts['valueX']<=10001:
   raise ValueError('lane key count mismatch/limit')
  points=list(zip(keys['valueX'],keys['valueY'],keys['valueZ']))
  if any(not math.isfinite(v) for p in points for v in p):raise ValueError('nonfinite coordinate')
  matches.append((tree,points))
 if len(matches)!=1:raise ValueError('expected one CourseLaneAnim')
 return matches[0]


def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--cache',type=Path,required=True)
 parser.add_argument('--master',type=Path)
 parser.add_argument('--reference',type=Path,default=WORKSPACE/'public/data/courses.json')
 parser.add_argument('--output',type=Path,default=WORKSPACE/'research/geometry')
 args=parser.parse_args()
 cache=args.cache.resolve();meta=cache/'meta';master=args.master or cache/'master/master.mdb'
 output=args.output.resolve()
 if output==cache or cache in output.parents or output==master.resolve().parent or master.resolve().parent in output.parents:
  raise ValueError('Output must stay outside source cache/database directories')
 output.mkdir(parents=True,exist_ok=True)
 conn=apsw.Connection(str(meta),flags=apsw.SQLITE_OPEN_READONLY)
 conn.execute("PRAGMA cipher='chacha20'");conn.execute("PRAGMA hexkey='"+META_KEY+"'");conn.execute('PRAGMA query_only=ON')
 rows=list(conn.execute("SELECT n,h,e,d,l FROM a WHERE n LIKE 'race/course/%/pos/an_pos_%'"))
 catalog_count=conn.execute('SELECT count(*) FROM a').fetchone()[0]
 conn.close()
 master_conn=sqlite3.connect(master.resolve().as_uri()+'?mode=ro&immutable=1',uri=True)
 columns=[r[1] for r in master_conn.execute('PRAGMA table_info(race_course_set)')]
 course_rows={str(row[0]):dict(zip(columns,row)) for row in master_conn.execute('SELECT * FROM race_course_set')}
 master_conn.close()
 reference=json.loads(args.reference.read_text(encoding='utf-8-sig'))
 source={'name':'Installed Steam Global serialized CourseLaneAnim assets',
  'extractedAt':datetime.now(timezone.utc).isoformat(),'catalogSha256':file_sha(meta),
  'catalogBytes':meta.stat().st_size,'catalogRows':catalog_count,'masterSha256':file_sha(master),
  'unityPyVersion':UnityPy.__version__,'sqliteCipher':'chacha20',
  'coordinateSpace':'Recorded Unity world-space XYZ; geometry kept separate from race telemetry',
  'assetDecodeReference':'https://github.com/MarshmallowAndroid/\x55mamusumeExplorer',
  'notes':['Game asset data copyright the UM:PD rights holders; no bundles, textures or user account data included.',
    'Catalog presence and installed master definitions do not prove playable availability.',
    'NormalRace=0 and StoryRace=1 metadata enum; course around and ground use zero-based asset tokens.', 'Overrun loops are retained as serialized: some endpoints differ slightly (largest observed 0.323 m); no closure correction applied.']}
 assets={};missing=[];failures=[]
 for name,hash_name,encryption_key,dependencies,size in rows:
  match=ASSET_RE.fullmatch(name)
  if not match:failures.append({'name':name,'error':'unrecognized name tokens'});continue
  track,short,embedded_track,phase,distance,ground,around,path_type=match.groups()
  if track!=embedded_track:raise ValueError('track filename mismatch')
  if not re.fullmatch(r'[A-Z2-7]{32}',hash_name):
   failures.append({'name':name,'error':'invalid asset hash name'});continue
  file=cache/'dat'/hash_name[:2]/hash_name
  if not file.is_file():missing.append({'name':name,'hash':hash_name});continue
  try:
   if file.stat().st_size>8*1024*1024:raise ValueError('bundle size limit')
   raw=file.read_bytes();data=decrypt_bundle(raw,encryption_key)
   tree,points=read_lane(data)
   xz=list(zip(tree['key']['valueX'],tree['key']['valueZ'])); arc_xz=sum(math.dist(a,b) for a,b in zip(xz,xz[1:]))
   gap=math.dist(points[0],points[-1]) if points else math.hypot(tree['key']['valueX'][0]-tree['key']['valueX'][-1],tree['key']['valueZ'][0]-tree['key']['valueZ'][-1])
   assets[short]={'logicalName':name,'trackId':int(track),'phase':int(phase),
    'filenameDistance':int(distance),'groundCode':int(ground),'aroundCode':int(around),
    'pathType':int(path_type),'distance':tree['Distance'],'length':tree['length'],
    'key':tree['key'],'assetHash':hash_name,'sha256':sha(raw),'decodedSha256':sha(data),
    'arcLengthXZ':arc_xz,'firstLastGap':gap,'heightAvailable':bool(points),'dependencies':dependencies}
  except Exception as exc:failures.append({'name':name,'error':type(exc).__name__+': '+str(exc)[:200]})
 research={'schemaVersion':1,'source':source,'assets':assets,'missing':missing,'failures':failures}
 (output/'all-course-assets.json').write_text(public_json(json.dumps(research,separators=(',',':'),allow_nan=False)),encoding='utf8')
 mappings={};mapping_report=[];public_paths={}
 for course_id,course in reference.items():
  row=course_rows.get(course_id)
  if not row:
   mapping_report.append({'courseId':course_id,'status':'missing master row'});continue
  requested=(course['raceTrackId'],course['distance'],course['surface'],course['course'])
  actual=(row['race_track_id'],row['distance'],row['ground'],row['inout'])
  if requested!=actual:
   mapping_report.append({'courseId':course_id,'status':'reference/master mismatch'});continue
  track,distance,surface,around=requested
  short=f'an_pos_race{track}_00_{distance:04}_{surface-1:02}_{around-1}_0'
  asset=assets.get(short)
  if not asset:
   mapping_report.append({'courseId':course_id,'status':'missing normal path','expected':short});continue
  if asset['distance']!=distance or not asset['heightAvailable']:
   mapping_report.append({'courseId':course_id,'status':'missing/mismatched serialized distance or height','expected':short});continue
  def add_path(short_name):
   lane=assets[short_name]
   public_paths[short_name]={'distance':lane['distance'],
    'points':[[round(x,3),round(y,3),round(z,3)] for x,y,z in zip(lane['key']['valueX'],lane['key']['valueY'],lane['key']['valueZ'])],
    'assetHash':lane['assetHash'],'sha256':lane['sha256']}
  add_path(short)
  binding={'path':short,'selection':'primary-serialized-path'}
  loops=[key for key,value in assets.items() if value['trackId']==track and value['phase']==1
    and value['groundCode']==surface-1 and value['aroundCode']==around-1 and value['pathType']==0]
  if course['turn'] in (3,4):
   loops=[]
  if len(loops)==1 and assets[loops[0]]['heightAvailable']:
   binding['loop']=loops[0];add_path(loops[0])
  mappings[course_id]=binding
  mapping_report.append({'courseId':course_id,'status':'mapped','path':short,'loopCandidates':loops,
   'loopBound':binding.get('loop'),'masterGround':surface,'masterInout':around})
 public={'schemaVersion':1,'source':source,'paths':public_paths,'courses':mappings}
 (output/'course-geometry.json').write_text(public_json(json.dumps(public,separators=(',',':'),allow_nan=False)),encoding='utf8')
 tracks=sorted(set(asset['trackId'] for asset in assets.values()))
 master_missing=[]
 for course_id,row in course_rows.items():
  name=f"an_pos_race{row['race_track_id']}_00_{row['distance']:04}_{row['ground']-1:02}_{row['inout']-1}_0"
  if name not in assets:master_missing.append({'courseId':course_id,'expected':name})
 report={'catalogPositionAssets':len(rows),'decodedAssets':len(assets),'tracks':tracks,
  'normalAssets':sum(a['pathType']==0 for a in assets.values()),'storyAssets':sum(a['pathType']==1 for a in assets.values()),
  'masterCourses':len(course_rows),'referenceCourses':len(reference),'mappedCourses':len(mappings),
  'paths':len(public_paths),'loopBindings':sum('loop' in b for b in mappings.values()),
  'masterMissing':master_missing,'missingCached':missing,'failures':failures,'mappings':mapping_report}
 (output/'geometry-extraction-report.json').write_text(public_json(json.dumps(report,indent=2)),encoding='utf8')
 print(json.dumps({k:v for k,v in report.items() if k!='mappings'},indent=2))
 print('Curated geometry bytes:',(output/'course-geometry.json').stat().st_size)


if __name__=='__main__':main()
