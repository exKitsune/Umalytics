# Last-spurt condition and player classification

The [GameTora condition viewer](https://gametora.com/%75%6D%61%6D%75%73%75%6D%65/skill-condition-viewer)
defines `lastspurt` as HP feasibility: **0** cannot cover the remaining race at
late base speed; **1** can run above that base but cannot cover maximum spurt;
**2** can cover maximum spurt. This is separate from recorded spurt entry
(`is_lastspurt`) and from the final race phase. All bundled Global expressions
currently use `lastspurt==2`.

`condition-spurt.ts` evaluates an explicitly inferred decision budget at late
entry, then after the runner's own recorded positive recovery effects. A later
HP-debuff sample does not retroactively change a decision. It never reads a
future post-recovery sample for an earlier observation. A missing recovery
sample invalidates the old decision rather than preserving stale certainty.

The supplied *Race Mechanics*, “Last Spurt” and “HP Consumption”,
specifies the maximum-spurt target, ground/guts HP curve, and a **60 m buffer**
before goal. The pinned [HP policy, lines 113–151](https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/HpPolicy.ts#L113)
implements the budget without acceleration, future skill effects, terrain or
random/status drain reductions. The helper follows that declared reference
calculation: `HP/s(speed) × max(0, distance − 60 − decision position) / speed`.
It uses both late base and maximum-spurt speed to assign the category.
The terrain omission is visible in the source, rather than inferred from the
mechanics prose: `getLastSpurtPair` receives the unmodified maximum/base targets;
[RaceSolver, lines 1181–1200](https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/RaceSolver.ts#L1181)
adds uphill/downhill changes separately during target updates.

The supplied mechanics dates recovery-triggered recalculation to after the
first anniversary. This helper targets that post-anniversary reference regime;
the current Global catalog contains anniversary-era mechanics, but catalog
availability alone does not prove an installed native recalculation method.
The pinned solver additionally stops its update method once its spurt flag is
set. That guard does not resolve native post-entry behavior; recovery budget
updates here remain an explicit feasibility proxy, including during spurt.

Initial speed and guts use the application's pre-fifth-anniversary stat regime:
over-1200 halving, motivation, base/final clamps, base-stat course thresholds,
ground speed penalty, career bonus and resolved initial passives. The helper
has no dependency on the condition engine. Its caller supplies already known
static predicate values; recorded initial branches and guaranteed statically
proven passives resolve greens. An unresolved relevant equipped passive,
missing inventory or required aptitude remains unknown. An unrelated timed
movement skill does not erase the budget.
Each passive gets its own normalized equipped-skill field count, including the
selected runner. Partial inventories produce a count interval: a comparison
can resolve when every possible count agrees, but Lone Wolf's `==1` stays
unresolved if another missing inventory could contain it. Character-presence
conditions resolve when the named character is observed, even if other field
IDs are missing; proving absence requires complete IDs. These checks do not
invoke the condition engine or invent a random passive activation.

Late-entry HP is interpolated only across a retained bracket of at most 2 s
without a recorded HP event. Recovery uses the first retained post-event
sample within 2 s; unreported drain between event and sample makes it a proxy.
All results retain `confidence: proxy`, decision time and the two HP costs.
They do not establish the native selected spurt speed, hidden acceptance roll
or exact skill failure cause. The inspected simulator's
[activation mapping](https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools/ActivationConditions.ts#L746)
itself calls its older 1/2/3 semantics uncertain; that mapping is not substituted
for GameTora's documented 0/1/2 meanings. No native budget method body was
recovered in the [installed-code investigation](mechanics-native-evidence.md).

## Safe player/NPC class

`remain_distance_viewer_id` means the remaining distance for **any non-NPC
player runner**, not necessarily the selected runner or a specific viewer ID.
`Runner.isNpc` stores only `true`, `false` or unknown. It does not store viewer,
owner or trainer identifiers.

The installed Global metadata (`global-metadata.dat`, SHA-256
`27b8f59d91c2be040bba33964ccb6bab37d5ae674b47dfccc32d5793f76edb5f`)
declares `RaceHorseData.npc_type`, field 123513 at metadata record 24846916.
`RaceDefine.RaceNpcType` is type 10128 at record 28669736. Its explicit constants
are Normal=0, Boss=3, User=11, UserOther=20, Ghost=21 and Follow=22 (fields
60428–60433; default records 17374196–17374256; data 18137616–18137621).
These are metadata file offsets, not runtime addresses or recovered method
behavior. The class mapping keeps 0/3 as NPC and 11/20 as player. Ghost, Follow
and unrecognized values remain unresolved because their relationship to this
condition is not established. Mob IDs, character IDs and missing/zero viewer
IDs are not used to guess classification.

The sanitizer keeps the source `npc_type` and also emits `is_npc`. Raw import
maps the same known codes and portable exports preserve `isNpc`. Old sanitized
races which discarded this field cannot recover it. Explicit normalized
booleans can supply the class without a later identity guess.

## Functional verification

`node --import tsx tests/spurt-capture-workflow.ts <new temporary folder>` runs
whole-file import/helper child processes for all three categories, decision
history, recovery versus debuffs, future/missing HP, known/unknown greens,
per-skill and bounded inventory counts, character presence/absence, ground and
Runaway differences. It also runs the real Python sanitizer and
portable importer/reimporter on a synthetic bounded binary replay, checking
NPC classes and identity sentinels. These test reference inference and capture
privacy, not live native execution.
