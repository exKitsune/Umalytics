# Last-spurt comparison

The results table compares a selected decision window's baseline spurt target with the maximum target allowed by effective speed, guts, strategy and distance aptitude. Temporary skill boosts and slope penalties are excluded from both values. Each target needs clean speed evidence within its own window. The motion model's assumed ceiling cannot fill a missing reading.

Buttons in the cell select late entry or a recovery check. Consecutive checks that deterministically support the same maximum, with no conflicting observed target or delayed start, share one summary. Every underlying check remains selectable in the popup, including an early window without a clear reading. This presentation grouping never backfills an unknown early target or assigns its luck from a later speed reading. The pre-spurt plateau remains in the details: it is late-race cruising, not a low selected spurt speed.

Recorded starts within 0.15 seconds of late entry display as “On time.” This is a presentation allowance based on the small offsets in inspected replays, not a verified native timer. The tooltip retains the measured offset, and analysis continues to use the original timing. Material delays remain explicit.

The hover plot follows the supplied mechanics notes: evaluate HP to 60 m before the finish, lower candidate targets in 0.1 m/s steps, order candidates by finishing time, then apply repeated wit checks. Enough HP selects the maximum immediately. Candidate costs omit acceleration and terrain, as described by that decision rule.

Each recovery after late entry gets a separate decision. The hover panel lets the user inspect those decisions and their HP budgets. Each speed fit uses only samples before the next recovery, after removing known skill effects and terrain penalties. Later samples cannot identify an earlier choice. Unresolved HP interpolation cannot establish odds.

The plot shows model probabilities, not a recovered random roll. A replay choice is highlighted only when a clean target plateau and the available start timing identify one candidate. If the next recovery replaces a choice before it can be observed, that decision remains unresolved. Delay is part of the choice; no distance gain or finish-time gain is attributed to spurt luck.

The popup offers target-speed and start-delay probability distributions. Equal values combine their probability mass; ticks retain the discrete choices. A uniquely matched stochastic choice can infer how many preceding faster-finish candidates were rejected. Those are checks within one decision, not retries over elapsed seconds. The last candidate has an acceptance/fallback ambiguity, so the count is a range. Deterministic and unmatched decisions never receive a failed-roll count.

A recovery window can have a measured target and recorded start even when the HP budget disagrees. Show those observations and the time from that check separately from the model mismatch. A later recovery does not erase usable evidence before it.

A clean accelerating pair that reaches the theoretical maximum can also identify the ceiling within rounding tolerance. Known offsets must be unchanged and no effect may start or end within the pair. This covers a ceiling reached just before another runner causes a slowdown; a later blocked sample is never used as plateau evidence.

Recovery entries are reference-model budget checks, not verified native recalculation events. The installed metadata declares request flags, a calculation count, result, target speed and start distance; protected native bodies remain unavailable. See [native evidence](mechanics-native-evidence.md). When the HP model predicts an immediate full spurt but the recorded start remains delayed, the panel reports that disagreement instead of assigning luck.

## Mechanics version limits

The supplied notes combine several eras, including fifth-anniversary changes, and explicitly distinguish server differences and speculative later mechanics. They are not a versioned specification for the installed Global build. The app uses the pre-fifth-anniversary stat regime (over-1200 halving and final caps) and includes the post-first-anniversary guts term and recovery budget checks. A fitted maximum speed supports that speed formula for a replay; it does not validate the separate HP decision rule.

The inspected simulator also differs from these checks: its full-spurt HP test retains the entire late-leg length during a recalculation, and its recovery guard can exclude already-started spurts. Neither detail has been established from native bodies. Do not adopt a rule solely to force a single replay to fit, or convert a contradictory budget into a luck score. Exact recovery triggers, budget inputs, candidate enumeration, and regional patch applicability remain verification requirements.

Exhaustion appears under HP finish / start, with onset bounds, distance remaining and local modeled distance/equivalent time lost after HP runs out. It uses the existing healthy-HP comparison, retaining traffic and skill timing. These figures do not measure earlier spurt waiting, different target selection or changed skill timing, and are not presented as total last-spurt loss.

## Decision budget versus finishing HP

The maximum-speed selection threshold is not a survival budget. It excludes the final 60 m and uses baseline self speed without future skills, terrain or traffic. A positive margin above that threshold does not imply positive HP at the finish. Keep this distinction explicit in the popup.

The October 16 audit of gate 1 in the local Nakayama 2500 m replay found 988.908 HP after the 102.763 s recovery. The 408.157 m decision budget costs 913.859 HP at the 24.595 m/s baseline, leaving a 75.050 HP margin. Covering the complete remaining 468.157 m at that baseline costs 1048.198 HP: the excluded 60 m costs 134.339 HP, so the full-distance baseline budget is already 59.289 HP short.

Integrating the ordinary running-drain formula over the observed self-speed trace after that recovery predicts 931.071 HP spent by the last positive sample at 119.345 s, versus 932.908 HP in the replay (56 HP remaining). The difference is 1.837 HP, about 0.20%. No later HP hit, heal, rushed, downhill or dueling interval appears for this runner in that window. Temporary target-speed skills, traffic and the final uphill are represented through the observed self speed; this comparison validates drain over that segment, not a forward prediction of its speed.

The next sample at 120.411 s records zero HP with 31.725 m remaining. This is consistent with the drain calculation and does not establish a general formula error. The separate earlier recovery/start-delay mismatch is still unresolved; this audit does not validate the native selection or recalculation rule.
