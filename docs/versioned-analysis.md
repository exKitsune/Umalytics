# Versioned simulation and inference integration

This integration was applied to local commit `3b949edcd54176b26174ba73fb1d302aefbfc09d`, preserving its course capture and race-time logging changes. The branch was not reset. Original files in the installed app's `races` directory were only read.

**Simulator-first analysis now permits unknown-version replay trials.** The updated policy allows the app-owned instrumented simulator to run when original version evidence is unknown; full recorded-field agreement enables its modeled decision timeline. Inference remains separately version-gated. No real date coverage has been invented. See [simulator decisions](simulator-decisions.md) for the current implementation, limits and validation. The artifact/test inventory below documents the initial observation-only integration and is historical.

The handoff's sibling analysis/report matched the kit copies byte for byte. The imported files under `simulation/evidence/` and `simulation/PACKAGE-MANIFEST.json` describe the original handoff; they are not manifests of this adapted application. Published evidence uses lossless JSON name escaping and replaces personal paths with placeholders. The new, separate [application validation report](../simulation/evidence/application-integration-validation.json) contains current artifact identities, source hashes, original capture checks and the new capture result. The [engine acceptance test plan](engine-test-plan.md) gives repeatable commands, pass criteria and the remaining UI checks before registering real coverage.

## Application changes

| Area | Files and behavior |
|---|---|
| Compatibility boundary | `desktop/globalsim_bridge/` preserves the supplied selector, independent comparator, v74 adapter and production `evaluate_for_analysis` gate. Diagnostic entry points remain separate. |
| Original evidence | `desktop/race_evidence.py` maps a narrow original-race schema, checks sidecar capture binding, converts established aware timestamps to UTC, and rejects precision intervals crossing support boundaries or conflicting sidecars. |
| Local service | `desktop/simulation_service.py` and `desktop/service.py` resolve the exact stored entry, run bounded asynchronous jobs, coalesce duplicates, revalidate selections, and serve only manifest-listed inference artifacts. Existing Host, Origin and CSRF protections remain. |
| Actual inference | `src/analysis/version-worker.ts`, `client.ts`, `prepared.ts` and `scripts/build-inference.mjs` load a measured, immutable worker with its own data snapshot. Authorization precedes cache restoration and computation and is repeated before delivery. |
| Recorded viewing | `RecordedReplay.svelte`, `observational-sample.ts`, `App.svelte`, library captions and race display provide recorded results, sample interpolation, events and provenance without invoking HP reconstruction, current skill predicates, course inference or background analysis warming. Decode failures have a terminal state. |
| Model presentation | `ComparedSimulation.svelte` shows compared simulated results only after the production capability gate passes. Larger result details are requested separately. Historical inference with a different UI revision is shown as precomputed inferred data rather than being recomputed by current panels. |
| Capture round trip | `scripts/proxy/race_extract.py`, observer/extract-file, raw types/import/export/share and service allowlists preserve direct course aliases, raw distance, contradictions, collector provenance and original-race evidence. |
| Desktop delivery | `scripts/build-desktop.ps1`, `package-simulator.py`, `desktop/collector.spec` and the locked Rust worker package the executable, Python modules, manifests and pinned offline resources. |

One simulator process runs per evaluation, with one running job and at most one queued job. Identical pending requests coalesce; at most eight completed/in-flight jobs are retained. Simulator files have separate storage, capped at 16 output files / 256 MiB. Cached model output is compared again. Legacy inference cache entries cannot satisfy the new authorization identity; malformed entries are rejected and removed when encountered. Existing legacy files are not destructively purged.

Active analysis is revalidated on delivery, each detail request and a two-second lease. Detected changes clear analysis and restore the original parsed race. A background file change can therefore remain visible until the next lease check (up to two seconds while the browser schedules timers). Each new open performs a fresh gate. No saved `verified` object authorizes a new selection.

## Existing race-time logger: actual semantics

The local logger stores `raced_at` / portable `racedAt` and a display source. `_object_clock` recognizes several clock-like fields, including start, save, result, entry and creation times. Naive date strings retain their wall time. Integer Unix seconds are rendered as a naive UTC-looking string, dropping the original offset marker. A live capture can fall back to `captured_at`. Saved practice history can join `save_time` by course instance, which is not a unique original race identifier.

Consequently, none of those display values automatically becomes original occurrence evidence. The UI's existing logged-time behavior is preserved. New capture observations retain the original scalar, field, sanitized route, unit, available offset and precision, and an explicit scenario/join association. The weaker saved-practice association is labeled `course-instance-only`. Available race-adjacent region/server/build/rules/master candidates are also retained as **unestablished observations**. A viewer build observed while reopening a replay is not promoted to an original game build.

