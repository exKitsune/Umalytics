"""Fixed API identity. No persistent CA signing key or plaintext server key."""
import ctypes
from ctypes import wintypes
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import csv
import hashlib
import json
import ipaddress
import os
from pathlib import Path
import subprocess
import time

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from storage import atomic_bytes, atomic_json, linked

HOST = 'api.games.\x75mamusume.com'
ROOT_CERT = 'umalytics-ca-cert.pem'
LEAF_CERT = 'umalytics-api-cert.pem'
LEAF_KEY = 'umalytics-api-key.dpapi'
MARKER = 'identity-v3.json'
LEGACY_MARKER = 'identity-v2.json'
RETIRED = 'retired-roots.pem'


def retire_roots(directory):
    """Keep public retirement records so denied removal/crashes can be retried."""
    from certificate_trust import current_user_trust
    record = directory / RETIRED
    if not record.exists():
        return
    for certificate in x509.load_pem_x509_certificates(record.read_bytes()):
        der = certificate.public_bytes(serialization.Encoding.DER)
        if current_user_trust(der):
            # Never delete a root based on its display name or a broad search.
            # It must be the exact identity read from this capture directory.
            names = certificate.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
            if not names or names[0].value not in ('mitmproxy', 'Umalytics Local Capture', 'UmaTrace'):
                raise ValueError('Unrecognized old capture root. Remove it manually before migrating.')
            if not current_user_trust(der, uninstall=True) or current_user_trust(der):
                raise ValueError('Approve Windows removal of the old capture certificate, then restart Umalytics.')


def prepare_identity_upgrade(directory):
    marker = directory / MARKER
    root_path = directory / ROOT_CERT
    if marker.exists():
        state = json.loads(marker.read_bytes())
        root = x509.load_pem_x509_certificate(root_path.read_bytes())
        digest = root.fingerprint(hashes.SHA256()).hex()
        if state != {'schemaVersion': 3, 'host': HOST, 'rootSha256': digest}:
            raise ValueError('Capture identity record mismatch.')
        if not any((directory / n).exists() for n in ('umalytics-ca.pem', 'umalytics-ca.p12')):
            retire_roots(directory)
            return
    if (directory / LEGACY_MARKER).exists():
        state = json.loads((directory / LEGACY_MARKER).read_bytes())
        root = x509.load_pem_x509_certificate(root_path.read_bytes())
        if state != {'schemaVersion': 2, 'host': HOST, 'rootSha256': root.fingerprint(hashes.SHA256()).hex()}:
            raise ValueError('Previous capture identity record mismatch.')
    if root_path.exists():
        root = x509.load_pem_x509_certificate(root_path.read_bytes())
        retired = directory / RETIRED
        prior = x509.load_pem_x509_certificates(retired.read_bytes()) if retired.exists() else []
        if root not in prior:
            atomic_bytes(retired, b''.join(c.public_bytes(serialization.Encoding.PEM) for c in [*prior, root]))
    elif not (directory / RETIRED).exists() and any(directory.glob('*-ca*')):
        raise ValueError('Capture CA is incomplete; existing files were preserved.')
    # Failure or cancellation stops migration before old keys are removed.
    retire_roots(directory)
    for name in ('umalytics-ca.pem', 'umalytics-ca.p12', ROOT_CERT, LEAF_CERT, LEAF_KEY,
                 'umalytics-ca-cert.cer', 'umalytics-ca-cert.p12', MARKER, LEGACY_MARKER):
        (directory / name).unlink(missing_ok=True)


