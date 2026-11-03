# GlobalSim v77 integration review

The maintained fork is `exKitsune/GlobalSim`. The local branch
`codex/umalytics-tracing-v77` in `.cache/globalsim-v77` is based on
`95f1416fb8c130dd2ef4b53c3b8277c6ba4c8055`. The former repository is now
`exKitsune/GlobalSimBackup`. The user approved this integration on 2026-11-03. The fork tracing commit is
`db33d265a4ab5b03b54688fa540ded288add32eb`; the application lock now selects it.

The Umalytics integration and licensing changes now live separately on
`codex/globalsim-v77-license`, in the `.cache/globalsim-integration` worktree
of the original workspace. The original workspace remains on
`codex/solver-opponents`; its tracked diff was verified byte-for-byte against
the pre-integration snapshot. Solver files are absent from this integration
worktree. The simulator fork remains on `codex/umalytics-tracing-v77`.

## Current master synchronization

The integration branch was fast-forwarded to `7f26186` (13 commits after its
original base). Pending changes were backed up and reapplied locally; no new
commit or push was made. Categorized desktop Settings are restored, with the
license section under About & uninstall. The solver branch remains separate.

Master's compact v2 tracing and diagnostic v1 mode are now integrated into the
v77 fork, including prepared/cached execution. The observer retains RAII cleanup
on rejected requests. Compact string tables now contain only emitted strings
in event order: unused initialization scopes no longer change the encoding
between first and reused runs. Tests cover this regression and byte-equivalent
repeated and threaded requests.

The merged tree passes 54 functional workflows, 214 simulator Python tests
(one skipped), 179 Rust tests, ten source-lock tests, eight source-package tests,
and all three checkout newline modes. The real SQLite catalog workflow passes.
The frontend has no Svelte errors or warnings. All 84 untouched-v77 accuracy
fixtures match with tracing off and on; strict observation checks pass, including
repeated requests, rejected requests and one-/two-thread batches.

Parallel simulations now publish each dashboard reference once under a lock,
avoiding concurrent file replacement while a Windows reader has it open.
An eight-thread regression test covers this path.

Missing-skill imports remain enabled for the exact new worker. Tests cover
all twelve activation branches of the bundled additions, a future supported ID
through the real worker and dashboard, and a new installed-master definition
through SQLite extraction and worker execution. Updating its definition produces
a new immutable snapshot while preserving the previous one. Unknown mechanics
are rejected with reasons. Updating the engine without its import-contract audit
fails a regression test rather than silently disabling imports.

Licensing and corresponding-source rebuild instructions are in
[licensing.md](licensing.md); fork update/pinning policy is in
[simulator-backup.md](simulator-backup.md).

## Tracing port

The observation hooks cover initialization lotteries, sampled conditions,
prerequisites, activation gates, effects, cooldowns, position keeping, spurt
selection and motion. They preserve short-circuit evaluation and RNG order.
The v77 compact skill scan keeps its existing stateful/stateless evaluation
order. Skipped checks are not fabricated as observations.

Both cached initialization and prepared-race execution are instrumented.
Thread-local trace sessions clean up on rejected requests as well as successful
ones. Gate-order results and trace runner/target indices return to request order.
Traced builds reevaluate static skill construction to retain its observations;
untraced prepared runs retain upstream's skill-data reuse.

Repeated boolean gates now reuse their existing trace objects; updates to
coalesced events reuse JSON keys. Context scopes move prior state instead of
cloning it, and stages use static strings. Untraced conditions avoid installing
observation-only predicate wrappers. Compact tracing uses `umalytics-decisions-v2`; `traceDiagnostics` retains the
full v1 diagnostic stream. Decoders accept both formats.

## Umalytics integration

- Explicit v74/v77 profiles retain separate source/data identities and saved-job
  bindings. The latest packaged v77 bundle is selected for new simulations.
- Imported skill definitions retain the existing conservative contract. The
  exact v77 source snapshot is audited before catalog extension is enabled.
- Outcome-only win-impact samples request v77's `omitFrames`, avoiding replay
  allocation and transport. Full dashboards continue to request frames and
  traces; reopening a sample uses its saved inputs.
