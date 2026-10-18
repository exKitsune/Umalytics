# Simulator UI regression plan

The original dashboard is the acceptance surface: race results, track replay and minimap, playback controls, telemetry, runner stats/statuses, skill cards and skill dialogs.

1. Open a capture that passes the independent comparison. Confirm the small “Simulation matched” text beside Workspace / Race analysis and the full dashboard, with no success banner or standalone trace report above it. Status rows should show names/times without repeated source labels. Select every runner and scrub before/after status transitions; compare targets, acceleration, blockers and clamp reductions to the corresponding trace tick. Do not interpolate discrete states or show future checks.
2. Verify finish places are one-based in the table, team cards and replay. The winner should be selected when opening each race, including recorded-only races; a manual selection during loading must survive analysis completion. Missing finish places fall back to the first runner. Engine arrays use request slot order even when gate order differs. Compare initial effective stats with `initial-stats` events. Check initialization passives appear on their own runner.
3. Open a skill that activates, one with a failed wit check, and one with an unmet branch. Compare roll, threshold, activation/expiry, precondition latch, condition readiness and cooldown times against the trace. Enable individual predicates. A skipped predicate must stay unknown; independently true predicates must not fabricate a successful conjunction.
4. Open last-spurt popovers for a deterministic decision and a decision with rolls, including a recovery recalculation. Compare every actual roll and retained target. A zero-roll decision must not invent a lottery. A deterministic choice has probability one; rolled candidate probabilities sum to one, including the all-failed fallback.
5. Compare telemetry HP and speed with engine replay frames. The target line includes the actual engine modes and skill effects. Blocking shows separate self/final speed reductions, never their sum as causal finish-time loss. Skill effectiveness and movement gains use local effect-removal comparisons. Check that equivalent travel time is never described as a predicted finish-time change.
6. Export race JSON and compare with the original capture semantics, including course/distance and race-time metadata. Export analysis separately to inspect full trace/provenance. Switching races while a request is pending must not attach old results to the new selection.
7. Open a mismatching capture and one missing required setup. Confirm the full dashboard remains and the top bar says Inferred analysis. No simulator decisions from the failed run may appear. Unknown eras require the explicit provisional replay policy; invalid evidence or artifacts still revoke analysis. Change a test registry/artifact/capture during an open matched view; the lease must revoke that view.
8. In an isolated updater fixture, exercise available, downloading, waiting-for-game and restarting states. Check dark/light themes and 150% text. The sidebar card must remain readable, aligned above Settings and disabled while installation is pending; no actual updater is triggered by this fixture.
9. Open an uncached race. Keep the dashboard skeleton, visible “Analyzing race” label and spinner throughout parsing, queueing, comparison and payload loading. Never flash the fallback replay while work is pending. Success replaces the skeleton with the dashboard; mismatch, missing setup and network failure leave the loading state. Switch races during each phase and confirm late responses cannot replace the current selection.
10. Open A, B, then A again and restart the service before reopening A. Confirm the saved output is reused with zero new engine starts and a fresh comparison on each open. Change evidence, policy, engine or reference identity and confirm stale output is rejected. Alter only a cached hidden roll and recompute its plain checksum: the service must reject it and rerun. Settings must count saved simulations, enforce the shared number/size limit and clear both caches while preserving original race files and tags.
11. Select a runner with repeated blocking and nearby-runner checks. Telemetry and the status list should show grouped Traffic episodes rather than separate Blocked/Near labels. Check both chart axes: cuts below 0.075 m/s are hidden, white starts at 0.075 m/s, yellow is 0.25 m/s, amber is 0.4 m/s, and red is 0.6 m/s or more. Use the larger blocking-stage cut; never add the stages. Colors interpolate smoothly within each box, with transparent fades at the edges and below-threshold gaps and the status legend/sidebar show a labeled scale. Clear gaps up to 0.25 s are faded inside an episode, show no active Traffic chip or replay card. Raw blocked-time and loss calculations remain unchanged by this display threshold. Longer gaps split episodes. Check finish clipping and that the global speed ceiling without a blocker is not labeled traffic loss.

