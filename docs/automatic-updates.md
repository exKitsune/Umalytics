# Signed Windows desktop releases

One workflow, `.github/workflows/release.yml`, runs on each push to `master` and
publishes both Pages and Windows releases. Keeping this workflow file preserves
its increasing release run number. Node.js 22.20.0, Python 3.12.10 and Rust 1.90.0
are pinned; Rust builds use `Cargo.lock` with `--locked`.

The web build and full platform-neutral validation run concurrently on Linux.
All 30 Node system workflows run once, with bounded concurrency of two. Set
`UMALYTICS_TEST_CONCURRENCY=1` for serial debugging, or up to four for an explicit
local benchmark. Windows consumes the exact web bundle from that workflow run;
it retains the source updater/storage tests, all native helper replacement and
rollback cases, and both packaged and native smoke tests. Those two smoke tests
run concurrently in separate portable installations on independent ports.

| Job | Prerequisites and result |
| --- | --- |
| Web | Type-checks and builds the shared SPA once; includes three frontend license inputs |
| Validation | Audits public files and exact reference bytes; runs every Node system workflow |
| Windows | Starts after Web; builds and tests the single EXE without installing Node or rebuilding the SPA |
| Pages | Starts after Web and Validation; deploys the shared SPA without another build or test run |
| Publish | Starts after Validation and Windows; stamps matching metadata, signs the tested EXE and publishes it |

The last complete baseline pipeline, which published `v0.2.5`, took about 14
minutes: validation took 368 seconds, the desktop build 320 seconds, native
helper checks 44 seconds and packaged/native smoke tests 51 seconds. These are
measurements of the previous pipeline, not a promised duration for every run.
The consolidated pipeline removes repeated validation and web builds and lets
validation overlap the Windows build.
The caption workflow's unchanged functional checks now complete in 2.59 seconds
instead of 63.21 seconds after correcting its test clock boundary. A warm native
relink measured 36.31 seconds with thin LTO and 16 codegen units, versus 98.09
seconds previously; the EXE grew by 1.02%. The same six expensive Node workflows
took 76.720 seconds serially and 47.119 seconds with two workers, a 38.6% reduction.
All 30 system workflows then passed in 89.155 seconds locally. Hosted full-pipeline
timing is measured after deployment rather than inferred by adding these separate
benchmarks from different machines.

The first consolidated hosted run published `v0.2.6` in about 8.5 minutes.
A Windows-only rerun restored all three dependency caches and completed in
263 seconds, including every Windows check. Its desktop build took 113 seconds,
native helper checks 36 seconds and parallel smoke tests 37 seconds. These
measurements precede the additional frozen restart regression below.

## Build caches and artifacts

Linux jobs reuse npm downloads keyed by Node version and `package-lock.json`.
Windows reuses its Python environment keyed by OS, architecture, exact Python
version and build requirements; pip downloads are restored only when that
environment is missing. Cargo source caches include both lockfiles. Compiled
desktop and helper targets additionally include their Cargo manifests and Rust
version, so dependency and release-profile changes select a different cache.
Each commit and rerun saves a fresh target cache and can restore the newest
compatible one.

Cache keys are computed before version stamping and reused unchanged on save.
Explicit cache saves run even after a later build or test failure, provided the
dependency setup succeeded. The final EXE and helper test executable are excluded
from target caches; current source is rebuilt and all tests run every time.
No test result, signing secret or installation data is cached. The workflow
accepts only trusted `master` pushes or manual runs; it does not create caches or
sign artifacts from pull requests.

The shared web artifact contains the SPA and only the package metadata and
license files required for offline frontend notices. Its reference manifest is
checked byte-for-byte against the source both before upload and after the Windows
build. The tested EXE travels as a separate uncompressed artifact to the Linux
signing job. Artifacts are scoped to the exact workflow run and retained for one
day. The private signing secret is exposed only to the final signing step after
all required validation succeeds. Pages and release publication each check that
the commit is still the newest `master`.

Each workflow run stamps `0.2.<run_number>` into the JavaScript package and lock,
Cargo package and lock, Tauri configuration, and bundled `desktop/build-info.json`.
The local source default is `0.2.0`. Stamping happens only in the runner checkout.
`scripts/build-desktop.ps1` writes the single distributable to
`.cache/dist/Umalytics.exe`; this build directory contains no installation data.
Copy the EXE into a writable installation folder. App files use
`%LOCALAPPDATA%\Umalytics`; an adjacent legacy `Umalytics-data` directory is
migrated after a verified copy. Updates and rollback accept only that per-user
directory or the legacy path during migration. The EXE can be on another drive:
an atomic replacement uses a temporary swap file beside it and keeps recovery
files in AppData. The temporary file is removed after the swap.

