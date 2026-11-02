"""Exact-certificate operations in the Windows current-user root store."""
import ctypes
import hashlib
import os

def current_user_trust(der, install=False, uninstall=False):
    """Open only CurrentUser ROOT, compare the exact certificate bytes."""
    if os.name != 'nt' or (install and uninstall):
        return False
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    crypt.CertOpenStore.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p]
    crypt.CertOpenStore.restype = ctypes.c_void_p
    crypt.CertCloseStore.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    crypt.CertFindCertificateInStore.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_void_p]
    crypt.CertFindCertificateInStore.restype = ctypes.c_void_p
    crypt.CertFreeCertificateContext.argtypes = [ctypes.c_void_p]
    crypt.CertAddEncodedCertificateToStore.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
    crypt.CertDeleteCertificateFromStore.argtypes = [ctypes.c_void_p]
    crypt.CertDeleteCertificateFromStore.restype = ctypes.c_int
    # CERT_STORE_PROV_SYSTEM_W=10; CURRENT_USER=0x10000, READONLY=0x8000.
    store = crypt.CertOpenStore(ctypes.c_void_p(10), 0, None, 0x10000 | (0 if install or uninstall else 0x8000), ctypes.c_wchar_p('ROOT'))
    if not store:
        raise ctypes.WinError(ctypes.get_last_error())
    context = None
    try:
        if install:
            return bool(crypt.CertAddEncodedCertificateToStore(store, 1, der, len(der), 4, None))
        class Blob(ctypes.Structure):
            _fields_ = [('cbData', ctypes.c_uint32), ('pbData', ctypes.c_void_p)]
        digest = ctypes.create_string_buffer(hashlib.sha1(der).digest())
        blob = Blob(20, ctypes.cast(digest, ctypes.c_void_p))
        context = crypt.CertFindCertificateInStore(store, 1, 0, 0x10000, ctypes.byref(blob), None)
        if not context:
            return False
        class CertificateContext(ctypes.Structure):
            _fields_ = [('encoding', ctypes.c_uint32), ('encoded', ctypes.c_void_p),
                        ('size', ctypes.c_uint32), ('info', ctypes.c_void_p), ('store', ctypes.c_void_p)]
        found = ctypes.cast(context, ctypes.POINTER(CertificateContext)).contents
        if ctypes.string_at(found.encoded, found.size) != der:
            return False
        if uninstall:
            deleted = bool(crypt.CertDeleteCertificateFromStore(context))
            context = None
            return deleted
        return True
    finally:
        if context:
            crypt.CertFreeCertificateContext(context)
        crypt.CertCloseStore(store, 0)
