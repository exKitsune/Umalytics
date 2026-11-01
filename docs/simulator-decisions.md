# Simulator-first race analysis

A matched simulator is now the primary mechanics source. The production path is stored race selection → app-owned installed artifact → input-only setup → authenticated saved output or instrumented execution → fresh independent recorded-field comparison → simulator timeline. Existing inference is a separately authorized fallback; its formulas do not populate the simulator panels.

## What is traced

- Each equipped skill's actual initialization wit check: whether a roll was required, roll, threshold, result and shared-stream draw range. Exempt checks draw nothing. Ordinary wit failure and forced activation are distinct.
- Static skill condition windows, sampled random triggers, each dynamic predicate actually evaluated, precondition latching, activation windows, cooldown readiness, activation, effect evaluation/application/defer/immunity/recipient delivery and effect-end callbacks.
- Every last-spurt calculation's input, each feasibility search, each lottery actually drawn, its threshold/candidate/result, the fallback and the plan the state machine retains. An immediate maximum-speed plan needs no lottery. Recalculation does not necessarily replace the original start point.
- Per-movement-tick target/base/section/pace values, acceleration, exact before/after values of both speed clamps, blocker, HP, pre-displacement position/lane and phase. Spurt, rushing, downhill, position-keep, force-in, Spot Struggle, Duel and near-runner states are emitted when they change and expanded at exact native ticks by the readers.
- Normal analysis retains specific skill/spurt rolls and sampled trigger windows. General shared-RNG history and unused motion diagnostics are available only with `traceDiagnostics: true`; these observe existing calls and never draw extra RNG.

After a match, `simulation/project.ts` maps the engine output into the existing race results, animated replay, telemetry, runner panel and skill cards. It does not invoke the inference engine. Engine frames drive playback; tick states drive status intervals, target speed and the two separate blocking clamps. Conserve Power uses its activation/expiry callbacks; its precomputed acceleration magnitude is not an active-state flag. The original capture remains the race JSON export source. Comparison/provenance details are collapsed below the dashboard.

The existing spurt popover shows actual rolls and retained targets. Skill dialogs include actual wit results, applied modifiers and a compact, expandable table of condition, prerequisite and cooldown checks. Initial effective stats are snapped after engine initialization; nested constructor effects retain the enclosing runner identity. Counterfactual skill effectiveness, distance/time gain, hill/corner losses and vision geometry remain unavailable where this trace does not measure them. They are never replaced with current unversioned inference. Export analysis includes the full trace and its authorization/provenance.

A state snapshot is discrete and is never interpolated. Motion rows describe the pre-displacement movement calculation on that tick; the published replay frames describe the resulting race. Continuous timers use the engine's own update order. Identical checks on consecutive ticks are compressed into a series with count, first/last tick/time and first/last sequence. Intermediate within-tick ordering is not reconstructed from a compressed series. Successful predicates use a checkmark. Failed branches show the closest actually evaluated conjunction and its restricting predicates; earlier restrictions before a successful activation remain available. Latched prerequisites use their own successful tick. A static condition that first empties a conjunction’s course windows is identified separately from later skipped conditions. Target, cooldown, prerequisite and trigger-window failures retain their own labels. Skipped predicates remain skipped. `complete` means no observation was dropped under this schema, not that every CPU branch or every unknown game mechanic is instrumented.

## Compact observation transport

Normal workers emit `umalytics-decisions-v2`. Event context strings are interned
once; coordinates and string IDs travel as rows. Boolean checks compare/update
typed records before allocating JSON, preserving the same counts, skipped-tick
boundaries and conjunction evidence. The 23 used movement scalars travel as
little-endian float64 bytes encoded in base64. Nine mode/state columns travel
as transitions; near-runner timers become positive/nonpositive state. Eleven
unused diagnostic columns are omitted. Python validates dimensions, finite
values, references, initial states, transition ticks and observation coverage.
The browser/Node reader expands this into the established analysis layout
without interpolating, rerolling or recomputing the executed movement pipeline.

Legacy `v1` traces remain readable. Explicit diagnostic requests produce that
full layout, including general RNG history, and are checked against the previous
worker. Last-spurt probabilities continue to use exact decision inputs, feasible
candidates, actual rolls and retained plans; candidate-search records are small
and retained to preserve the existing probability graphs exactly. Skill
applications, deferred follow-ups, recipients and extended expiries are retained.
The mode does not change race decisions or results.

