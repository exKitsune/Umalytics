# Official-client proxy experiment

The collector observes responses from the game the user is playing. It does not sign in as a second client, poll replay endpoints, or initiate game actions. **One saved Room Match is now validated end to end** on the installed Steam Global build: HTTPS inspection, application-envelope decoding, inner replay parsing and browser display. Other replay modes and future builds remain unverified. See [the live test record](proxy-live-validation.md).

## Stages

1. **Probe:** mitmproxy local capture selects the installed UM:PD executable. The addon tunnels every TLS connection unchanged using `tls_clienthello.ignore_connection`. Only numerical connection/known-API-SNI counters are written. No certificate is trusted and no plaintext race is expected in this stage. Start a fresh game connection after capture starts; an already-established connection may not appear.
2. **Inspect:** after reviewing and explicitly approving the particular locally generated CA, trust its public certificate in this Windows user's root store. Intercept only exact SNI the exact game API host; all other TLS hosts pass through. Upstream certificate validation remains enabled. Current-user trust has wider scope than this application: other applications using that root store may also accept certificates signed by this CA. It is not a game-only trust exception.
3. **Decode:** for HTTPS POSTs under the game API prefix, keep only a temporary request-derived IV. Decode the matching response offline, copy allowlisted race fields, and atomically write JSON into `captures/inbox`. Career, Team Trials, practice/Room Match, Champions Meeting and other categories default to enabled; dynamic settings can disable individual categories. No full response, request, auth header, account identifier, or flow recording is saved. The viewer's bounded parser still needs to validate the inner replay binary. See [collection settings and portable JSON](collection-format.md).

The process selector handles routing without changing the Windows global proxy, hosts file, or game installation. Windows local capture uses mitmproxy's privileged WinDivert redirector and may require Windows consent. This is not a guarantee of anti-cheat compatibility or undetectability. See [mitmproxy modes](https://docs.mitmproxy.org/stable/concepts/modes/) and the [Windows implementation](https://www.mitmproxy.org/posts/local-capture/windows/).

## Regular proxy experiment

