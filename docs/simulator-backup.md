# Saved simulator source and private builds

`simulation/source-lock.json` pins the traced source in `exKitsune/GlobalSim` to
`231f346a46b569dd4d0f91a0046326275667d1c7`. Its original v74 parent is
`efc2decdfeaff227ada0e9847f5deceb42c3b97f`. The lock also records the exact
instrumented Rust source hash. This changes source storage and retrieval;
it does not upgrade the engine or change mechanics or compatibility policy.

## One maintained source

The private repository's `master` branch contains the traced version. The original
source remains in its Git history; a separate original branch is unnecessary.
`UMALYTICS.md` explains the observation hooks and their parity checks. Original
files and third-party notices are preserved. Tracing does not intentionally alter
race decisions, RNG draws or physics.

Builds stage a clean Git archive of the traced commit, verify its instrumentation
manifest against the reviewed patch and source hash, and compile a local path
dependency with `cargo build --offline --locked`. The patch is not applied again.
The archived patch remains in Umalytics as provenance and for upgrade review.
Packaging separately records both the original and traced commit identities.

## Recovery copies

`backups/globalsim-v74-2026-10-18/` holds the original, byte-verified recovery copies:

- `globalsim-source/`: the original checkout, including Git history and tags.
- `globalsim-traced/`: the instrumented source used by Umalytics.
- `globalsim-history.bundle`: portable original Git history and refs.
- `backup-manifest.json`: SHA-256 hashes, file counts and sizes.

`backups/GlobalSim-review/` is the private repository working checkout.
`backups/globalsim-traced-v74.bundle` preserves the committed traced version and
its parent history for offline recovery. These local recovery files are outside
`.cache`; the entire `backups/` directory is ignored and rejected by Umalytics'
public-file audit. They must not enter its public Git history or release artifacts.

## GitHub Actions access

Umalytics uses a dedicated read-only SSH deploy key on `exKitsune/GlobalSim`.
Its private half belongs in Umalytics' Actions secret `GLOBALSIM_SOURCE_DEPLOY_KEY`.
Keep **Allow write access** unchecked when adding the deploy key. Never put the
private key in source, logs or chat.

The Windows job reads the source lock and checks out that exact private commit
into `.cache/globalsim-saved`, with `persist-credentials: false`. A missing secret
fails early with setup instructions. The default Umalytics `GITHUB_TOKEN` does not
grant access to a separate private repository. See
[checkout's private repository support](https://github.com/actions/checkout/tree/v4#checkout-multiple-repos-private)
and [GitHub's deploy-key instructions](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys).

## Local build and offline recovery

For a new checkout with private repository access:

```powershell
git clone git@github.com:exKitsune/GlobalSim.git .cache/globalsim-saved
git -C .cache/globalsim-saved checkout --detach 231f346a46b569dd4d0f91a0046326275667d1c7
python scripts/simulator_source.py --source .cache/globalsim-saved
```

Alternatively, restore without network access from the traced Git bundle into a
new path, then verify the locked commit:

```powershell
git clone backups/globalsim-traced-v74.bundle .cache/globalsim-saved
git -C .cache/globalsim-saved checkout --detach 231f346a46b569dd4d0f91a0046326275667d1c7
python scripts/simulator_source.py --source .cache/globalsim-saved
```

Do not overwrite a checkout containing local work. Verification rejects missing,
dirty or wrong-revision checkouts without changing them. The older original
`.cache/globalsim-source` checkout can remain available for comparison.
The full desktop build still downloads its ordinary Python, npm, Tauri and Node
license inputs when needed; the simulator worker itself builds offline.

## Validation before publication

- Run `python tests/simulator-source-workflow.py` and
  `python tests/simulator-checkout-workflow.py`: immutable checkout verification,
  preservation of local changes, offline bundle recovery, source/trace tampering,
  Actions lock outputs and cross-platform instrumentation byte identity.
- Clone the pinned private commit or restore its bundle into a fresh directory.
  Verify the staged source hash matches the saved traced copy. Build the worker
  offline with an empty `CARGO_HOME` and target directory.
- Compare rebuilt output and decision traces with the previous worker on the
  unchanged private capture fixtures. Package and smoke-test the desktop.
- Lint the workflow, check the public-file audit and obtain review approval before
  committing or pushing. A successful private checkout in Actions confirms the
  deploy-key/secret pair is configured correctly.

This backup does not automatically mirror future upstream releases. Updating it
requires authorized source access, reviewed tracing changes, fresh parity checks
and a coordinated update to the source lock, resources and compatibility data.