def remove_identity(directory):
    """Untrust exact public roots before deleting their local private identity."""
    from certificate_trust import current_user_trust
    directory = Path(directory)
    if linked(directory) or any(linked(p) for p in directory.iterdir()):
        raise ValueError('Linked capture store refused.')
    # Persist the stop even across restarts. Re-creation requires explicit setup.
    atomic_json(directory / 'disabled', {'disabled': True})
    root = directory / ROOT_CERT
    if root.exists():
        certificate = x509.load_pem_x509_certificate(root.read_bytes())
        der = certificate.public_bytes(serialization.Encoding.DER)
        if current_user_trust(der):
            if not current_user_trust(der, uninstall=True) or current_user_trust(der):
                raise ValueError('Approve Windows removal of the capture certificate, then try again.')
    retire_roots(directory)
    for name in (ROOT_CERT, LEAF_CERT, LEAF_KEY, MARKER, LEGACY_MARKER, RETIRED,
                 'umalytics-ca.pem', 'umalytics-ca.p12', 'umalytics-ca-cert.cer', 'umalytics-ca-cert.p12'):
        (directory / name).unlink(missing_ok=True)


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def protect(raw, decrypt=False):
    if os.name != 'nt':
        raise ValueError('Capture key protection requires Windows.')
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    buffer = ctypes.create_string_buffer(raw)
    source = Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    output = Blob()
    method = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    method.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                       ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    method.restype = wintypes.BOOL
    # CRYPTPROTECT_UI_FORBIDDEN; user scope, never machine scope.
    if not method(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(output.data, output.size)
    finally:
        kernel.LocalFree(output.data)


@lru_cache(maxsize=1)
def user_sid():
    result = subprocess.run(['whoami.exe', '/user', '/fo', 'csv', '/nh'],
                            capture_output=True, text=True, check=True,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    sid = next(csv.reader([result.stdout.strip()]))[1]
    if not sid.startswith('S-1-') or any(c not in 'S0123456789-' for c in sid):
        raise ValueError('Windows account identity unavailable.')
    return sid


def restrict(path):
    if os.name != 'nt':
        raise ValueError('Capture key protection requires Windows.')
    advapi = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    convert = advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW
    convert.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p]
    convert.restype = wintypes.BOOL
    apply = advapi.SetFileSecurityW
    apply.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_void_p]
    apply.restype = wintypes.BOOL
    descriptor = ctypes.c_void_p()
    sddl = f'D:P(A;OICI;FA;;;{user_sid()})(A;OICI;FA;;;SY)'
    if not convert(sddl, 1, ctypes.byref(descriptor), None):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        if not apply(str(path.resolve()), 0x80000004, descriptor):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        kernel.LocalFree(descriptor)


def root_constraints():
    # A DNS subtree also permits descendants; exclude those explicitly.
    # IP SANs must not provide an alternate route around the DNS restriction.
    return x509.NameConstraints(
        [x509.DNSName(HOST)],
        [x509.DNSName('.' + HOST), x509.IPAddress(ipaddress.ip_network('0.0.0.0/0')),
         x509.IPAddress(ipaddress.ip_network('::/0'))])


def validate(root, leaf, key):
    constraints = root.extensions.get_extension_for_class(x509.NameConstraints)
    if not constraints.critical or constraints.value != root_constraints():
        raise ValueError('Capture root hostname constraints mismatch.')
    if list(root.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value) != [ExtendedKeyUsageOID.SERVER_AUTH]:
        raise ValueError('Capture root purpose mismatch.')
    leaf.verify_directly_issued_by(root)
    if leaf.extensions.get_extension_for_class(x509.BasicConstraints).value.ca:
        raise ValueError('Capture server certificate must not be a CA.')
    if list(leaf.extensions.get_extension_for_class(x509.SubjectAlternativeName).value) != [x509.DNSName(HOST)]:
        raise ValueError('Capture certificate hostname mismatch.')
    usage = leaf.extensions.get_extension_for_class(x509.KeyUsage).value
    if usage.key_cert_sign or usage.crl_sign:
        raise ValueError('Capture server key must not sign certificates.')
    if list(leaf.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value) != [ExtendedKeyUsageOID.SERVER_AUTH]:
        raise ValueError('Capture certificate purpose mismatch.')
    if leaf.public_key().public_numbers() != key.public_key().public_numbers():
        raise ValueError('Capture certificate key mismatch.')
    now = datetime.now(timezone.utc)
    if not (leaf.not_valid_before_utc <= now < leaf.not_valid_after_utc and
            root.not_valid_before_utc <= now < root.not_valid_after_utc):
        raise ValueError('Capture certificate expired. Renew capture setup.')


