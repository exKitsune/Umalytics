"""Windows capture identity lifecycle, using disposable directories only."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import ctypes
import json
from ctypes import wintypes
import subprocess
import sys
import tempfile
from unittest.mock import patch

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
from capture_store import load_store
from capture_identity import HOST, LEAF_KEY, LEAF_CERT, ROOT_CERT, MARKER, root_constraints, protect, user_sid
from mitmproxy.certs import CertStore


def snapshot(folder):
    return {p.name: p.read_bytes() for p in folder.iterdir()}


with tempfile.TemporaryDirectory(prefix='capture-identity-', dir=ROOT / '.cache') as temporary:
    base = Path(temporary)
    fresh = base / 'fresh'
    # Concurrent supervisor/collector initialization must share one identity.
    with ThreadPoolExecutor(max_workers=4) as workers:
        stores = list(workers.map(lambda _: load_store(fresh), range(4)))
    assert all(s.default_ca == stores[0].default_ca for s in stores)
    before = snapshot(fresh)
    assert not any('PRIVATE KEY' in raw.decode('ascii', errors='ignore') for raw in before.values())
    assert not (fresh / 'umalytics-ca.pem').exists()
    assert not (fresh / 'umalytics-ca.p12').exists()
    key = serialization.load_pem_private_key(protect(before[LEAF_KEY], decrypt=True), None)
    assert isinstance(key, rsa.RSAPrivateKey)
    leaf = x509.load_pem_x509_certificate(before[LEAF_CERT])
    root = x509.load_pem_x509_certificate(before[ROOT_CERT])
    assert root.extensions.get_extension_for_class(x509.NameConstraints).critical
    assert root.extensions.get_extension_for_class(x509.NameConstraints).value == root_constraints()
    assert key.public_key().public_numbers() == leaf.public_key().public_numbers()
    assert key.public_key().public_numbers() != root.public_key().public_numbers()
    assert stores[0].get_cert(HOST, [x509.DNSName(HOST)]).cert._cert == leaf
    try:
        stores[0].get_cert('example.com', [x509.DNSName('example.com')])
        raise AssertionError('Unrelated hostname accepted')
    except ValueError:
        pass
    # A fresh process can decrypt/reload the identity without a CA key.
    code = 'import sys;sys.path.insert(0,sys.argv[1]);from capture_store import load_store;load_store(sys.argv[2])'
    subprocess.run([sys.executable, '-c', code, str(ROOT / 'desktop'), str(fresh)], check=True,
                   creationflags=subprocess.CREATE_NO_WINDOW)
    assert snapshot(fresh) == before
    advapi = ctypes.WinDLL('advapi32', use_last_error=True)
    get_security = advapi.GetFileSecurityW
    get_security.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_void_p,
                             wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    size = wintypes.DWORD()
    get_security(str(fresh / LEAF_KEY), 4, None, 0, ctypes.byref(size))
    descriptor = ctypes.create_string_buffer(size.value)
    assert get_security(str(fresh / LEAF_KEY), 4, descriptor, size, ctypes.byref(size))
    # Read the binary ACL: Windows can render the same SID as LA/SY or a
    # full SID string depending on the runner's account identity.
    get_dacl = advapi.GetSecurityDescriptorDacl
    get_dacl.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.BOOL),
                        ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wintypes.BOOL)]
    present, defaulted, dacl = wintypes.BOOL(), wintypes.BOOL(), ctypes.c_void_p()
    assert get_dacl(descriptor, ctypes.byref(present), ctypes.byref(dacl), ctypes.byref(defaulted))
    assert present.value and dacl.value, 'A missing/null DACL would allow unrestricted access'

    class AclSize(ctypes.Structure):
        _fields_ = [('count', wintypes.DWORD), ('used', wintypes.DWORD), ('free', wintypes.DWORD)]

    information = advapi.GetAclInformation
    information.argtypes = [ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.c_int]
    size = AclSize()
    assert information(dacl, ctypes.byref(size), ctypes.sizeof(size), 2)
    assert size.count == 2, 'Only the current account and SYSTEM should have access'
    get_ace = advapi.GetAce
    get_ace.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p)]
    stringify = advapi.ConvertSidToStringSidW
    stringify.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.LPWSTR)]
    free = ctypes.WinDLL('kernel32').LocalFree
    free.argtypes = [ctypes.c_void_p]
    trustees = set()
    for index in range(size.count):
        ace, sid = ctypes.c_void_p(), wintypes.LPWSTR()
        assert get_ace(dacl, index, ctypes.byref(ace))
        assert ctypes.c_ubyte.from_address(ace.value).value == 0, 'Expected an allow ACE'
        assert wintypes.DWORD.from_address(ace.value + 4).value == 0x1f01ff, 'Expected full file access'
        assert stringify(ace.value + 8, ctypes.byref(sid))
        try:
            trustees.add(sid.value)
        finally:
            free(sid)
    assert trustees == {user_sid(), 'S-1-5-18'}, 'Unexpected key ACL trustees'
    control, revision = wintypes.WORD(), wintypes.DWORD()
    get_control = advapi.GetSecurityDescriptorControl
    get_control.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.WORD), ctypes.POINTER(wintypes.DWORD)]
    assert get_control(descriptor, ctypes.byref(control), ctypes.byref(revision))
    assert control.value & 0x1000, 'Key ACL must be protected from inheritance'
    # Corruption must fail closed, leave files unchanged, and never reissue.
    (fresh / LEAF_KEY).write_bytes(b'broken DPAPI key')
    damaged = snapshot(fresh)
    try:
        load_store(fresh)
        raise AssertionError('Damaged key silently replaced')
    except (OSError, ValueError):
        pass
    assert snapshot(fresh) == damaged
    (fresh / LEAF_KEY).write_bytes(before[LEAF_KEY])
    (fresh / LEAF_CERT).unlink()
    incomplete = snapshot(fresh)
    try:
        load_store(fresh)
        raise AssertionError('Incomplete identity silently replaced')
    except (OSError, ValueError):
        pass
    assert snapshot(fresh) == incomplete
    # Both legacy CA-key formats disappear only after the replacement works.
    legacy = base / 'legacy'
    CertStore.create_store(legacy, 'umalytics', 2048)
    original_root = (legacy / ROOT_CERT).read_bytes()
    load_store(legacy)
    assert (legacy / ROOT_CERT).read_bytes() != original_root
    assert (legacy / 'retired-roots.pem').read_bytes() == original_root
    assert not (legacy / 'umalytics-ca.pem').exists()
    assert not (legacy / 'umalytics-ca.p12').exists()
    assert load_store(legacy).get_cert(HOST, [x509.DNSName(HOST)]).privatekey

    # Exercise Windows removal cancellation/retry without installing test roots
    # into the real user's store. The complete migration uses real files/keys.
    cancelled = base / 'cancelled'
    CertStore.create_store(cancelled, 'umalytics', 2048,
                           organization='Umalytics Local Capture', cn='Umalytics Local Capture')
    old_root = (cancelled / ROOT_CERT).read_bytes()
    old_der = x509.load_pem_x509_certificate(old_root).public_bytes(serialization.Encoding.DER)
    state = {'trusted': True, 'allow': False, 'removed': 0}

    def trust(der, install=False, uninstall=False):
        assert not install, 'Migration must never silently trust a root'
        assert der == old_der, 'Migration must target only the exact previous root'
        if uninstall:
            if not state['allow']:
                return False
            state['trusted'] = False
            state['removed'] += 1
            return True
        return state['trusted']

    with patch('certificate_trust.current_user_trust', trust):
        try:
            load_store(cancelled)
            raise AssertionError('Removal cancellation did not stop migration')
        except ValueError as error:
            assert 'Approve Windows removal' in str(error)
        assert (cancelled / ROOT_CERT).read_bytes() == old_root
        assert (cancelled / 'umalytics-ca.pem').is_file()
        assert not (cancelled / LEAF_KEY).exists()
        state['allow'] = True
        load_store(cancelled)
        assert state['removed'] == 1 and not state['trusted']
        assert (cancelled / ROOT_CERT).read_bytes() != old_root
        assert not (cancelled / 'umalytics-ca.pem').exists()
        assert not (cancelled / 'umalytics-ca.p12').exists()
        # Restart preserves the new identity and retirement record.
        committed = snapshot(cancelled)
        load_store(cancelled)
        assert snapshot(cancelled) == committed

    # The previous hostname-only setup upgrades to constrained roots.
    prior = json.loads((legacy / MARKER).read_bytes())
    prior['schemaVersion'] = 2
    (legacy / 'identity-v2.json').write_text(json.dumps(prior))
    (legacy / MARKER).unlink()
    previous_root = (legacy / ROOT_CERT).read_bytes()
    load_store(legacy)
    assert (legacy / ROOT_CERT).read_bytes() != previous_root
    assert not (legacy / 'identity-v2.json').exists()

    # An earlier prototype with no version marker must also rotate its root,
    # even though its signing key was already deleted.
    prototype_root = (legacy / ROOT_CERT).read_bytes()
    (legacy / MARKER).unlink()
    load_store(legacy)
    assert (legacy / ROOT_CERT).read_bytes() != prototype_root

print('Capture identity lifecycle passed: concurrent setup, protected key/ACL, fixed hostname, restart, corruption rejection, forced fresh roots, removal cancellation/retry, and prototype upgrade. Windows trust unchanged.')