Automated gates: `npm test` includes a synthetic projection regression with deliberately different recorded and simulated values, slot mapping, original-capture preservation, replay cards, states, skills, rolls and version-bound inference fallback. `tests/decision-trace-parity.py` compares original == instrumented-off == instrumented-on across private captures and verifies initialization event ownership. Python bridge tests, the HTTP/packaged workflows, Windows native smoke and the release workflow remain required. Private captures and screenshots stay outside Git.

12. For a matched race, inspect skill effectiveness, component use, movement gain/carryover, combined totals, received debuffs, HP/recovery, corner loss, hill/status contributions, speed explanations and finish-gap metres. Unsupported components must have a reason. Confirm totals use a joint removal rather than a sum of overlapping marginal gains. Compare actual delivered debuffs with effect-applied events, including immune/empty target selections.
13. Reopen A after B and after an app restart. Verify both the authenticated baseline cache and compressed mathematical summaries are reused. Change the analysis revision and recompute mathematical summaries without rerunning a still-valid baseline. Corrupt the mathematical payload and confirm clean recomputation. A cached payload must not replace frames, initial effective stats, activation decisions or rolls.
14. Exercise an unknown-version CM capture missing seed/setup with the installed inference bundle. Confirm Nakayama 2500 m, the full dashboard, winner selection, skill/status cards and a cache hit on reopening. Exercise simulator mismatch, unsupported and engine-error fallbacks independently with synthetic fixtures.

15. With power diagnostics enabled, compare accumulation windows against clock start, interruption, restart cooldown and cutoff events. Compare release duration/acceleration against actual activation, application and expiry events. Missing or unsupported gauge data must stay unavailable; the legacy `cp_acc` gauge must never become a full-race Release band. Enabling diagnostics must preserve the original engine's race output.
16. Verify green/passive skills have three-second telemetry markers, while their actual stat effects and analysis durations remain unchanged. Audit every selectable status against the legend, including Inward, Extra PU, Limit, Conserve and Release. Show only one Rushed band. Its legend states up to +4% base target, ×1.6 HP drain at equal speed, and SS combinations ×3.6 / ×7.7 for Runaway.
17. Scrub matched telemetry through steady speed, phase changes, acceleration, skill application/expiry, traffic clamps and HP exhaustion. Every executed tick has an explanation with its actual target and velocity pipeline; none falls back to “Cause unresolved.” Target speed is a thin solid light/dark line. Inference may still express genuine uncertainty.
18. Hover each result metric separately: elapsed time versus finish gap, HP spent versus recovered, status duration versus speed bonus, corner distance versus equivalent time. In Stats, verify phase targets, maximum/selected spurt, acceleration, HP/wit formula inputs and actual section values. Spurt duration is finish time minus start time. Analysis details and meaningful race notes use matching collapsible panels; routine course provenance lives inside analysis details.
19. Warm A → B → A for both matched and fallback dashboards. Check fresh service authorization but no new native run, full-trace transfer or analysis worker for retained entries. Repeat after restart to exercise the persistent path. Changing the diagnostics/runtime identity invalidates older baselines once; later opens must hit cache again.

20. Check the per-status legend checkboxes on matched and inference races. Last spurt, Inward and Conserve power start off in telemetry, while replay still shows both. Enable a band, switch races and reload: the choice must persist. Reset defaults restores those three hidden bands. Turn all statuses off and verify empty rows disappear. Restore the original velocity/elevation/course/skill spacing; only status bands move down one bar. Traffic owns the bottom status lane. No “STATUSES” caption appears. Rushed and Exhausted share red; Dueling is pink and Release shares acceleration orange. Separate Extra pace up, Pre-spurt competition, Stamina limit break, Stamina keep and Secure lead under the later-mechanics notice.
21. Verify the race date includes its year in the library and header. Hover values and bar segments: descriptions must identify the specific metric and amount, without sign explanations or long calculation prose. Detailed formulas belong in each expandable stat in Stats; scoring and accounting details belong in the FAQ/legend.