`scripts/benchmark-race-simulation.py --include-trace` measures normal tracing;
add `--diagnostic-trace` for exhaustive diagnostics. Dashboard parity checks
compare all calculated fields, excluding only internal sequence coordinates
that shrink when general RNG history is omitted.

## Meaning of a match

The independent comparator still covers the supported recorded result fields, pre-finish sampled movement/state and supported skill/competition observations at their captured precision. No tolerance was relaxed. An agreement authorizes the simulator's explanation, labeled **Simulated**. The recording does not independently establish unrecorded private decisions. Different internal executions can theoretically produce indistinguishable sampled observations.

Blocking displays two exact local clamp reductions. They are separate stages; summing them is not a race-time penalty. A different no-traffic race would change other runners, acceleration, skills and future decisions. Nearby runners also influence the actual position-keep/lane controllers.

## Version policy

`simulation/engine-registry.json` enables `allowUnknownVersionSimulation`. The service binds the most recently packaged trace-capable v74 simulator from its own installed manifest as the preferred unknown-version trial. This does not assign an original version or authorize inference. Unknown/unmapped versions may run; their decisions are withheld on mismatch, incomplete comparison or incomplete trace. Conflicting/invalid evidence and known unsupported historical eras retain their existing restrictions. Known coverage takes precedence over trial policy.

No real date ranges were invented. Enter documented original-occurrence windows, region/mode and installed engine identities in the existing era registry. The evidence mapper preserves timezone and precision and rejects intervals crossing boundaries. See `mechanics-date-research.json` for November 2025 and July 2026 candidates, announcement/completion distinctions, source links and uncertainties. Collector/import clocks are not silently converted into original race dates.

## Reproducible instrumentation

`simulation/source-lock.json` pins the traced source in the private `exKitsune/GlobalSim` repository and separately records its original v74 parent and instrumented source hash. See [backup and CI setup](simulator-backup.md). `scripts/prepare-simulator.py` stages that exact traced Git archive and verifies its instrumentation manifest against `simulation/instrumentation/engine.patch`, `decision_trace.rs` and the locked source hash. It does not reapply the patch or edit the saved checkout. Cargo uses a direct local path dependency and builds the worker offline. Package manifests pin the executable, data, original/traced commits and instrumentation. The runtime still requires the installed trace schema, complete bounded rows, correct runner mappings and a fresh successful comparison.

Simulation output, including decision traces, is saved across race switches and service restarts. Before cache access, the service freshly selects compatibility and binds the capture, context, evidence, registry/policy and installed manifest. The runtime key also includes prepared inputs, measured executable, reference and bridge identities. Each open independently compares saved output against recorded observations and validates the trace; no saved verdict authorizes the UI. A service-owned installation secret authenticates the cache key and modeled digest with HMAC-SHA256, because recorded samples alone cannot authenticate hidden decisions. Unsigned, damaged or differently signed traces are cache misses. Without a usable secret, trace execution remains available but caching is disabled. Active selections are revoked on capture, policy, manifest, executable or reference changes.

Simulation files remain separate from inference payloads. Settings count both stores and apply one retention budget; clearing analysis removes both without touching captures, tags or the installation key. New analyses show an “Analyzing race” skeleton until completion; unsupported races and errors leave that state. Enable “Analyze recent races in the background” in Settings → Analysis cache to prepare saved races while the window is open. The queue works by race date, newest first, one race at a time. It pauses during playback and cancels its display worker when a foreground race is opened. A native job already running may finish before the foreground job starts. Background work uses the same fresh simulator/inference authorization and persistent caches as a foreground open; it never changes the selected race or runner. Count/size limits bound warming and completed entries are not repeatedly queued. Closing the window stops this analysis queue; the separate tray service continues collecting captures.

The Traffic display groups actual front-block and near-front/near-behind timer ticks into one episode. Gaps up to 0.25 seconds are joined for label layout only, remain faded, and do not assert a blocked/near state. Color runs from amber at zero cut to red at 1 m/s or above, using the larger of the two blocking-stage reductions; those stages are not summed. A global speed cap without a blocker is excluded. Replay cards and active status chips use each exact tick, including the clear gaps. The original trace and blocked-time totals remain separate from the presentation grouping.

