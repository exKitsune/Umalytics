# Automatic skill-impact performance

Measured locally on 2026-10-26 with a nine-runner Chukyo 1200 m field, four
worker processes, 100 seeds, a baseline and nine separate skill removals
(1,000 simulations). The installed engine SHA-256 was
`616561097e7be0e054c21df046f19ae67537ea6b0f04dbcd3500dfd93c86442f`.

| Path | Time | Throughput |
| --- | ---: | ---: |
| Previous orchestration | 52.34 s | 19.1 races/s |
| Updated orchestration | 4.83 s | 206.9 races/s |

All 1,000 saved results were identical, including finishing order, raw finish
times, seeds, gate draws and mood draws. These are local batch measurements,
not a promise for every course or machine. The comparison used the same engine
and full skill catalog; no mechanics or sample counts were reduced.

Changes:

- Verify the executable hash before launching each worker. Check its path,
  file identity, size and timestamps on each request; replacements, changes,
  restarts and changed pins require verification again.
- Encode each worker's pinned skill catalog once. New reference objects
  replace this bounded cache; per-seed settings are still encoded separately.
- For outcome measurements, validate/read the binary packet but skip building
  Python replay-frame objects that the win-rate calculation never consumes.
- Keep the SQLite WAL connection open for a batch and commit completed results
  incrementally. Closing the last connection after each race repeatedly
  checkpointed the growing database. Progress remains visible during the run.

Automatic measurements still use 100 unique pairs per skill, preserve their
reserved seeds on resume, retain completed outcomes when cancelled, and yield
to foreground simulations. Full dashboard runs retain replay decoding.


## Additional automatic-impact optimization (2026-10-27)

On a nine-runner Nakayama 2,500 m field, the same 100 reserved seeds, baseline
and nine isolated skill removals produced 1,000 identical outcomes. The previous
four-worker path took 7.24 seconds. Cached input templates with four workers took
6.74 seconds; allowing up to eight lightweight outcome workers took 4.18 seconds
(239 races/s). The machine has 16 logical CPUs. Outcome concurrency is capped at
eight and half the logical CPU count; full analysis remains capped at four.
These local timings are not a general performance guarantee.

Static skill inventories, aptitude mapping, race settings and variant summaries
are prepared once per job/worker. Seed, mood and gate draws are regenerated for
every sample using the unchanged draw rules. Templates are replaced when the job
or reference changes, and returned horse dictionaries are separate from the cache.
No simulations, pairs or mechanics are omitted.

Automatic coverage now caches bounded per-job pair sets, keyed by source context,
engine/reference, job inputs and stored run cursor. Unchanged completed jobs do
not reread their outcome rows; new outcomes invalidate that job's cached coverage.
Cross-job pair deduplication is preserved. Across 20 completed impact jobs and
20,000 stored outcomes, repeated coverage checks fell from 856 ms to 17 ms with
identical counts. The cache is disposable; SQLite remains the durable source for
restarts and pause/resume.
