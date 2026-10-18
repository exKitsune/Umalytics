# Umalytics Windows desktop package

`.cache/dist/Umalytics.exe` is the single distributable Windows executable. It embeds
the Svelte SPA, Tauri shell, Python runtime, mitmproxy, race observer, and a
Node 22 runtime for headless analysis. End users
do not install Node.js, Python, or Rust. The Windows WebView2 runtime is required;
current Windows installations normally provide it. The executable is currently
unsigned, so Windows may show a reputation prompt on a new download.

The frontend is bundled once, inside the embedded service. Tauri opens the
service's loopback URL; it does not carry a second unused copy of the website.

Keep the executable in a writable folder so it can update itself. App files live
in `%LOCALAPPDATA%\Umalytics`, regardless of the executable's location. Settings
shows the actual data path. An adjacent `Umalytics-data` folder is copied there
on first launch. All file hashes are verified before originals are removed;
conflicting files stop migration without replacing either copy. Settings, races,
certificates, exports and the browser profile are preserved. A running older
collector must be idle before it can stop for migration.

This is temporary transition code. `storage-layout.json` records completion
on migrated and fresh installs. Later launches ignore adjacent data folders.
The migration entry point can be removed without changing normal AppData storage.

When upgrading from the old layout, the old updater first finishes verification
at its original path. The new app then restarts once to migrate to AppData.

The directory contains:

- `settings.json`: preferences and collection settings.
- `races/`: captured races and imported JSON files.
- `exports/`: older exported JSON files. New race and Uma JSON files go to the
  user's Downloads folder unless a different folder is chosen in Settings.
- `data/`: one active set of reference files, replaced together during an update.
- `runtime/UmalyticsCollector.exe`: one extracted collector, replaced when idle.
- `capture/`: this installation's certificate and **private key**, with
  `umalytics-*` filenames. Keep this folder private.
- `cache/`: the WebView profile and temporary update files.

Dependency notices are embedded and available offline through Settings → Licenses.
There is no extracted license tree. Desktop imports and preferences migrate from
browser storage after the service acknowledges each save. The static website
continues to use browser storage. Existing capture keys keep their identity and
trust when their filenames migrate.

Windows needs the extracted collector and PyInstaller's temporary Python/DLL
files. PyInstaller normally removes its temporary `_MEI*` directory on exit.
The WebView profile is browser cache; races and preferences live outside it after
migration. Never remove the profile before migration completes.

Closing the window hides it to the system tray. When background analysis is
enabled, the Python service continues processing new captures and the backlog,
newest race date first. It runs one local analysis process at a time and persists
authenticated dashboard snapshots. No visible or hidden webview is needed.
Closing the window does not stop the queue; exiting Umalytics does. Both normal launch and
`--background` keep a native Umalytics process and tray icon alive. Double-click
the icon to open the window; **Exit Umalytics and stop collection** stops the
collector too. Steam's launch wrapper starts the tray if needed, then stops that
Steam-started session when the game exits. A tray that was already running stays
open. The **Start at login** toggle changes only this user's Run entry. There is
no administrator Windows service or scheduled task.

## Certificate and game setup

The first launch generates a local CA without installing it. The regular proxy
runs with encrypted TLS passthrough while that CA is untrusted, so the Steam
wrapper can still launch the game. Race inspection starts when the exact CA is
trusted in the Windows CurrentUser Root store and collection is enabled.
The settings page shows its status and fingerprint. Clicking **Install
certificate** explicitly requests that exact certificate; **Remove certificate**
uninstalls that same CurrentUser Root entry. Windows manages the security
confirmation. Administrator rights are not required. Settings also includes
uninstall steps for the app, Steam launch option, login item, certificate and
optional data folder.
Disabling collection pauses race exports while keeping the proxy available to
the running game. Installing trust changes the proxy from passthrough to
inspection, so perform that one-time setup before launching the game.

The app shows a Steam Launch Options string for its actual executable location:

```text
"C:\Your\Install\Umalytics.exe" --launch-game -- %command%
```

The user sets this in Steam explicitly. Umalytics never edits Steam settings.
The wrapper waits for collector readiness, forwards the executable and all
arguments, sets `http_proxy`, `https_proxy`, and `all_proxy` only in the game's
copied child environment, and waits for the game to exit so Steam tracks its
lifetime. If Steam had to start Umalytics for that launch, the wrapper stops
collection and the tray after the game exits. It does not log the game arguments
or change Windows proxy settings.
The regular proxy binds only `127.0.0.1:4327`; the app API binds only
`127.0.0.1:4317`. The observer inspects the specific game API host and passes other
TLS traffic through encrypted.

Proxy readiness and game connection are separate. The app recognizes the game
API from CONNECT, TLS SNI, and inspected API requests; it does not wait for a
race response. It clears the active connection when the client disconnects.
Desktop collector counters travel through authenticated localhost IPC and stay
in memory. There is no status heartbeat file. Standalone proxy scripts write
their status JSON only when counters or state change. Unchanged settings and reference files are reused across app starts.

## App and reference updates

Settings → **Update and restart** installs a signed release from this repository.
The collector checks for releases hourly and after an overdue wake. Updates include
the matching executable, frontend, collector and reference data. Replacement waits
until Uma and its launcher close. The helper verifies the signature and file hashes,
keeps one temporary rollback copy, and checks the new app before cleaning up.
See [automatic-updates.md](automatic-updates.md) for signing and release details.

