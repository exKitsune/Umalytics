# GlobalSim maintenance investigation and update procedure

Reviewed 2026-10-18. This is a source/evidence investigation and a maintenance procedure; no game mechanics were changed and no new game build was reverse engineered for this report.

## What we can maintain today

We can build, inspect, instrument and modify the preserved simulator independently of its original repository. We have the Rust implementation, data snapshots, 63 captured regression fixtures, numeric reference vectors, integration tests and our observation hooks. We do **not** yet have a complete reproducible pipeline for recovering an unfamiliar future game update. The main missing pieces are exact engine-data exporters, a reproducible parameter/mechanics extraction procedure, and a larger capture corpus tied to actual game eras.

The working locations are `F:\CodeWorkspace\Umalytics` and `F:\CodeWorkspace\GlobalSim`. The saved traced revision is `231f346a46b569dd4d0f91a0046326275667d1c7`; its original v74 parent is `efc2decdfeaff227ada0e9847f5deceb42c3b97f`. The original history and both pre-migration source backups remain recoverable. `VERSION=v74`, Cargo's `0.1.0`, the parameter definition string `20180828`, capture/export dates, and the game's actual mechanics version are different identities.

## What the author's records establish

| Finding | Evidence and confidence |
|---|---|
| The detailed implementation was reconstructed from the Global client, with intermediate Python implementations ported to Rust. | Explicit source comments in [retail physics](../../GlobalSim/src/retail_physics.rs), [field coordination](../../GlobalSim/src/race_field.rs), [condition parser](../../GlobalSim/src/condition_parser.rs), and [last-spurt search](../../GlobalSim/src/retail_spurt.rs). This establishes the recorded lineage; the original Python source is not included. |
| Parameters were read from a loaded client using metadata-resolved offsets. | [global_parameters.json, source](../../GlobalSim/data/global_parameters.json) names `RaceManager._paramDefine`, the module hash, extraction date, RNG field type, and particular method RVAs. These are the author's provenance records, not a fresh extraction independently repeated here. |
| Geometry came from installed course assets with master-table identity checks. | [Course 10501](../../GlobalSim/data/course_geometry/10501.json) records animation, event, overrun and master hashes. [The loader](../../GlobalSim/src/retail_geometry.rs) checks course identity, logical asset names, rotations and sample counts. |
| Fidelity depends on execution order and numeric behavior, beyond the mathematical formulas. | [Architecture](../../GlobalSim/docs/ARCHITECTURE.md) documents shared RNG, ordered field passes, float32 stores, wider intermediate arithmetic, receiver ordering and the 0.0666 s tick. [The sort implementation](../../GlobalSim/src/retail_sort.rs) reproduces framework tie behavior. |
| Corrections were driven by frozen captures, isolated hypotheses and regression controls. | [The final v74 audit](../../GlobalSim/evidence/new-races-20261017-morning.json) reports one remaining discrepant race, three passing controls and 40 configuration matches. It changed one final lane-boundary comparison, then reran 203,572 races; 203,571 full outputs remained unchanged. |
| The author explicitly distinguished model inference from observed game behavior. | The same audit labels the hidden lane decision as inferred and records an alternative implementation that also matched the available observations. [Accuracy definitions](../../GlobalSim/docs/ACCURACY.md) limit exactness to recorded precision, cadence and supported fields. |

The supported reconstruction of the workflow is: inspect client code and data, build a component model, preserve the client's RNG/numeric/order behavior, run from pre-race inputs, compare against independent recordings, isolate the earliest discrepancy, change the smallest justified mechanism, and rerun regression controls and the complete available corpus.

The author's particular disassembler, live extraction scripts and full working research environment are unknown. Public searches did not establish an additional primary explanation of those tools. An older cached GitHub v73 page is not evidence that the original repository is accessible again. No claim here depends on anonymous commentary about the author.

The source contains 119 course geometry documents plus a catalog and 63 compressed accuracy fixtures. The full reported 203,572-race corpus is **not** bundled. The referenced `retail_physics.py`, `tools/build_course_geometry_catalog.py` and `tools/compare_horseact.py` are absent from the saved checkout. Several headers retain old development wording; executable behavior, the pinned release profile and tests take precedence over those comments.

## What an update can change

