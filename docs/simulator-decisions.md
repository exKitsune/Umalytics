# Simulator-first race analysis

A matched simulator is now the primary mechanics source. The production path is stored race selection → app-owned installed artifact → input-only setup → fresh instrumented execution → independent recorded-field comparison → simulator timeline. Existing inference is a separately authorized fallback; its formulas do not populate the simulator panels.

## What is traced

- Each equipped skill's actual initialization wit check: whether a roll was required, roll, threshold, result and shared-stream draw range. Exempt checks draw nothing. Ordinary wit failure and forced activation are distinct.
- Static skill condition windows, sampled random triggers, each dynamic predicate actually evaluated, precondition latching, activation windows, cooldown readiness, activation, effect evaluation/application/defer/immunity/recipient delivery and effect-end callbacks.
- Every last-spurt calculation's input, each feasibility search, each lottery actually drawn, its threshold/candidate/result, the fallback and the plan the state machine retains. An immediate maximum-speed plan needs no lottery. Recalculation does not necessarily replace the original start point.
- Per-movement-tick target/base/section/pace values, acceleration, exact before/after values of both speed clamps, blocker/gap, HP, lane target, phase, spurt, rushing, downhill, position-keep mode, force-in, Spot Struggle, Duel, Conserve Power and continuous blocking/near-lane/overtake timers.
- Actual raw draws from the retail shared RNG, with ordinal and execution context. These are observations of existing calls, not an extra RNG replay.

The UI opens the trace automatically after a match. Runner selection and time are synchronized with recorded playback. Skills, spurt decisions, states and clamp reductions have dedicated views, with a filtered/paginated decision log. Export analysis includes the full trace and its authorization/provenance.

A state snapshot is discrete and is never interpolated. Motion rows describe the pre-displacement movement calculation on that tick; the published replay frames describe the resulting race. Continuous timers use the engine's own update order. Identical checks on consecutive ticks are compressed into a series with count, first/last tick/time and first/last sequence. Intermediate within-tick ordering is not reconstructed from a compressed series. Skipped predicates remain skipped. `complete` means no observation was dropped under this schema, not that every CPU branch or every unknown game mechanic is instrumented.

## Meaning of a match

The independent comparator still covers the supported recorded result fields, pre-finish sampled movement/state and supported skill/competition observations at their captured precision. No tolerance was relaxed. An agreement authorizes the simulator's explanation, labeled **Simulated**. The recording does not independently establish unrecorded private decisions. Different internal executions can theoretically produce indistinguishable sampled observations.

Blocking displays two exact local clamp reductions. They are separate stages; summing them is not a race-time penalty. A different no-traffic race would change other runners, acceleration, skills and future decisions. Nearby runners also influence the actual position-keep/lane controllers.

## Version policy

`simulation/engine-registry.json` enables `allowUnknownVersionSimulation`. The service binds the most recently packaged trace-capable v74 simulator from its own installed manifest as the preferred unknown-version trial. This does not assign an original version or authorize inference. Unknown/unmapped versions may run; their decisions are withheld on mismatch, incomplete comparison or incomplete trace. Conflicting/invalid evidence and known unsupported historical eras retain their existing restrictions. Known coverage takes precedence over trial policy.

No real date ranges were invented. Enter documented original-occurrence windows, region/mode and installed engine identities in the existing era registry. The evidence mapper preserves timezone and precision and rejects intervals crossing boundaries. See `mechanics-date-research.json` for November 2025 and July 2026 candidates, announcement/completion distinctions, source links and uncertainties. Collector/import clocks are not silently converted into original race dates.

## Reproducible instrumentation

The upstream Git dependency remains pinned at `efc2decdfeaff227ada0e9847f5deceb42c3b97f`. `scripts/prepare-simulator.py` extracts that exact Git archive into an isolated source cache and applies `simulation/instrumentation/engine.patch` plus `decision_trace.rs`. It never edits the upstream checkout. Cargo uses the reviewed local patch. Package manifests pin the executable, data, patch files and prepared source. The runtime requires the installed trace schema, complete bounded rows, correct runner mappings and a fresh successful comparison.

