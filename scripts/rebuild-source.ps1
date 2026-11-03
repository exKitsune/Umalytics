[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $sourceRoot
# Requires Windows x64, Git, the Python version in .python-version, Node 22, Rust and VS C++ build tools.
& python scripts/verify-source-archive.py
if ($LASTEXITCODE -ne 0) { throw 'Source archive integrity check failed.' }
$requiredPython = (Get-Content .python-version -Raw).Trim()
$actualPython = (& python -c "import platform; print(platform.python_version())").Trim()
if ($LASTEXITCODE -ne 0 -or $actualPython -ne $requiredPython) { throw "Use Python $requiredPython to rebuild this source archive; found $actualPython." }
& python -m venv .cache/proxy-venv
if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
$buildPython = Join-Path $sourceRoot '.cache/proxy-venv/Scripts/python.exe'
& $buildPython -m pip install -r dependency-sources/python/requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
& npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
$env:CARGO_HOME = Join-Path $sourceRoot '.cache/cargo'
$receipt = Get-Content SOURCE-MANIFEST.json -Raw | ConvertFrom-Json
$sourceArguments = @()
if ($receipt.development) { $sourceArguments = @('--development') }
& $buildPython scripts/prepare-simulator.py --source .cache/globalsim-saved @sourceArguments
if ($LASTEXITCODE -ne 0) { throw 'Simulator source staging failed.' }
& cargo fetch --locked --manifest-path simulation/simulator-worker/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Simulator dependency download failed.' }
if ($receipt.development) {
    & ./scripts/build-desktop.ps1 -DevelopmentSimulatorSource .cache/globalsim-saved
} else {
    & ./scripts/build-desktop.ps1
}
if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