| Change | Modules/data to investigate | Required evidence |
|---|---|---|
| Skill definitions or new skills | `data/v70-skill-data.json`; `race_solver_builder.rs`, `activation_conditions.rs`, `condition_parser.rs`, `retail_initialization.rs`, `race_solver.rs` | Exact master projection; changed conditions/usages/targets/lottery behavior; new-skill captures and unchanged controls. Unknown conditions/effects must fail explicitly. |
| Physics, stamina, stats or spurt | `global_parameters.json`; `retail_physics.rs`, `hp_policy.rs`, `retail_spurt.rs`, `race_solver_builder.rs` | Changed parameters or named client functions; operation order and float bits; boundary fixtures; official replay comparisons. |
| RNG or initialization | `retail_random.rs`, `retail_initialization.rs`, `rushing.rs`, `starting_grid.rs` | Signed seed boundaries, draw ordinals, initialization-stage counts, ordering and random wrapper precision. One extra draw can alter the entire race. |
| Traffic, pacing, competition or lanes | `race_field_retail.rs`, `race_field.rs`, `race_solver_retail.rs`, `retail_position_keep.rs`, `retail_lane.rs`, `retail_states.rs` | Cached versus live state, field-pass order, equality boundaries, participant ordering and one-tick cases. |
| Courses | `course_data.json`, `course_geometry/*`, `retail_geometry.rs`, `retail_geometry_assets.rs` | Master identity, complete serialized events, unrounded curves/rotations, widths and overrun assets. |
| Replay layout | Umalytics `desktop/globalsim_bridge/comparator.py` and `src/data/binary.ts` | Independently established field layout/stride/version and wire quantization. Decoder changes alone do not establish changed mechanics. |

A client executable update may concern only presentation; a master update may add data without changing formulas. Classify the change before editing the simulator. The client is useful evidence but is not automatically identical to the server: existing source comments document some client/server precision differences.

## Preserve evidence before the next game update

Use a private local directory outside either Git checkout, for example `F:\CodeWorkspace\GlobalSim-maintenance\snapshots\<unique-build-id>`. Keep each snapshot immutable after verification. Do not commit native binaries, complete master databases, asset bundles or private race captures into Umalytics.

For explicitly selected installed files, preserve the native module, matching IL2CPP metadata when present, master database and asset catalog. Record file sizes and SHA-256 before and after copying; reject a changing input. Preserve the exact course assets used by extraction with their logical names and hashes. Take copies from a stable installation, with the game closed if its updater can replace files. Source paths in unrelated old reports are not target selection.

The snapshot manifest should contain:

```json
{
  "schemaVersion": 1,
  "region": "global",
  "platform": "windows-steam",
  "acquiredAtUtc": "<actual snapshot time>",
  "clientVersion": null,
  "storeBuildId": null,
  "mechanicsEra": null,
  "sourceCommit": "<measured simulator commit>",
  "toolchain": "<rustc/cargo/python and extractor versions>",
  "files": [
    {"role": "native-module", "path": "inputs/native-module.bin", "bytes": 0, "sha256": "<measured>"},
    {"role": "il2cpp-metadata", "path": "inputs/global-metadata.dat", "bytes": 0, "sha256": "<measured>"},
    {"role": "master", "path": "inputs/master.mdb", "bytes": 0, "sha256": "<measured>"},
    {"role": "asset-catalog", "path": "inputs/meta", "bytes": 0, "sha256": "<measured>"}
  ]
}
```

This illustrates the schema, not real measured values. Add a logical-name/hash entry for every selected asset and hashes for generated outputs. Leave unavailable version evidence null. Acquisition time and filesystem modification time must never silently become the race's original date or a mechanics cutoff.

For each capture, keep original bytes, original occurrence evidence and timezone/precision, mode/region, pre-race input hash, engine/data/profile hashes and the independent expected observations. Maintain both a regression set used while fixing bugs and a separate newly collected holdout. Record incomplete inputs and known mismatches as distinct outcomes rather than dropping them from denominators.

## Existing extractors and the remaining schema work

These commands already exist. They read only the explicitly selected master/cache and write to the requested output. Use a Python environment with `scripts/requirements-geometry.txt` dependencies available. Run them against a stable installation or a complete private copy; do not overwrite current production references.

