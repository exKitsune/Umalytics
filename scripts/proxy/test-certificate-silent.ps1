#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-Fa-f]{40}$')][string]$ExpectedThumbprint,
    [switch]$Worker
)
$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'This experiment requires an unelevated Windows token.'
}
$certificatePath = Join-Path $env:LOCALAPPDATA 'UmaTrace\proxy\mitmproxy-ca-cert.cer'
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath)
if ($certificate.Thumbprint -ne $ExpectedThumbprint -or $certificate.HasPrivateKey) {
    throw 'Expected only the previously reviewed public CA certificate.'
}
$trustPath = "Cert:\CurrentUser\Root\$ExpectedThumbprint"
$machinePath = "Cert:\LocalMachine\Root\$ExpectedThumbprint"
if ((Test-Path -LiteralPath $trustPath) -or (Test-Path -LiteralPath $machinePath)) {
    throw 'Certificate was already trusted. Refusing to modify pre-existing trust.'
}
$captureDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\captures'))
$workerPath = Join-Path $captureDirectory 'certificate-silent-worker.json'
$resultPath = Join-Path $captureDirectory 'certificate-silent-result.json'
New-Item -ItemType Directory -Path $captureDirectory -Force | Out-Null

if ($Worker) {
    # Internal child operation; invoke the parent script for watchdog and cleanup.
    Add-Type -Path (Join-Path $PSScriptRoot 'SilentCertificateImport.cs')
    $workerResult = [ordered]@{ stage='memory-control'; elevated=$false }
    $workerResult | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $workerPath -Encoding utf8
    $workerResult.memory_control = [UmaSilentCertificateImport]::Run($certificate.Handle, $true)
    if (-not $workerResult.memory_control.Success) { throw 'Memory-store import control failed; root import skipped.' }
    $workerResult.stage = 'root-import'
    $workerResult | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $workerPath -Encoding utf8
    $workerResult.root_import = [UmaSilentCertificateImport]::Run($certificate.Handle, $false)
    $workerResult.stage = 'returned'
    $workerResult | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $workerPath -Encoding utf8
    $certificate.Dispose()
    exit 0
}

if (Test-Path -LiteralPath $workerPath) { Remove-Item -LiteralPath $workerPath }
$result = [ordered]@{
    started_at=[DateTimeOffset]::UtcNow.ToString('o')
    method='CryptUIWizImport: NO_UI | ALLOW_CERT; CurrentUser Root'
    thumbprint=$ExpectedThumbprint
    elevated=$false
    root_present_before=$false
    worker_timed_out=$false
    cleanup_attempted=$false
}
$child = $null
try {
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -ExpectedThumbprint ' + $ExpectedThumbprint + ' -Worker'
    $child = Start-Process -FilePath (Join-Path $PSHOME 'pwsh.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $captureDirectory 'certificate-silent-worker.stdout.txt') `
        -RedirectStandardError (Join-Path $captureDirectory 'certificate-silent-worker.stderr.txt')
    $result.worker_pid = $child.Id
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding utf8
    Write-Output 'Unelevated no-UI certificate import test started; 40-second timeout.'
    if (-not $child.WaitForExit(40000)) {
        $result.worker_timed_out = $true
        $child.Kill()
        if (-not $child.WaitForExit(5000)) { throw 'Owned import worker did not stop.' }
    }
    $result.worker_exit_code = $child.ExitCode
    if (Test-Path -LiteralPath $workerPath) { $result.worker = Get-Content -LiteralPath $workerPath -Raw | ConvertFrom-Json }
    $result.root_present_after_import = Test-Path -LiteralPath $trustPath
    $chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
    try {
        # This is a local root trust check; no network retrieval or TLS setting is changed.
        $chain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
        $chain.ChainPolicy.DisableCertificateDownloads = $true
        $result.chain_trusted_after_import = $chain.Build($certificate)
        $result.chain_status_after_import = @($chain.ChainStatus | ForEach-Object { $_.Status.ToString() })
    } finally { $chain.Dispose() }
}
finally {
    if ($child -and -not $child.HasExited) {
        $child.Kill()
        if (-not $child.WaitForExit(5000)) { Write-Warning 'Import worker shutdown could not be confirmed.' }
    }
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding utf8
    if (Test-Path -LiteralPath $trustPath) {
        $result.cleanup_attempted = $true
        Write-Output "Removing temporary Current User root certificate: $ExpectedThumbprint"
        & certutil.exe -user -delstore Root $ExpectedThumbprint
        $result.cleanup_exit_code = $LASTEXITCODE
    }
    $result.root_present_after_cleanup = Test-Path -LiteralPath $trustPath
    $result.machine_root_present_after_cleanup = Test-Path -LiteralPath $machinePath
    $result.finished_at = [DateTimeOffset]::UtcNow.ToString('o')
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding utf8
    $certificate.Dispose()
    if ($result.root_present_after_cleanup -or $result.machine_root_present_after_cleanup) {
        throw "Certificate cleanup is incomplete. Remove exact thumbprint $ExpectedThumbprint."
    }
    Write-Output 'Verified certificate absent after test.'
}
$result | ConvertTo-Json -Depth 8