Trace requests always execute again when reopening a race. Recorded samples cannot authenticate hidden decisions copied from disk, so persistent modeled caches are not used for decision traces. A currently authorized job's payload is reused while inspecting its timeline. Observation-only engines retain the previous cache/recomparison behavior. Active selections are revoked on capture, policy, manifest, executable or reference changes.

## Validation and limitations

The compact `simulation/evidence/decision-trace-validation.json` records unchanged original capture/input hashes, engine identities, full output equality (original worker = patched trace-off = patched trace-on after removing the added trace), comparison verdicts and counts. All seven runnable captures remained identical. Six matched their recordings; the pre-existing mismatch remained a mismatch. The eighth capture still needed setup and did not execute. Original captures were read only.

The untouched upstream Rust library has eleven failing fixture tests on this Windows toolchain; the instrumented library has exactly the same eleven failures and one additional passing observation test. These upstream failures were not fixed by changing physics or test expectations. Umalytics application, contract and new trace tests pass independently. Keep this baseline comparison in upgrade review: do not report the upstream suite as fully passing.

There is no dependency-update notification monitor configured. The Git revision remains locked until deliberately updated. An upgrade should refresh/review the instrumentation patch, repeat trace-on/off and original-capture comparisons, review mechanics-date evidence, and only then change the installed/era bindings.

## Tracking and applying upstream updates

Subscribe to the [upstream commit feed](https://github.com/daftuyda/GlobalSim/commits/main.atom)
in an RSS/Atom reader, or check the [commit history](https://github.com/daftuyda/GlobalSim/commits/main/).
As checked on October 17, 2026, upstream's latest commit is our pinned v74
revision, and its GitHub Releases list is empty. GitHub's Watch → Custom →
Releases setting is useful if upstream starts publishing formal releases, but
does not cover its current commit-only updates. No subscription is created by
building or installing Umalytics.

A quick manual check requires no checkout changes:

```powershell
git ls-remote https://github.com/daftuyda/GlobalSim.git refs/heads/main
```

Compare the returned SHA to the revision in `simulation/simulator-worker/Cargo.toml`.
For an upgrade, request: “Update GlobalSim to <commit or version>, preserve the
decision traces, run the engine acceptance plan, and commit and push after it
passes.” Updating this integration requires these coordinated changes:

1. Review upstream mechanics/API/data changes and rebase the observation patch.
2. Update the Cargo revision/lock, archive/build revision, adapter/runtime pins,
   packaged version/profile and applicable reference hashes together. A version
   label alone does not establish a game's date range.
3. Rebuild, verify original = trace-off = trace-on output, compare the real
   capture corpus, and run the [acceptance plan](engine-test-plan.md).
4. Register supported dates independently for simulation and inference. Retain
   historical bundles needed by existing registrations.
5. Push the tested change. The passing release workflow builds and publishes a
   Umalytics desktop update containing the new worker and resources. Installed
   users receive it through the existing application updater, without Rust,
   Python or Git installations.

`cargo update` or replacing an executable alone is insufficient: the trace patch,
reference data, executable identity and compatibility registration belong to
the same reviewed integration.

## Runtime and build boundaries

The Svelte UI talks to the local Python service over loopback HTTP. The service
owns bounded jobs, capture/evidence binding and engine selection. The adapter
constructs simulator inputs only from original setup, owned skills, seed and
runner/course data. Observed outcomes are reserved for the independent comparator.

The service starts a separate Rust worker using JSON lines over standard input
and output. Our small worker calls the upstream library; an isolated source
archive plus the observation patch supplies its implementation. It is not a
remote simulation API or a browser port. Instrumentation reads actual decision
sites without drawing more randomness or evaluating conditions again.

The comparator checks results, supported sampled movement/state, and supported
skill/competition events. A complete match exposes the model's decision timeline.
Failure falls back to a separately authorized inference worker, or recorded
replay when inference is ineligible. Trace executions are fresh when reopening;
changing capture, policy, executable or resources invalidates authorization.

The desktop build packages the worker, pinned data, Python service and shared
frontend into the Tauri application. Their hashes are recorded in the installed
bundle manifest. Instrumentation inputs are stored without Git newline conversion
so Windows checkout cannot change patch application or their hashes.
