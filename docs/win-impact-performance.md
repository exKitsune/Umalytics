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
