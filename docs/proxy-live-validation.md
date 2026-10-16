# First official-client replay capture

Tested on **October 13, 2026 (America/New_York)** against the installed Steam Global game. File names and status timestamps use UTC, so those files are dated October 14.

## Result

The user restarted the official game and loaded a saved Room Match normally while a process-scoped external proxy ran. The game accepted a temporarily trusted local certificate; the collector decoded its application envelope, exported one race-only JSON file, and the existing parser and browser viewer displayed the real replay. No independent account login, game hook, memory access, request replay or game action automation was used.

This is one successful saved Room Match proof of concept. It does not validate Champions Meetings, all shared-replay entry paths, future builds, distribution/installer behavior, or anti-cheat compatibility.

## Observed pipeline

| Stage | Actual result |
| --- | --- |
| Local routing | Selected the installed UM:PD executable; 29 client connections in the successful inspection run. |
| TLS | 1 API ClientHello; 1 established inspected client handshake; 0 TLS failures. Upstream validation remained enabled. |
| HTTP | 8 API requests/responses; 6 eligible Room Match/Champions-prefix exchanges. No request bodies, account headers or full responses were written to disk. |
| Application envelope | 0 unsupported requests and 0 decode failures; 5 responses without a replay, 1 exported race. |
| Race data | 9 runners, 143 frames, 1,287 runner samples and 88 events. All 9 runners include character IDs and numeric stats. |
| Inner parser | Existing Global binary parser succeeded. Last frame time: 97.3682403564453 simulation seconds. |
| Browser | Folder watcher imported the normalized JSON. Results, runner stats, replay scrubber, speed/HP/distance/lane telemetry and skill-event timeline displayed. Verified at 75 seconds. |
| Cleanup | Capture stopped through the graceful stop file. Windows certificate-removal consent completed. Independent unsandboxed checks returned both `TemporaryCertificatePresent=False` and `CaptureProcessRunning=False`. |

Local artifacts (ignored by Git):

- `captures/inbox/observed-20261014T015038-d33f13e3.json`: 20,922 bytes of allowlisted race scenario and metadata.
- `captures/inbox/race-2026-10-14T01-51-15-887Z-608dfed3.json`: 195,316-byte normalized, portable race export.
- `captures/proxy-status.json`: final sanitized counters for the successful inspection run.
- `test-output/first-real-replay.jpg`: browser evidence of the real imported race.

The portable export deliberately has `synthetic: false`. Original identifiers/trainer/session fields are excluded. Character names currently appear as IDs; course/distance metadata is absent. The viewer uses observed distance for its replay extent without labelling it an official course length. Game finish times and simulation-clock finish times are separate recorded values.

## Issues found and fixed

The first inspection established TLS and the user could load a replay, but the filter selected no HTTP exchanges. Inspection of the installed mitmproxy 12.2.3 source showed that its transparent HTTP layer sets `request.host` to the original server address. Requiring that field to equal the API hostname was incorrect for local capture. The filter now requires both the exact TLS SNI and HTTP authority while leaving the destination address unchanged. IPv4/IPv6 and mismatch regression cases pass. The following capture then produced the real race.

Stopping the first run by interrupting its shell did not complete its cleanup block. PowerShell's forced certificate-provider removal also failed because Windows required root-store UI consent. The exact CA was removed with `certutil -user -delstore Root`, and absence was verified before the next run. The test wrapper now uses that removal method and supports a graceful stop file so normal early shutdown reaches its `finally` block. Windows still requires the user to approve the removal dialog on this machine; certificate cleanup must never be inferred solely from process exit.

28 Python codec, extraction and hook-contract tests pass after the host-filter fix. The real export was additionally validated through `npm run import:race` and the browser. No UI or parser source change was required for this captured replay.

## Regular proxy: no administrative elevation

A second experiment on the same evening succeeded using mitmproxy's **regular explicit HTTP proxy** on `127.0.0.1:4327`, without WinDivert, an elevated helper, or Windows-wide proxy changes. The launch/test scripts checked that their Windows token was unelevated. Certificate installation still required Windows Current User root-store consent; that is separate from administrative elevation.

Directly starting the game from the wrapper initially caused Steam to replace it, so that attempt did not establish whether the running game inherited proxy variables. A temporary **Uma-only Steam Launch Option** then invoked `launch-with-proxy.ps1 -WaitForExit -GameExecutable %command%`. The wrapper set HTTP/HTTPS/ALL proxy variables only in the game child's environment. The running game PID matched the recorded child PID throughout both successful tests; no game modification or independent authentication was involved.