```powershell
Set-Location F:\CodeWorkspace\Umalytics
$masterPath = Read-Host 'Full path to the selected stable master.mdb'
$gameCachePath = Read-Host 'Full path to its asset cache containing meta and dat'
$snapshot = Join-Path 'F:\CodeWorkspace\GlobalSim-maintenance\snapshots' ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
New-Item -ItemType Directory -Path $snapshot -ErrorAction Stop | Out-Null
python scripts/extract-game-reference.py --master $masterPath --cache $gameCachePath --output "$snapshot/reference"
if ($LASTEXITCODE -ne 0) { throw 'Reference extraction failed.' }
python scripts/extract-course-geometry.py --master $masterPath --cache $gameCachePath --reference "$snapshot/reference/courses.json" --output "$snapshot/geometry"
if ($LASTEXITCODE -ne 0) { throw 'Geometry extraction failed.' }
```

[Master extraction](../scripts/extract-reference-metadata.py) already preserves raw skill values, conditions, preconditions, duration/cooldown usages and target fields. [Course extraction](../scripts/extract-game-reference.py) resolves installed master courses and CourseParamTable assets. [Geometry extraction](../scripts/extract-course-geometry.py) preserves full raw CourseLaneAnim values in `all-course-assets.json`.

These outputs are not yet a drop-in GlobalSim upgrade:

| Required exporter work | Why it matters |
|---|---|
| Convert master skills to the exact GlobalSim schema. | The engine needs `alternatives`, `baseDuration`, `cooldown`, `wisdomCheck`, `priority`, `tags`, effect `modifier`, `target`, `targetValue`, `additionalActivate`, `valueUsage`, `levelModifiers`, plus general/inactive classification. The app's `branches`, `rawValue`, `activateLot` and `levelUsage` are a different representation. Priority/classification and level tables need their own proven mapping; do not default them silently. See [skill loading](../../GlobalSim/src/lib.rs) and [value conversion](../../GlobalSim/src/race_solver_builder.rs). |
| Export every raw course event with original precision. | The public extractor keeps only kinds 0/2/11 and rounds event distances to two decimals. GlobalSim consumes kind 3 lane-width changes and kind 7 inward-movement overrides, plus corner identity and straight-entry state. Retain other rows as diagnostics. |
| Generate exact per-course geometry and its source catalog. | GlobalSim requires 1001 aligned XYZ/quaternion samples, verified course identity and logical asset names, source hashes, turn-specific `rotation_fix`, `distance_to_world`, and applicable overrun data. The app's public `course-geometry.json` rounds XYZ to three decimals and must not be fed into physics. Use retained raw assets, then reproduce the engine wrapper and checks. |
| Recreate the missing catalog generator. | Generate `retail_geometry_assets.rs` deterministically from validated numeric course files. Reject missing/duplicate identities; do not hand-copy include lists during an update. |
| Recover/compare live parameters and changed native behavior. | We have the prior extraction result but not its extraction program. A new parameter snapshot needs version-bound metadata resolution or independently established static values, with preserved float bits. Never reuse old RVAs/offsets merely because names look similar. |

Before trusting a new exporter, reproduce the current baseline from matching original inputs and compare all engine-consumed fields, order and numeric bits. Where those exact original inputs are unavailable, label the missing baseline and validate the new extraction directly against the selected client and captures. Do not describe byte equality as established without running it.

## When REA is appropriate

REA was not invoked for this source-only investigation. Its `reverse-engineer-anything` skill directs ordinary source analysis through normal repository tools. It becomes useful when a future discrepancy requires evidence from a selected shipped module, package or runtime.

For that work:

1. Bind the explicitly selected native binary with REA `open_binary`; record its hash and matching metadata identity. Reuse retained evidence only when that identity matches.
2. Resolve the affected names/callers and inspect a narrow function family: e.g. `RaceManager`, `RaceUtil.CalcActivatePer`, `HorseLastSpurtCalculator`, relevant lane/skill classes, or the RNG wrapper. The existing RVAs identify the old build only.
3. Compare branch boundaries, conversions, helper calls, receiver order and state writes with the saved Rust implementation. Store evidence IDs and locations beside each proposed change. Do not infer execution from static pseudocode.
4. If static evidence cannot establish a live parameter or state relationship, use a supported explicitly selected runtime observation. Keep its evidence separate from server-replay comparison. Missing REA providers or metadata tooling are a concrete dependency to resolve, not evidence that a mechanic is unchanged.
5. Close an opened native analysis session after exporting its evidence. A new interpretation remains a hypothesis until the relevant captures and controls support it.

REA cannot recover unavailable server-only behavior from a client that no longer contains it. In that case use controlled capture comparisons, retain alternatives and uncertainty, and keep the existing inference fallback available.

