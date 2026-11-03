# GlobalSim source and local review builds

`simulation/source-lock.json` identifies the maintained public fork,
`exKitsune/GlobalSim`. The old private repository was renamed
`exKitsune/GlobalSimBackup`; it preserves the v74 tracing history.
The current upgrade starts at upstream v77 commit
`95f1416fb8c130dd2ef4b53c3b8277c6ba4c8055`.

The approved tracing source is committed as
`db33d265a4ab5b03b54688fa540ded288add32eb` on
`codex/umalytics-tracing-v77`. Release builds use this clean committed revision.
The local fork checkout remains `.cache/globalsim-v77`.

## Updating the maintained fork

The fork is the simulator we use. The lock is a build receipt for an exact
revision of that fork, not a policy to remain on an old upstream version.
After changing the fork, rebuild and validate the worker, update the source
lock and import-contract audit together, and package the resulting worker.
Release builds do not follow a moving branch: otherwise rebuilding the same
Umalytics release could silently change physics, traces, or imported skills.
Saved jobs keep their original worker and definition snapshots; new jobs use
the latest packaged compatible worker.

Skill releases do not require a simulator source update when their mechanics
are already supported. The catalog merges bundled additions and available
catalog rows with installed game master definitions taking precedence. It
imports missing IDs, including branches and scaling, into immutable snapshots
passed to the engine and matching dashboard references. The installed database
reader detects content changes even when its size and timestamp stay the same.
Existing engine definitions are not overwritten. Unknown conditions, targets,
effects, or scaling are explicitly rejected until support is implemented and
tested. An engine upgrade must pass the import-contract test; it must not
silently turn this path off.

The v77 fork now includes master's compact v2 trace format and optional full
diagnostic traces, including both cached/prepared and legacy execution paths.
The former v74-only compact overlay is no longer applied during builds.

## Build the committed source

```powershell
python scripts/prepare-simulator.py --source .cache/globalsim-v77
cargo build --release --locked --offline --manifest-path simulation/simulator-worker/Cargo.toml
python scripts/package-simulator.py --source .cache/globalsim-v77 --engine simulation/simulator-worker/target/release/umalytics-globalsim-worker.exe
```

For a full desktop build, check out the locked fork revision at
`.cache/globalsim-saved` and run `scripts/build-desktop.ps1`. Future uncommitted
review builds use `-DevelopmentSimulatorSource` with an explicit `pendingReview`
lock and exact source hash. Such snapshots cannot pass release verification.

Release builds verify a clean checkout, stage its Git archive and compile it as
a local path dependency. They do not reapply the instrumentation patch, fetch
upstream, or overwrite a dirty checkout. The patch and trace module in
`simulation/instrumentation/` are reproducible provenance inputs.

GitHub Actions checks out the exact public fork revision into
`.cache/globalsim-saved` with credentials persistence disabled. The old private
backup deploy key is no longer required by the build workflow. No account keys
are changed by this upgrade.

## Recovery

The prior sibling `GlobalSim` checkout and ignored `backups/` copies remain
available for v74 comparisons. Its old remote name may now resolve to the new
public fork; treat that checkout as a recovery copy, not a push target.
`backups/globalsim-traced-v74.bundle` preserves the old traced history offline.
Private recovery files must not enter Umalytics' public Git history.

## Verification

- `python tests/simulator-source-workflow.py`
- `python tests/simulator-checkout-workflow.py`
- `cargo test --no-default-features --offline --lib --manifest-path .cache/globalsim-v77/Cargo.toml`
- `python tests/globalsim-upgrade-parity.py --source .cache/globalsim-v77 --baseline .cache/globalsim-v77-baseline/target/release/race_engine_rs_v2.exe --engine simulation/simulator-worker/target/release/umalytics-globalsim-worker.exe --output simulation/evidence/globalsim-v77-parity.json`

The parity panel compares untouched v77, tracing off and tracing on. It also
checks repeated prepared races, rejected requests and threaded seed batches.
Historical v74 and v77 bundles keep separate reference identities, cache keys
and saved-job bindings. See `docs/globalsim-v77-upgrade.md` for results and limits.