`start-proxy.ps1 -Transport Regular -Stage Probe -DurationSeconds 600` instead starts an explicit HTTP proxy on `127.0.0.1:4327`, without the packet redirector or Windows proxy changes. In Probe it tunnels HTTPS unchanged, so no CA trust is needed. Only clients explicitly configured to use it are routed. **This path captured and decoded one real replay without administrative elevation on the tested Steam Global installation.** See the [regular-proxy evidence](proxy-live-validation.md#regular-proxy-no-administrative-elevation).

`launch-with-proxy.ps1` sets `http_proxy`, `https_proxy`, `all_proxy` and local bypass entries only in the launched game's environment. It refuses an elevated token or an already-running game and records only launch time, PIDs, the local proxy address and scope. `-Plan` validates without launching; `-WaitForExit` keeps the wrapper alive for Steam. The wrapper forwards Steam's game arguments without logging them. Windows and the existing Steam process environment are unchanged.

A direct launch was replaced by Steam on this machine, losing reliable evidence of inherited proxy variables. The successful experiment used a temporary per-game Steam Launch Option to invoke this wrapper with `%command%` under Steam. The actual running game remained the wrapper's child and its API traffic reached the listener. With the proxy already listening, the tested option was:

```text
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\path\Umalytics\scripts\proxy\launch-with-proxy.ps1" -WaitForExit -GameExecutable %command%
```

Adapt the script path for another checkout. Execution policy override applies only to this PowerShell invocation. Record and restore any existing launch options rather than overwriting them. For the temporary test, close the game and restore its previous options before stopping the proxy, so future normal launches do not depend on a stopped listener. Only Uma was configured; existing Steam and other games were not redirected through a global setting.

### Console-free Steam launcher

The PowerShell test wrapper can briefly show a console before `-WindowStyle Hidden` takes effect. `UmaTraceLauncher.cs` replaces that wrapper with a Windows-subsystem (`winexe`) executable. Normal launches start the game directly through `ProcessStartInfo`; no PowerShell or command shell is spawned. Its manifest requests the caller's existing permissions, and it refuses an elevated token.

Build locally with `scripts/proxy/build-launcher.ps1`. The Windows .NET Framework compiler produces `.cache/launcher/UmaTrace.Launcher.exe`, using .NET Framework libraries already installed on the tested machine. The Steam option is:

```text
"C:\path\Umalytics\.cache\launcher\UmaTrace.Launcher.exe" -- %command%
```

The collector must already be running before using this option. The launcher checks the loopback listener, then starts Uma with child-only proxy settings and waits for its exit so Steam can track the game lifetime. It preserves the game's working directory and forwards all arguments after its executable path; arguments and account data are not logged. A failed preflight shows a brief explanatory dialog. This launcher currently **checks** the listener; it does not install certificates, start the collector, configure startup, or edit Steam settings. Keep the older script for the separate experimental CA-file/key-log tests.

`--check -- <game-executable>` performs preflight without launching anything or displaying a dialog. `--quiet` suppresses error dialogs for diagnostics. A sanitized status record is written to `%LOCALAPPDATA%\UmaTrace\launcher\latest-launch.json`.

`C:\Python312\python.exe tests/launcher/test_launcher.py` compiles and launches only a harmless stand-in under `.cache/launcher-tests`. It requires Steam to be running, no real Uma process, and port 4327 to be free. It verifies the Windows GUI PE subsystem, absence of a console in the launcher/child, actual argument round-tripping (including empty, quoted, Unicode and trailing-backslash arguments), child-only proxy environment, working directory, exit-code propagation, and refusal to launch when the proxy is unavailable. These checks passed on October 14, 2026. An actual Steam/game launch with the new executable remains to be verified; prior real replay captures used the PowerShell wrapper.

For temporary HTTPS inspection after approval of the specific CA, use `test-https.ps1 -Transport Regular -ExpectedThumbprint <reviewed-thumbprint> -DurationSeconds 600`. This refuses an elevated token, installs the Current User CA, starts inspection, and removes the CA afterward. Create `captures/proxy-regular-test.stop` to end it gracefully. Certificate consent remains necessary even though regular mode needs no administrative capture helper. A packaged application must still manage this lifecycle and its Steam launch integration.

A separate authorized test of `CryptUIWizImport` with its documented no-UI flag still displayed the Current User trusted-root warning on this machine. The operation was not approved; the worker timed out and both root stores were verified clear afterward. Do not promise silent first-time trust based on that flag. See the [silent-import test evidence](proxy-live-validation.md#silent-certificate-installation-test).

Regular-proxy counters go to `captures/proxy-regular-status.json` separately from the successful local-capture evidence. `http_connect_requests` counts all CONNECT requests; `api_connect_requests` counts only the exact API host on port 443. Zero race exports in Probe are expected. A positive control request must be distinguished from game traffic.

### Experimental game-only CA file

`test-game-ca-file.ps1 -ExpectedThumbprint <reviewed-thumbprint> -PrepareOnly` builds a public PEM bundle containing the existing Windows roots plus the reviewed proxy CA. It does not install a certificate, export private keys, or launch anything. Both Windows root stores must be clear of the test CA, and the Windows token must be unelevated. The bundle and integrity manifest stay under `.cache/proxy-ca-file/`.

Omitting `-PrepareOnly` runs a bounded regular-proxy inspection test (default 300 seconds, maximum 600). For this experiment only, add `-TestCaFile` to the Steam wrapper option before `-GameExecutable`. The wrapper sets `CURL_CA_BUNDLE` and `SSL_CERT_FILE` only in the game child's environment, using the prepared bundle. It verifies its hash, the matching public certificate, and absence of Windows root trust. The proxy keeps upstream TLS validation enabled. Normal inspection still requires the approved Windows root; the explicit experimental switch instead requires root trust to be absent.

This compatibility probe **failed on the installed game**: two API TLS attempts failed and the user saw connection errors, while an independent client succeeded with the same explicit CA file. Cleanup verified unchanged Windows trust and restored launch options. See the [test record](proxy-live-validation.md#process-only-ca-file-experiment). It is not a documented Unity Player feature: [curl's CA environment variables](https://curl.se/docs/sslcerts.html) are documented for its command-line tool; the [libcurl environment-variable list](https://curl.se/libcurl/c/libcurl-env.html) does not promise them. Unity's explicit-CA verification functions are in-process APIs and do not by themselves establish a launch setting. The installed files contain those UnityTLS functions but no direct ASCII/UTF-16 references to either candidate variable in the three files checked; the bounded scan is saved in `captures/ca-file-static-candidates.json`.

Counters and launch/result records use `captures/proxy-ca-file-*`, separately from the successful regular-proxy proof. Create `captures/proxy-ca-file-test.stop` for graceful shutdown. Restore the previous Steam launch options and close the game when finished. A connection failure means these settings did not produce a working configuration for that run; it does not prove every possible game-specific trust mechanism is unavailable. Do not turn off certificate verification to make the test pass.

### Experimental TLS session-key logging

**Result on the tested Steam Global build:** the replay ran, but `SSLKEYLOGFILE` produced no bytes or records, including after game shutdown. Private files were removed and original launch settings restored. See the [live test record](proxy-live-validation.md#tls-session-key-logging-experiment). This is a retained diagnostic experiment, not a working acquisition option.

`test-tls-keylog.ps1 -PrepareOnly` creates a unique private directory under `%LOCALAPPDATA%\UmaTrace\tls-keylog`, limits its permissions to the current user and SYSTEM, and prepares an empty `game.keys`. Only paths and counts go into the synced workspace. File existence is not evidence of support: the preparation itself creates the empty file to verify write access.

`test-tls-keylog.ps1 -UsePrepared -DurationSeconds 600` starts a bounded **Probe**, preserving all original TLS connections. The matching Steam wrapper option adds `-TestKeyLog` before `-GameExecutable`. This supplies `SSLKEYLOGFILE` only to the game child. It cannot be combined with the CA-file experiment. The supervisor refuses inherited key logging so proxy/control keys cannot contaminate the game result. No certificate is imported, and both the supervisor and game wrapper require unelevated tokens.

The probe records game API CONNECT/ClientHello counters separately in `captures/tls-keylog-proxy-status.json`. `tls-keylog-launch.json` records the child PID, key-log path and test identity. `tls-keylog-result.json` contains only root-store checks, byte counts and counts of recognized key-log record labels. Session secrets must never be printed, saved in `captures/`, or included in a shared race export. A working independent Python key-log control validates file access and the concept, not support in Uma.

Create `captures/tls-keylog-test.stop` to stop gracefully. Close the game and restore Steam Launch Options before ending the proxy. Inspect the final key-log counts after the game exits, in case output was buffered. If genuine game keys exist, correlate them with a fresh bounded packet capture before claiming usable race decryption. Otherwise retain the sanitized result and remove the temporary empty file/session manifest.

The standard environment variable is supported only by participating TLS implementations; it is not a Windows-wide switch. References: [Wireshark TLS decryption](https://wiki.wireshark.org/TLS), [libcurl environment variables](https://curl.se/libcurl/c/libcurl-env.html).

## Runtime setup

The installed Windows executable runs, but its embedded Python environment lacks `msgpack`, needed by this addon. Use the official PyPI package in a workspace virtual environment. Python 3.12 is installed here at `C:\Python312\python.exe`; adapt that path for another machine.

```powershell
C:\Python312\python.exe -m venv .cache/proxy-venv
.\.cache\proxy-venv\Scripts\python.exe -m pip install -r scripts/proxy/requirements.txt
npm test
```

This installs neither a trusted CA nor a Windows proxy setting. The launcher uses this venv's `mitmdump.exe`. Production CA files are kept at `%LOCALAPPDATA%\UmaTrace\proxy`, outside the MEGA-synced source folder. Never distribute the generated `mitmproxy-ca.pem` private key or copy that directory into a repository.

## Run

```powershell
# Print the exact configuration without starting anything:
.\scripts\proxy\start-proxy.ps1 -Stage Plan

# Bounded routing test; no TLS decryption:
.\scripts\proxy\start-proxy.ps1 -Stage Probe -DurationSeconds 180

# Only after the specific CA has been reviewed and explicitly trusted:
.\scripts\proxy\start-proxy.ps1 -Stage Inspect -DurationSeconds 180
```

The launcher checks the generated certificate's exact thumbprint in `Cert:\CurrentUser\Root` before inspection. It does not add trust itself. When stopped, local capture ceases. No global proxy configuration requires restoration. If a CA was trusted for a test, remove that exact thumbprint afterward unless the user elects to retain it.

For an explicitly approved temporary test, `test-https.ps1 -ExpectedThumbprint <reviewed-thumbprint> -DurationSeconds 300` installs only that certificate, runs inspection, and invokes `certutil -user -delstore Root` in a `finally` block. It refuses a changed certificate or pre-existing trust. Windows can require visible confirmation for both installation and removal. To stop early, create `captures/proxy-test.stop`; the addon exits gracefully and the wrapper proceeds to certificate removal. The duration timer provides the other normal stop path. Interrupting the whole shell can skip cleanup, so independently verify the exact Current User root thumbprint is absent after any interruption. Do not use `Remove-Item -Force` as the only cleanup path: it failed here because the user root store required UI consent.

`captures/proxy-status.json` contains the stage, state, update timestamp and counters. `client_connections` alone does not prove the game API was reached; `api_tls_hellos` does. Probe intentionally has no established MITM TLS sessions or exports. In Inspect, `api_tls_established` confirms a completed client TLS handshake. A failure alone does not distinguish pinning from unsupported roots, certificate generation/handshake problems or connectivity errors. Do not disable validation or patch the game to hide a failure.

The addon refuses insecure upstream TLS or flow recording options. Requests outside the exact API POST scope stream through without body collection. Eligible bodies are bounded to 16 MiB, with a smaller historical codec bound; oversized or unknown messages are counted and passed to the game unchanged. Decoding/export runs off the event loop. Up to eight export jobs and 128 request contexts are retained; unsupported contexts are discarded. Repeated downloads may produce duplicate files. Champions chart-only responses are not joined heuristically with a different race.

Local/transparent capture sets `request.host` from the original destination address, which may be an IP. The HTTP filter therefore checks both exact TLS SNI and HTTP Host/`:authority` (with optional `:443`), plus HTTPS, port, method and path. It does not rewrite the game's destination. Regression tests cover IPv4/IPv6 destinations and mismatched SNI/authority.

Start the local viewer with `npm start`, open `http://127.0.0.1:4318`, and choose **Watch local folder**. Only a successfully decoded genuine replay proves the complete capture-to-viewer path. Use the viewer's **Export JSON** for sharing, rather than packet captures or original network logs.

## Current evidence

- The offline codec, race allowlist and hook-contract tests pass with synthetic data.
- The installed binary's missing `msgpack` dependency was identified before redirecting game traffic.
- The official PyPI runtime (12.2.3) loads the addon and shuts down successfully on its duration timer and graceful stop file. All 28 Python codec/extraction/hook tests pass in that runtime's environment.
- The 2026-10-13 local probe observed 30 selected client connections, including one ClientHello for the exact API hostname. The user closed/reopened the game from its desktop shortcut, loaded a saved Room Match and completed it normally. This establishes routing and normal operation for the tested replay; the payload remained encrypted.
- Authorized temporary inspection succeeded for one real saved Room Match. The corrected run observed 8 API requests/responses, of which 6 matched the race endpoint filter; 5 contained no replay and 1 yielded race JSON. No unsupported request, decoding, write, backlog or TLS failure was recorded. The resulting export contains 9 runners, 143 frames and 88 events.
- After the test, capture was stopped and absence of the exact temporary Current User root certificate was independently verified. First-run certificate consent is also required for other installations of this HTTPS interception design.

See the [codec contract](proxy-codec.md) and [overall acquisition plan](acquisition-plan.md).