## Local validation commands and gates

The snippets below are procedures for the next update, not tests executed by this investigation. Use a fresh run directory and record toolchain versions. The shipped v74 documentation reports **133 passes and 11 existing failures** in its Rust suite. Our tracing fork adds tests; its current total should be measured, not copied from that number.

Build and run the bundled official-observation fixtures:

```powershell
Set-Location F:\CodeWorkspace\GlobalSim
$run = Join-Path 'F:\CodeWorkspace\GlobalSim-maintenance\runs' ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
New-Item -ItemType Directory -Path $run -ErrorAction Stop | Out-Null
rustc --version
cargo --version
python --version
cargo build --release --locked --target-dir "$run/target"
if ($LASTEXITCODE -ne 0) { throw 'Simulator build failed.' }
$engine = Join-Path $run 'target/release/race_engine_rs_v2.exe'
python tools/check_accuracy_regressions.py --engine $engine --report "$run/captured-regressions.json"
if ($LASTEXITCODE -ne 0) { throw 'Captured regression failed.' }
```

All 63 fixtures must pass for a v74-preserving change. For an intentional new-era mechanics implementation, retain the old v74 engine and its passing fixtures; route each capture to its actual profile. A new engine may legitimately differ on old-era inputs, but each permitted difference needs an explicit era/behavior explanation and independent new-era acceptance. Do not relabel every old regression as expected failure.

Run the Rust suite and compare the **exact failed-test set**, not just its count:

```powershell
$knownReport = Get-Content 'evidence/new-races-20261017-morning.json' -Raw | ConvertFrom-Json
$expectedFailures = @($knownReport.unitTests.defaultRelease.failures | Sort-Object)
$log = Join-Path $run 'rust-tests.txt'
cargo test --release --locked --lib --target-dir "$run/target" -- --format pretty --test-threads=1 2>&1 | Tee-Object -FilePath $log
$testExit = $LASTEXITCODE
$lines = Get-Content -LiteralPath $log
$actualFailures = @($lines | ForEach-Object {
    if ($_ -match '^test (\S+) \.\.\. FAILED$') { $Matches[1] }
} | Sort-Object)
if ($testExit -notin @(0, 101) -or -not ($lines -match '^test result:')) {
    throw 'Test compilation or harness did not complete normally.'
}
$addedFailures = @($actualFailures | Where-Object { $_ -notin $expectedFailures })
$removedFailures = @($expectedFailures | Where-Object { $_ -notin $actualFailures })
if ($addedFailures.Count -or $removedFailures.Count) {
    [PSCustomObject]@{ added = $addedFailures; removed = $removedFailures } | ConvertTo-Json
    throw 'Failed-test baseline changed; investigate before updating the baseline.'
}
if ($testExit -eq 0 -and $actualFailures.Count -ne 0) { throw 'Inconsistent test result.' }
Write-Output "Completed with $($actualFailures.Count) documented failures; these are not passes."
```

Freeze the expected report from the known source revision before editing it. Also compare discovered test names/ignored tests with a fresh baseline so removing tests cannot make this gate green. Re-run the `fast-alloc` variant if that feature will ship. A known failure becoming a pass also deserves review: determine whether the correction is justified, then deliberately update the baseline. Do not rewrite reference vectors only to make tests pass; some are explicitly Python-model vectors, not captured game outcomes.

For a behavior-preserving optimization or source/toolchain upgrade, exercise the persistent worker and binary interfaces:

```powershell
python tools/check_worker_parity.py --engine $engine --baseline $previousEngine --inputs examples/v74-race.jsonl --isolation
if ($LASTEXITCODE -ne 0) { throw 'Worker parity failed.' }
python -m unittest discover -s tests -p test_replay_protocol.py
if ($LASTEXITCODE -ne 0) { throw 'Protocol tests failed.' }
python tools/check_replay_protocol.py --engine $engine --baseline $previousEngine --inputs examples/v74-race.jsonl --isolation
if ($LASTEXITCODE -ne 0) { throw 'Binary/JSON parity failed.' }
```

`$previousEngine` must be assigned to the preserved, hash-verified executable being compared. Add actual captured inputs and malformed/changed-data cases; the example alone is a smoke check. For prepared library changes also run `tools/check_native_parity.py --library <candidate DLL> --baseline <matching candidate worker> --inputs <corpus JSONL> --isolation`.

The trace gate has two different uses:

