"""Independently visualize already extracted local course curves; no game access."""
from pathlib import Path
import hashlib
import json
import os
import numpy as np
os.environ.setdefault('MPLCONFIGDIR',str(Path('.cache/geometry-matplotlib').resolve()))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

source = Path('research/geometry/course-lane-curves.json')
curves = json.loads(source.read_text(encoding='utf8'))
by_name = {c['name']: c for c in curves}
base_name = 'an_pos_race10006_00_2400_00_0_0'
variant_name = 'an_pos_race10006_00_2400_00_0_1'
loop_name = 'an_pos_race10006_01_0000_00_0_0'

def xyz(curve):
    return np.column_stack([curve['key'][k] for k in ('valueX', 'valueY', 'valueZ')])

def position(curve, distance):
    points = xyz(curve)
    phase = distance / curve['distance'] * (len(points)-1)
    index = min(len(points)-2, int(phase))
    return points[index] + (points[index+1]-points[index])*(phase-index)

def lengths(points):
    return np.r_[0, np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))]

def aligned_offsets(base, variant):
    """Local closest-segment projection; do not confuse phase drift with width."""
    normal_offset, shifts = [], []
    for i, point in enumerate(variant):
        lo, hi = max(0, i-8), min(len(base)-1, i+9)
        a, vector = base[lo:hi], base[lo+1:hi+1]-base[lo:hi]
        square = np.sum(vector*vector, axis=1)
        t = np.clip(np.sum((point-a)*vector, axis=1)/square, 0, 1)
        projection = a+vector*t[:,None]
        k = np.argmin(np.sum((point-projection)**2, axis=1))
        tangent = vector[k]/np.sqrt(square[k])
        normal_offset.append((point-projection[k]) @ np.array([tangent[1],-tangent[0]]))
        shifts.append(lo+k+t[k]-i)
    return np.array(normal_offset), np.array(shifts)

base, variant, loop = (by_name[n] for n in (base_name, variant_name, loop_name))
p, v, l = xyz(base), xyz(variant), xyz(loop)
d = np.linspace(0, base['distance'], len(p))
normal_offset, shifts = aligned_offsets(p[:,[0,2]], v[:,[0,2]])
quaternions = np.array([[q[k] for k in ('x','y','z','w')] for q in base['key']['rotation']])
qx,qy,qz,qw = quaternions.T
forward = np.c_[2*(qx*qz+qy*qw), 1-2*(qx*qx+qy*qy)]
right = np.c_[1-2*(qy*qy+qz*qz), 2*(qx*qz-qy*qw)]
tangent = np.gradient(p[:,[0,2]],axis=0)
tangent /= np.linalg.norm(tangent,axis=1)[:,None]
forward /= np.linalg.norm(forward,axis=1)[:,None]
right /= np.linalg.norm(right,axis=1)[:,None]
outward = np.c_[tangent[:,1],-tangent[:,0]]
race_xz=p[:,[0,2]]
segments=np.diff(race_xz,axis=0)
segment_lengths=np.linalg.norm(segments,axis=1)
phase=np.clip(np.sum((race_xz[-1]-race_xz[:-1])*segments,axis=1)/np.sum(segments*segments,axis=1),0,1)
projected=race_xz[:-1]+segments*phase[:,None]
residual=np.linalg.norm(projected-race_xz[-1],axis=1)
early_index=int(np.argmin(residual[:500]))
early_distance=float(lengths(race_xz)[early_index]+phase[early_index]*segment_lengths[early_index])

stats = []
for c in curves:
    q = xyz(c)
    stats.append({'name':c['name'], 'nominalDistance':c['distance'],
        'arcLengthXZ':float(lengths(q[:,[0,2]])[-1]),
        'arcLength3D':float(lengths(q)[-1]),
        'endpointGap3D':float(np.linalg.norm(q[-1]-q[0])),
        'heightRange':float(np.ptp(q[:,1]))})
boundaries = [0,325,575,900,1125,1200,1250,1350,1500,1625,1875,1950,2100,2400]
report = {'source':str(source), 'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
    'curves':stats, 'baseCoordinatesAtNominalRaceMetres':{
        str(distance):position(base,distance).tolist() for distance in boundaries},
    'displayTransform':'Matplotlib horizontal=-X, vertical=-Z; uniform equal aspect; SVG horizontal=-X, vertical=+Z with screen Y down',
    'baseXZStepMinMeanMax':[float(segment_lengths.min()),float(segment_lengths.mean()),float(segment_lengths.max())],
    'earlyFinishPassing':{'xzArcDistance':early_distance,'projectionResidual':float(residual[early_index]),
        'remainingRaceXZArc':float(lengths(race_xz)[-1]-early_distance)},
    'variantMinusBaseXZArcLength':float(lengths(v[:,[0,2]])[-1]-lengths(p[:,[0,2]])[-1]),
    'alignedOutwardOffsetPercentiles':np.percentile(normal_offset,[0,25,50,75,100]).tolist(),
    'localAlignmentShiftSamplePercentiles':np.percentile(shifts,[0,25,50,75,100]).tolist(),
    'quaternionLocalForwardTangentDotPercentiles':np.percentile(np.sum(forward*tangent,axis=1),[0,50,100]).tolist(),
    'quaternionLocalRightOutwardDotPercentiles':np.percentile(np.sum(right*outward,axis=1),[0,50,100]).tolist(),
    'limits':['No downloaded source code executed.', 'Quaternion comparison uses standard Unity quaternion convention as a hypothesis checked against the sampled path.',
        'Asset suffix meanings and simulation lane conversion remain unresolved.', 'Nominal d=index*distance/1000 assumes the uniform sampled phase; base XZ steps independently agree closely with that distance scale.']}