## Validation and limitations

The compact `simulation/evidence/decision-trace-validation.json` records unchanged original capture/input hashes, engine identities, full output equality (original worker = patched trace-off = patched trace-on after removing the added trace), comparison verdicts and counts. All seven runnable captures remained identical. Six matched their recordings; the pre-existing mismatch remained a mismatch. The eighth capture still needed setup and did not execute. Original captures were read only.

The untouched upstream Rust library has eleven failing fixture tests on this Windows toolchain; the original instrumentation baseline had exactly the same eleven failures. The two focused observation tests now pass, including initialization runner ownership. These upstream failures were not fixed by changing physics or test expectations. Umalytics application, contract and new trace tests pass independently. Keep this baseline comparison in upgrade review: do not report the upstream suite as fully passing.

There is no dependency-update notification monitor configured. The Git revision remains locked until deliberately updated. An upgrade should refresh/review the instrumentation patch, repeat trace-on/off and original-capture comparisons, review mechanics-date evidence, and only then change the installed/era bindings.

## Tracking and applying upstream updates

The former upstream repository became unavailable on October 18, 2026. Its
public release and commit feeds cannot currently provide reliable notifications.
The private backup preserves our saved version; it does not automatically receive
future upstream changes. New versions require authorized source access and an
explicit mirror update. No update subscription is created by building Umalytics.

When access is available, compare the new commit with `simulation/source-lock.json`.
For an upgrade, request: “Update GlobalSim to <commit or version>, preserve the
decision traces, run the engine acceptance plan, and let me review before committing
or pushing.” Updating this integration requires these coordinated changes:

1. Review upstream mechanics/API/data changes and rebase the observation patch.
2. Commit the reviewed traced update to the private repository and update its source lock,
   Cargo lock if needed, adapter/runtime pins,
   packaged version/profile and applicable reference hashes together. A version
   label alone does not establish a game's date range.
3. Rebuild, verify original = trace-off = trace-on output, compare the real
   capture corpus, and run the [acceptance plan](engine-test-plan.md).
4. Register supported dates independently for simulation and inference. Retain
   historical bundles needed by existing registrations.
5. Obtain user review approval, then commit and push the tested change. The passing release workflow builds and publishes a
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
archive containing the reviewed observation hooks supplies its implementation. It is not a
remote simulation API or a browser port. Instrumentation reads actual decision
sites without drawing more randomness or evaluating conditions again.

The comparator checks results, supported sampled movement/state, and supported
skill/competition events. A complete match exposes the model's decision timeline.
Failure falls back to a separately authorized inference worker, including the
explicit provisional replay policy. Trace authorization and comparison are fresh when reopening;
changing capture, policy, executable or resources invalidates authorization.

The desktop build packages the worker, pinned data, Python service and shared
frontend into the Tauri application. Their hashes are recorded in the installed
bundle manifest. Instrumentation inputs are stored without Git newline conversion
so Windows checkout cannot change patch application or their hashes.

## Fixed-replay effectiveness and movement comparisons

The dashboard keeps its established cards, charts and scoring conventions. The
matched execution supplies effective stats, HP, target speed, acceleration,
current speed, blockers, status windows, activations and decision checks. The
TypeScript analysis worker calculates local comparisons from those values; it
does not start another Rust simulation or draw randomness.

For a selected movement effect, subtract its evaluated modifier during the
active window, advance the runner's local velocity, retain the original field's
speed cap and integrate the difference. The no-removal path is exactly the trace.
The paired path carries the same per-step baseline residual to preserve native
float/order details. Target-speed and acceleration changes can leave a decaying
speed advantage; type-22 natural deceleration also preserves its expiry impulse.
Stat, status and healthy-HP comparisons apply differences from the established
reference formulas to the traced baseline. Their results are estimates, even
though their starting state and active windows come from the simulator.

