# Umalytics

A replay and telemetry viewer.

[Download the Windows app](https://github.com/exKitsune/Umalytics/releases/latest)

## First-time setup

1. Download **Umalytics.exe** from the [latest release](https://github.com/exKitsune/Umalytics/releases/latest), then open it.
2. Open **Settings → Collection & Certificate → Install certificate**. Approve the Windows prompt once.
3. Under **Steam setup**, click **Copy launch option**.
4. In Steam, right-click the game → **Properties → General → Launch Options**. Paste the copied line.
5. Launch the game from Steam. Look for **Game connected** in Umalytics, then play or open a replay. Captured races appear in the sidebar.

App files are saved in `%LOCALAPPDATA%\Umalytics`. Keep that folder private: it holds your races and capture certificate key.

Closing the window keeps collection running in the tray. Use **Exit** in the tray menu to stop it.

## Import existing races

Already have JSON files from horseACT or another collector? Click **Import race
JSON** or drop them onto the app. Importing files does not need certificate or
Steam setup.

## Updates and reference data

The app checks GitHub for updates once an hour. **Update and restart** installs
the latest app and data. Update requests share normal connection information,
such as your IP address, but do not upload your races or logs.

Names, skills, outfits and course information come from the game's installed
master database (MDB) where available. We open it read-only and use its public
reference tables, not account or save databases. Course shapes and elevation
come from bundled game assets.

Missing data uses bundled or cached references, including JP skill definitions
and translations. Some references originally came from GameTora, but the app
does not download catalogs from GameTora in the background. Reference updates
come from this repository. Analysis still works without an installed MDB.

## How capture works

The Steam launch option starts the game with a local proxy. It applies to the
game and its child processes; it does not change your Windows system proxy or
route your browser through Umalytics.

The proxy inspects HTTPS connections only when the TLS hostname exactly matches
the game API. Other hostnames, or connections without a hostname, pass through
encrypted. The proxy still verifies the real game server's certificate before
connecting upstream.

This lets Umalytics read API traffic, including traffic that is not about races.
Saving supported race responses uses further checks on the port, HTTP hostname,
request method and API path. Recognized authentication and session fields are
removed when the capture is saved, but race and runner data can still identify you.
Race JSON export uses that saved capture, not our analysis model or the full API
response. Trainer names and IDs are anonymized by default. Turn this off in
Settings → Storage to export the saved capture unchanged.

Capture, analysis and simulation run on your computer. **Umalytics does not
automatically upload races, API archives or logs.** Exporting or sharing files is
your choice. The game still connects to its servers, and app updates still use
GitHub, so the app is not completely disconnected from the internet.

### What is saved

Files live under `%LOCALAPPDATA%\Umalytics`.

| Files | What they contain |
| --- | --- |
| Saved races and runner data | Replay information used by the viewer and simulator. |
| `cache/responses/` and `cache/api-trace.jsonl` | Decoded API responses and route/status records. These are saved during normal collection, even when raw debug capture is off. Recognized auth/session fields are removed; other fields remain. |
| `logs/` | Routine diagnostics, such as startup, shutdown, errors and build information. These logs exclude HTTP bodies, game launch arguments and free-form error messages. |
| `development-captures/` | Raw game API requests and responses, including headers, bodies, tokens and personal data. Created only when you enable raw debug capture. |

Keep this folder private. Removing known secret fields does not make every saved
file anonymous or safe to share.

### Raw debug capture

**Raw debug capture is off by default.** It is separate from routine diagnostics
and the decoded API archives above.

In **Settings → Diagnostics**, turning it on opens a warning. You must accept
three acknowledgements, type `CAPTURE SECRETS`, and wait five seconds. **Enable**
keeps it on until you turn it off, including across restarts. **Enable for 30
minutes** stops after 30 minutes or a service restart. The switch turns red and
the app shows a warning while it is on.

These files can contain account secrets. Do not publish them or share them
without removing secrets first. Body and storage limits apply, so raw capture
is not guaranteed to preserve every byte.

**Delete all logs and debug captures** turns raw capture off and deletes those
files after confirmation. It keeps races, normal decoded API archives and
analysis data. Use **Delete all saved data** to remove those too. Routine logs
may appear again while the app is running.

## Why a certificate is needed

HTTPS normally prevents a proxy from reading traffic. To collect replays,
Umalytics presents its own certificate for the game API, which you explicitly
allow Windows to trust.

Setup creates two separate key pairs: one for a certificate authority (CA), and
one for the proxy's server certificate. The CA signs that one server certificate,
then its signing key is discarded. **The app never saves the CA private key to a
file.** Only the separate server key is kept, encrypted for your Windows account.

**Copying the public certificate does not let someone forge certificates.**
An attacker needs a private key. Even if they decrypt the saved server key, it
is not the CA signing key and cannot issue valid certificates for other sites
under normal certificate validation. Ignoring the CA's hostname constraints
alone does not give an attacker the missing signing key.

The saved server key could still let an attacker impersonate the game API if
they also redirect a connection through their server. That could expose game
tokens or let them change API responses.

**Unexpected certificate trust prompt? Choose No.** Only approve after you click
**Install certificate** in Umalytics Settings. Do not approve an unexpected
prompt just because it says Umalytics. Opening or updating the app never
silently installs new trust.

### Protections and their limits

Windows trusts the public CA certificate under **Current User → Trusted Root
Certification Authorities**. This trust applies to your Windows user, not just
the game. We reduce its scope and protect the keys in several ways:

- **The CA is restricted to one hostname.** Its critical Name Constraints permit
  only the exact game API hostname, exclude subdomains and IP addresses, and its
  extended key usage permits only TLS server authentication.
- **The server certificate cannot act as a CA.** It has one exact DNS SAN,
  `CA=false`, no certificate-signing permission, and TLS-server-only usage. The
  proxy serves this fixed certificate instead of creating certificates on demand.
- **The saved key is protected at rest.** Windows DPAPI encrypts it for your user.
  The capture folder's access rules allow your user and SYSTEM.
- **The services listen only on your computer.** The proxy and app API bind to
  `127.0.0.1`, not a LAN interface. The app API checks Host and Origin and requires
  a CSRF token for changes, helping prevent websites from controlling it.

These protections have limits. Some applications do not enforce constraints on
trusted roots. If an attacker stole the CA signing key while setup held it in
memory, those applications could accept forged certificates for other sites,
provided they also trust our root and the attacker can redirect their traffic.
Current Chrome and Edge document enforcement; other clients and older versions
can differ. See the [Chrome](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/policy/resources/templates/policy_definitions/Miscellaneous/EnforceLocalAnchorConstraintsEnabled.yaml)
and [Edge](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/EnforceLocalAnchorConstraintsEnabled)
documentation.

DPAPI and file permissions do not protect the key from malware already running
as your user, an administrator or SYSTEM. Such malware may read captures,
decrypt the server key, change the app or add its own trusted certificates.
Discarding the CA key also does not guarantee that no copy could remain in
memory, paging or a crash dump.

The proxy, local API, file parsers and updater add software that could contain
bugs. These measures reduce specific risks; they do not make a compromised PC
safe or replace an independent security audit. A certificate alone grants no
administrator rights and does not decrypt arbitrary past HTTPS connections.

## Stop capture or uninstall

Pausing race collection stops normal saving, but it does not remove certificate
trust or stop API TLS inspection.

1. Close the game. In **Settings → Collection & Certificate**, choose **Remove
   certificate** and approve Windows removal. This stops collection and deletes
   the local capture certificates and key. Capture stays disabled until you
   create and explicitly trust a new certificate.
2. Clear the game's Steam Launch Options.
3. Optionally choose **Settings → About & uninstall → Delete all saved data**.
   It asks for confirmation and removes races, saved builds, settings, caches,
   logs and the capture identity. Downloaded runtime and active browser-profile
   files remain. Files exported elsewhere are untouched.
4. Exit Umalytics from its tray menu. To uninstall, delete `Umalytics.exe`.

Removing trust does not need the CA private key. It prevents new connections
from trusting certificates issued under that root for this Windows user. Any
other user or device where you installed it needs its own removal.

If you suspect a compromise, clean the PC and revoke exposed account sessions
or credentials from a trusted device. Removing a certificate cannot undo stolen
data, and deleting files is not guaranteed forensic erasure. Do not restore an
old capture identity from backup.

## Verify the implementation

The source is available for inspection:

- [Certificate creation and key protection](desktop/capture_identity.py),
  [Windows trust operations](desktop/certificate_trust.py), and
  [fixed-certificate TLS integration](desktop/capture_store.py).
- [API hostname and export checks](scripts/proxy/observer.py) and
  [local control API](desktop/service.py).
- [Routine diagnostics](desktop/diagnostics.py),
  [raw capture](scripts/proxy/development_capture.py), and
  [debug controls and deletion](desktop/debug_capture.py).

Use `certmgr.msc` to compare the trusted root's fingerprint with Settings, and
`certutil -dump` to inspect the public certificates. In `capture/`, the server
key is `umalytics-api-key.dpapi`; the identity record is `identity-v3.json`.
There should be no CA private-key files named `umalytics-ca.pem` or
`umalytics-ca.p12`. Inspect folder permissions through Windows Security properties.
The default API/proxy listeners are ports 4317 and 4327; check them with
`Get-NetTCPConnection -State Listen -LocalPort 4317,4327`.

Our [Windows constraint tests](tests/root-constraints-workflow.py) reject
out-of-scope certificates, including ones signed with a simulated stolen CA key.
[Identity tests](tests/capture-identity-workflow.py) check key separation,
permissions and restart behavior. [HTTPS capture tests](tests/capture-inspection-workflow.py)
check verified connections and replay export against a local test server.
They do not install roots in Windows or prove that every application enforces
the same rules. The constrained-CA build still needs a live-game capture check.
See [capture security details](docs/capture-key-security.md) for the full test
setup and file layout.

## License and source

Umalytics original software is licensed under [AGPL-3.0-only](LICENSE),
without warranty. You may redistribute and modify it under those terms.
Third-party material retains its own licenses; see [NOTICE](NOTICE).

Each desktop release includes **Umalytics-source.zip**, containing the matching
application, modified GlobalSim, worker, dependency sources, and build instructions.
Download it beside the executable for the same version. See
[source and licensing](docs/licensing.md) for rebuilding and release checks.

## Notices

Third-party code, data and artwork retain their copyrights and licenses. See the [code notice](src/data/THIRD_PARTY_LICENSE.txt), [data notice](public/data/NOTICE.txt), [portrait notice](public/portraits/NOTICE.txt) and [icon notice](public/icons/NOTICE.txt).
