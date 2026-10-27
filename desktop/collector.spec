# Single-file, Windows-subsystem service. The Tauri shell embeds this binary.
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules

root = Path(SPECPATH).parent
datas = [(str(root / 'dist'), 'dist')]
datas += [(str(root / 'simulation' / 'engine-registry.json'), 'simulation')]
if (root / 'simulation' / 'installed-bundles.json').is_file():
    datas += [(str(root / 'simulation' / 'installed-bundles.json'), 'simulation'),
              (str(root / 'simulation' / 'bundles'), 'simulation/bundles')]
# Runtime code fingerprints remain measurable when frozen. Python imports are
# collected normally; these source resources are for identity, never execution.
datas += [(str(root / 'desktop' / 'globalsim_bridge'), 'globalsim_bridge')]
datas += [(str(root / '.cache' / 'desktop-licenses' / 'THIRD-PARTY-NOTICES.txt'), '.')]
datas += [(str(root / 'desktop' / name), 'desktop')
          for name in ('build-info.json', 'update-public-key.txt')]
datas += [(str(root / 'scripts' / 'proxy' / name), 'scripts/proxy')
          for name in ('observer.py', 'race_extract.py', 'uma_envelope.py', 'development_capture.py')]
datas += [(str(root / 'simulation/analysis'), 'simulation/analysis')]
datas += [(str(root / '.cache/analysis-runtime/LICENSE'), 'analysis-runtime')]
binaries = [(str(root / '.cache/analysis-runtime/node.exe'), 'analysis-runtime')]
hiddenimports = []
for package in ('mitmproxy', 'mitmproxy_rs', 'msgpack', 'cryptography'):
    package_datas, package_bins, package_hidden = collect_all(package)
    datas += package_datas
    binaries += package_bins
    hiddenimports += package_hidden
hiddenimports += collect_submodules('aioquic')

a = Analysis([str(root / 'desktop' / 'service.py')], pathex=[str(root)], binaries=binaries,
             datas=datas, hiddenimports=hiddenimports, hookspath=[], hooksconfig={},
             runtime_hooks=[], excludes=['tkinter', 'IPython', 'pytest'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='UmaTraceService', debug=False,
          bootloader_ignore_signals=False, strip=False, upx=False, console=False,
          disable_windowed_traceback=True, icon=str(root / 'src-tauri' / 'icons' / 'icon.ico'))
