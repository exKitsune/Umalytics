# Simulator-first race analysis

A matched simulator is now the primary mechanics source. The production path is stored race selection → app-owned installed artifact → input-only setup → authenticated saved output or instrumented execution → fresh independent recorded-field comparison → simulator timeline. Existing inference is a separately authorized fallback; its formulas do not populate the simulator panels.

## What is traced

- Each equipped skill's actual initialization wit check: whether a roll was required, roll, threshold, result and shared-stream draw range. Exempt checks draw nothing. Ordinary wit failure and forced activation are distinct.
- Static skill condition windows, sampled random triggers, each dynamic predicate actually evaluated, precondition latching, activation windows, cooldown readiness, activation, effect evaluation/application/defer/immunity/recipient delivery and effect-end callbacks.
- Every last-spurt calculation's input, each feasibility search, each lottery actually drawn, its threshold/candidate/result, the fallback and the plan the state machine retains. An immediate maximum-speed plan needs no lottery. Recalculation does not necessarily replace the original start point.
- Per-movement-tick target/base/section/pace values, acceleration, exact before/after values of both speed clamps, blocker/gap, HP, lane target, phase, spurt, rushing, downhill, position-keep mode, force-in, Spot Struggle, Duel, Conserve Power and continuous blocking/near-lane/overtake timers.
- Actual raw draws from the retail shared RNG, with ordinal and execution context. These are observations of existing calls, not an extra RNG replay.

After a match, `simulation/project.ts` maps the engine output into the existing race results, animated replay, telemetry, runner panel and skill cards. It does not invoke the inference engine. Engine frames drive playback; tick states drive status intervals, target speed and the two separate blocking clamps. Conserve Power uses its activation/expiry callbacks; its precomputed acceleration magnitude is not an active-state flag. The original capture remains the race JSON export source. Comparison/provenance details are collapsed below the dashboard.

The existing spurt popover shows actual rolls and retained targets. Skill dialogs include actual wit results, applied modifiers and a compact, expandable table of condition, prerequisite and cooldown checks. Initial effective stats are snapped after engine initialization; nested constructor effects retain the enclosing runner identity. Counterfactual skill effectiveness, distance/time gain, hill/corner losses and vision geometry remain unavailable where this trace does not measure them. They are never replaced with current unversioned inference. Export analysis includes the full trace and its authorization/provenance.

A state snapshot is discrete and is never interpolated. Motion rows describe the pre-displacement movement calculation on that tick; the published replay frames describe the resulting race. Continuous timers use the engine's own update order. Identical checks on consecutive ticks are compressed into a series with count, first/last tick/time and first/last sequence. Intermediate within-tick ordering is not reconstructed from a compressed series. Skipped predicates remain skipped. `complete` means no observation was dropped under this schema, not that every CPU branch or every unknown game mechanic is instrumented.

## Meaning of a match

The independent comparator still covers the supported recorded result fields, pre-finish sampled movement/state and supported skill/competition observations at their captured precision. No tolerance was relaxed. An agreement authorizes the simulator's explanation, labeled **Simulated**. The recording does not independently establish unrecorded private decisions. Different internal executions can theoretically produce indistinguishable sampled observations.

Blocking displays two exact local clamp reductions. They are separate stages; summing them is not a race-time penalty. A different no-traffic race would change other runners, acceleration, skills and future decisions. Nearby runners also influence the actual position-keep/lane controllers.

## Version policy

`simulation/engine-registry.json` enables `allowUnknownVersionSimulation`. The service binds the most recently packaged trace-capable v74 simulator from its own installed manifest as the preferred unknown-version trial. This does not assign an original version or authorize inference. Unknown/unmapped versions may run; their decisions are withheld on mismatch, incomplete comparison or incomplete trace. Conflicting/invalid evidence and known unsupported historical eras retain their existing restrictions. Known coverage takes precedence over trial policy.

No real date ranges were invented. Enter documented original-occurrence windows, region/mode and installed engine identities in the existing era registry. The evidence mapper preserves timezone and precision and rejects intervals crossing boundaries. See `mechanics-date-research.json` for November 2025 and July 2026 candidates, announcement/completion distinctions, source links and uncertainties. Collector/import clocks are not silently converted into original race dates.

## Reproducible instrumentation