Reference files are stored directly in `data/`. Only verified generated legacy
snapshot directories are removed; unknown files are preserved. The older
`/api/data/update` endpoint remains available for development, but the desktop UI
updates the entire app so data and code stay together.

After changing `public/data/`, run `python desktop/generate_manifest.py` before
building or committing. `--check` verifies the committed manifest.

## Developer build

The build requires Windows x64, Visual Studio C++ build tools, current stable
Rust, Node.js, and Python 3.12. Use a local build environment:

```powershell
python -m venv .cache/proxy-venv
.cache/proxy-venv/Scripts/python.exe -m pip install -r desktop/requirements-build.txt
npm ci
powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1
```

The script generates the data manifest and icon, builds the Svelte SPA, packages
the collector with PyInstaller, embeds that binary into the Tauri executable,
and writes `.cache/dist/Umalytics.exe`. Cargo dependencies, native build output
(`.cache/desktop-target/`), and PyInstaller work files remain under `.cache/`.
A privately installed `.cache/rustup` toolchain is used
when present; otherwise the normal Rust toolchain is used. `-SkipFrontend` and
`-SkipService` are available for targeted shell rebuilds.
`-OutputFile Umalytics-updated.exe` writes an alternate filename under `.cache/dist/`
when an existing executable is still open.

Dependency notices are rebuilt deterministically in memory from installed source
notices and written only when changed. The package embeds only the resulting
combined file, so stale generated notice directories are not included.

Only the requested EXE is a desktop release artifact. Keep generated test reports,
screenshots, smoke installations, and analysis output under `.cache/` or
`test-output/`; those files are not required beside the EXE. Existing installation data is private and is never a build input or a release
asset. Build and smoke commands do not remove user data.

```powershell
.cache/proxy-venv/Scripts/python.exe desktop/smoke_packaged.py .cache/desktop-service/UmaTraceService.exe
# Include the real repository update and persistence check:
.cache/proxy-venv/Scripts/python.exe desktop/smoke_packaged.py .cache/desktop-service/UmaTraceService.exe --update-reference
# Verify the final single EXE and its embedded native launch wrapper:
.cache/proxy-venv/Scripts/python.exe desktop/smoke_native.py .cache/dist/Umalytics.exe
```

The system smoke run uses an isolated workspace data directory and a separate
regular proxy on port 14327. It checks an encrypted loopback TLS connection
through the proxy, the actual packaged service and synthetic library, and that a second
instance does not bind the port, launches a harmless executable fixture through
the actual packaged launcher, checks restart persistence, and shuts it down
through the protected API. It also checks API connection/disconnection using
game API SNI directed only to the loopback TLS fixture, idle file timestamps,
unchanged settings, and saving/revealing a JSON export in Explorer.
`--no-proxy` skips the collector and launcher checks.
These tests do not install a certificate, change startup settings, or launch Uma.

The native smoke copies the distributable to an isolated installation and AppData,
verifies its extracted service hash and bundled frontend, forwards a harmless
launcher fixture through the native EXE, checks compact race metadata and
Explorer selection, and verifies that its resident tray survives a Steam launch
then exits with the owned service, while a Steam-owned session stops after the
fixture. `--headless`
skips only the Explorer selection assertion on CI. It requires the normal app
ports 4317/4327 to be free and refuses to stop an existing installation.

## Local API

`GET /api/health` returns readiness, sanitized proxy counters, certificate status,
a per-process CSRF token, the Steam wrapper string, and actual data directory.
`proxy.state` remains compatible; `proxy.listening` reports a ready proxy,
`proxy.gameConnected` and `proxy.activeGameConnections` report API connections,
and `proxy.lastGameTrafficAt` records the most recent API traffic marker.
`GET /api/races?summary=1&limit=200&offset=0` returns metadata, `total`, and
`nextOffset`. Each summary includes compact `courseId`, `distance`, and
`conditions` (`weather`, `ground`, `season`) without telemetry or scenarios.
Conditions preserve their recorded code/string; absent fields remain null.
An available public `raceInstanceId` is included and can resolve a course from
the active reference data. `GET /api/races/{id}` returns the full race envelope. The legacy
`GET /api/races/latest` contract is also supported. Settings, certificate status,
and reference status use `/api/settings`, `/api/certificate`, and
`/api/data/status`. Desktop imports use `POST /api/races/import`; preferences use `GET`/`POST
/api/preferences`. Release endpoints are `/api/update/status`, `/api/update/check`
and `/api/update/install`. Other POST routes are `/api/settings`, `/api/certificate/install`,
`/api/certificate/uninstall`, `/api/reveal`, `/api/data/update`, `/api/exports`, and
`/api/app/exit`. The export endpoint accepts `{filename, content}` with a safe
`.json` filename and a bounded JSON string, then writes to the configured
Downloads folder and returns `{filename, path, revealed}`. Existing filenames
receive a numeric suffix. The folder is a setting, not part of the filename.

Every mutation requires the exact local Host and Origin, JSON content type,
bounded body, and `X-UmaTrace-CSRF` from health. Cross-site origins and requests
are rejected. The frontend loads from the same fixed local origin inside Tauri,
while desktop imports and preferences are saved by the local service.

To organize loose local reports, run `scripts/organize-workspace.ps1` to preview,
then add `-Apply`. It moves root `tmp-*` folders and top-level artifact images,
JSON reports and clips into `.cache/archives/diagnostics-*/` with a restore manifest.
It never deletes files or moves EXEs, launcher folders, captured races, or
`Umalytics-data`. Geometry plots now write to `.cache/reports/`.