The mapper accepts only explicitly established facts:

```json
{
  "schemaVersion": 1,
  "observations": [],
  "facts": {
    "region": { "value": "documented-region", "source": "upstream-original-race", "reference": "specific original-race evidence" },
    "mode": { "value": "documented-mode", "source": "upstream-original-race", "reference": "specific original-race evidence" },
    "occurredAt": {
      "value": "2020-01-01T12:34:56+00:00",
      "precisionMicros": 1000000,
      "source": "independently-confirmed-original-race",
      "reference": "illustrative schema only; not evidence about any real race"
    }
  }
}
```

This object is `original_race` in raw captures and `originalRace` in portable documents. The other permitted fact fields are `rulesetId`, `gameBuild` and `masterSha256`. Each needs its own source/reference. Occurrence precision describes the half-open interval beginning at the supplied timestamp; it must be explicitly provided, from one microsecond through one day. No machine timezone is inferred. The example above is intentionally not a usable production support claim.

An independently established sidecar may be placed at `<data-dir>/analysis-evidence/<canonical-capture-sha256>.json`. It uses the same schema plus `captureSha256`, bound to the exact selected capture after the service unwraps a selected singleton once. Conflicting captured and sidecar facts fail closed. The catalog exposes an evidence hash; the selected-document API retains the complete bounded provenance. The entry/file hash and canonical gateway hash are different identities and are not interchangeable.

## Installed builds and missing configuration

The Windows preview includes these real local artifacts:

| Kind | Engine ID | Artifact SHA-256 | Data identity |
|---|---|---|---|
| Simulator, desktop build | `globalsim-v74-win-cfa215c90a55d9ff` | `cfa215c90a55d9ff5b1c85e1005cca7155c8d2f02b1bec724329fd66aaef63c1` | `92e00d5d695d02a0c6c6da10ec0df8ffe8df9c61f66d5cb88654ef63cf26b318` |
| Simulator, initial diagnostic build | `globalsim-v74-win-ad239efbbf4f0634` | `ad239efbbf4f0634f385bdcea9b5a2c85d5ba25308c42933387cccbd5c0d590a` | Same measured reference identity |
| Inference | `umalytics-inference-4d8bac21837bdb41-62955a34d3b82cd7` | `4d8bac21837bdb41405d8512647e8782c14a62c1f4428e6db970bb66e86036ed` | `62955a34d3b82cd7d7935587c791301a8b0e2cb8baf2e56389df19954b8c78ad` |

Both simulator binaries come from the locked `daftuyda/GlobalSim` commit `efc2decdfeaff227ada0e9847f5deceb42c3b97f`, v74 profile, full v70 skills and pinned geometry/physics. They are two Windows builds of the same implementation, **not two historical game eras**. The inference bundle contains the actual application formula dependency closure and compiled tables; its separate snapshot includes skills, master/course data, source metadata and geometry. Build manifests record input source hashes. Generated binaries and `simulation/installed-bundles.json` are ignored by Git and rebuilt by the build scripts.

To enable real analysis, a maintainer must supply documented region/mode release windows and/or original rules/build/master identifiers, then register coverage using an installed bundle's exact identity. Historical support requires an actual compatible implementation/data bundle; the included simulator adapter accepts only v74. No such historical implementation or real release mapping was established here. Future inference requires an explicit policy naming a later era or finite interval, the same region/mode, one installed inference identity and a persistent warning. Synthetic test registries are isolated and never copied into production.

## Validation