- **Instrumentation-only change:** old untraced output = candidate trace-off = candidate trace-on after removing only observation output. Preserve the existing expected match/mismatch/input-incomplete cases.
- **Intentional mechanics change:** candidate trace-off = candidate trace-on, then compare the candidate against independent official observations for that era. Do not require a corrected/new ruleset to reproduce every old implementation error.

[Our existing trace checker](../tests/decision-trace-parity.py) already runs these three outputs. For candidate self-parity it can take the same executable for `--baseline` and `--engine` and explicit `--capture` paths. However, arbitrary-capture comparison verdicts are only reported; without expected manifest entries a mismatch does not fail that script. Add a clear candidate-only mode and a manifest-based verdict gate before treating it as release acceptance. Preserve raw capture and prepared-input hashes.

The [bridge comparator](../desktop/globalsim_bridge/comparator.py) already reports first observed discrepancies. Extend it with a diagnostic report that brackets the last matching recorded sample and the first mismatch, joins relevant motion/condition rows, and compares shared RNG stages/draw ordinals. An exact model tick can be identified between two simulator runs; a sparse official recording only establishes an interval. Do not claim a hidden official tick or roll from interpolation.

Finally run the Umalytics checks from its root:

```powershell
Set-Location F:\CodeWorkspace\Umalytics
python tests/simulator-source-workflow.py
python tests/simulator-checkout-workflow.py
python -m unittest discover -s tests/globalsim -p 'test_*.py'
node tests/globalsim/test_contracts.mjs --python python
npm test
npm run build
```

Require each command to succeed. Then run the real HTTP, packaged-engine, desktop/native, tray and update/rollback checks in [the engine acceptance plan](engine-test-plan.md) and [the release workflow](../.github/workflows/release.yml). Keep tests isolated from the installed app and its captures. Present the test UI and relevant non-UI diffs for user approval before any commit or push, as [AGENTS.md](../AGENTS.md) requires.

## Integration changes needed before a second mechanics profile

The registry can select engines, but the current implementation still has v74-specific assumptions. [adapter.py](../desktop/globalsim_bridge/adapter.py) hardcodes reference hashes, geometry manifest hash, settings filename and identity profile. [package-simulator.py](../scripts/package-simulator.py) hardcodes the v74 bundle name/version/profile. These must become explicit per-profile manifests/loaders while retaining the old profile and artifacts. Merely replacing a global hash would prevent reliable multi-era use.

A reviewed profile must bind source commit, upstream lineage, code/data/settings hashes, trace schema, comparator/adapter identity, binary artifact and established game-era evidence. Preserve the current simulator-trial/inference policy and dashboard fallback behavior. Mismatch is a rejected simulation, not permission to show its hidden decisions; inference has its own identity and compatibility rules. Date ranges should come from documented original-race evidence, not from the date we downloaded the build.

For a mechanics change, regenerate/review trace instrumentation provenance and its source hash, then update `simulation/source-lock.json` only after the new traced source is reviewed and committed. Rebuild the measured bundle and publish through the normal reviewed Umalytics release. Keep historical bundles where required. `cargo update` alone neither changes the pinned private source nor updates its data or mechanics.

## Recommended next implementation order

1. **Snapshot tool and corpus manifest:** explicit input paths, copy/hash verification, private artifacts, build/data identities, capture provenance and distinct missing/mismatch/error outcomes. This preserves the evidence needed before an updater removes an older client.
2. **Exact engine-data export:** extend the current read-only extractors with an engine-specific unrounded schema, complete course events and reproducible catalog generation; add schema/round-trip checks. Recover live parameter extraction only against a selected matching target.
3. **Upgrade runner:** preserve old executable/profile, build a candidate in isolated output, enforce known-failure/test-inventory gates, run all applicable captured fixtures and independent holdout cases, check trace noninterference, and produce a compact diff report without publishing anything.
4. **Versioned profile support and divergence diagnostics:** remove v74-global assumptions, preserve historical data, expose the first observed divergence interval plus implicated RNG/state changes, and review every changed verdict.
5. **First real update rehearsal:** snapshot a selected current build, reproduce its data and an actual capture, then compare it with a future build. Only that exercise can demonstrate the full maintenance workflow end to end.

This gives us a realistic route to maintaining GlobalSim when upstream is unavailable. The saved source is enough to continue development; validation data, recoverable game evidence and exact extraction are what make future updates trustworthy.
