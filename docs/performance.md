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
inference switch took 301 ms and return to the matched dashboard took 61 ms,
measured from browser click to visible results. These are individual local UI
measurements, not a general latency guarantee. The service recorded one native
worker execution for the initial matched open and two comparisons after reopening;
the second open did not rerun the native simulator. Cold opens and persistent
restores after restarting still pay validation, transfer and projection costs.
