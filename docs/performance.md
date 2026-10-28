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

## Lossless cache storage (2026-10-27)

The installed-data inspection found 244 native cache files but only 37 distinct
modeled payload hashes. The files were uncompressed JSON containing full motion
traces and replay frames. Engine/context namespaces duplicated identical output.
The analysis database also held 239 dashboard versions for 55 distinct source
capture hashes. Its size was occupied payload, with only one free SQLite page;
vacuuming alone would not meaningfully reduce it. Simulator history contained
37,100 JSON run summaries, including repeated runner metadata and unknown fields.

Native caches now store one gzip payload per exact modeled SHA-256, shared across
namespaces. Small per-key headers retain the original authentication; a shared
blob is decompressed with a byte limit, hashed and parsed before use. Existing
inline JSON remains readable, and every cache hit still undergoes the recorded
comparison and trace gate. Reference counting during cache pruning preserves
blobs still used by another header. Compression does not round or omit numbers.

Simulator summaries use compressed SQLite blobs, with both legacy JSON text and
new blobs decoded to the same API objects. New prepared dashboards replace older
views of the same original capture hash even when an engine/context key changes.
Original race JSON, individual simulation seeds/draws, outcomes, saved builds and
jobs are retained. New/optimized databases support incremental page reclamation.

A consistent copy of the installed data was migrated and independently checked:

| Store | Before | After |
| --- | ---: | ---: |
| Native model caches | 2,120.4 MiB | 45.5 MiB |
| Analysis database | 876.8 MiB | 224.1 MiB |
| Simulator database | 155.6 MiB | 41.1 MiB |
| Total | 3,152.7 MiB | 310.7 MiB |

All 244 authenticated model bindings, all 37,100 run summaries, jobs/builds,
50 original race files and 55 latest dashboard payloads matched after migration.
184 superseded dashboard versions were removed on the copy. Native traces were
retained; derived effect-removal calculations and chart data remain rebuildable.
The original installation was not modified. Migration took about 155 seconds,
excluding creation of the copy and the subsequent exhaustive verification.
For one 15.6 MB signed model, authenticated cache-read median improved from
529 ms to 308 ms across six reads (first excluded), with identical modeled data.
This measures cache decoding/verification only, not complete race analysis.

Existing storage is optimized automatically by the service after an update.
The worker waits ten seconds after startup and defers while the game, foreground
analysis or simulation is active. It also waits for the updater to commit success
before touching persistent data, preserving the updater's rollback window.
Compression and authenticated dashboard retirement run in checkpointed batches;
closing the app resumes the work on the next launch. Settings shows progress and
reclaimed space. Original captures, saved builds and simulation outcomes remain.

Named migration steps and a build marker let future releases append optimizations
without a user script. Each new build rescans supported formats; a completed build
does not repeatedly migrate storage. Existing database connections keep their
normal concurrency. Final SQLite compaction waits for an exclusive idle lease and
is interrupted when a foreground database request arrives. Stable result cursors
preserve dashboard pagination even if compaction reassigns SQLite row IDs.

The automatic worker was stopped and resumed on an isolated copy with 37,100
legacy summaries and 244 native cache bindings. All summaries, original captures,
jobs, builds and retained dashboards matched after migration. It served 1,880
concurrent simulator metadata reads with unchanged result cursors. Tests also
verify an incoming reader interrupts compaction and a later idle retry completes.
The installed application's data was not migrated during this verification.

`scripts/optimize-storage.py` remains an optional offline maintenance tool and
reports size by default. Exit Umalytics from the tray before using `--apply` to
compress models and summaries, and additionally `--keep-latest-dashboards` to
remove superseded dashboard versions. The tool refuses the normal running
service's data directory and preserves cache timestamps.
For an intentional downgrade to an older executable, first use
`--apply --plain-run-summaries` to restore plain JSON simulator summaries. Native
headers not understood by an older version are ordinary cache misses. Existing
cache limits and preferences are preserved.

## Update relaunch and workspace recovery (2026-10-28)

One installed update log measured 5.12 s from desktop process entry to window
readiness (4.40 s to service connection), and 10.85 s for the updater helper's
handoff, replacement and readiness checks. This excludes downloading the release.
It is one local observation, not a startup latency guarantee.

Helper preparation now hashes while copying, avoiding a second executable read
and full-file allocation. A 60,121,600-byte local executable measured 57.05 ms
before versus 49.76 ms after across seven warm samples; helper bytes and hashes
matched. This small microbenchmark is not the complete update time. Native
readiness verification hashes the runtime once at the final commit gate rather
than repeatedly during its two-second stability interval. The interval, signed
release checks, runtime/data hashes and rollback protections remain in place.
Startup cleanup runs on a delayed background thread. Runtime reuse still compares
every embedded byte, using a bounded buffer instead of a full runtime allocation.
Diagnostics include runtime preparation and service-startup elapsed milliseconds
for measuring future real launches. Service unpacking/startup remains a material
part of the total; no whole-update speedup is claimed from the helper benchmark.

The WebView profile retains a versioned workspace checkpoint: route, captured race,
selected runner, paused replay time/speed, simulator setup, seed options, results
job and an open Uma editor draft. Simulator results themselves remain in the
service database. Field edits are debounced; update buttons, page hide and visibility
changes flush pending state. Reloading restores drafts without saving or changing
their Dorm originals, and viewing results does not replace an unfinished setup.
Explicit URL routes take precedence over the checkpoint. Incompatible/malformed
checkpoints are ignored and unavailable browser storage does not block the app.

App-only updates reuse the running collector when both independently verified
component identities match its exact runtime hash. This removes collector
shutdown, PyInstaller extraction/startup and engine initialization from that
update path; capture and the Steam game wrapper remain alive. Collector changes
continue to wait for the game to close. The first upgrade from a release without
component identities uses that conservative path too. Frontend assets are gzip
compressed in the native executable and reference data remains collector-owned.
The portable download still contains the collector for offline installation;
separate CI artifacts do not yet mean a smaller app-only download.
