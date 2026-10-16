# Browser UI verification

Manual checks on 2026-10-14 used the local in-app browser at 1920 × 1080,
in both dark and light themes. These checks cover the browser UI; verification
of the packaged Windows EXE is recorded separately in the desktop workflow.

- The footer remained 32 px high. The body measured 1914 px wide with no
  horizontal overflow, and select controls were readable in both themes.
- Dragging the telemetry plot moved replay time from 0 to 53.4 s. Shift-arrow
  keyboard seeking reached 30 s.
- The **Shooting for Victory!** skill modal showed the recorded activation at
  58.34 s and reported duration of 6.4 s, with the correct reference acceleration
  effect of 0.4 m/s². Reference effects remain separate from measured changes.
- Manually choosing Tokyo course 10606 persisted after reload and portable
  export retained `courseIdentity.source="manual"`. The captured course was
  restored after this check.
- Loading an older IndexedDB race with a null distance recovered its 1600 m
  finish-derived distance.
- A Tokyo 10606 clip covering 30–32 s at 1× recorded, previewed, downloaded and
  sought successfully. FFprobe confirmed VP9 WebM, 1280 × 480, 30 fps, 60 decoded
  frames and no audio stream. Packet timestamps covered 2.000 s; the browser
  reported 1.967 s for the final frame timestamp. A decoded midpoint frame
  retained the course bend, markers, clock, phase, elevation and synthetic label.

The clip has no container Duration element, as produced by this browser's
MediaRecorder, but the tested browser preview and FFmpeg seeking succeeded.
No duration rewrite was needed. No private capture files or replay data are
included in this document.

The revised layout was checked again after source freeze: small map and results
above the full-width curve, telemetry below, and per-runner skill cards. Replay
advanced from 83.4 to 102.8 s and paused; dragging telemetry moved from 1 to
83.2 s. Local portraits, skill details and light/dark themes rendered correctly,
with no browser console errors. Modeled status spans retain dashed styling and
their source in details.

The portrait-backed 40–42 s clip also encoded and sought successfully: VP9,
1280 × 480, 30 fps, 60 decoded frames, 553,156 bytes, and one video stream with
no audio. Its decoded midpoint showed local Uma portraits, skill callouts,
41.01 s on the race clock, and relative elevation labeled in meters.

The final `npm test` run passed nine whole-process workflows with no skipped
checks: library
import/export/reimport, failed-import retention, decoded response analysis,
binary finish-distance recovery, modeled-status handling, conservative course
inference, declared response-shape sanitization with privacy sentinels, offline
master/event reference generation and running desktop history caption hydration.
The history workflow includes the real 61-second work-budget cooldown and
disposal checks. The extraction fixture uses standard-library Python only;
installed-cache course and portrait extraction were verified separately.

## Duration boxes and fixed replay camera

The next revision was checked at the user's 2247 × 1916 viewport and at
1366 × 900, in dark and light mode. There was no page-wide horizontal overflow.
The selected runner panel starts alongside the race title; the map, results,
replay and telemetry occupy the left column. White stat icons gain contrast in
light mode. The temporary viewport override was reset after the check.

- Replay rendering retained the same camera angle and scale while playback
  advanced through the course. A rendered-frame workflow separately covers
  3,508 frames, 119 courses and 839 corner boundaries.
- Dragging the graph moved the replay to 66.57 s / 1269.4 m. Keyboard Home and
  End seek correctly; changing axes and hiding/showing statuses updates overlays.
- PU, PD and Dueling labels shared one baseline at 15 m/s when their intervals
  did not overlap. Each label was centered on its actual interval.
- A reported 7.5 s skill occupied 61.83 SVG distance-axis units for the selected
  runner. Its label was clipped to that interval. Hover revealed **See Ya Later!**
  and keyboard focus revealed **Be Still** without widening the duration bar.
  Instant and unknown-duration activations retain exact point markers and have
  a minimum label width for at least five letters. Their labels also expand on
  hover, and row packing reserves that label space. Green elevation stays inside the plot, while course sections,
  phases and skills stay underneath it.
- Late Surger Savvy showed its guaranteed activation rule, satisfied strategy
  condition, and inferred passive state without adding a recorded proc time.
- The selected front runner showed SU separately from PU/PD, and its SS panel
  separated modeled distance/extra HP from sampled HP spent in the same window.

The local verification screenshot is kept outside the public repository.

The final functional suite passed all 12 workflows with no failures or skips.
The separate native collector handoff workflow also passed: idle legacy and
current-runtime upgrades, exact-runtime reuse, protection of active loopback
game-API traffic, and refusal to stop another installation or an unrelated
listener. Native Cargo checking and the Svelte production build passed.

The rebuilt single executable also passed the packaged collector and native
EXE smoke workflows: embedded runtime hash, real launcher arguments/environment,
export selection in Explorer, unchanged idle files/settings, exact-runtime
reuse, and owned shutdown. These used isolated installations and loopback TLS;
no game process or certificate trust was changed.