| Check | Observed result |
| --- | --- |
| Listener control | An explicit curl HTTPS request succeeded through the regular proxy with original TLS. This was a separate run and is excluded from game counters below. |
| Game routing probe | 2 client connections and 2 CONNECT requests, including 1 API CONNECT and 1 API ClientHello. Replay loaded normally. No certificate trust used. |
| HTTPS inspection | 2 connections; 1 inspected API TLS handshake; 13 API requests/responses; 11 eligible race-prefix responses. |
| Decoding | 10 eligible responses without a scenario; 1 race exported; 0 TLS, unsupported-format, decoding, backlog or write failures. |
| Inner replay | 9 runners, 113 frames, 1,017 runner samples and 71 events; last frame at 77.38914489746094 simulation seconds. Portable export is 155,502 bytes with `synthetic: false`. |
| Viewer | Folder watcher loaded the new normalized filename. Browser showed imported race, 9-runner stats/results, 01:17.4 replay duration, telemetry and event timeline. |
| Cleanup | User closed the game and restored the previously empty Steam Launch Options. Graceful stop completed certificate removal. Independent checks found no temporary CA, listener, owned proxy process or running game. |

Sanitized local evidence:

- `captures/proxy-regular-probe-result.json` and `captures/proxy-regular-inspect-result.json`: stopped counters for the two game tests.
- `captures/proxy-regular-launch.json`: child/parent PIDs, local proxy address, unelevated flag and exit status; no credentials or Steam arguments.
- `captures/inbox/observed-20261014T030436-e31fc4cf.json`: 17,688-byte allowlisted replay.
- `captures/inbox/race-2026-10-14T03-05-28-036Z-3657f8bb.json`: portable parsed export, loaded by the viewer.

The 28 Python tests pass after adding CONNECT counters, and the updated PowerShell scripts parse successfully. The Windows PowerShell 5.1 wrapper was exercised through Steam. This verifies a practical capture path without administrator rights on this machine. It does not yet package proxy startup, Steam launch configuration, certificate lifecycle or recovery into a single application action. The exact replay entry route for this second test was not separately classified as a shared replay or Champions flow, so those modes remain unverified.

## Silent certificate installation test

On October 13, 2026 at approximately 11:15 p.m. America/New_York, the user authorized a temporary test of Microsoft's documented `CryptUIWizImport` API using `CRYPTUI_WIZ_NO_UI | CRYPTUI_WIZ_IMPORT_ALLOW_CERT`, followed by certificate removal if installation succeeded. The exact previously reviewed CA was absent from Current User and Local Machine Root beforehand. Both the supervisor and import worker refused an elevated Windows token.

**Result: the no-UI import did not suppress Windows trusted-root consent.** The same call first succeeded against an in-memory certificate store in 137 ms, validating the input and native API binding without changing persistent trust. The subsequent Current User Root call displayed the Windows Security Warning shown in the user's screenshot, naming mitmproxy and matching thumbprint `49019503DD723E11240A2AA7FC3091CA9B4C29C1`. No approval was given. The supervisor terminated its owned worker at the 40-second timeout; the user confirmed the warning had closed.

The certificate never became trusted: the root-store lookup remained negative and a Windows chain build reported `UntrustedRoot`. Independent checks after the dialog closed found the exact certificate absent from both root stores and the worker stopped. No deletion was needed because installation had not completed. No proxy, game launch, policy change, UI automation or machine-store installation was involved.

The reproducible bounded test is `scripts/proxy/test-certificate-silent.ps1`, with its native binding in `SilentCertificateImport.cs`. It runs a hidden, unelevated child, records fixed diagnostics, and uses exact-thumbprint cleanup in `finally` if a certificate was actually added. Invoke the supervisor rather than its internal `-Worker` branch. Local evidence is `captures/certificate-silent-result.json` and `captures/certificate-silent-worker.json`.

This result applies to the tested API, flags and Windows installation; it is not a proof that every possible Windows certificate deployment mechanism requires this dialog. For the currently validated non-admin collector, retain first-use root-certificate consent. Reusing an approved certificate across sessions avoids repeating installation, subject to expiry, replacement or removal.