Previous tracing validation on 2026-10-18: all 39 system workflows passed; Python bridge tests
passed (122 passed, one skipped); production Svelte checks had no errors or
warnings. The six runnable private parity fixtures retained identical race
output with decision and power tracing enabled; five matched, the known mismatch
remained a mismatch, and the seventh fixture still required missing input.
The real Nakayama dashboard displayed power accumulation/release, three-second
passive markers, complete legend explanations and a 33.9 s spurt lasting from
86.7 s to the 120.570 s finish. An isolated no-proxy service verified cached
simulator and inference dashboards. Restart this development service after a
frontend rebuild: it snapshots static assets at startup, so hot-replacing its
inference manifest alone intentionally fails the UI-version compatibility check.
Private captures and screenshots were not committed.

Status-display validation on 2026-10-18: all 39 system workflows passed, including
the minimum-cut boundary, continuous color interpolation, transparent gaps,
preference decoding and replay independence. The final production build passed
Svelte/TypeScript checks with no errors or warnings. An isolated no-proxy service
and real Nakayama capture verified the year in both dates, saved checkbox choices
after a reload and race change, default-hidden Last spurt/Inward, spurt cards in
replay at 95 s, traffic toggle removal, collapsed hidden rows, Reset defaults,
and dark/light legend contrast. The selected traffic fixture had measured peaks
of 0.81 and 0.23 m/s; a runner whose peak was 0.0863 m/s had no Traffic bands.
Tooltip calculation details now live in the FAQ, legend and expandable formulas.


22. For an absent activation, check the closest conjunction against dynamic trace predicates. Show passed predicates as checkmarks without “true at” text. Verify a rank failure, failed prerequisite, static course exclusion, failed wit roll, missing target and cooldown independently. A short-circuited predicate must not become a failure. A missing check must say unavailable, never fabricate a failed roll. Successful skills show earlier restricting conditions. Clicking a received-skill card opens the caster’s detail while retaining the selected runner.
23. Compare a pure speed skill with a speed + recovery/lane skill with the same movement effect. The latter must keep HP/field positions fixed and retain full carryover coverage without requiring reference-course physics. Complete totals show a percentage, zero speed potential says “No speed effects,” and genuine gaps say “Partial.”
24. Enable background analysis in Settings. With the window open and playback paused, confirm newest race date first, one job at a time, persistent cache growth and no selected-runner change. Open another race during warming: foreground work takes priority. Resume idle processing; interrupted work can retry, completed work does not loop. Test count/size limits, disable/re-enable, playback pause/resume and disposal. Reopen a warmed match/fallback and verify fresh authorization with no unnecessary engine rerun. The tray collector continues capture independently when the window closes.


Follow-up validation on 2026-10-18: all 40 system workflows passed, including the
background client’s service-gate wiring, newest-first ordering/cancellation,
retention limits, hidden-status preference migration, precise failed predicates,
latched prerequisites and mixed-effect carryover. The production build and public
artifact audit passed. A private nine-runner matched race now has complete local
carryover coverage for every runner; the three previously missing percentages
are restored. An isolated desktop session saved background analyses, then reopened
the warmed match with a fresh comparison and no extra native run. Browser checks
confirmed the reserved Traffic lane, compact graph spacing, default-hidden
Conserve power, later-mechanics legend, readable course/rank restrictions and
received-skill dialogs preserving the selected runner. Private fixtures and
screenshots remain outside Git.


