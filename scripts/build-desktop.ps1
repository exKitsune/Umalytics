[CmdletBinding()]
param([switch]$SkipFrontend, [switch]$SkipService, [ValidatePattern('^[A-Za-z0-9._-]+\.exe$')][string]$OutputFile = 'Umalytics.exe')
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $workspace
$python = Join-Path $workspace '.cache/proxy-venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Build Python environment is missing; see docs/desktop-package.md.' }
& $python desktop/generate_manifest.py
if ($LASTEXITCODE -ne 0) { throw 'Reference manifest generation failed.' }
$buildInfo = Get-Content -LiteralPath 'desktop/build-info.json' -Raw | ConvertFrom-Json
if ($buildInfo.version -ne "0.2.$($buildInfo.buildNumber)") { throw 'Desktop build version is invalid.' }
$releasePublicKey = (Get-Content -LiteralPath 'desktop/update-public-key.txt' -Raw).Trim()
if ($releasePublicKey -notmatch '^[0-9a-f]{64}$') { throw 'Embedded update public key is invalid.' }
if (-not $SkipFrontend) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    & node scripts/build-inference.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Versioned inference bundle build failed.' }
} else {
    $bundles = Get-Content -LiteralPath 'simulation/installed-bundles.json' -Raw | ConvertFrom-Json
    $inference = @($bundles.bundles | Where-Object { $_.kind -eq 'inference' })
    if ($inference.Count -eq 0) { throw 'Shared frontend is missing its versioned inference bundle.' }
    foreach ($bundle in $inference) {
        if ((Get-FileHash -LiteralPath $bundle.artifact -Algorithm SHA256).Hash.ToLowerInvariant() -ne $bundle.artifact_sha256 -or
            (Get-FileHash -LiteralPath $bundle.data -Algorithm SHA256).Hash.ToLowerInvariant() -ne $bundle.data_sha256) {
            throw 'Shared inference bundle hash mismatch.'
        }
    }
}
$env:CARGO_HOME = Join-Path $workspace '.cache/cargo'
$env:CARGO_TARGET_DIR = Join-Path $workspace '.cache/desktop-target'
if (Test-Path -LiteralPath (Join-Path $workspace '.cache/rustup/toolchains')) { $env:RUSTUP_HOME = Join-Path $workspace '.cache/rustup' }
$cargo = Join-Path $env:USERPROFILE '.cargo/bin/cargo.exe'
if (-not (Test-Path -LiteralPath $cargo)) { $cargo = (Get-Command cargo.exe -ErrorAction Stop).Source }
$env:Path = (Split-Path $cargo) + ';' + $env:Path
# A fresh release runner needs the locked Rust source notices before packaging
# the combined offline license bundle inside the service.
& $cargo fetch --locked --manifest-path src-tauri/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Locked Rust dependency download failed.' }
$env:CARGO_NET_GIT_FETCH_WITH_CLI = 'true'
$simSource = Join-Path $workspace '.cache/globalsim-source'
if (-not (Test-Path -LiteralPath $simSource)) {
    & git clone --no-checkout https://github.com/daftuyda/GlobalSim.git $simSource
    if ($LASTEXITCODE -ne 0) { throw 'Simulator resource checkout failed.' }
}
# This task-owned cache may have been created by the sandbox build account.
# Limit the ownership exception to this invocation and this exact checkout.
& git -c "safe.directory=$($simSource.Replace('\','/'))" -C $simSource checkout --detach efc2decdfeaff227ada0e9847f5deceb42c3b97f
if ($LASTEXITCODE -ne 0) { throw 'Pinned simulator resources are unavailable.' }
& $python scripts/prepare-simulator.py --source $simSource
if ($LASTEXITCODE -ne 0) { throw 'Simulator instrumentation preparation failed.' }
& $cargo build --release --locked --manifest-path simulation/simulator-worker/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Pinned simulator worker build failed.' }
& $python scripts/package-simulator.py --source $simSource --engine (Join-Path $env:CARGO_TARGET_DIR 'release/umalytics-globalsim-worker.exe')
if ($LASTEXITCODE -ne 0) { throw 'Simulator bundle verification failed.' }
& $python desktop/generate_icon.py
if ($LASTEXITCODE -ne 0) { throw 'Desktop icon generation failed.' }
& $python desktop/generate_licenses.py
if ($LASTEXITCODE -ne 0) { throw 'Dependency license collection failed.' }
if (-not $SkipService) {
    $env:PYINSTALLER_CONFIG_DIR = Join-Path $workspace '.cache/pyinstaller-config'
    & $python -m PyInstaller --noconfirm --clean --distpath .cache/desktop-service --workpath .cache/desktop-pyinstaller desktop/collector.spec
    if ($LASTEXITCODE -ne 0) { throw 'Collector packaging failed.' }
}
$env:UMATRACE_SERVICE_DIGEST = (Get-FileHash -LiteralPath '.cache/desktop-service/UmaTraceService.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
& $cargo build --locked --release --manifest-path src-tauri/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Tauri build failed.' }
New-Item -ItemType Directory -Path '.cache/dist' -Force | Out-Null
$artifactPath = Join-Path (Join-Path $workspace '.cache/dist') $OutputFile
Copy-Item -LiteralPath (Join-Path $env:CARGO_TARGET_DIR 'release/umatrace.exe') -Destination $artifactPath -Force
$artifact = Get-Item -LiteralPath $artifactPath
Write-Output "Built $($artifact.FullName) ($([Math]::Round($artifact.Length / 1MB, 1)) MiB)."
