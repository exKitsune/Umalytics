# Saved analysis

The viewer prepares race analysis in a worker. It shows the course and runners first, then fills in results and runner details. Telemetry and skill panels mount when they approach the viewport. During opening and preparation, placeholders reserve the result table, replay and selected-runner columns using the same responsive layout.

Completed analysis is compressed and saved. The desktop app uses one SQLite file at `cache/analysis.sqlite` inside its data directory. The web viewer uses IndexedDB. Reopening a saved result restores the calculations; it does not run them again. Three recently opened races also stay in memory. A persistent hit still needs disk reading, a worker start, decompression and transfer into the viewer. It sends only the packed result to the worker. An in-memory hit needs no worker.

Cache keys include the analysis source revision, reference data, race identity and content, and any manual course choice. Analysis or reference changes discard stale entries. Portrait or stylesheet changes do not. Corrupt entries are recalculated.

## Background work

Saved races are prepared newest first, one at a time. Background calculations yield between stages and pause during playback or interaction. Selecting the race being prepared promotes that worker. Selecting another race stops the old job and starts the selected race; the old race can be prepared again later. A stopped worker cannot replace the selected race.

The cache is unlimited by default. Settings can retain the newest number of races or limit disk usage in MB. Clearing the cache preserves races and tags and pauses background preparation so the cache does not immediately refill. Browser storage remains subject to browser quota and eviction.

## Verification

The worker workflow compares its outputs with the synchronous analysis, saves and restores a compressed result in a fresh worker, checks foreground promotion and preemption, verifies that persistent restores send no raw replay or reference data, and verifies reference invalidation. The desktop workflow exercises the real cache HTTP endpoints, disk limits, restart persistence and purge while preserving race files.