The workflow uploads three assets to a draft release: `Umalytics.exe`,
`release-manifest.json` and `release-manifest.sig`. It checks that its commit is
still the current `master` before creating the draft and again before publishing
it as latest. A build superseded during upload remains a draft. Published version
assets are never replaced by a rerun. The workflow uses its temporary GitHub
token with `contents: write`; it needs no personal token or SSH key.
Rerunning a published version for the same commit succeeds without signing or
replacing its assets. A tag pointing to another commit is rejected.

## Configure the signing secret

Set the repository Actions secret `UMALYTICS_UPDATE_SIGNING_KEY` to the Base64
encoding of the raw 32-byte Ed25519 private key corresponding to the committed
`desktop/update-public-key.txt`. Keep a private backup outside the source tree.
The public file contains exactly 32 bytes encoded as 64 lowercase hexadecimal
characters and is safe to publish. The signing command rejects a missing or
mismatched private key and never writes or prints the secret.

This signature authenticates the updater's release assets. Windows Authenticode
signing and SmartScreen reputation are separate; the generated EXE may still
show a Windows reputation prompt.

## Release manifest

The detached signature is the Base64 encoding of a 64-byte Ed25519 signature
over the **original raw bytes** of `release-manifest.json`, including its final
newline. Never parse and reserialize the file before verifying it.

Schema version 1 contains exactly these fields:

| Field | Value |
| --- | --- |
| `schemaVersion` | `1` |
| `version` | `0.2.<buildNumber>` |
| `buildNumber` | Positive monotonically increasing workflow run number |
| `commit` | Full 40-character lowercase Git commit hash |
| `filename` | `Umalytics.exe` |
| `bytes` | Executable byte length, at most 512 MiB |
| `sha256` | Executable SHA-256 in lowercase hexadecimal |
| `dataSha256` | SHA-256 of bundled `public/data/update-manifest.json` |
| `releaseUrl` | Official repository release tag URL for this version |

The client requests metadata from the official repository's
`releases/latest/download/` endpoint. It uses conditional requests after a
verified check and derives the executable URL from the verified version:
`https://github.com/exKitsune/Umalytics/releases/download/vVERSION/Umalytics.exe`.
It never follows a manifest-supplied executable URL. HTTPS redirects are bounded
and restricted to the official repository and GitHub's release asset hosts.
Metadata, executable size, socket waits and total download duration are bounded.

## Installation behavior

The background service checks at startup, every hour, and on the next wake if a
check became overdue during system sleep. Checking does not download an EXE.
The Settings **Update Umalytics** action checks the newest release again,
downloads its executable, and verifies the exact signed size and SHA-256 before
preparing a restart. Active game connections and launcher activity defer the
restart. The app downloads the executable and its bundled reference data as one
version; there is no separate reference-data update action.

The AppData `cache/update/` folder holds downloads and recovery files. The current
EXE is copied there as `helper.exe`, with a transaction containing the exact
installation paths, expected current EXE hash and a one-use random restart token.
The helper independently checks the signature, executable and paths, then calls
the protected local restart API. That handshake expires after 60 seconds. A failed
download or helper preparation leaves the running app and user data in place.
The service continues watching the helper until shutdown. A helper crash or
authenticated abort restores an error status and allows a retry.

The native helper handles shutdown, replacement, new-version health checks and
temporary rollback. A successful update retains one active runtime and reference
dataset; settings, races, capture credentials, exports and the WebView profile
remain installation data. The helper removes temporary recovery copies after
the replacement has passed health verification.

On Windows, shutdown waits on the old desktop process, not just its executable
file. A running executable can still pass a file-sharing check. The replacement
must confirm that its window and tray were created and stay alive alongside a
healthy collector before the helper commits the update. A collector running
without its desktop is a failed restart and triggers rollback. Planned service
disconnects display restart progress instead of a connection error.

## Verification

Run the service and release packaging integration flow with the build Python:

```powershell
.cache/proxy-venv/Scripts/python.exe tests/updater/test_release_flow.py
```

The test uses the real loopback service and authenticated API routes, a local
HTTP server with an ephemeral fixture signing key, and a harmless native-helper
stand-in process. It checks invalid signatures, unsupported URL fields, invalid
redirects, wrong hashes, interrupted downloads, conditional checks, startup and
overdue checks, game deferral, failed helper preparation, the validated restart
handshake, helper crashes and aborts after acknowledgement, release version
stamping, manifest signing, and user-data preservation.
It never changes certificate trust or starts the game.

`tests/frozen-handoff-workflow.py` builds a small console-only frozen process
and calls the production update handoff through a native helper. It waits for
the original Python extraction directory to disappear before restarting the
same executable path. It reproduces the old missing-DLL failure without a
dialog, then verifies a fresh extraction and working HTTP service with the fix.
The app, update helper and rollback helper request a fresh PyInstaller runtime
at each independent launch; ordinary collector workers can still share their
living parent's runtime. Native helper workflows also check replacement and
rollback launches with stale inherited runtime state.