The upstream Git dependency remains pinned at `efc2decdfeaff227ada0e9847f5deceb42c3b97f`. `scripts/prepare-simulator.py` extracts that exact Git archive into an isolated source cache and applies `simulation/instrumentation/engine.patch` plus `decision_trace.rs`. It never edits the upstream checkout. Cargo uses the reviewed local patch. Package manifests pin the executable, data, patch files and prepared source. The runtime requires the installed trace schema, complete bounded rows, correct runner mappings and a fresh successful comparison.

Simulation output, including decision traces, is saved across race switches and service restarts. Before cache access, the service freshly selects compatibility and binds the capture, context, evidence, registry/policy and installed manifest. The runtime key also includes prepared inputs, measured executable, reference and bridge identities. Each open independently compares saved output against recorded observations and validates the trace; no saved verdict authorizes the UI. A service-owned installation secret authenticates the cache key and modeled digest with HMAC-SHA256, because recorded samples alone cannot authenticate hidden decisions. Unsigned, damaged or differently signed traces are cache misses. Without a usable secret, trace execution remains available but caching is disabled. Active selections are revoked on capture, policy, manifest, executable or reference changes.

Simulation files remain separate from inference payloads. Settings count both stores and apply one retention budget; clearing analysis removes both without touching captures, tags or the installation key. New analyses show an “Analyzing race” skeleton until completion; unsupported races and errors leave that state. The capture service keeps collecting races, but automatic whole-library background analysis is currently disabled. Opening a race schedules its analysis, which can finish and save even after the user selects another race.

The Traffic display groups actual front-block and near-front/near-behind timer ticks into one episode. Gaps up to 0.25 seconds are joined for label layout only, remain faded, and do not assert a blocked/near state. Color runs from amber at zero cut to red at 1 m/s or above, using the larger of the two blocking-stage reductions; those stages are not summed. A global speed cap without a blocker is excluded. Replay cards and active status chips use each exact tick, including the clear gaps. The original trace and blocked-time totals remain separate from the presentation grouping.

## Validation and limitations

The compact `simulation/evidence/decision-trace-validation.json` records unchanged original capture/input hashes, engine identities, full output equality (original worker = patched trace-off = patched trace-on after removing the added trace), comparison verdicts and counts. All seven runnable captures remained identical. Six matched their recordings; the pre-existing mismatch remained a mismatch. The eighth capture still needed setup and did not execute. Original captures were read only.

The untouched upstream Rust library has eleven failing fixture tests on this Windows toolchain; the original instrumentation baseline had exactly the same eleven failures. The two focused observation tests now pass, including initialization runner ownership. These upstream failures were not fixed by changing physics or test expectations. Umalytics application, contract and new trace tests pass independently. Keep this baseline comparison in upgrade review: do not report the upstream suite as fully passing.

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

## Effectiveness calculator plan

This is a proposed implementation, not functionality shipped with the UI cleanup.
Use two measurements rather than treating a percentage as a finish-time prediction:

| Measurement | Meaning | Execution |
|---|---|---|
| Effectiveness | How much of the activated effect was usable in this race | Engine-side probes against the matched run's actual tick state |
| Race impact | How the runner and field finish differently without those effects | A separate full-field counterfactual execution |

### 1. Define the measurements before optimizing

Preserve the existing target-speed 0/half/full scoring convention, with its
numerator and duration denominator explicit. Replace reconstructed targets,
acceleration and blockers with engine values and engine-owned calculations.
Report fully used, accelerating, capped/blocked and unused time as the breakdown.
Do not assume that a blocker flag wastes every effect: the actual clamp order
determines whether target-speed, acceleration and direct-speed effects survive.
Acceleration and direct speed need their own measurable use ratios. Recovery
shows actual HP restored versus offered HP, including overflow; useful recovery
is a separate question answered by the race-impact calculation. Mixed skills
retain their component results instead of averaging incompatible units. A failed
wit check means no activation and zero realized effect; activation utilization
itself is not applicable. Missed activation remains visible separately.

For each tick with active supported effects, evaluate the relevant physics
functions on scratch state with and without one effect. Hold the baseline
pre-tick field context fixed, consume no new randomness, and never mutate the
live execution. This measures immediate use under the actual circumstances;
summing these probes does not establish a causal finish-time gain. Implement
the probes beside the Rust calculation sites, not as another TypeScript physics
engine. Unsupported effect components remain unavailable.

