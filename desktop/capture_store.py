"""Use a fixed API certificate with no persistent CA signing key."""
from pathlib import Path
from storage import prepare_storage


def load_store(directory, key_size=2048, passphrase=None):
    from capture_identity import load_identity
    return load_identity(directory, key_size)


def run_collector(directory, arguments):
    """Replace the TLS addon before configure; no dependency globals are patched.

    tlsconfig imports CONF_BASENAME by value, so changing options.CONF_BASENAME
    cannot reliably select our existing CA. This explicit loader also refuses
    partial identities instead of allowing CertStore.from_store to regenerate.
    """
    if (Path(directory) / 'capture' / 'disabled').exists():
        raise ValueError('Capture certificate removed. Create a new certificate in Settings.')
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
                if ctx.options.certs:
                    raise ValueError('Custom capture certificates are disabled.')
            super().configure(set(updated) - triggers)

    class CaptureMaster(DumpMaster):
        def __init__(self, options):
            super().__init__(options)
            self.addons.remove(self.addons.get('tlsconfig'))
            self.addons.add(CaptureTlsConfig())

    prepare_storage(directory)
    run(CaptureMaster, cmdline.mitmdump, arguments)