promoted_source=Path('research/geometry/course-geometry.json')
if promoted_source.exists():
    promoted_bytes=promoted_source.read_bytes()
    promoted=json.loads(promoted_bytes)
    promoted_points=np.array(promoted['paths'][base_name]['points'],dtype=float)
    report['currentGeometryExport']={'sha256':hashlib.sha256(promoted_bytes).hexdigest(),
        'courseBindings':len(promoted['courses']),'paths':len(promoted['paths']),
        'loopBindings':sum(bool(c.get('loop')) for c in promoted['courses'].values()),
        'baseMaximumCoordinateRoundingDifference':float(np.max(np.abs(promoted_points-p)))}
Path('research/geometry/tokyo-curve-validation.json').write_text(json.dumps(report,indent=2),encoding='utf8')

plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig=plt.figure(figsize=(13,10),layout='constrained')
grid=fig.add_gridspec(2,2,height_ratios=[2.2,1])
ax=fig.add_subplot(grid[0,:])
ax.plot(-l[:,0],-l[:,2],color='#90969d',ls='--',lw=2,label='Separate closed-loop asset (2095 nominal)')
regions=[(0,325,'Initial home'),(325,900,'Corners 1–2'),(900,1350,'Back straight'),(1350,1875,'Corners 3–4'),(1875,2400,'Final home')]
colors=['#3977b7','#df9442','#50a57a','#9c70c2','#3977b7']
for (start,end,label),color in zip(regions,colors):
    segment=np.linspace(start,end,max(2,int((end-start)/2)+1))
    points=np.array([position(base,float(distance)) for distance in segment])
    ax.plot(-points[:,0],-points[:,2],color=color,lw=2.2,label=label)
for distance,offset in [(325,(12,-16)),(575,(12,5)),(900,(8,12)),(1350,(-5,12)),(1625,(-65,5)),(1875,(-15,-20))]:
    point=position(base,distance)
    ax.scatter(-point[0],-point[2],s=25,color='#283849',zorder=5)
    ax.annotate(f'{distance} m',(-point[0],-point[2]),textcoords='offset points',xytext=offset,fontsize=9)
for point,label,marker,color,offset in [(p[0],'START · 0 m','s','#cd4347',(-20,-25)),(p[-1],'FINISH · 2400 m','D','#263645',(-5,-27))]:
    ax.scatter(-point[0],-point[2],s=80,marker=marker,color=color,zorder=6)
    ax.annotate(label,(-point[0],-point[2]),textcoords='offset points',xytext=offset,fontsize=10,weight='bold')
for distance in (120,720,1080,1550,2150):
    a,b=position(base,distance),position(base,distance+35)
    ax.annotate('',xy=(-b[0],-b[2]),xytext=(-a[0],-a[2]),arrowprops={'arrowstyle':'->','color':'#293b46','lw':1.7})
ax.set_aspect('equal',adjustable='box')
ax.set_ylim(-255,225)
ax.set_xlabel('−X · original asset units (no length rescaling)')
ax.set_ylabel('−Z · original asset units')
ax.set_title('Tokyo turf 2400: extracted game path, rotated into GameTora viewing orientation',weight='bold',pad=14)
ax.legend(loc='upper center',bbox_to_anchor=(.5,-.12),ncol=3,frameon=False,fontsize=9)
ax.grid(alpha=.15)

height=fig.add_subplot(grid[1,0])
height.plot(d,p[:,1],color='#3977b7',label='Suffix 0_0')
height.plot(d,v[:,1],color='#df9442',alpha=.85,label='Suffix 0_1')
height.set_xlabel('Nominal phase distance · 2400 × sample index / 1000')
height.set_ylabel('Y · asset units')
height.set_title('Original mesh/path heights; no event-grade replacement')
height.legend(frameon=False);height.grid(alpha=.15)

delta=fig.add_subplot(grid[1,1])
delta.plot(d,normal_offset,color='#bd7440',lw=1.2)
delta.axhline(0,color='#65717c',lw=.8)
delta.set_xlabel('Nominal phase distance · 2400 × sample index / 1000')
delta.set_ylabel('Signed local outward offset · asset units')
delta.set_title('_0_1 vs _0_0: not a constant outward lane')
delta.grid(alpha=.15)
fig.suptitle('Full-precision local curves '+report['sourceSha256'][:12]+'… · current geometry export '+report.get('currentGeometryExport',{}).get('sha256','unavailable')[:12]+'…',fontsize=10,color='#5a6570')
Path('.cache/reports').mkdir(parents=True,exist_ok=True)
fig.savefig('.cache/reports/tokyo-game-xz-validation.png',dpi=170)
plt.close(fig)
print(json.dumps({k:report[k] for k in ['sourceSha256','variantMinusBaseXZArcLength','alignedOutwardOffsetPercentiles','quaternionLocalForwardTangentDotPercentiles','quaternionLocalRightOutwardDotPercentiles']},indent=2))
