"""Plot extracted routes corresponding to the 14 already inspected GameTora diagrams."""
from pathlib import Path
import hashlib
import json
import os
import numpy as np
os.environ.setdefault('MPLCONFIGDIR',str(Path('.cache/geometry-matplotlib').resolve()))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

source=Path('research/geometry/course-geometry.json')
geometry=json.loads(source.read_text(encoding='utf8'))
references=json.loads(Path('research/geometry/gametora-checked-pages.json').read_text(encoding='utf8'))
courses=json.loads(Path('public/data/courses.json').read_text(encoding='utf8'))
plt.rcParams.update({'font.size':9,'axes.spines.top':False,'axes.spines.right':False})
fig,axes=plt.subplots(5,3,figsize=(15,16),layout='constrained')
measurements=[]
for ax,reference in zip(axes.flat,references):
    course_id=reference['diagram'].rsplit('/',1)[-1].removesuffix('.png')
    mapping=geometry['courses'][course_id]
    path=geometry['paths'][mapping['path']]
    points=np.array(path['points'],dtype=float)
    display=-points[:,[0,2]]
    loop_name=mapping.get('loop')
    # Straight races are compared as straight races, not as their venue's oval.
    if loop_name and courses[course_id]['corners']:
        loop=-np.array(geometry['paths'][loop_name]['points'],dtype=float)[:,[0,2]]
        ax.plot(loop[:,0],loop[:,1],color='#bec4ca',lw=1.4,ls='--')
    colors=['#3677b7','#50a57a','#b27cc6']
    for i in range(3):
        lo=int(i*(len(display)-1)/3);hi=int((i+1)*(len(display)-1)/3)+1
        ax.plot(display[lo:hi,0],display[lo:hi,1],color=colors[i],lw=2)
    ax.scatter(*display[0],marker='s',s=38,color='#c6484c',zorder=5)
    ax.scatter(*display[-1],marker='D',s=32,color='#283849',zorder=6)
    for phase in (.15,.55,.85):
        i=int(phase*(len(display)-1));j=min(len(display)-1,i+12)
        ax.annotate('',xy=display[j],xytext=display[i],arrowprops={'arrowstyle':'->','color':'#263b49','lw':1.5})
    ax.set_aspect('equal',adjustable='datalim')
    ax.margins(.12)
    ax.tick_params(labelsize=7)
    ax.grid(alpha=.12)
    turn=courses[course_id]['turn']
    direction={1:'clockwise',2:'counterclockwise',4:'straight'}.get(turn,'unknown turn')
    ax.set_title(f"{reference['track']} · {courses[course_id]['distance']} m\nCourse {course_id} · {direction}",weight='bold',fontsize=10)
    ax.set_xlabel('−X · asset units',fontsize=8)
    ax.set_ylabel('−Z · asset units',fontsize=8)
    arc=float(np.linalg.norm(np.diff(points[:,[0,2]],axis=0),axis=1).sum())
    measurements.append({'track':reference['track'],'courseId':int(course_id),'path':mapping['path'],
        'loop':loop_name,'nominalDistance':path['distance'],'arcLengthXZ':arc,
        'referencePage':reference['page'],'referenceDiagram':reference['diagram'],
        'referenceScreenshot':reference['file'],'coordinateTransform':'horizontal=-X, vertical=-Z; equal aspect, no metric fit'})
axes.flat[-1].axis('off')
axes.flat[-1].text(0,.8,'Red square: race start\nDark diamond: finish\nArrows: sampled traversal\nColors: route thirds, not race phases\nDashed gray: matching-family loop asset\n\nMismatched/straight loop bindings\nare omitted in the current dataset.\n\nUniform aspect within each venue.\nNo route was warped to the screenshot.\nOriginal extracted coordinates retained.\n\nQualitative comparison covers these\n14 selected routes, not every course.',ha='left',va='top',fontsize=11,linespacing=1.8)
digest=hashlib.sha256(source.read_bytes()).hexdigest()
fig.suptitle('14 Global venues · game-extracted XZ footprints\nRoutes selected from actually inspected GameTora diagram IDs · source SHA-256 '+digest[:16]+'…',fontsize=13,weight='bold')
Path('.cache/reports').mkdir(parents=True,exist_ok=True)
fig.savefig('.cache/reports/global-game-geometry-14.png',dpi=160)
plt.close(fig)
Path('research/geometry/global-geometry-validation.json').write_text(json.dumps({'sourceSha256':digest,'source':geometry['source'],
    'courseBindings':len(geometry['courses']),'paths':len(geometry['paths']),
    'loopBindings':sum(bool(c.get('loop')) for c in geometry['courses'].values()),
    'routes':measurements},indent=2),encoding='utf8')
print(json.dumps({'routes':len(measurements),'sourceSha256':digest,'artifact':'.cache/reports/global-game-geometry-14.png'},indent=2))
