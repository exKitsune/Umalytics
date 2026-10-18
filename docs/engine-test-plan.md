# Engine integration acceptance plan

The acceptance question is whether the app selects the right implementation,
executes its measured artifact, independently compares its output, and removes
authorization when the evidence or implementation changes. A diagnostic
`verified` result alone is insufficient.

Real date coverage remains unconfigured. The updated production policy permits an installed simulator trial for unknown versions and exposes its decisions only after a complete recorded-field match and a complete trace. This does not authorize inference. Synthetic coverage must never be installed as production date evidence. See [simulator decisions](simulator-decisions.md).

## Automated checks before each engine upgrade

Run from the repository root with the normal build prerequisites installed:

```powershell
npm ci
npm test
npm run build
python -m unittest discover -s tests/globalsim -p 'test_*.py'
node tests/globalsim/test_contracts.mjs --python python
python tests/launcher-identity-workflow.py
python tests/simulator-checkout-workflow.py
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-desktop.ps1 -OutputFile Umalytics-IntegrationPreview.exe
```

| Check | Required evidence / failure condition |
|---|---|
| Real inference worker | `npm test` runs the compiled immutable worker through HTTP authorization. Cold results and fresh-worker cache restoration agree. Legacy cache, unknown race, changed policy and changed artifact cannot restore authorized analysis. Future warnings survive cache/reload. |
| Independent compatibility | Python and TypeScript contracts cover old/current/future/unknown/conflicting evidence, half-open windows, ambiguous time precision, separate simulator/inference identities, historical bindings and explicit provisional policies. Without an explicit unknown-version trial policy, unknown/unsupported selections touch no model resources. With that policy, only the app-bound simulator may run; inference remains denied. Conflicts and known unsupported eras never acquire trial eligibility. |
| Capture preservation | Original course/distance aliases, conflicting 10805/10801 evidence, race-time value/offset/precision/provenance and original version observations survive collection, portable export, sharing and service import. Derived finish distance cannot become an initial simulator input. |
| Packaging | The shared frontend carries its exact inference bundle to Windows; packaging verifies hashes, builds the locked simulator and embeds its reference resources. No developer checkout or toolchain is required by an installed user. |

## Real simulator through the application HTTP routes

After building, select the bundle from the installed manifest and use a known
matching local capture. The test copies all inputs and creates a temporary,
explicitly synthetic support mapping. It never changes the original or the
production registry.

```powershell
$simBundle = (Get-Content simulation/installed-bundles.json -Raw | ConvertFrom-Json).bundles |
    Where-Object kind -eq 'simulation' | Select-Object -Last 1
$captureDir = Join-Path $env:LOCALAPPDATA 'Umalytics/races'
$matchingCapture = Join-Path $captureDir 'observed-20261017T231417-56bf898d.json'
python tests/simulation-http-workflow.py --capture $matchingCapture --engine $simBundle.engine_id --output test-output/simulation-http-validation.json
```

Pass requires all of the following:

1. The real service resolves selected entry `~1`, calls `evaluate_for_analysis`,
   and launches the exact manifest-listed executable once. Its measured hash
   matches; engine elapsed time is positive; the cold request has no cache hit.
2. Independent comparison passes before modeled details are exposed. Summary
   polling excludes replay arrays. Reopening a traced race executes again and
   compares again; observation-only builds may reuse cached model output.
3. With unknown-version trials disabled, an unknown original version loads no
   model references, launches no process and leaves the cache unchanged. With
   trials enabled, the bound simulator executes and can expose a complete trace
   after comparison; inference remains unavailable.
4. Appending bytes to the disposable executable revokes prior detail access
   with HTTP 409 and prevents another process launch, even with a populated
   cache. An independently eligible inference bundle remains authorized.
5. Changing the test policy revokes prior authorization with HTTP 409. Original
   capture bytes and the production registry remain identical.

The call counters wrap the real process runner and comparator. They do not
stub simulation output. This distinguishes a working dependency declaration
from actual engine use in the production request path.

## Original diagnostic corpus and packaged application

```powershell
python simulation/run_fixture_regressions.py --captures $captureDir --engine $simBundle.artifact --umalytics . --globalsim .cache/globalsim-saved --engine-sha256 $simBundle.artifact_sha256 --output test-output/globalsim-regression.json
python tests/globalsim/test_course_capture.py --umalytics-root . --globalsim-root .cache/globalsim-saved --capture-dir $captureDir --baseline-report simulation/evidence/bridge-regression-results.json --output test-output/course-capture-validation.json
python tests/simulation-packaged-workflow.py .cache/desktop-service/UmaTraceService.exe --capture $matchingCapture --engine $simBundle.engine_id --output test-output/packaged-simulation-validation.json
python desktop/smoke_packaged.py .cache/desktop-service/UmaTraceService.exe --headless
python desktop/smoke_native.py .cache/dist/Umalytics-IntegrationPreview.exe --headless
```

The corpus baseline is five verified races, the existing `c3a24961` mismatch
near 7.459194183 seconds, and `74d99c26` needing input without execution. Keep
file and prepared-input hashes fixed. A changed verdict requires investigation;
never alter initial conditions or loosen tolerances to recover green tests.

