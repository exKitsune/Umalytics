# License and corresponding source

Umalytics original software is AGPL-3.0-only. The root LICENSE contains the
complete terms, and NOTICE describes attribution, modifications, warranty,
and third-party exclusions. This does not relicense game assets, reference
data, or third-party dependencies. Preserve their individual notices.

GlobalSim and our linked Rust worker are AGPL-3.0-only. Keep GlobalSim's
LICENSE, NOTICE, and licenses directory in its bundle. Settings exposes the
AGPL text, the source repository, the release source, and complete dependency
notices. The static viewer exposes the license and source repository too.

## Rebuild a release

Download **Umalytics-source.zip** beside **Umalytics.exe** on the same GitHub
release. Extract it into a writable directory. The archive includes:

- The application, Python bridge, Rust worker, frontend, build scripts and locks.
- The exact modified GlobalSim checkout at `.cache/globalsim-saved`, including
  its pinned commit/tree objects, with no remotes, credentials or earlier history.
- Rust crate source archives, runtime npm package archives, and Python dependency
  source distributions. Packages without PyPI source distributions use explicitly
  pinned upstream source archives. SOURCE-MANIFEST.json records URLs and hashes.
- The actual Python dependency versions used by the packaging environment.

Install Git, the Python version specified in `.python-version`, Node 22, Rust 1.90, and Visual Studio C++ build tools
on Windows x64. Run `./scripts/rebuild-source.ps1` from PowerShell. It verifies
the source manifest, restores dependencies using the included locks, and builds
the app. Dependency installation uses the network; the source archives remain
available locally for inspecting, modifying, or separately building dependencies.
Unmodified general-purpose tools and system libraries, including the Python and
Node interpreters, Windows, WebView2, compilers and SDKs, are not vendored here.

The result is a locally built executable. No update-signing private key is
needed to build or run it. The built-in updater trusts official signed updates;
that does not prevent users from building or running modified applications.
Build output need not be byte-for-byte identical across toolchain environments.
After intentionally editing source, review the manifest differences and invoke
the documented build commands directly instead of the pristine-archive check.
For simulator changes, update its commit, source lock, and instrumentation
receipt as described in simulator-backup.md.

## Release requirements

1. Obtain user review approval, commit the modified simulator with dated notices,
   push the public fork, and pin the exact commit in simulation/source-lock.json.
   A pending-review source cannot pass normal release verification.
2. Commit the matching Umalytics changes. Build from that source and generate
   offline notices after packaging the simulator. Both Rust lockfiles contribute
   dependency notices, including crates used only by the worker.
3. Run `python scripts/package-source.py` using the same Python environment as
   the desktop build. It packages the exact application build inputs, simulator,
   and dependency sources; missing sources or mismatched hashes fail the build.
4. Publish the source archive next to the executable in the same release.
   Keep the source available for as long as necessary to satisfy AGPL section 6.
   Never publish an executable while omitting its corresponding source asset.
5. If deploying a modified simulator for remote users, prominently offer its
   corresponding source through the service interface as required by section 13.

Local `--development` archives are explicitly marked unpublished review
snapshots. They include uncommitted work from this isolated branch. Do not
publish them as release source or mistake the base revision for a source commit.

The licensing scope and source offer apply to this release onward. Previously
distributed versions need their own matching source and license review; a new
archive does not retroactively document a different binary.