References: [Microsoft import API](https://learn.microsoft.com/en-us/windows/win32/api/cryptuiapi/nf-cryptuiapi-cryptuiwizimport), [import structure](https://learn.microsoft.com/en-us/windows/win32/api/cryptuiapi/ns-cryptuiapi-cryptui_wiz_import_src_info), and [store API](https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-certopenstore).

## Process-only CA file experiment

Tested on October 13, 2026 at approximately 11:30 p.m. America/New_York. The candidate settings were `CURL_CA_BUNDLE` and `SSL_CERT_FILE`, both scoped to the child launched by the Steam wrapper. They pointed to a PEM bundle containing existing public Windows roots and the same reviewed proxy CA. No Windows certificate installation was involved. **This configuration failed for the installed game:** two API TLS handshakes failed, none succeeded, and the user reported connection issues to the game servers.

The independent control test used Python's explicit SSL context, not the game or curl CLI. It sent CONNECT and a TLS handshake only, with no HTTP request inside the tunnel. Default roots rejected the proxy certificate with verification code 20 (`unable to get local issuer certificate`). Supplying the public bundle succeeded with TLS 1.3. This validates the bundle and proxy configuration; it does not establish that Uma supports the environment variables. The control proxy was stopped before the game test, so its counters cannot be mistaken for game traffic.

Both Current User and Local Machine Root lacked the exact CA before preparation. The supervisor and Steam launcher refuse an elevated token. PowerShell parsing and the Windows PowerShell 5.1 launcher plan passed; the 28 existing Python tests passed. A bounded raw-byte scan of UnityPlayer.dll, GameAssembly.dll, and global-metadata.dat found no direct ASCII/UTF-16 occurrences of either variable. UnityTLS explicit/default-CA names are present. These are static string observations, not a decompiled trace proving which verifier the game calls.

The Steam wrapper recorded an unelevated child launch with both variables and the expected bundle hash. The game reached the proxy twice, with two API CONNECTs and two ClientHellos, but no established inspected TLS session, HTTP exchange or race export. The child exited normally at 23:31:53, and the graceful stop finished at 23:32:08. This rules out the supplied combined configuration for this run; it does not prove every possible process-local trust mechanism is unavailable or distinguish ignored variables from every other possible TLS failure.

The user confirmed Steam Launch Options were restored to empty. Independent cleanup at 23:32:56 verified both Windows roots lacked the test CA, no game or mitmdump process was running, and no listener remained on port 4327. The temporary public bundle and its manifest were removed. The existing proxy CA/key in LocalAppData were left untouched and untrusted.

Local evidence: `captures/proxy-ca-file-controls.json`, `captures/proxy-ca-file-control-status.json`, `captures/ca-file-static-candidates.json`, `captures/proxy-ca-file-launch.json`, `captures/proxy-ca-file-result.json`, and `captures/proxy-ca-file-cleanup.json`. The control and game runs have separate counters. The previously successful regular proxy with explicit Current User root consent remains the validated acquisition route.

## TLS session-key logging experiment

Tested on October 13, 2026 from approximately 11:49 to 11:53 p.m. America/New_York. **No session keys were produced by the game with `SSLKEYLOGFILE` supplied.** The user launched the official Steam Global client through the wrapper and ran a replay. The key-log file remained exactly zero bytes during play and after normal game shutdown.

The test used the regular proxy in Probe mode, preserving the origin's TLS connection and certificate. No CA was installed, TLS verification was not disabled, and no hook or process-memory access was used. The private key-log directory was outside the MEGA-synced project, with access limited to the current Windows user and SYSTEM. The preparation created an empty `game.keys` to verify write access, so existence alone was deliberately not counted as support.

Before the game trial, a separate Python client performed a verified TLS 1.3 handshake using an explicit `SSLContext.keylog_filename`. It wrote five key-log records (998 bytes) to a different control file in the same private directory, then closed the key-log handle and deleted the control keys. It sent no HTTP request. This establishes file access and a functioning control client, not support in Unity. No control secrets entered the game file or the workspace.

| Check | Observed result |
| --- | --- |
| Launcher | Windows PowerShell 5.1; unelevated; only the game child received `SSLKEYLOGFILE`; prepared file initially 0 bytes. |
| Process identity | Running game PID 195788 and parent PID 183988 matched the wrapper's recorded child and parent. |
| Routing | 2 connections and 2 CONNECT requests; 1 exact API CONNECT and 1 API ClientHello. |
| Game behavior | User reported launching the game and running a replay. |
| Key output | 0 bytes and 0 recognized records before, during, and after exit. |
| Exit | Game exited normally at 23:52:19 with code 0; passthrough proxy stopped gracefully at 23:52:33. |
| Cleanup | User confirmed Launch Options cleared. At 23:53:10, no game/proxy process or port-4327 listener remained, both root stores lacked the test CA, and neither user nor machine had a persistent `SSLKEYLOGFILE` setting. Empty key file, private test directory and active manifest removed. |

Probe's zero `api_tls_established` counter is expected: the proxy did not terminate TLS. It is not evidence of a failed game handshake. No packet recording or decryption was attempted in this trial because the prerequisite game session secrets were absent. The result applies to this setting on this build; it does not prove that every possible instrumented or undocumented key-export mechanism is absent.

Sanitized evidence: `captures/tls-keylog-control.json`, `captures/tls-keylog-launch.json`, `captures/tls-keylog-running-check.json`, `captures/tls-keylog-result.json`, and `captures/tls-keylog-cleanup.json`. The scripts parsed successfully, the Windows PowerShell 5.1 launcher plan and actual Steam launch ran, and the 28 existing Python tests passed. The currently validated capture path remains the regular proxy with explicit certificate trust.