- Local development staging records an exact pending source hash. Normal
  releases still require a clean, committed source pin. See
  [source workflow](simulator-backup.md).
- Packaging preserves the upstream license/notice files. CI uses the public
  fork without the former private-backup deploy key.

The selected profile uses upstream's default mechanics with retail initialization,
sections, runtime and geometry enabled. Optional `experimental-umamoe` and other
Cargo experiment flags are not enabled. Startup and later-stamina extensions
remain disabled, as in the existing adapter.

## Original port verification

The final packaged worker SHA-256 is
`2b472ded1120da6cc6c22bce046d87158b0c16281f5d17d248c909543e0df733`.
The reviewed Rust source SHA-256 is
`52f17d5c8cc36ca6345ea1e5e30a43469654d8cb431fd92c2c2fdc445acf44e9`.

- The original v1 port passed 173 Rust unit tests; current results are above.
- 84/84 upstream accuracy fixtures passed strict observation comparison.
- Untouched v77, tracing off and tracing on produced identical race output on
  all 84 fixtures. Traces passed Umalytics validation.
- First/repeated prepared requests, error recovery and one-/two-thread seed
  batches produced identical traces.
- 200 Python integration tests passed, with one existing optional test skipped.
- 57/57 functional workflows passed; Svelte checks and the frontend build passed.
- 10 source workflow tests and the three checkout newline modes passed.

The functional runner needed an unrestricted Windows token because Node's
`os.userInfo()` fails under the restricted token before TSX tests start. The
successful run used the normal suite unchanged.

The synchronized integration worktree passes the public-file audit (1,576 files).
The earlier combined-workspace audit findings concerned the previous snapshot;
no solver files were copied into this branch.

Evidence is in [parity](../simulation/evidence/globalsim-v77-parity.json) and
[performance](../simulation/evidence/globalsim-v77-performance.json). These are
finite regression checks, not proof that every possible race matches the game.
The upstream strict comparison also documents gaps in recorded observations.

## Original v1 port performance

These measurements predate the compact v2 integration; they are retained as
historical evidence, not a benchmark of the final synchronized worker.

Warm persistent workers, binary replay protocol, two warmups and 12 measured
seeds per field. Variant order alternates. Times include IPC and protocol
validation; these are local measurements, not universal throughput guarantees.

| Field | v74 traced | v77 port traced | Optimized traced | Additional reduction |
|---|---:|---:|---:|---:|
| 9 runners | 510 ms | 353 ms | 255 ms | 27.7% |
| 18 runners | 1,751 ms | 1,269 ms | 922 ms | 27.4% |
| 16 runners | 1,118 ms | 772 ms | 556 ms | 27.9% |

Compared with the pinned v74 build, final traced latency falls 47–50%.
Outcome-only latency falls from 12.8/45.1/28.8 ms on v74 to 8.6/29.1/19.8 ms
on v77 for those fields. Omitting frames accounts for a further 2–6% latency
reduction over optimized v77 compact runs and reduces their response bytes by
58–63%. Full, compact and outcome-only v77 results remained identical.

Master subsequently introduced compact typed events and binary motion traces.
Those changes and their validators/dashboard consumers are included in the
current integration. The historical v1 performance evidence is unchanged.

## Review

The original combined review used `.cache/globalsim-v77-review` on port 4318.
Three races and 27 automatic skill-impact measurements (100 pairs each)
completed there before branch separation.

The current isolated integration worktree serves QA at
`http://127.0.0.1:52835/?desktop=1`, with its own `.cache/review` data. Three fresh v77 races
completed after separation. After master synchronization, QA job
`0fd4f2fe-095a-43e8-835d-be7957e916c8` completed all three races with the compact v2 worker. Settings shows the AGPL text, source links and
GlobalSim notices. The source archive is `.cache/dist/Umalytics-source-review.zip`.
The installed app and other review services remain separate.

The existing solver work remains on its own branch. The user approved the
reviewed integration for commit, push, and build verification on 2026-11-03.
