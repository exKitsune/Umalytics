"""Use one named capture CA for review, trust installation and live TLS."""
from pathlib import Path
from storage import linked, prepare_storage

BASENAME = 'umalytics'
SUBJECT = 'Umalytics Local Capture'


def load_store(directory, key_size=2048, passphrase=None):
    from mitmproxy.certs import CertStore
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    if linked(directory) or any(linked(path) for path in directory.iterdir()):
        raise ValueError('Linked capture store refused.')
    ca = directory / (BASENAME + '-ca.pem')
    if not ca.exists():
        # A partial existing identity must be repaired explicitly, never silently
        # replaced with a different CA that no longer matches the trusted one.
        if any(directory.glob('*-ca*')):
            raise ValueError('Capture CA is incomplete; existing certificate files were preserved.')
        CertStore.create_store(directory, BASENAME, key_size, organization=SUBJECT, cn=SUBJECT)
    store = CertStore.from_files(ca, directory / (BASENAME + '-dhparam.pem'), passphrase)
    certificate = directory / (BASENAME + '-ca-cert.pem')
    if not certificate.is_file() or certificate.read_bytes() != store.default_ca.to_pem():
        raise ValueError('Capture certificate does not match its private CA.')
    return store


def run_collector(directory, arguments):
    """Replace the TLS addon before configure; no dependency globals are patched.

    tlsconfig imports CONF_BASENAME by value, so changing options.CONF_BASENAME
    cannot reliably select our existing CA. This explicit loader also refuses
    partial identities instead of allowing CertStore.from_store to regenerate.
    """
    from mitmproxy import ctx
    from mitmproxy.addons.tlsconfig import TlsConfig
    from mitmproxy.tools.dump import DumpMaster
    from mitmproxy.tools.main import run
    from mitmproxy.tools import cmdline

    class CaptureTlsConfig(TlsConfig):
        name = 'tlsconfig'

        def configure(self, updated):
            updated = {updated} if isinstance(updated, str) else set(updated)
            triggers = {'certs', 'confdir', 'key_size', 'cert_passphrase'}
            if triggers.intersection(updated):
                self.certstore = load_store(Path(ctx.options.confdir), ctx.options.key_size,
                    ctx.options.cert_passphrase.encode('utf-8') if ctx.options.cert_passphrase else None)
                for spec in ctx.options.certs:
                    name, separator, filename = spec.partition('=')
                    self.certstore.add_cert_file(name if separator else '*', Path(filename if separator else name))
            super().configure(set(updated) - triggers)

    class CaptureMaster(DumpMaster):
        def __init__(self, options):
            super().__init__(options)
            self.addons.remove(self.addons.get('tlsconfig'))
            self.addons.add(CaptureTlsConfig())

    prepare_storage(directory)
    run(CaptureMaster, cmdline.mitmdump, arguments)
