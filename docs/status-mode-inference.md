# Position keeping and downhill candidates

The supported replay contains distance, velocity, HP, lane, rushed state and
front-block slot. It has no explicit position-keep or downhill-mode flag.
`status-models.ts` therefore reports **inferred candidates**, never recovered
native mode entries. Missing candidates do not establish mode off.

The supplied *Race Mechanics*, “Position Keeping”, places the mode
coefficient on the strategy base target before additive section-wit, terrain
and skill offsets. The pinned
[solver](https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/RaceSolver.ts#L852)
applies mode decisions before target/acceleration updates; entry does not
require already reaching the new target. The inference integrates observed self speed across the sample bracket
toward the ordinary target and toward each mode target, including known
phase, slope and skill boundaries. The mode whose integral meets the next
recorded speed is the candidate. A speed gain inside the bracket is not
treated as tolerance on the ordinary target.
Resolved direct-speed effects are removed from actual velocity; known target
and acceleration effects remain in both hypotheses. Supported initial
reference activations also contribute their motion context, without creating
new recorded events.

An adjacent compatible ceiling can confirm an earlier acceleration fit. A
continuing already-supported mode can retain a compatible ramp through a
known hill boundary. At the 10/24-distance limit, a contiguous fit lasting
at least two seconds with self velocity above every ordinary target scenario
can support a weaker no-plateau candidate; its active interval stops at the
interpolated limit. Residual velocity after that boundary is not labeled an
active mode. Ordinary acceleration, a skill-only rise or an unresolved gap
does not become a mode. Sub-bracket onset/exit fits are reference times, not
native transitions measured to that precision.

Front Runner and Runaway are separate strategy groups. Overtake entry checks
same-strategy ordering, and an existing overtake can remain after taking
first until its peer-gap exit. A compatible 1.05 plateau with recent
same-strategy lead history can support that continuation even when an earlier
entry bracket was not independently classified. Speed Up uses overall first
place and the appropriate close-second threshold. Non-front candidates use
the leading runner of the most forward strategy as a pacemaker **proxy**;
the post-anniversary native pacemaker selection is not recorded. Continuation
uses the possible random exit band rather than reapplying entry thresholds.

## HP evidence is independent of the speed fit

Downhill candidates require downhill grade and normalized drain below half
the ordinary reference HP rate. The rate uses observed self speed, known
ground and late guts. Target-speed skills can change observed speed without
invalidating that HP comparison. A speed surplus is never the proof of DH,
so it cannot later be circular evidence of the same skill's benefit.
The [HP policy](https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/HpPolicy.ts#L62)
supports the 0.4 downhill drain factor; the supplied mechanics gives target
bonus `0.3 + abs(slope percent)/10`.

An instant HP event invalidates its touching HP bracket for DH/Pace Down,
but does not erase an otherwise resolved speed-based PU/SU/OT fit. Unknown
current effects, recipient masks/immunity, magnitude or timing still withhold
the affected inference. Normal-drain and partial-transition brackets between
DH candidates are not joined. Sampled endpoint-average HP rates approximate
a nonlinear speed curve; boundaries remain sampled/model precision.

## Reachable per-mode gains

`modeImpactsFor(race, reference, analysis, runnerId, courseId?)` in
`status-mode-impact.ts` lazily returns one summary per inferred mode kind.
It reuses the shared ideal engine, removing **all episodes of that kind in one
paired trajectory**. Full-path calibration and the common section-wit
quantile are retained. The excluded known interval uses a normal/off
reference; it is not replaced by fresh unknown-mode scenarios.

Reachable distance is the time integral of paired constrained velocities;
neighborhood caps and acceleration/deceleration apply to both paths. Local
equivalent time divides that travel difference by the full reference velocity.
Known residual differences after mode expiry are included until paths agree;
unknown histories are not bridged. HP compares the paired self-speed curves
and compound status factors. Positive distance/time means gained reference
travel/equivalent time; negative means lost. Positive HP means extra spent;
negative means saved. Direct-speed uncertainty withholds HP attribution.

The older `modeledExtraDistance` is only a target-ceiling area and is kept
separate. `reachableExtraDistance/Time/Hp` are the paired shared-model values;
`reachableRange` describes matching lower/mid/upper conditional scenarios,
not confidence intervals or guaranteed extrema. `coverage` measures active
candidate windows. `complete` additionally requires known carryover; complete
totals are withheld when a tail is missing, while assessed partial values can
remain. Inferred mode identity, recorded progress, HP and the field schedule
are held fixed. These numbers are not measured causal finish-time changes,
and different mode/skill comparisons are not independent additive credits.

## Whole-file verification

`node --import tsx tests/mode-inference-workflow.ts <new temporary folder>`
imports synthetic public replay files in child processes, runs real analysis,
then requests the shared per-mode comparisons. Cases cover recovery/phase
ramps, ordinary and known startup acceleration, target/current/acceleration
skills without invented modes, unknown gaps/scaling, front ordering and the
position limit, independent DH evidence and instant HP brackets, reachable
distance/time/HP signs, cached identity and partial missing tails. They verify
the declared inference and reference model, not live native execution.
