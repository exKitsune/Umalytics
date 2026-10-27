# Replay performance audit

Measured on Windows with Node 22.23.2 on 2026-10-15, against a local recorded
race containing 9 runners, 160 observation frames and 154 events over 122.48
seconds. Capture contents and local paths are excluded from this report.

## Changes

Replay label smoothing caches only owner-relative placement offsets. Previously,
each cached knot retained complete marker, sample, card and group objects and
rebuilt an offset map on every cache hit. Both versions keep the existing limit
of eight display configurations and 400 knots per configuration.

Cold layout knots now construct only runner markers and effect cards. They skip
course routes, elevation, signs and vision polygons, which are needed only for
the actual displayed frame. The placement algorithm, smoothing weights and
cache keys remain the same.

Telemetry's existing immutable-race index also records the maximum lane value,
so chart setup can read it without allocating and spreading all recorded lanes.

## Measurements

The replay benchmark used a 1280 × 500 viewport with labels, vision, debuffs and
course markers enabled. Warm playback sampled 3,600 display frames at 60 Hz per
pass. Timings include scene construction without canvas drawing or browser DOM
work; they are workload measurements rather than an application FPS claim.

| Workload | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| 150 cold seeks | 547.04 ms | 409.85 ms | 25.1% |
| 3,600 playback frames, median of five passes | 881.94 ms | 765.06 ms | 13.3% |
| Retained heap after filling eight × 400 layout knots | 23,114,016 bytes | 1,951,136 bytes | 91.6% |

Retained heap was measured after explicit garbage collection in both runs.
Before playback passes were 1046.66, 871.92, 925.22, 871.35 and 881.94 ms;
after passes were 856.99, 759.41, 759.69, 765.06 and 776.24 ms. These results are
from one machine and capture; other field sizes and effect densities can differ.

Ranking all recorded frames twenty times took approximately 4 ms. Building
speed, position and lane paths on both axes twenty times took approximately
55 ms. These small costs did not justify additional ranking or CLI rewrites.
Offline reference loading already reads independent files concurrently.

## Output equivalence and workflows

Complete scene JSON from the same 150 cold seeks produced the identical SHA-256
before and after the replay optimization:
`eb549bfccf0f44f0123178e28a58d04305daf0b2ca07a5f36f9bf577a4ee0c39`.
Speed, position and lane path output on both axes also matched exactly:
`e293179b322ed2ed059752e226586018ca8586614e19480ea9d86bb441872652`.

The existing shared-canvas workflow passed across 119 game courses, 839 corner
boundaries and 5,299 course render samples, plus 3,231 dense, growing-stack and
crossing-owner layout frames. It checks arbitrary seeks, clip determinism,
viewport bounds, received-effect cards, vision geometry and preservation of
every effect row. Its track-width expectation now reflects the existing 1.3×
widening, and its recording canvas supports the existing debuff gradient API.
The HP timeline/plot and bridge import/export workflows also passed.

The offline race-analysis CLI now rejects using its capture path as the report
path, matching the motion-analysis CLI. The whole-file CLI workflow checks that
rejection leaves capture bytes unchanged and that a separate report still works.

## Warm simulator dashboards (2026-10-18)

The client retains three prepared dashboards, keyed by current capture hash and
service authorization. Warm opens still submit a new gate/comparison and retain
the revocation lease, but skip full trace transfer, projection, decompression and
effect-removal calculations. Polling starts at 60 ms and backs off to 350 ms.
Traffic SVG gradients also collapse identical adjacent stops without discarding
transitions or faded clear gaps. Analysis JSON is formatted only when expanded.

In an isolated local service using copied nine-runner Nakayama captures, a warm
inference switch took 314 ms and return to the matched dashboard took 1,063 ms,
measured from browser click until the runner Stats control was available (not
the result heading, which also appears in the loading skeleton). These are
individual local UI measurements, not a general latency guarantee. The service
recorded zero native worker executions after restarting with saved baselines;
both the persistent restore and warm reopen performed fresh comparisons.
Cold opens and persistent
restores after restarting still pay validation, transfer and projection costs.


## Full simulator batches (2026-10-27)

Ordinary multi-race analysis uses up to four isolated simulator/Node worker pairs,
capped at half the logical CPU count. Workers reuse the pinned skill JSON and
analysis reference for each job. A shared WAL connection avoids checkpointing
at every race; each completed race is committed for polling and interruption
recovery. Skill-impact jobs retain their separate outcome-only execution path.

Binary simulator frames stay binary through Python and are decoded directly into
analysis frames in Node. Frame dimensions, byte counts, runner mapping and finite
values are validated before analysis. JSON-protocol simulators retain the existing
path. Single-race dashboards and capture verification retain their current path.

An isolated nine-runner, 2,500 m benchmark ran the same 12 seeds twice per version.
The original path took 32.17 seconds including worker startup, then 29.82 seconds
with warm workers. Two optimized workers took 18.44 and 15.46 seconds; four took
14.31 and 11.39 seconds. Every saved per-race summary was identical, including
skill metrics and carryover. These local measurements are not a general latency
guarantee. A proposed browser aggregation index was discarded after measuring
slightly worse performance on 1,000 races.

## Single-race analysis and native trace output (2026-10-27)

The single-race sandbox path now hands binary replay frames directly to Node,
as full batches already do. Trace validation uses C-level numeric scans while
still rejecting booleans, strings and non-finite cells. Start-dash state uses
an upper-bound binary search, preserving duplicate timestamps and interpolated
exit boundaries. Current-speed checks avoid temporary filtered effect arrays;
HP multipliers scan active status windows once rather than four times.

For the same nine-runner Nakayama 2,500 m race, warm Node analysis median fell
from 1.830 s to 1.635 s (eight requests, first two excluded). Full single-race
execution, including the existing native engine, validation, analysis and packed
dashboard, fell from 3.449 s to 3.232 s warm median (five seeds, first excluded).
Cold execution stayed around 4.9 s. Every saved summary and unpacked dashboard
value matched. A proposed per-tick effect-window/target-stack cache was discarded
after it increased runtime on the longer race.

The GlobalSim native optimization compares repeated
decision payloads by exact value before serializing fingerprints; numeric
matrix columns reuse their exact serialized text, and small integers use static
text. Schema, observation limits, coalescing, mechanics and RNG ordering remain
unchanged. Twelve traced runs fell from 15.219 s to 13.892 s in the isolated
worker benchmark, including Python response decoding. All twelve complete traces
and 100 untraced outcomes matched. An additional direct JSON comparison matched
byte for byte, including the 12,438,685-byte traced reply. Startup-plan caching
was discarded because it did not improve outcome-only runtime.

The reviewed native source is pinned at
`b8cd8842259cc90f90be6d8640e057b98f17ec42` in `simulation/source-lock.json`.
Both added native serialization tests pass. The native debug suite reports the
same eleven existing failures on the untouched baseline (135 passed / 11 failed)
and modified source (137 passed / 11 failed): HP/spurt and movement/geometry
reference-vector assertions, including duel partner selection. These failures
were reproduced using separate Cargo target directories. No mechanics or test
expectations were changed to hide them. These local benchmarks are not general
latency guarantees or proof for every possible input.
