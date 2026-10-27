"""Synthetic encrypted roster regressions; no real credentials or captures."""
import base64
from pathlib import Path
import struct
import sys
import unittest
from unittest.mock import patch

import msgpack
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/proxy'))
import uma_envelope as codec


def exchange(payload):
    request = base64.b64encode(struct.pack('<I', 116) + bytes(116) + bytes(16) + b'K' * 32)
    context = codec.extract_request_context(request)
    body = msgpack.packb(payload, use_bin_type=True)
    padder = padding.PKCS7(128).padder()
    padded = padder.update(struct.pack('<I', len(body)) + body) + padder.finalize()
    encryptor = Cipher(algorithms.AES(b'K' * 32), modes.CBC(context._iv)).encryptor()
    response = base64.b64encode(encryptor.update(padded) + encryptor.finalize() + b'K' * 32)
    return request, response


class EnvelopeTests(unittest.TestCase):
    def test_full_roster_exceeds_old_limit_and_preserves_unknown_fields(self):
        veteran = {'card_id': 100101, 'speed': 1200, 'stamina': 1000, 'power': 900,
                   'guts': 600, 'wiz': 800, 'skill_array': [{'skill_id': n, 'level': 1} for n in range(40)],
                   'race_result_list': [{'race_id': n, 'result': 1} for n in range(40)],
                   'factor_info_array': [{'factor_id': n, 'level': 3} for n in range(40)],
                   'support_card_list': [{'support_card_id': n, 'level': 50} for n in range(6)],
                   'succession_chara_array': [{'card_id': 100201}, {'card_id': 100301}],
                   'future_field': {'keep': ['all', 1, None, True]}}
        payload = {'data': {'trained_chara_array': [dict(veteran, trained_chara_id=n) for n in range(600)]}}
        request, response = exchange(payload)
        with patch.object(codec, 'MAX_OBJECT_NODES', 200_000):
            with self.assertRaises(codec.EnvelopeDecodeError) as caught:
                codec.decode_exchange(request, response)
            self.assertEqual(caught.exception.code, 'structure_limit')
        self.assertEqual(codec.decode_exchange(request, response), payload)

    def test_node_and_depth_limits_remain_enforced(self):
        with patch.object(codec, 'MAX_OBJECT_NODES', 10):
            with self.assertRaises(codec.EnvelopeDecodeError) as caught:
                codec.decode_exchange(*exchange({'data': list(range(10))}))
            self.assertEqual(caught.exception.code, 'structure_limit')
        value = 1
        for _ in range(65):
            value = [value]
        with self.assertRaises(codec.EnvelopeDecodeError) as caught:
            codec.decode_exchange(*exchange({'data': value}))
        self.assertEqual(caught.exception.code, 'structure_limit')

    def test_wire_limits_and_corrupt_messages_still_fail(self):
        with self.assertRaises(codec.EnvelopeDecodeError) as caught:
            codec.extract_request_context(b'A' * (codec.MAX_WIRE_BYTES + 1))
        self.assertEqual(caught.exception.code, 'size_limit')
        request, response = exchange({'data': {}})
        with self.assertRaises(codec.EnvelopeDecodeError) as caught:
            codec.decode_exchange(request, response[:-1] + b'!')
        self.assertEqual(caught.exception.code, 'base64')


if __name__ == '__main__':
    unittest.main()