25. With background analysis enabled, close every viewer window. The service must process the newest race date first, discover another capture, and persist both comparison and complete dashboard calculations. Restart the service and reopen a warmed race: no native or inference worker should rerun. Foreground requests precede the remaining backlog, while a calculation already running finishes safely.
26. Leave a dashboard open while at least twelve other races are analyzed. It must remain on that dashboard. Change capture evidence or an installed artifact: old derived values must be withdrawn and reauthorized, with recorded fields retained in the same UI if no engine qualifies. A brief connection error must not invent an unknown-version warning.
27. Click the selected race again after seeking and selecting another runner: no request, spinner, selection change or time reset. Switch between two warmed races and measure the ready callback separately from a first disk load and a first calculation.
28. Compare raw blocked seconds with traffic contact outlines. The color threshold remains 0.075 m/s; a long contact can have only a few colored ticks. Check transparent lane backgrounds, full-tick colors, the rotating legend triangle, and PD/PU or OT/SU guide markers. Toggle Position-keep guides off and on: markers and their hover lines hide together, the gap graph remains visible, and the choice survives reload. Sub-centimetre-per-second cuts must not print 0.00 / 0.00.
29. Force a genuinely unsupported engine selection. Recorded results, runner build, skills, replay, and velocity/HP samples stay in the ordinary dashboard; targets, skill checks, effective stats and effectiveness remain blank. No current-engine formulas may run for those fields.

Service follow-up validation (2026-10-18): all 41 functional workflows passed;
124 compatibility tests completed with one existing skip. Svelte checking found
zero errors or warnings. Isolated service testing finished five copied races,
including matched simulation and a long-race inference fallback, with no viewer
required for the queue. The inference worker allows a 2 GiB V8 heap because the
existing long-race inference calculation exceeds 768 MiB; only one calculation
runs at a time. Saved-load ready callbacks measured 373/481 ms from disk and
14/14 ms on retained race switches, excluding final UI rendering. A missing-engine
fixture retained the dashboard with unavailable mechanics blank. Browser checks
verified a same-race click preserves 31 s playback, the guide checkbox persists
across reloads, and the scale runs from 0.075 to 0.6 m/s. Windows release smoke
checks additionally exercise the bundled headless worker with system toolchains
removed from PATH. Existing display caches rebuild once for the new format.


30. Inspect the reserved traffic lane in both time and distance axes. Each traced tick occupies its full projected width at its own slowdown color; no label or fade should obscure its magnitude. Zero and sub-0.075 m/s cuts remain transparent, while contact outlines retain their duration. Hover across a blocked tick, a zero-cut blocked tick and a clear tick: one card directly below the lane must show the correct state, time, blocker and slowdown. Tab to the lane and use arrows/Home/End to inspect it by keyboard. Toggling Traffic hides both its paint and hit area.
31. Runner skill cards show Passed/Failed/Not required for wit checks, with raw roll and threshold preserved in analysis data. In Stats, expand Skill activation chance and Skill-check Wit separately. Compare the chance to the simulator's actual threshold, including over-1200 raw Wit and mood; green passives and strategy aptitude must not contaminate the initialization value. Missing initial inputs stay unavailable without a traced threshold. Verify formula rows keep their compact collapsed height and work in both themes.
32. Check that the FAQ contains the local carryover calculation, date-based engine selection and inference fallback explanations, without the removed recovery timing, skill duration, hill, rushed bonus, status source, exhaustion, HP accounting, start quality, debuff, failed-skill or replay-effect sections. Good start labels should be light green.


Traffic/formula follow-up validation (2026-10-18): all 41 functional workflows
passed, including full-tick paint boundaries on both linear and nonlinear axes,
transparent low cuts, contact without a cut, and initial Wit before passive
bonuses. The production build had no Svelte/TypeScript errors or warnings and
passed the public artifact audit. An isolated matched Chukyo dashboard verified
0.316 m/s colored contact, 0.006 m/s transparent contact, and 0.000 m/s clear
points; keyboard inspection, both axes, and hiding the entire traffic hit area
also passed. Skill cards show Passed, the individual activation formula displays
93.10%, and collapsed formula rows measured 28 px. The revised FAQ and dark/light
stat disclosures were checked with no browser console errors. Private fixtures
and screenshots remain outside Git.
