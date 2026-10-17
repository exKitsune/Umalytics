# Skill condition coverage

The engine separates three questions: what the rule means, whether the replay shows qualifying evidence, and whether the actual trigger is known. A rule can be understood and show an eligible candidate region while its selected random window or internal timer remains unobserved. Missing proc events do not make these three questions equivalent.

## Bundled Global definitions

The bundled Steam Global metadata contains **732 skills, 785 effect branches and 2,375 condition/precondition atoms using 100 distinct keys**. Every one of those keys was checked against the loaded [GameTora condition viewer](https://gametora.com/%75%6D%61%6D%75%73%75%6D%65/skill-condition-viewer) on 2026-10-14. The page had 145 condition sections; all 100 used Global keys were present. All current expressions parse, and all 785 branches now use understood reference rules. There are no remaining partial or unsupported meanings in this catalog. There are still 241 branches with random-window or separate random-gate conditions.

This is **100% rule coverage for the bundled catalog**, not 100% reconstruction of hidden race state. Missing player/NPC flags, team membership, selected random points, internal timers and selected spurt speed can still prevent a definite outcome. New selector values outside the implemented domain produce an explicit diagnostic instead of silently borrowing an old meaning.

[condition-coverage.json](condition-coverage.json) lists every key, expression, skill/branch, meaning, required input and evidence limit. [gametora-condition-audit.json](gametora-condition-audit.json) records the review date, section hashes and correction notes without copying the reference page. Regenerate the coverage report with:

```powershell
node --import tsx scripts/report-condition-coverage.ts public/data/metadata.json docs/condition-coverage.json
```

Vision-based predicates remain unresolved while a recorded own or targeted foreign vision proc has an unrecognized effect branch. Reported expiry or reference expiry for every possible vision branch can end that uncertainty; a recipient mask that excludes the runner prevents it. The whole-file catalog workflow verifies these cases alongside all 785 public branches.

The supporting declaration audit pins [kachi-dev/uma-tools revision 4401e259](https://github.com/kachi-dev/uma-tools/tree/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/uma-skill-tools). It declares 50 reference rules, 24 no-op approximations, five random proxies and eight random-region rules; 13 Global keys are absent. GameTora supplies meanings that this simulator omits or approximates. The supplied mechanics document was also checked locally (SHA-256 `fb63c86215a4f06fadcca2cca6d4f5bbf5e5d399a9bb955c2b2382c8f7e9649b`). Neither the private document nor private replays are bundled.

### Corrections from the complete review

| Conditions | Implemented rule |
| --- | --- |
| `distance_diff_rate` | Leader gap as a percentage of the leader-to-last spread. A zero spread stays unresolved. |
| `distance_diff_top` | Whole-metre leader gap, distinct from the separate decimetre predicate. |
| `lane_type`, `is_behind_in` | Four lane bands with upper boundaries 0.2/0.4/0.6; the runner behind must be nearer lane 0. Tied trailing runners do not select an arbitrary neighbor. |
| `is_move_lane` | 1 means inward movement; 2 means outward movement. |
| Proximity timers | Any qualifying neighbor can sustain the timer. Ordinary front/rear thresholds are 2.5 m and one horse lane; `set1` is 5 m and 2.7 lanes. Rank changes reset these timers. |
| Overtaking timers | `overtake_target_time` measures being targeted; `overtake_target_no_order_up_time` measures having a target. |
| `near_count`, `is_surrounded` | Inclusive documented distance boundaries; surrounding side occupancy can be on either side. |
| `remain_distance_viewer_id` | Any player runner, excluding NPCs. Every bound in an AND clause must hold for the same player. |
| `is_other_character_activate_advantage_skill==9` | Another runner's positive recovery event, rather than any buff or this runner's own activation. |
| `compete_fight_count>0` | At least one recorded final-straight duel. Higher exact episode/resume counts remain unsupported. |
| Rushed-opponent counters | Currently rushed enemies, filtered by direction or strategy. Known teammates are excluded; unknown membership gives a count range. |
| `lastspurt` | HP-feasibility states 0/1/2, reconstructed at late entry and recovery under the documented budget. This remains an inference. |
| Course triggers | Final-corner later half ends with the corner. Last-straight entry is a transition, not a lasting 10 m region. Named-corner random triggers use its last pass. |
| Continuous outside ranks | Include the rounded boundary, matching GameTora's examples; ignore the first five seconds. |
| Random selectors | Preserve four corner draws and segment-first straight selection as reference semantics. Do not fabricate a selected point or reuse the wit lottery as trigger RNG. |

Last-spurt formulas, version assumptions, player/NPC field provenance and focused verification are documented in [last-spurt-conditions.md](last-spurt-conditions.md). Native method bodies remain unverified where noted in [mechanics-native-evidence.md](mechanics-native-evidence.md); a documented rule is not evidence of native execution.

## Implemented evidence

| Rule family | Available evidence / conservative boundary |
| --- | --- |
| Static course and selection | Surface, turn, venue, distance class, 400 m divisibility, selected strategy, full-field strategy counts and equipped-skill counts. |
| Public captured metadata | Bounded popularity, motivation, grade and time-of-day enums; missing fields stay missing. Base-stat checks apply overcap/motivation before passive bonuses. |
| Course/progress | Phase, distance percentage, integer remaining distance, corner number, final-corner flag, final straight, grade and spurt distance. Event-time interpolation is marked as a proxy. |
| Rank and gaps | Current one-based rank comes from the complete race inventory and its distances at each retained snapshot, never finishing order or position within a strategy group. Equal distances or omitted opponents leave a possible-position interval; a clause is established when every possible position satisfies it. Leader/adjacent gaps still require complete field distances. Horse-length gaps use the 2.5 m reference unit. |
| Activation history | Prior successful events and positive recovery definitions provide lower counts by phase. Requested-skill checks compare the actual skill ID, including inherited-ID normalization, rather than comparing a boolean with that ID. Same-timestamp lower reference IDs and prior-tick notifications supply supported trigger evidence; a proc cannot count itself as an earlier proc. Missing events are not assumed to prove zero. |
| Rushed/block history | Recorded flags supply sampled states; episode counts are lower bounds and sample-held timers remain proxies. A recording gap does not become a second rushed episode. |
| Spatial/vision | Near/surrounding opponents, lane motion, proximity/block timers and visible overtake candidates use documented horse-lane/vision formulas as proxies. Known vision modifiers use reported/reference duration and supported level scaling; known nonrecipients and immune teammates are excluded. Overtake candidates use the documented positive gap up to 20 m and catch-up within 15 seconds rule, or a recorded front blocker. Actual selected targets and internal timer updates are unobserved. Unknown applicable vision effects suppress the vision proxy. |
| Continuous rank conditions | A sampled threshold violation is known. Full compliance between coarse samples remains a proxy; the first five seconds are excluded. |
| Random activation | Candidate phase/corner/straight/slope regions are evaluated, including all corner draws and the last pass of named corners. The selected 10 m window and separate random-lot gate remain unobserved; a wit draw is never reused as trigger RNG. |

`state` retains observable met/unmet/unknown semantics. `eligibilityState` adds eligible/ineligible/unresolved candidate evidence. `mechanicsState`, readable predicate meanings and separate observations/proxies/missingInputs/hiddenState explain why an outcome is unresolved. `definitiveOpportunity` excludes random-window and proxy-only opportunities from a causal wit-failure diagnosis. Supported lottery results can still be shown separately as reference-model evidence.

`inferredState` adds a separate replay inference without rewriting `state`. Each branch exposes `inferenceBasis` (`observed`, `replay-proxy`, `complete-random-region`, `unresolved`) and an `absenceAssessment` that separates excluded conditions, supported conditions, hidden random timing, missing inputs, partially established mechanics, and no observed candidate. Diagnostics describe one coherent qualifying candidate rather than accumulating missing inputs from unrelated times.

An absent equipped non-passive lottery skill can be labeled **Wit check failed · inferred** when the recording covers start through finish, all inventories are available, and an unconditional/static opportunity is established. The same inference applies to a reference random-window rule only when the complete recording traverses every eligible region of at least 10 m and every other clause/precondition is static and satisfied. A random window combined with changing rank or proximity does not qualify. Contradictory supported lottery-pass evidence or another equipped skill in the same activation group prevents that inference. Lottery-free skills are never called wit failures; missing inventory or start/finish coverage withholds the inference. This is a conditional inference under reference mechanics and capture completeness, not a recovered native RNG result or proof that all activation-exclusion state is known.

### Field-position boundaries

`order` compares the current whole-field position directly; first place is 1. `order_rate` converts its argument into an integer position cutoff with `round(fieldCount × percentage / 100)` **before** applying the recorded comparison operator. In a nine-runner race, `order_rate<=50` covers first through fifth, `order_rate>50` covers sixth through ninth, and `order_rate>=40` covers fourth through ninth. In a twelve-runner race the 50% cutoff is sixth. This is not a literal percentile of the runner's rank, and selected strategy does not change its denominator.

The rounded cutoff is directly implemented in the pinned simulator's `ActivationConditions.ts:769–770`, and the supplied mechanics notes' `order_rate` section gives the nine-runner `>50 → >5` example. The simulator's optional `orderRange` filtering is a simulation approximation; its forward-position relaxation late-race is not used to rewrite observed replay conditions. GameTora’s examples independently include the rounded boundary for continuous-outside conditions, matching the simulator’s inclusive `orderOutFilter` test. Continuous history remains a proxy, with sampled violations known and the first five seconds excluded.

Rank at an inserted skill timestamp is interpolated and remains a proxy; identical bracket ranks alone do not prove the internal rank at an unsampled instant. A satisfied sampled position clause also does not establish a separate random window or transient activation trigger. `explainFieldRankCondition(expression, fieldSize)` exports concise field-size-aware wording, while raw expressions remain available separately.

Each `PredicateExplanation` can include `state`, `observed`, `time` and `role` for one **coherent eligible candidate**, preferring the first retained snapshot over an earlier inserted/interpolated proxy. `firstOpportunity` still records the earliest eligible time. Current-condition clauses share the chosen snapshot; a latched precondition carries the time of its earlier coherent witness. No candidate means no per-clause evidence check is emitted. These fields do not combine unrelated satisfying samples: fifth place at one time and sixth at another cannot satisfy a simultaneous fifth-and-sixth condition. A position clause can be `met` while the separate random-trigger clause remains `unknown` at the same candidate. This is clause evidence, not a claimed activation or wit outcome.

## Retained capture measurement

The revised evaluator was run on 20 retained Champions Meeting captures without changing their original hashes. These contain 3,123 skill rows and 3,312 evaluated branches. All 3,312 branches now have understood meanings. Candidate evidence is eligible for 2,648 branches, ineligible for 130, and unresolved for 534. Strict observed satisfaction is met for 918, unmet for 130, and unknown for 2,264. Random triggers occur in 1,354 branches; understanding those rules does not reveal their selected points.

The analysis preserves 1,976 recorded activations and 258 inferred guaranteed passives. It reports 126 inferred wit failures, two supported wit failures, 52 strictly met-condition outcomes, 40 replay-inferred condition outcomes, 123 incompatible outcomes, and 483 unresolved outcomes. It separately recovers 63 initial acceleration activations from gate markers, satisfied initial conditions and uniquely matching clean acceleration samples; these remain inferred and do not increase the recorded-activation count. These unresolved rows are not reclassified as wit failures simply to complete a table. Missing-input diagnostics occur on 136 branches. No private runner data is published here.

## Capture context and provenance

Installed IL2CPP v31 declarations expose `RaceHorseData.popularity` at metadata record offset 24,846,940 and `team_id` at 24,847,132. Popularity is now retained only within 1..field count. Explicit team membership is remapped to anonymous local ordinals; raw team IDs, trainer/owner/viewer IDs and team-member identities are not retained. Frame order is a simulation slot and is not promoted to an actual post draw.

The selected public SQLite tables provide `race_instance.id → race_instance.race_id → race.grade`, and `race_instance.time`. The 1,817 exact joins are bundled as `raceInstanceConditions` beside the existing course map. Installed metadata also declares `MasterRace.Grade` at 23,480,656 and `MasterRaceInstance.Time` at 23,483,800. Public time enum values are 2/3/4; the Global Night Races condition is `time==4`. Explicit captured `race_grade` / `start_time_type` win over the lookup. Portable JSON labels each source as recorded or race-instance. The bounded sanitizer header reader supports gzip/zlib and variable Global header size.

Older sanitized files from which popularity/team/instance/NPC context was removed cannot recover those fields. Only preserved public instance IDs support exact default context lookup; inference does not manufacture an instance ID or restore discarded metadata. The new preservation path is verified with whole-process synthetic capture fixtures, not a fresh live game capture.

The REA evidence and limits are in [skill-status-evidence.md](skill-status-evidence.md). Readable simulator and replay reference source and the public master tables supply the reference rules. They do not establish that a native method or server transition executed.

## Functional verification

`tests/condition-engine-workflow.ts` runs actual analysis, sanitizer, import and portable reimport processes using public definitions and explicitly synthetic inputs. It checks activation history/recovery, same-timestamp ordering, rank/gap/continuous conditions, positional/vision proxies, static field counts, separate random eligibility, a supported failed lottery with an unobserved random window, unknown post draw, popularity bounds, anonymous teams, exact grade/time lookup and explicit overrides, extended gzip/zlib headers, envelope privacy, portable facts and unstripped horseACT-compatible raw fields (horses, trained characters, course). It does not assert that modeled candidates are recorded internal states.

`tests/field-rank-workflow.ts` invokes the whole-file analysis CLI for eight synthetic replay variants. It checks nine/twelve-runner rounding, all comparison directions, separation from strategy rank and final placing, an omitted opponent, ties inside/across the cutoff, random/interpolated trigger uncertainty, coherent per-clause evidence, sampled candidate preference and an earlier latched precondition. Run it with `node --import tsx tests/field-rank-workflow.ts .cache/field-rank-functional`. No private replay data is embedded in the workflow.

`tests/condition-catalog-workflow.ts` evaluates all 785 bundled branches through the real import/analysis CLI as independently addressable synthetic branch probes, covers all 100 keys, and compares the regenerated audit with the committed report. Seventeen focused checks cover requested/inherited skill IDs, self-event ordering, guaranteed versus conditional random opportunities, inferred versus supported wit, incomplete recordings/inventories, and reference-duration vision expiry. Run it with `node --import tsx tests/condition-catalog-workflow.ts <fresh-output-folder>`. The report records reference comprehension and available evidence, not successful native execution of every predicate.

`tests/gametora-conditions-workflow.ts` runs complete file imports and analysis for the corrected units, lane bands/directions, both overtaking timer roles, all proximity boundaries, enemy-rushed scopes, positive healing triggers, same-player distance conjunctions, spurt categories, hidden-state safeguards and portable NPC privacy. `tests/spurt-capture-workflow.ts` separately tests budget decisions, recovery/debuff differences, unknown greens and the real Python sanitizer. Both are included in `npm test`; these are functional workflows, not unit tests.