- `npm test`: all 36 application workflows passed. The real versioned-worker workflow was rerun after final client changes and passed cold calculation, fresh-worker cache restoration, rejection of unversioned cache, unknown/no-worker/no-cache behavior, provisional warning persistence, policy invalidation, artifact mismatch and exact `~1` singleton selection.
- `npm run build`: zero TypeScript/Svelte errors or warnings; Vite reports its existing large-chunk advisory.
- `python -m unittest discover -s tests/globalsim -p 'test_*.py'`: 108 tests run successfully; one external course-test class is deliberately skipped in discovery and run separately.
- `node tests/globalsim/test_contracts.mjs --python python`: 16 contract checks passed using actual Python gateway reports.
- `python tests/room-course-workflow.py`: all eight existing capture/logger checks passed. Additional app tests cover direct setup aliases, 10805/10801 conflicts, raw-distance conflicts, aware clock precision, unestablished viewer builds and sidecar disagreement.
- `node --import tsx tests/versioned-capture-workflow.ts`: real parser → portable export → parser → sharing → actual service import allowlist passed, including contradictory aliases and no normalized-distance feedback.
- `python tests/globalsim/test_course_capture.py --umalytics-root . --globalsim-root .cache/globalsim-source --capture-dir "$env:LOCALAPPDATA\Umalytics\races" --baseline-report simulation/evidence/bridge-regression-results.json --output test-output/course-capture-validation.json`: 16 scoped tests and all seven original file/input hashes passed.
- The locked Windows simulator reproduced all seven diagnostic outcomes: five verified Trials (60 runners, 7,330 pre-finish samples, 481 skills, 26 competition starts), the `c3a24961` mismatch at approximately 7.459194183 s, and `74d99c26` still needing input without engine execution. No tolerance or initial-input changes were made to force agreement.
- New capture `observed-20261017T231417-56bf898d.json`, file SHA-256 `9dd4721665350c36ec44174c778d8211954bf83b21f25da32ad10a91be44633e`, instance 800023, independently verified with both local and packaged workers. Its logged time is `2026-10-17T22:44:16`; original occurrence/offset/version remains unestablished. Its production mode is recorded-only.
- Full `scripts/build-desktop.ps1` build passed: locked Windows worker, PyInstaller and Tauri. Output is `.cache/dist/Umalytics-IntegrationPreview.exe`.
- `python desktop/smoke_packaged.py .cache/desktop-service/UmaTraceService.exe --headless`: launcher, encrypted loopback proxy lifecycle, service, reference assets, 119 geometry bindings, invalid geometry rejection, library/history, settings, single instance and restart checks passed.
- `python tests/simulation-packaged-workflow.py .cache/desktop-service/UmaTraceService.exe --capture "$env:LOCALAPPDATA\Umalytics\races\observed-20261017T231417-56bf898d.json" --engine globalsim-v74-win-cfa215c90a55d9ff --output test-output/packaged-simulation-validation.json`: passed from an unrelated temporary working directory with developer tools removed from PATH. The embedded simulator verified the new capture, manifest-served inference bytes matched their hashes, and the same production service kept an unknown race recorded-only without simulation/cache execution.
- The built browser UI was visually inspected and successfully sought to 60 seconds in recorded-only mode. Screenshot: `test-output/recorded-only-preview.png`.

Detailed generated diagnostic reports stay in ignored `test-output/`; the compact checked-in validation report contains hashes and verdicts, not copied private race payloads.

The full `desktop/smoke_native.py --headless` check now passes, including native launch, argument forwarding, console suppression, tray lifetime, migration and owned session shutdown. The launcher accepts its own frozen runtime only when executable path, executable hash and data directory match; development launchers still reject installed runtimes. Console helpers use `CREATE_NO_WINDOW`, which Windows ignores for GUI programs. The packaged smoke supplies its isolated data directory explicitly. Both tests use harmless launcher fixtures; no actual game was launched and certificate trust was unchanged. Explorer interaction is omitted in headless mode.

The direct `tests/simulation-http-workflow.py` check passed with the actual pinned Windows worker: one cold process launch, a cache hit with a second independent comparison, no model access for unknown evidence, HTTP 409 after binary/policy changes, and independently eligible inference after simulator rejection. Its compatibility facts and registry are synthetic and temporary; original capture bytes and production configuration remain unchanged. The release workflow now carries the immutable inference bundle from the shared frontend build and runs compatibility, artifact-pin and recorded-only gate checks.

## Run locally

From the repository root:

```powershell
npm ci
npm run build:inference
npm run build
python desktop/service.py --serve --no-proxy --port 5419 --data-dir .cache/versioned-preview
```

Open `http://127.0.0.1:5419/` and import a portable/raw replay to inspect the recorded-only experience in isolated storage. `npm start` retains the project's existing development launch flow. To rebuild the complete Windows preview with build prerequisites described in `docs/desktop-package.md`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-desktop.ps1 -OutputFile Umalytics-IntegrationPreview.exe
```

Installed users need neither Git/Cargo nor a source checkout. An optional **diagnostic-only** packaged-service CLI is available:

```powershell
.cache/desktop-service/UmaTraceService.exe --diagnose-capture C:\path\capture.json --diagnose-output C:\path\new-diagnostic.json --diagnose-engine globalsim-v74-win-cfa215c90a55d9ff
```

The output must be a new file distinct from the capture. This command never updates production compatibility and explicitly emits `productAuthorization: false`.

The stock worker provides no hidden-state trace. Matched samples do not validate unsampled intervals, target-speed decisions, cooldowns, failed predicates or RNG state. Those remain unavailable until separately pinned instrumentation and equivalence tests exist.
