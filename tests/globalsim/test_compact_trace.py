"""Shared synthetic wire fixture and strict compact-trace validation."""
import base64
from copy import deepcopy
import json
from pathlib import Path
import struct
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'desktop'))
from globalsim_bridge.decision_trace import (expand_trace,validate_trace,COMPACT_SCHEMA,CORE_INDICES,STATE_INDICES,MOTION_COLUMNS)


def fixture():
    rows=[]
    for tick in (1,2,3):
        r=[0.]*43;r[0]=tick;r[1]=tick/10;r[3]=.1;r[4]=tick*2;r[5]=500;r[7]=20;r[11]=.5;r[13]=30;r[14]=3;r[15]=-1
        r[29]=1 if tick<3 else 0;r[40]=1
        rows.append(r)
    event=dict(sequence=1,lastSequence=2,tick=1,lastTick=2,time=.1,lastTime=.2,count=2,horseIndex=0,stage='activation',skillId='100531',detail=0,kind='condition',data={'passed':False})
    packet=dict(schema=COMPACT_SCHEMA,complete=True,dropped=0,observations=5,strings=['activation','100531','condition'],events=[[1,2,1,2,.1,.2,2,0,0,1,0,2,{'passed':False}]],motionCount=3,motionEncoding='f64le-base64',motionIndices=CORE_INDICES,stateIndices=STATE_INDICES,
        motionData=base64.b64encode(b''.join(struct.pack('<23d',*(r[k] for k in CORE_INDICES)) for r in rows)).decode(),
        states=[[r[0],r[1],0,*(r[k] for k in STATE_INDICES)] for r in (rows[0],rows[2])])
    return {'wire':packet,'events':[event],'motion':rows,'columns':MOTION_COLUMNS}


class CompactTraceTests(unittest.TestCase):
    def test_direct_validation_agrees_with_expanded_validation(self):
        # Exercise every packed numeric column, including invalid runner,
        # blocker, timing and clamp values. The optimized route must retain
        # the old validator's acceptance boundary without expanding rows.
        for column in range(len(CORE_INDICES)):
            for value in (-1., 0., .5, 1., 100., float('nan'), float('inf')):
                wire=fixture()['wire'];raw=bytearray(base64.b64decode(wire['motionData']))
                struct.pack_into('<d',raw,8*column,value)
                wire['motionData']=base64.b64encode(raw).decode()
                try:
                    expected=validate_trace(expand_trace(wire),1) is None
                except (ValueError,TypeError,OverflowError):
                    expected=False
                with self.subTest(column=CORE_INDICES[column],value=value):
                    self.assertEqual(validate_trace(wire,1) is None,expected)

    def test_exact_expansion_and_immutable_wire(self):
        v=fixture();before=deepcopy(v['wire']);expanded=expand_trace(v['wire'])
        self.assertEqual(expanded['motion'],v['motion']);self.assertEqual(expanded['events'],v['events'])
        self.assertEqual(v['wire'],before);self.assertIsNone(validate_trace(v['wire'],1))
        self.assertIs(expand_trace(expanded),expanded)

    def test_malformed_packets_fail_closed(self):
        changes=[lambda v:v.update(motionCount=True),lambda v:v.update(motionCount=100001),lambda v:v.update(motionData=v['motionData'][:-4]),
                 lambda v:v.update(motionData='!'*len(v['motionData'])),lambda v:v['motionIndices'].reverse(),lambda v:v['events'][0].__setitem__(8,99),
                 lambda v:v['events'][0].__setitem__(8,True),lambda v:v['events'][0].__setitem__(0,1.5),lambda v:v['events'][0].__setitem__(7,True),lambda v:v.update(states=[]),lambda v:v['states'][0].__setitem__(0,0),
                 lambda v:v['states'][1].__setitem__(0,2),lambda v:v['states'][1].__setitem__(1,.25),lambda v:v['states'][1].__setitem__(2,1),
                 lambda v:v['states'][0].__setitem__(5,2),lambda v:v.update(observations=6),lambda v:v.update(complete=False)]
        for change in changes:
            with self.subTest(change=change):
                wire=deepcopy(fixture()['wire']);change(wire);self.assertIsNotNone(validate_trace(wire,1))

    def test_nonfinite_and_unknown_runner_are_rejected(self):
        for value in (float('nan'),float('inf')):
            wire=fixture()['wire'];raw=bytearray(base64.b64decode(wire['motionData']));struct.pack_into('<d',raw,8*7,value)
            wire['motionData']=base64.b64encode(raw).decode();self.assertIsNotNone(validate_trace(wire,1))
        self.assertIsNotNone(validate_trace(fixture()['wire'],0))


if __name__=='__main__':
    if '--fixture' in sys.argv:print(json.dumps(fixture()))
    else:unittest.main()
