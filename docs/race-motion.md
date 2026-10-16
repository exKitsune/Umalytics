# Shared race-motion reference

The shared model separates a target ceiling from reachable velocity. A skill
can raise its target while the runner is still accelerating; a nearby runner
can constrain reachable speed without changing that target. This model is a
replay-context reference comparison, not a recovered native simulation or a
prediction of what a different whole race would have done.

`createRaceMotionEngine(race, reference, courseId, analysis)` compiles known
effects and caches per-runner builds. `.build({runnerId, excludeActivationKey})`
can remove one activation while retaining the same calibrated random quantile,
other supported effects, recorded progress, HP and field positions.
`activationMotionKey(sourceId, activation)` supplies the key.
`excludeStatusKey: "kind:pace-up"` removes all episodes of one mode together.
Mode gains use these paired reachable paths, including traffic and carryover;
the extra target-speed area is not presented as realized distance gain. The convenience
`buildRaceMotion` builds every runner; core calls require the existing analysis
and do not recursively analyze the race.

## Trace fields

| Field | Meaning |
| --- | --- |
| `actual`, `selfActual`, `currentSpeedDelta` | Sampled actual velocity and its supported normalization for direct-speed effects 21/22. Unknown direct magnitude/immunity leaves self speed unresolved. |
| `targetBase` | Initial-stat strategy target, section-wit reference and terrain, before timed skills/status additions. |
| `targetActive` | Supported active target effects, pace coefficient, terrain/downhill and competition contributions, with final speed limits. |
| `free` | Acceleration/deceleration-bounded actual velocity without a front cap, including direct-speed effects after self-speed integration. |
| `constrained`, `constraint` | The same physics with the recorded or geometry-derived front cap. Evidence distinguishes recorded blocking from a sampled neighborhood hypothesis. |
| `accelerationRange` | Matched conditional scenario forces; HP-zero force is −1.2 m/s². The scalar `acceleration` is the midpoint. |
| `downhillTargetDelta`, `paceStarts` | Explicit slope-mode bonus and sampled inferred pace starts, including a supported acceleration-onset fit when available. |
| `initialStats` | Exact or conditional final-stat endpoints. An unresolved equipped passive is not silently treated as inactive. |

`min/mid/max` are conditional endpoint scenarios, not confidence intervals or
guaranteed extrema of every possible hidden trajectory. The midpoint is a
declared reference choice. Each sample retains reasons and assumptions. A
fully drawn reference path does not imply that its hidden mode/RNG history was
recorded or uniquely identified.

## Physics and hidden decisions

The source reference is the supplied *Race Mechanics*, together with
the pinned [RaceSolver](https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/RaceSolver.ts)
and [HP policy](https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/HpPolicy.ts).
The model retains the pre-fifth-anniversary stat regime already documented in
[effect models](effect-models.md). It does not add later JP wit-limit-break or
zenkai-spurt rules to Global.

Position keeping multiplies the base strategy target. Section-wit, skill,
terrain and lane-coupling terms remain additive. Negative target effects apply
before the final minimum/30 m/s limits. The force model includes ordinary and
skill acceleration, phase deceleration, pace-down deceleration, start-dash
acceleration/threshold and the post-dash minimum. Recorded start delay gates
movement. A delay shorter than one 15 Hz simulation tick changes displacement
but does not prorate acceleration in the first active tick. Start-dash history has no arbitrary two-second cutoff: a supported
uphill/gap history can retain it longer. HP-zero decelerates while retaining
the composed target order; its force does not become positive merely because
a skill raises the ceiling.

Before 10/24 distance, missing pace flags produce a normal midpoint with explicit
style-mode alternatives, rather than permanent blank traces. Rushed AI style
changes and possible PU-Ex receive conditional alternatives. These are not
invented entry rolls, timers or transitions. Separately inferred PU/SU/OT
intervals may include an adjacent acceleration ramp only after a compatible
elevated ceiling confirms the candidate. An ordinary unconfirmed ramp does not
become a mode, and unknown intervening brackets are not bridged.

There are 24 section-wit references. Clean stable retained plateaus can fit a
conditional residual within the theoretical range after supported effects and
constraints are removed. This assumes the declared pace and no missing
force-in/lane bonus; it does not recover the server's RNG. Removing an initial
wit passive preserves the calibrated quantile and shifts the offset by the
changed wit formula, rather than refitting away the passive's contribution.
The HP-budget decision supports the maximum spurt target when sufficient HP
remains. It no longer defaults to the midpoint between cruising and maximum
spurt in that case. Otherwise, late-to-maximum scenarios remain, with supported
earlier clear-path acceleration supplying a lower target bound. Decisions
restart after an own recovery; inferred targets are not recorded game fields.

Independent downhill candidates contribute `0.3 + abs(grade)/10` target speed.
An unidentified downhill mode uses an off midpoint and on alternative. The
pinned solver's signed-grade expression differs from the supplied mechanics;
the absolute-grade choice is explicit. SS/dueling use supported reference
intervals and guts-dependent contributions. Recorded release, stamina-limit,
pre-spurt competition and secure-lead starts use explicitly conditional
credit/random/duration reference scenarios where their required inputs exist.
Those later mechanics' exact native execution/version is not established by
the enum alone. Missing special-status inputs are named in assumptions, not
called an exact modeled contribution.

