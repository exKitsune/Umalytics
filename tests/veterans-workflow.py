"""A complete roster replaces its predecessor; failures and partial lists do not."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from veterans import VeteranStore, record_veterans

ROUTE = '/\x75mamusume/trained_chara/load'


def payload(count):
    return {'data': {'trained_chara_array': [dict(trained_chara_id=i+1,card_id=100101,
        speed=1200,stamina=800,power=1000,guts=500,wiz=900,skill_array=[{'skill_id':200001,'level':1}],
        future_field={'preserved':True}) for i in range(count)]}}


class VeteranTests(unittest.TestCase):
    def test_complete_partial_and_out_of_order(self):
        with tempfile.TemporaryDirectory() as folder:
            store = VeteranStore(folder)
            self.assertIsNone(store.get()['capturedAt'])
            self.assertTrue(record_veterans(folder,payload(249),ROUTE,'2026-10-27T04:57:35+00:00'))
            value=store.get()
            self.assertEqual(value['count'],249)
            self.assertTrue(value['veterans'][0]['future_field']['preserved'])
            self.assertNotIn('veterans',store.get(value['capturedAt']))
            self.assertTrue(store.get(value['capturedAt'])['unchanged'])
            self.assertNotIn('veterans',store.get(summary=True))
            partial=payload(2);partial['data']['has_next']=True
            invalid=payload(2);del invalid['data']['trained_chara_array'][1]['wiz']
            duplicate=payload(2);duplicate['data']['trained_chara_array'][1]['trained_chara_id']=1
            failed=payload(0);failed['data_headers']={'result_code':101}
            for body,route in [(partial,ROUTE),(invalid,ROUTE),(duplicate,ROUTE),(failed,ROUTE),(payload(1),'/other/response'),({},ROUTE)]:
                self.assertFalse(record_veterans(folder,body,route,'2026-10-27T05:00:00Z'))
            self.assertFalse(record_veterans(folder,payload(2),ROUTE,'2026-10-26T05:00:00Z'))
            self.assertEqual(store.get()['count'],249)
            self.assertTrue(record_veterans(folder,payload(0),ROUTE,'2026-10-28T05:00:00Z'))
            self.assertEqual(store.get()['veterans'],[])
            self.assertIsNotNone(store.get()['capturedAt'])

    def test_archive_recovery_uses_last_full_roster_not_last_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);responses=root/'cache/responses';responses.mkdir(parents=True)
            (responses/'full.json').write_text(json.dumps({'body':payload(3)}))
            (responses/'partial.json').write_text(json.dumps({'body':{'data':{'something_else':[]}}}))
            records=[{'at':'2026-10-27T01:00:00Z','route':ROUTE,'file':'full.json'},
                     {'at':'2026-10-27T02:00:00Z','route':ROUTE,'file':'partial.json'},
                     {'at':'2026-10-27T03:00:00Z','route':ROUTE,'failure':'structure_limit'}]
            (root/'cache/api-trace.jsonl').write_text(''.join(json.dumps(v)+'\n' for v in records))
            self.assertEqual(VeteranStore(root).get()['count'],3)
            (root/'cache/api-trace.jsonl').unlink()
            self.assertEqual(VeteranStore(root).get()['count'],3)

    def test_favorites_and_memos_recovered_from_same_capture(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);responses=root/'cache/responses';responses.mkdir(parents=True)
            body=payload(2)
            # Order differs from the roster, and stale favorites can outlive a Veteran.
            body['data']['trained_chara_favorite_array']=[
                {'trained_chara_id':2,'icon_type':9,'memo':'Mile candidate'},
                {'trained_chara_id':1,'icon_type':5,'memo':''},
                {'trained_chara_id':999,'icon_type':1,'memo':'Removed Veteran'}]
            when='2026-10-27T04:57:35+00:00'
            self.assertTrue(record_veterans(root,body,ROUTE,when))
            path=root/'veterans/latest.json'
            old=json.loads(path.read_text());old['schemaVersion']=1;del old['favorites']
            path.write_text(json.dumps(old))
            (responses/'complete.json').write_text(json.dumps({'body':body}))
            (root/'cache/api-trace.jsonl').write_text(json.dumps({'at':when,'route':ROUTE,'file':'complete.json'})+'\n')
            store=VeteranStore(root);value=store.get()
            self.assertEqual(value['schemaVersion'],2)
            self.assertEqual(len(value['favorites']),2)
            self.assertEqual(value['favorites'][0]['memo'],'Mile candidate')
            self.assertEqual(value['favorites'][1]['icon_type'],5)
            self.assertNotIn('favorites',store.get(summary=True))
            self.assertNotIn('favorites',store.get(value['capturedAt']))
            self.assertFalse(record_veterans(root,body,ROUTE,when))
            (root/'cache/api-trace.jsonl').unlink()
            self.assertEqual(VeteranStore(root).get()['count'],2)


if __name__ == '__main__':
    unittest.main()
