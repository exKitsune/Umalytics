"""Read public career UI facts from a selected master; never changes simulator data."""
import argparse, hashlib, json, sqlite3
from pathlib import Path
from public_json import public_json

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--master',type=Path,required=True)
p.add_argument('--output',type=Path,default=Path('src/data/career-reference.json'))
a=p.parse_args()
master=a.master.resolve(strict=True)
if a.output.resolve()==master or master.parent in a.output.resolve().parents: p.error('Output must be outside the source master directory.')
db=sqlite3.connect(master.as_uri()+'?mode=ro&immutable=1',uri=True);db.row_factory=sqlite3.Row
texts=lambda category:{str(r[0]):r[1] for r in db.execute('select [index],text from text_data where category=?',(category,))}
labels=['G','G+','F','F+','E','E+','D','D+','C','C+','B','B+','A','A+','S','S+','SS','SS+']
labels += [f'{rank}{n or ""}' for rank in ['UG','UF','UE','UD','UC','UB','UA','US'] for n in range(10)]
skills={str(r['id']):{'cost':r['need_skill_point'],'group':r['group_id'],'order':r['group_rate'],'rarity':r['rarity']} for r in db.execute('select s.id,s.group_id,s.group_rate,s.rarity,p.need_skill_point from skill_data s left join single_mode_skill_need_point p on p.id=s.id')}
names=texts(75)
supports={str(r['id']):{'name':names.get(str(r['id']),f"Support {r['id']}"),'charaId':r['chara_id'],'rarity':r['rarity'],'type':r['support_card_type'],'command':r['command_id']} for r in db.execute('select * from support_card_data')}
factor_names=texts(147)
effects={}
for r in db.execute('select factor_group_id,target_type,value_1 from succession_factor_effect where target_type=41'): effects.setdefault(r[0],set()).add(r[2])
factors={str(r['factor_id']):{'name':factor_names.get(str(r['factor_id']),f"Factor {r['factor_id']}"),'group':r['factor_group_id'],'stars':r['rarity'],'type':r['factor_type'],'skillIds':sorted(effects.get(r['factor_group_id'],[]))} for r in db.execute('select * from succession_factor')}
relations={}
for r in db.execute('select m.chara_id,m.relation_type,r.relation_point from succession_relation_member m join succession_relation r on r.relation_type=m.relation_type'): relations.setdefault(str(r[0]),{})[str(r[1])]=r[2]
race_names=texts(28)
programs={str(r['id']):{'name':race_names.get(str(r['race_instance_id']),f"Race {r['race_id']}"),'raceId':r['race_id'],'grade':r['grade'],'courseId':r['course_set'],'month':r['month'],'half':r['half']} for r in db.execute('select p.id,p.race_instance_id,p.month,p.half,r.id race_id,r.grade,r.course_set from single_mode_program p join race_instance i on i.id=p.race_instance_id join race r on r.id=i.race_id')}
turns={}
for r in db.execute('select s.id,t.turn,t.year,t.month,t.half from single_mode_scenario s join single_mode_turn t on t.turn_set_id=s.turn_set_id'):
 turns.setdefault(str(r[0]),{})[str(r[1])]=list(r)[2:]
g1_instances={r[0]:race_names.get(str(r[0]),f'Race {r[0]}') for r in db.execute('select i.id from race_instance i join race r on r.id=i.race_id where r.grade=100')}
g1_artwork={r[0]:r[1] for r in db.execute('select i.id,r.thumbnail_id from race_instance i join race r on r.id=i.race_id where r.grade=100 and r.thumbnail_id>0')}
win_names=texts(111);wins={}
for r in db.execute('select * from single_mode_wins_saddle'):
 instances=[r[f'race_instance_id_{i}'] for i in range(1,9) if r[f'race_instance_id_{i}']]
 if instances and all(i in g1_instances for i in instances):
  wins[str(r['id'])]={'name':win_names.get(str(r['id']),''),'races':instances,'condition':r['condition']}
result={'schema':2,'source':{'name':'Installed Global public master career tables','sha256':hashlib.sha256(master.read_bytes()).hexdigest()},'ranks':[{'id':r['id'],'min':r['min_value'],'max':r['max_value'],'label':labels[r['id']-1] if 0<r['id']<=len(labels) else str(r['id'])} for r in db.execute('select * from single_mode_rank')],'skills':skills,'supports':supports,'supportLevels':{str(rarity):[list(r) for r in db.execute('select level,total_exp from support_card_level where rarity=? order by level',(rarity,))] for rarity in [1,2,3]},'scenarios':texts(237),'epithets':texts(130),'factors':factors,'programs':programs,'saddles':win_names,'relations':relations,'turns':turns,'g1Races':g1_instances,'g1Wins':wins}
result['g1Artwork']=g1_artwork
a.output.parent.mkdir(parents=True,exist_ok=True)
a.output.write_text(public_json(json.dumps(result,ensure_ascii=False,separators=(',',':')))+'\n',encoding='utf-8')
print('Career reference:',len(skills),'skills,',len(supports),'supports,',len(factors),'factors,',len(programs),'races')