### 2. Establish a correct counterfactual reference implementation

Start with complete reruns from initialization. Keep the race setup, opponents,
owned skills and initial RNG state fixed; suppress the selected skill's applied
effects while preserving its checks, draws, activations and cooldown bookkeeping.
Apply suppression consistently to self effects, queued external effects,
initial passives and later activations. This answers the value of its effects
within this build. Removing the skill from the loadout is a different experiment,
because ownership can change other conditions and initialization; expose that
only as a separate build-comparison feature.

Run the entire field so lane choices, blocking, opponents, recovery/spurt changes
and carryover can evolve. Define time saved as counterfactual raw finish time
minus baseline raw finish time. Allow negative values. Also report place change,
finish gap and team impact for debuffs. Define distance gain at a common time
and document the finish clamp; do not integrate incomparable trajectories or
label equivalent travel time as an actual finish-time change. Counterfactuals
are expected to differ from the recording and never replace the authorized
baseline replay.

The current engine uses a shared sequential random stream. Equal seeds or a
cloned RNG state do not guarantee equal later decisions after paths diverge.
The first implementation should preserve native RNG behavior and identify
the result as a conditional alternative execution. If users need expected build
value, compare paired runs over a predetermined seed set and report uncertainty;
never quietly substitute a single changed stream for an isolated effect claim.
Event-aligned common random numbers are a possible later experimental mode,
requiring stable event identities and explicit rules for new/missing events.
They change the coupling between runs and must not alter the matched baseline.
Synchronization and variance reduction require validation, rather than assuming
that sharing a seed is sufficient ([L'Ecuyer, WSC 2015](https://informs-sim.org/wsc15papers/003.pdf)).

### 3. Optimize the measured bottlenecks

1. Aggregate effectiveness during the existing matched run and return small
   component summaries. Reuse one baseline for all comparisons.
2. Reuse a warm, app-owned Rust worker and parsed immutable course/skill data;
   the upstream JSON-lines loop already supports multiple requests, whereas
   our current bridge starts a process per execution. Batch the selected
   runner's comparisons and omit replay frames/full decision traces from
   counterfactual summaries. Retain bounded diagnostics for validation.
3. Prioritize the selected runner, compute expensive impacts on demand, deduplicate
   identical requests, and use a small CPU/memory-bounded pool. Cancel or detach
   obsolete requests when the selected race changes; keep capture responsive.
   Skip proven no-op effect-suppression scenarios, but do not apply that shortcut
   to loadout-removal experiments.
4. Only after full-rerun correctness and profiling, add checkpoints before the
   first affected phase. Passive effects require initialization checkpoints.
   Capture the entire field, all RNGs, timers, queues, ranks and control state;
   rebind callbacks and shared ownership safely. `RaceField`/`RaceSolver` are not
   simple isolated clones. Bound checkpoint memory and fall back to full reruns.
5. Cache summaries by capture/setup digest, exact executable/data/instrumentation
   identities, intervention, metric version and RNG policy. Display cached
   results only after a fresh baseline authorization; revoke them on the same
   changes that revoke the baseline. Authenticate saved hidden decisions using
   the same service-owned cache mechanism as the baseline.

Individual removal deltas are marginal effects and must not be added together.
Calculate a combined all-selected-skills intervention for the total. If an
additive per-skill allocation is later needed, offer a bounded sampled Shapley
allocation as an estimate, with shared coalition caches and an uncertainty/
runtime budget; do not attempt every subset by default.

### 4. Acceptance gates and rollout

First ship component effectiveness; next add on-demand full-field impact; then
optimize with warm workers, batching and measured checkpoint benefits. Require
no-op interventions and disabled probes to reproduce the baseline exactly.
Compare optimized runs with the full-rerun reference, including passive skills,
recovery/spurt changes, blocked direct-speed effects, overlapping activations,
debuff immunity, failed wit, post-finish duration and RNG divergence. Test that
runner order, concurrent requests and cancellation cannot change results or
attach one race's results to another. Benchmark median/p95 latency, peak memory,
output size and CPU use on representative fields before choosing default batch
sizes or promising a response time. Keep the existing cards and graphs; show
Effectiveness and Time saved there, with methods in expandable details.