The packaged test runs from unrelated temporary storage with developer tools
removed from PATH. It proves the embedded simulator and inference artifacts
are available, policy-disabled unknown races still deny analysis, and production
unknown-version trials can expose matching complete traces. Native smoke tests
use a harmless launcher fixture, isolated app
storage and temporary untrusted certificates. They check argument forwarding,
proxy environment, tray lifetime, migration and shutdown. Close the installed
app first if it owns ports 4317/4327; the test refuses to take those ports.

## UI acceptance when real coverage becomes available

Record engine IDs, artifact/data hashes, original evidence, verdict and a
screenshot for each row. This checklist is still required before declaring a
new real era supported; synthetic tests cannot establish that claim.

| Scenario | Expected visible behavior |
|---|---|
| Unknown original version | Recorded viewing works; the configured trial can expose complete matching simulator decisions, with the unknown-version notice. No inference is authorized. |
| Contradictory original version | Recorded results, frames, events and seeking work; conflict notice; no mechanics-derived panels. |
| Compatible simulator and matching replay | Compared simulated fields appear with provenance; hidden state stays unavailable unless independently supported. |
| Simulation mismatch or missing input; eligible inference | Only that eligible inference implementation is used; simulation rejection remains in diagnostics. |
| Historical race with matching installed implementation | Actual historical worker/data identity is shown; no relabeled current bundle. |
| Historical race without implementation | Older-version notice and recorded replay only. |
| Future race without explicit policy | Newer-update notice and recorded replay only. |
| Future race with explicit provisional policy | Registered inference only; warning persists during display, cache/reload and exported analysis. |
| Evidence, registry or artifact changes while open | New detail requests fail immediately; displayed analysis clears on the next two-second lease check, subject to browser timer scheduling. |

## Upstream updates

The saved source lock pins traced commit `231f346a46b569dd4d0f91a0046326275667d1c7`,
its v74 parent `efc2decdfeaff227ada0e9847f5deceb42c3b97f`, and the instrumented
source hash. Resource pins still identify the original v74 data. Umalytics currently has no upstream
dependency notification job or automated update PR configuration. Its desktop
updater checks Umalytics releases, not new GlobalSim commits.

The former upstream repository is currently unavailable. The private backup
preserves this version but does not mirror future updates automatically. See
[saved-source recovery and CI setup](simulator-backup.md). New source requires
authorized upstream access and a deliberate mirror update.
An upgrade must update the source lock, Cargo lock when needed and resource pins
together, rebuild measured bundles, rerun this plan, and review support mappings
for simulators and inference independently. Preserve old bundles when existing
historical coverage requires them.


## Decision-trace acceptance

1. Prepare the pinned instrumented source with `python scripts/prepare-simulator.py --source .cache/globalsim-saved`, then build the locked worker. Check the manifest pins and isolated source identity.
   Instrumentation files must retain identical bytes under Git's Windows CRLF,
   LF and input-only checkout settings; the checkout regression runs in CI.
2. For every corpus capture, run the original pinned worker, patched worker with tracing off, and patched worker with tracing on. Remove only `decisionTrace`; require complete JSON output equality, unchanged prepared-input hash and unchanged comparison verdict. Keep the known mismatch and missing-input capture as negative controls.
3. Require each actual wit roll to agree with its threshold/result; exempt skills must have no roll. Include failed ordinary lotteries and forced activation. Check condition/precondition stages, skipped predicates, activation ordering, cooldown and effect delivery.
4. Include spurt success without any roll, multiple rejected candidates, accepted/rejected lottery rolls, fallback and recovery recalculation. Do not invent rolls for calculations that did not draw.
5. Select a blocking tick in the UI. Compare both before/after clamp pairs against the worker row, verify blocker mapping after gate reordering, and inspect position-keep/near-lane timers. Show local clamp reductions without labeling their sum as finish-time loss.
6. Real HTTP tests must cover known-version match, policy-disabled unknown, policy-enabled unknown match, no inference from a trial, fresh trace execution on reopening, identity tamper, policy invalidation and payload projection. A mismatch or incomplete trace must not show decision panels.
7. In the browser, seek a time between ticks, switch runners and skills, page the decision log, reload the race, and switch to the known mismatch. Confirm discrete sampling, correct runner/skill labels and removal of simulator panels. Export the full trace with its provenance.
8. Run application tests/build, Python gateway tests, TypeScript contracts, packaged worker/service smoke and native smoke. Compare upstream Rust failures against the untouched pin; any new failure blocks delivery. The current eleven pre-existing upstream failures are documented separately, not counted as passes.

The full-output parity check is reproducible with a preserved original worker:

```powershell
python tests/decision-trace-parity.py --baseline <original-worker.exe> --engine <instrumented-worker.exe> --source .cache/globalsim-saved --capture-dir $captureDir --capture $matchingCapture --output test-output/decision-trace-validation.json
```

The original seven fixtures are checked against the committed capture/input
manifest; additional captures receive separate hashes and verdicts. This command
also validates the trace schema and actual wit/spurt lottery results.
