[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-Fa-f]{40}$')][string]$ExpectedThumbprint,
    [ValidateRange(30, 600)][int]$DurationSeconds = 300,
    [ValidateSet('Local', 'Regular')][string]$Transport = 'Local'
)
$ErrorActionPreference = 'Stop'
if ($Transport -eq 'Regular') {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run the regular-proxy experiment from a normal unelevated Windows session.'
    }
}
$certificatePath = Join-Path $env:LOCALAPPDATA 'UmaTrace\proxy\mitmproxy-ca-cert.cer'
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath)
if ($certificate.Thumbprint -ne $ExpectedThumbprint) { throw 'Certificate differs from the approved thumbprint. No trust changed.' }
$trustPath = "Cert:\CurrentUser\Root\$ExpectedThumbprint"
$stopName = if ($Transport -eq 'Regular') { 'proxy-regular-test.stop' } else { 'proxy-test.stop' }
$stopFile = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\captures\$stopName"))
if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
if (Test-Path -LiteralPath $trustPath) { throw 'Certificate was already trusted before this test. Refusing to change existing trust.' }
try {
    Import-Certificate -FilePath $certificatePath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
    if (-not (Test-Path -LiteralPath $trustPath)) { throw 'Certificate trust installation did not succeed.' }
    Write-Output "Temporary Current User CA trust installed: $ExpectedThumbprint"
    Write-Output "Graceful stop: create $stopFile"
    & (Join-Path $PSScriptRoot 'start-proxy.ps1') -Stage Inspect -Transport $Transport -DurationSeconds $DurationSeconds -StopFile $stopFile
    if ($LASTEXITCODE -ne 0) { throw "Inspection process exited with code $LASTEXITCODE." }
}
finally {
    # The Windows user root store can require a visible removal consent dialog.
    # PowerShell Remove-Item -Force fails with 'UI is not allowed' in that case.
    if (Test-Path -LiteralPath $trustPath) { & certutil.exe -user -delstore Root $ExpectedThumbprint }
    if (Test-Path -LiteralPath $trustPath) { throw "Cleanup failed: manually remove Current User root certificate $ExpectedThumbprint." }
    Write-Output "Temporary CA trust removed and absence verified: $ExpectedThumbprint"
}
