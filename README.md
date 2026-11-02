# Umalytics

A replay and telemetry viewer.

[Download the Windows app](https://github.com/exKitsune/Umalytics/releases/latest) · [Open the web viewer](https://exkitsune.github.io/Umalytics/)

## First-time setup

1. Download **Umalytics.exe** from the [latest release](https://github.com/exKitsune/Umalytics/releases/latest), then open it.
2. Open **Settings → Collection & Certificate → Install certificate**. Approve the Windows prompt once.
3. Under **Steam setup**, click **Copy launch option**.
4. In Steam, right-click the game → **Properties → General → Launch Options**. Paste the copied line.
5. Launch the game from Steam. Look for **Game connected** in Umalytics, then play or open a replay. Captured races appear in the sidebar.

App files are saved in `%LOCALAPPDATA%\Umalytics`. Keep that folder private: it holds your races and capture certificate key. Existing data beside the executable is moved there once and the old folder is removed after verification.

Closing the window keeps collection running in the tray. Use **Exit** in the tray menu to stop it.

## Use the web viewer instead

Already have JSON files from horseACT or another collector? Open the [web viewer](https://exkitsune.github.io/Umalytics/) and import them. No app installation, certificate or Steam changes are needed. Files are processed in your browser.

## Updates and reference data

The app checks GitHub for updates hourly. **Update and restart** installs the
latest app and data. Reference updates can also download files from this
repository. These are normal download requests, not uploads of races or logs.

Reference catalogs use the installed public MDB first: skill definitions and
text, character/outfit names, skill costs, support-card facts, base aptitudes and
unique-skill ownership, plus core course distance/surface/direction/lane/bonus
properties. Curve and elevation geometry stays bundled from game assets. MDB is opened read-only; account/save databases are not
read. Local changes are checked periodically without network requests.

There are no automatic GameTora catalog downloads. Missing entries use bundled
or previously cached fallbacks, including JP definitions, translations and
editorial fields unavailable from the installed Global MDB. Some of those
fallbacks were originally sourced from GameTora; attribution remains. They are
not refreshed from GameTora at runtime. Bundled data updates come through our
normal releases/reference updates. A missing MDB leaves local fallbacks usable.

These connections expose normal network metadata such as your IP and requested
resources to their providers. The hosted web viewer downloads its assets from
GitHub Pages. The game itself still contacts its game servers. The complete app
therefore is not a network-isolated application.

## Capture, privacy and security

Capture, replay analysis and simulation run locally. Umalytics has no automatic
external upload path for your races, diagnostics or debug captures. Imported JSON
in the web viewer is processed in your browser. Exporting or sharing a file
is a separate action. Normal download connections are described under
[Updates and reference data](#updates-and-reference-data).

### What the collector can see

The Steam launcher sets proxy environment variables for the launched game and
its child processes. It does not change the Windows system proxy. The HTTP proxy
and app control service bind to IPv4 loopback (`127.0.0.1`), not a LAN interface.
Production defaults are ports 4327 and 4317 respectively.

TLS inspection uses an **exact hostname allowlist**, defined by `API_HOST` in
[the observer](scripts/proxy/observer.py). Connections with another TLS SNI, or no
SNI, pass through encrypted. Inspection of the allowed API necessarily exposes
its traffic to the local collector in memory; the hostname allowlist is not a
promise that only race-related bytes are decrypted. Normal replay collection
further requires HTTPS on port 443, matching HTTP Host/`:authority`, POST, and an
allowed path prefix. The decoder extracts supported race responses and removes
recognized credential/envelope fields before saving JSON. This is not a general
anonymizer: race and runner information can remain identifiable.

Upstream TLS certificate verification stays enabled. Normal packet/flow dumps
are disabled; processing uses bounded bodies and export queues. Local control
requests are checked for Host and Origin, cross-site requests are rejected, and
mutations require the app's CSRF token. These checks limit browser-based attacks;
they are not an authentication boundary against malware running as your user.

### Certificate trust and retained keys

The collector uses a constrained root CA and one fixed game API server
certificate. We do not use direct peer trust or install the server certificate
itself as a trusted root.

1. Setup generates independent CA and server key pairs in memory.
2. The CA signs the server certificate, then its signing key is discarded. The
   app never saves that CA private key to a file.
3. You explicitly approve the public CA certificate in **Current User → Trusted
   Root Certification Authorities**. This is user-wide trust, not a game-only
   Windows trust store.
4. The collector retains only the server key, encrypted with user-scoped Windows
   DPAPI. The capture directory has a protected ACL for your user and SYSTEM.

The CA has critical DNS Name Constraints permitting the exact API hostname,
excluding its subdomains and all IPv4/IPv6 addresses. Its extended key usage is
TLS server authentication only. The server certificate has one exact DNS SAN,
`CA=false`, no certificate/CRL-signing permission, and TLS-server-only usage.
The proxy serves that fixed certificate; it cannot issue certificates on demand.

**Reject unexpected certificate trust prompts.** Only approve after you click
**Install certificate** in Umalytics Settings. If you did not request it, choose
**No**, even if the prompt says Umalytics. Opening or updating the app never
silently installs new trust. A legitimate migration may separately ask to
**remove** an old certificate; that is different from adding trust.

The `capture/` directory contains the public root/server certificates,
`umalytics-api-key.dpapi`, and an `identity-v3.json` record binding the identity
to its root fingerprint and hostname. It should contain neither
`umalytics-ca.pem` nor `umalytics-ca.p12`. The public root certificate is not secret.

### Limits and compromise scenarios

| What an attacker obtains | What that could enable |
| --- | --- |
| A public certificate alone | It does not supply a private key or grant remote access. |
| The decrypted server key | Impersonating the game API if the attacker also redirects a connection. This can expose game tokens and allow response changes. It cannot issue valid certificates for unrelated sites under normal validation. |
| The CA signing key while setup holds it in memory | Issuing certificates. Supporting clients enforce the root's hostname constraints; clients that ignore trust-anchor constraints may accept certificates for unrelated sites. |
| Code execution as your user, administrator or SYSTEM | Reading local captures, potentially decrypting the retained key, modifying the app, or changing trust settings. These controls do not secure an already-compromised PC. |

**Root constraints are additional protection, not a universal guarantee.**
Our isolated Windows chain and SSL-policy tests reject unrelated DNS names,
subdomains, IPv4/IPv6 addresses, mixed SANs, CN-only certificates, and an
unconstrained replacement root supplied by an attacker. That tests one Windows
validation configuration, not every installed application. Current Chrome and
Edge document enforcement; custom validators, older software and other runtimes
can differ. An application must also trust our root for its failure to enforce
constraints to matter. See [Chromium's policy documentation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/policy/resources/templates/policy_definitions/Miscellaneous/EnforceLocalAnchorConstraintsEnabled.yaml)
and [Edge's documentation](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/EnforceLocalAnchorConstraintsEnabled).

DPAPI protects stored keys against some file-theft scenarios; it does not isolate
keys from malware running as your user. The no-CA-key-on-disk rule concerns files
written by the app: it does not guarantee secure erasure from memory, paging,
crash dumps or backups. Neither certificate automatically grants administrator
rights, redirects traffic, or decrypts arbitrary past HTTPS sessions.

The loopback service, proxy, parsers and update mechanism add attack surface.
Host/Origin/CSRF checks and upstream TLS validation reduce specific risks, but
are not a claim that the app has undergone an independent security audit.

### Migration, removal and uninstall

Migration retires the exact previous root from CurrentUser Root, removes local
legacy PEM/PKCS12 signing keys, and creates a fresh constrained identity. Denying
or failing Windows removal stops migration. Public retirement records allow
retries after interruption. New trust always requires explicit installation.
Other Windows users or devices that trusted an old root need their own removal.

To remove trust, open **Settings → Collection & Certificate → Remove certificate**
and approve Windows removal. This stops the collector and deletes the local
capture key and certificates. Capture stays disabled across restarts until you
create and explicitly trust a new certificate. No CA private key is needed to
remove the public certificate from Windows trust.

For uninstalling, clear the game's Steam Launch Options, optionally use
**Settings → About & uninstall → Delete all saved data**, exit Umalytics from the
tray, then delete `Umalytics.exe`. Data deletion requires confirmation and the
game to be closed. It removes saved races, builds, settings, reference/analysis
caches, logs and capture identity, and stops collection. Downloaded runtime and
active browser-profile files remain; files exported elsewhere are untouched.

Pausing race collection does not remove trust or stop API TLS inspection. To
end capture, remove the certificate, clear the Steam launch option and exit the
collector. Removal prevents new connections from trusting this identity; close
running game connections too. It cannot revoke secrets already stolen. After a
compromise, clean the machine and revoke exposed account sessions or credentials
from a trusted device. Do not restore an old capture identity from backup.
Deletion is not guaranteed forensic erasure.

### Diagnostics and verification

Routine diagnostics are **on by default**, bounded and local under `logs/`.
They record lifecycle events, timestamps, process/build identifiers, exception
types and source-frame locations. Their structured fields exclude HTTP payloads,
game launch arguments and free-form exception messages.

Normal collection also keeps decoded API response archives under
`cache/responses/`, route/status records in `cache/api-trace.jsonl`, and extracted
runner data. These can exist with raw debug capture **off**. Recognized auth and
session envelopes are removed, but other decoded fields remain; these files and
saved race JSON are not guaranteed anonymous or free of personal data. The
routine `logs/` files described above are separate from these response archives.

Full API debug capture is a separate feature, **off by default**. Settings →
Diagnostics provides a guarded toggle: a separate warning popup with three acknowledgements, the exact phrase
`CAPTURE SECRETS`, and a five-second service-enforced delay. **Enable** keeps
capture on across restarts until you turn it off. **Enable for 30 minutes** stops
after 30 minutes or a service restart. The switch and its row turn red while capture is enabled; its popup contains Stop
and log-deletion controls. A warning also remains outside Settings. These safeguards prevent accidental activation; they do not stop
malware that already has your user's access.

Raw files in `development-captures/*.json.gz` record game API requests and
responses, including headers, bodies, authentication material and personal data.
Bodies above 64 MiB are marked unavailable; generated raw captures have a
512 MiB retention limit. Treat these files as secrets: do not
publish them or include them in a support bundle. Neither logging mode uploads
its output automatically.

**Delete all logs and debug captures** disables raw capture, synchronizes with
raw-file writers and deletes local diagnostics and raw captures after confirmation.
It preserves races, certificates, analysis data and normal decoded API archives.
Use **Delete all saved data** to remove those archives too. Routine diagnostics continue
and may create new files afterward. Deletion is not guaranteed forensic erasure.

Power users can inspect [certificate generation and migration](desktop/capture_identity.py),
[exact-root trust operations](desktop/certificate_trust.py),
[TLS store integration](desktop/capture_store.py),
[routing and control API checks](desktop/service.py),
[normal diagnostics](desktop/diagnostics.py), and
[full debug capture](scripts/proxy/development_capture.py), and
[guarded debug controls and deletion](desktop/debug_capture.py).
Inspect the public server certificate with `certutil -dump`, and compare the root
fingerprint shown in Settings with Current User Trusted Root Certification
Authorities in `certmgr.msc`. Use Windows file Security properties to inspect the
capture-folder ACL. Loopback listeners can be inspected with
`Get-NetTCPConnection -State Listen -LocalPort 4317,4327`.

The [identity lifecycle workflow](tests/capture-identity-workflow.py) checks fresh
roots, key separation, permissions, concurrent setup, restart, rejected unrelated
hosts and cancelled migration. The [constrained-root workflow](tests/root-constraints-workflow.py)
uses an isolated Windows trust store to test adversarial certificates. The
[HTTPS capture workflow](tests/capture-inspection-workflow.py) exercises verified
TLS inspection and replay export against a loopback upstream. These workflows
do not install test roots in Windows.

A separate live-game experiment using a non-CA certificate in **Trusted People**
failed: two TLS attempts failed before any API request or response. Its temporary
trust and key were removed. A server certificate installed as a trusted root
was not tested with the game and is not the chosen design. The constrained-CA
build still needs live-game compatibility verification; successful loopback and
Windows policy tests do not replace that check.

See [capture security details](docs/capture-key-security.md) for test commands
and the on-disk contract.

## Notices

Third-party code, data and artwork retain their copyrights and licenses. See the [code notice](src/data/THIRD_PARTY_LICENSE.txt), [data notice](public/data/NOTICE.txt), [portrait notice](public/portraits/NOTICE.txt) and [icon notice](public/icons/NOTICE.txt).
