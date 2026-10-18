# Saved analysis

The viewer prepares race analysis in a worker. During opening, the dashboard skeleton says “Analyzing race” or “Loading saved analysis”; it does not briefly show a replay-only page. Telemetry and skill panels mount when they approach the viewport.

The service saves authenticated simulator baselines separately from compressed mathematical summaries in `cache/analysis.sqlite`. The browser uses IndexedDB for mathematical summaries when no desktop cache is available. A persistent simulator hit still needs disk reading, independent comparison, trace transfer, worker projection and decompression. The saved summaries avoid recalculating the expensive effect-removal analysis; they never replace trace decisions or frames.

Three recently opened dashboards also stay in memory, for both simulation and inference. Every open still checks the current capture hash and obtains fresh service authorization. If the content and authorization match, the client reuses the prepared dashboard without fetching the full trace, starting an analysis worker or decompressing summaries. Inference additionally revalidates its version-bound cache key and UI revision. A changed binding cannot reuse the memory entry.

Cache keys include the analysis source revision, reference data, race identity and content, and any manual course choice. Analysis or reference changes discard stale entries. Portrait or stylesheet changes do not. Corrupt entries are recalculated.

## Background work

The simulator-first client analyzes the selected race on demand. It does not warm the whole race library in the background. The local collection service still receives and stores new races; following a new race opens and analyzes it. Switching selection cancels the previous client worker and guards against late replies replacing the current dashboard.

The cache is unlimited by default. Settings can retain the newest number of races or limit disk usage in MB. Clearing the cache preserves races and tags, clears the prepared memory entries, and does not trigger library-wide preparation. Browser storage remains subject to browser quota and eviction.

## Verification

The projection workflow verifies fresh authorization before memory reuse, no full payload request on a warm open, invalidation after a capture change and late-response guards. Derived-cache tests prevent restored summaries from replacing simulator facts. Desktop workflows exercise real cache HTTP endpoints, disk limits, restart persistence and purge while preserving race files.