Resolved skills compound by their individual target/current/acceleration or
stat effects. Timed magnitude supports known contextual green counts and
additional activation counts; sampled pass hooks are explicitly sampled and
their history is cached. Unknown magnitude/recipient/timing breaks the affected
trajectory and is never silently omitted. Known equal teams support debuff
immunity; unknown team membership has conditional applied/immunity endpoints,
with an enemy-applied midpoint. Firelight's unresolved pass-count magnitude
has a narrowly named fallback to the pinned simulator's fixed strength, not an
invented native scaling formula or guaranteed bound. Type 22 expiry transfers
its supported modifier to self speed before the final self-speed blocker cap;
the endpoint impulse is not backdated over the preceding interval.

## Neighborhood constraints and area

The supplied front-collision rule requires `0 < distance gap < 2 m` and
`abs(lane gap) <= (1−0.6×gap/2)×0.75/18` in decoded course-width units. The nearest
qualifying runner gives the reference cap
`front actual speed × (0.988+0.012×gap/2)`. No rule was established for a separate
anticipatory slowdown from merely being within 20 m or some other arbitrary
distance. Side blocking affects lane decisions; it is not itself an invented
forward-speed reduction.

Complete interpolated neighborhood geometry can support a conditional cap or
clear-path case while a sampled block transition is unreported. Missing field
positions cannot prove that a visible blocker is nearest. A recorded blocker
index and its known geometry remain separate evidence.

Two areas are exposed separately. `distanceLoss/timeLoss` compare free and
constrained reference paths. `trafficLoss` compares recorded speed with an
entry-anchored free-running path across a contiguous braking approach, a
recorded/collision anchor and speed recovery. Known target drops, direct-speed
jumps, HP exhaustion and missing samples stop unsupported extensions. The raw
recorded-block duration remains separate from the full slowed interval.
`observedTrafficDeficit/observedTrafficTime` mirror the new traffic summary for
compatibility. A traffic-associated shortfall does not prove that traffic
caused every unexplained deviation in that window.

`exhaustionLoss` uses a healthy-HP path that preserves the same traffic cap and
other timed effects. Normal drain can bound the zero crossing between retained
HP samples. Recoveries and other HP events prevent unsupported crossing
interpolation. It stops at the runner's finish, includes supported speed regain
after recovery, and leaves unknown intervals unassessed. Equivalent time uses
local reference speed; these figures are not causal finish-time predictions.

Target-speed utilization gives half credit while accelerating between the
normal and boosted ceilings, zero below normal speed or while blocked, and
full credit at the boosted ceiling. Deceleration also receives full credit
when paired paths show speed retained from this activation. Overspeed left by
an unrelated effect does not count. Acceleration utilization is separate and
counts only the time that the additional force helps reach the active ceiling.
Within a coarse retained-sample bracket, known force and target changes can
locate cap arrival before the next sample. This correction is accepted only
when the reconstructed endpoint matches the next retained speed within 0.022
m/s and the whole bracket is clear, grounded and resolved. The model reanchors
at original retained samples, not every synthetic interpolated point.

The grid contains 15 Hz steps plus retained observations, activation/expiry and
status boundaries. Gaps over 2 seconds reset trajectories. The first exact
sample after a gap can re-anchor without integrating across the missing time.
Recorded phase/grade/HP/field schedules stay fixed in paired variants, so these
are local marginal reference paths rather than full field-outcome simulations.

## Whole-process checks

`node --import tsx tests/race-motion-workflow.ts <temporary-folder>` runs the
actual importer, analysis and shared engine in child processes. Synthetic cases
cover target versus reachable speed, compounds/debuffs, direct normalization,
type 22 expiry and blocker cap, team uncertainty/immunity, unknown scaling,
neighborhood thresholds, missing nearest-neighbor evidence, HP-zero, downhill,
uphill, calibrated residuals/common wit quantile, unknown passive stat ranges,
gap resets, long start-dash history, confirmed/unconfirmed pace ramps, the
named Firelight fallback, cache identity and traffic-only actual shortfall.
These verify the declared reference model; they do not establish native
simulation equivalence or causal finish-time gains.

`tests/traffic-loss-workflow.ts` checks approach/regain areas, unchanged raw
block duration, healthy exhaustion with traffic, bounded zero crossings,
missing inputs and discrete start-delay physics. `tests/mode-inference-workflow.ts`
checks acceleration onset, phase/hill transitions, known skill stacking,
recovery brackets, the 10/24 cutoff, independent downhill HP evidence and
paired mode gains. `tests/motion-skills-workflow.ts` checks funded and unresolved
spurt targets, fractional acceleration use and beneficial deceleration. These
are full-file import/analysis workflows using synthetic inputs.

Initial `-1` skill markers remain distinct from timed recorded procs. The narrow
initial-skill inference requires equipped positive self-acceleration branches,
proven gate conditions and earlier trigger counts, complete stat inputs, and a
unique subset matching a contiguous clean post-dash acceleration window.
Unknown effects, missing opponents, blocking, slopes and ambiguous combinations
withhold the inference. Recovered entries use `activationEvidence: estimated`
and reference start/expiry; raw events, raw duration and the recorded proc count
are unchanged. This evidence is not reused as an independent causal-gain proof.