def load_identity(directory, key_size=2048):
    import msvcrt
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    if linked(directory) or any(linked(p) for p in directory.iterdir()):
        raise ValueError('Linked capture store refused.')
    restrict(directory)
    # The supervisor and collector may initialize together. Never issue two
    # different identities or delete the old signing key during another write.
    with (directory / 'identity.lock').open('a+b') as lock:
        # Windows can lock past EOF. Writing an initial byte before acquiring
        # the lock races with another opener that already locked that byte.
        deadline = time.monotonic() + 20
        while True:
            lock.seek(0)
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise ValueError('Capture identity is busy. Try again.')
                time.sleep(.05)
        try:
            return _load_identity(directory, key_size)
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def _load_identity(directory, key_size):
    from mitmproxy.certs import Cert, CertStore, CertStoreEntry
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    if linked(directory) or any(linked(p) for p in directory.iterdir()):
        raise ValueError('Linked capture store refused.')
    restrict(directory)
    prepare_identity_upgrade(directory)
    root_path, leaf_path, key_path = [directory / n for n in (ROOT_CERT, LEAF_CERT, LEAF_KEY)]
    if leaf_path.exists() or key_path.exists():
        # Incomplete or damaged identities fail closed, never create a new CA.
        root = x509.load_pem_x509_certificate(root_path.read_bytes())
        leaf = x509.load_pem_x509_certificate(leaf_path.read_bytes())
        restrict(key_path)
        key = serialization.load_pem_private_key(protect(key_path.read_bytes(), decrypt=True), None)
    else:
        now = datetime.now(timezone.utc)
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Umalytics Local Capture')])
        root = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=3650))
                .add_extension(x509.BasicConstraints(ca=True, path_length=0), True)
                .add_extension(root_constraints(), True)
                .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), False)
                .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), False)
                .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), False)
                .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), True)
                .sign(ca_key, hashes.SHA256()))
        key = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, HOST)])
        leaf = (x509.CertificateBuilder().subject_name(name).issuer_name(root.subject)
                .public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now - timedelta(minutes=5))
                .not_valid_after(root.not_valid_after_utc)
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), True)
                .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), False)
                .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(root.public_key()), False)
                .add_extension(x509.SubjectAlternativeName([x509.DNSName(HOST)]), False)
                .add_extension(x509.KeyUsage(True, False, True, False, False, False, False, False, False), True)
                .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), False)
                .sign(ca_key, hashes.SHA256()))
        validate(root, leaf, key)
        protected = protect(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        # Verify DPAPI round trip before committing an identity or deleting keys.
        recovered = serialization.load_pem_private_key(protect(protected, decrypt=True), None)
        validate(root, leaf, recovered)
        atomic_bytes(root_path, root.public_bytes(serialization.Encoding.PEM))
        atomic_bytes(key_path, protected)
        restrict(key_path)
        atomic_bytes(leaf_path, leaf.public_bytes(serialization.Encoding.PEM))
        atomic_json(directory / MARKER, {'schemaVersion': 3, 'host': HOST,
                                       'rootSha256': root.fingerprint(hashes.SHA256()).hex()})
        del ca_key
    validate(root, leaf, key)
    # Both formats produced by the old store contain the CA private key.
    for name in ('umalytics-ca.pem', 'umalytics-ca.p12'):
        (directory / name).unlink(missing_ok=True)

    class FixedStore(CertStore):
        def get_cert(self, commonname, sans, *args, **kwargs):
            names = [n.value for n in sans if isinstance(n, x509.DNSName)]
            if HOST not in names and commonname != HOST:
                raise ValueError('Capture certificate is restricted to the game API.')
            return CertStoreEntry(Cert(leaf), key, None, [Cert(root)])

        def add_cert_file(self, *args, **kwargs):
            raise ValueError('Custom capture certificates are disabled.')

    # Only the server key is present. get_cert never issues new certificates.
    return FixedStore(key, Cert(root), None, b'', CertStore.load_dhparam(directory / 'umalytics-dhparam.pem'))