| Dashboard result | Meaning |
|---|---|
| Effectiveness | Existing target-speed 0/half/full convention, with separate acceleration and direct-speed use |
| Movement gain | Integral of full minus effect-removed velocity with field, HP, phase and decisions fixed |
| Equivalent travel time | Movement difference divided by the local comparison speed, not another race's finish time |
| Combined skill gain | One comparison removing the whole supported set; marginal skill gains are not summed |
| Traffic / exhaustion | Local movement deficit under the existing fixed-context comparison |
| HP / recovery | Existing HP-capacity and recovery timing calculations using the matched replay context |
| Corner and hills | Existing geometric/reference calculations using matched positions and state windows |
| Spurt odds | Feasible traced candidates and the integer roll threshold, with all-rejected probability assigned to the fallback candidate |
| Incoming debuffs | Confirmed effect deliveries, followed by a recipient-local movement comparison |

Changing a skill here does not change other runners, lanes, activation checks,
RNG, HP decisions or last-spurt choices. This is the user's requested diagnostic
of the observed race context, not a causal alternative-race outcome. Recovery,
stat and lane benefits do not share the movement-score denominator. Unsupported
components remain unavailable rather than receiving an invented zero.

Work runs off the UI thread. Indexed traces and cached paths are shared across
cards, skills and combined comparisons. Compressed derived results are keyed by
fresh baseline authorization and the analysis code revision. Only derived
mathematical fields are restored; frames, effective stats, activations, hidden
states and rolls are always projected from the freshly authorized trace. The
service's authenticated simulator cache can reuse the baseline itself while
rerunning the independent comparison. Both layers share cache settings.

### Post-activation potential

Supported additional-activation types use the matched definition and the pinned
engine contract: passing a runner or activating another skill, capped at three
increments (type 3: two). Duration usage 4 adds distance/1000 seconds per pass,
up to three times. Each matched follow-up keeps its application time. The skill
inspector separates base definitions, bonus rules and observed trigger times.

For these skills, effectiveness is useful magnitude-time area divided by maximum
magnitude times maximum nominal duration. It includes untriggered bonuses in the
denominator and never changes the measured movement gain. The stacked score
separates base credit from conditional strength/extended-duration credit. Active
useful seconds remain unchanged. Missing provenance, unknown trigger types or
unresolved magnitudes leave the potential score unavailable.

### Analysis work sharing

Runner/event partitions, exact-time motion indexes, healthy-HP physics and
tick-invariant terrain/context are shared within one analysis. Effect sums keep
their original evaluation order. Counterfactual traffic diagnostics and replaced
skill-utilization estimates are evaluated only if consumed; baseline cards and
unreplaced estimates remain available. Status HP integration reuses identical
midpoint factors and interval searches retain the original endpoint rules.

The bridge validates compact motion bytes directly, checking the same finite
values, runners, timing, state transitions and coverage as expanded traces.
Reference JSON parsing is bounded and cached by exact file content in read-only
trees. Prepared requests get independent mutable copies. Reference/geometry pins
and executable hashes are still checked on every evaluation; timestamps do not
authorize cached reference contents.

## Inference fallback

The shipped registry enables `allowReplayInference`. The service selects and
hash-binds the installed inference bundle and its data. Missing simulator inputs,
unsupported races, mismatches and engine failures therefore retain the full
dashboard through the legacy inference worker. Unknown/unregistered game eras
use an explicitly provisional replay-analysis policy, shown as Inferred analysis
in the top bar. This makes no claim that the current formulas reproduce an
unknown historical game's rules. Registered compatible historical engines retain
priority. Invalid evidence, changed artifacts or revoked authorization still
fail closed; the application never publishes stale or mislabeled simulator state.

Tests cover the mathematical oracle, blocking caps, candidate probabilities,
cache key invalidation, restoration without hidden-state substitution, dashboard
projection, the version-bound fallback and existing inference workflows. The
manual acceptance cases are in `simulator-ui-test-plan.md`.

### Hybrid movement effectiveness

Consolidated acceleration + speed scores add the independently scored components: acceleration supplies the primary effectiveness and speed supplies bonus credit. Target-speed and current-speed components retain their existing average within the speed group; this group adds once when acceleration is also present. A fully useful acceleration effect with unused target speed scores 100%; both fully useful score 200%. Repeated activations still add their individual scores. Each component retains its existing denominator, including maximum potential for post-activation bonuses. Component bars and joint distance/time comparisons remain separate from this scoring convention. HP and lane effects do not supply a movement effectiveness percentage.
