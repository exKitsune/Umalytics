# Collector handoff after an app update

The native launcher reuses a collector only when its health response identifies
the same canonical installation data directory and runtime executable. Packaged
runtimes live under the embedded service digest, so replacing the app produces
a distinct executable path. The health identity is the actual frozen executable;
source development reports the Python executable.

An older runtime belonging to the same installation is asked to exit through
the local Origin/CSRF-protected API. The launcher requires zero game connections
and a stopped or fully listening collector, rechecks health before the request,
waits for the API listener to close, and then launches the new runtime. New
services also refuse a conditional exit if capture becomes active or the
collector's readiness is uncertain. Active capture gets a short message asking
the user to close the game and reopen the app.

Legacy health without a runtime field can establish ownership through the same
canonical data directory. It still needs an explicit zero connection count and
idle/readiness confirmation. Those older endpoints lack the final conditional
exit guard; the launcher makes a fresh health check before requesting exit.
Malformed identities, another installation, an unrelated port listener, refused
exit or an old listener that has not closed produce an error and prevent launch.
The launcher does not terminate processes forcibly. Tray exit targets only its
own runtime and installation.

The native functional workflow uses the actual startup module, a previous
packaged service and current source services in disposable installations. It
checks idle legacy and modern handoff, exact runtime reuse, preservation of
foreign installations and unrelated HTTP listeners, updated served HTML and
skill metadata. A real collector observes held synthetic loopback TLS with
game SNI; handoff is refused and conditional exit returns 409 while that
connection remains active. No game or certificate-trust change is involved.

```powershell
cargo build --offline --manifest-path tests/runtime-handoff/Cargo.toml --target-dir .cache/runtime-handoff-target
.cache/proxy-venv/Scripts/python.exe tests/runtime-handoff-workflow.py --legacy-service .cache/desktop-service/UmaTraceService.exe --harness .cache/runtime-handoff-target/debug/umalytics-runtime-handoff-check.exe --alternate-python (Get-Command python).Source
```

The legacy service argument must point to a preserved build whose health lacks
runtime identity, and the alternate Python must differ from the workflow's
interpreter. Run this before overwriting the old packaged service. A still-open
legacy GUI may retain its loaded frontend; close that GUI before opening the
replacement app. This handoff changes the collector serving new page loads.
