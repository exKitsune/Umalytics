[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-Fa-f]{40}$')][string]$ExpectedThumbprint,
    [ValidateRange(30, 600)][int]$DurationSeconds = 300,
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run the CA-file experiment from a normal unelevated Windows session.'
}
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path $env:LOCALAPPDATA 'UmaTrace\proxy\mitmproxy-ca-cert.cer'))
if ($certificate.Thumbprint -ne $ExpectedThumbprint) { throw 'The proxy certificate differs from the reviewed certificate.' }
function Get-TestRootPresence {
    [ordered]@{
        current_user_root = (Test-Path -LiteralPath "Cert:\CurrentUser\Root\$ExpectedThumbprint")
        local_machine_root = (Test-Path -LiteralPath "Cert:\LocalMachine\Root\$ExpectedThumbprint")
    }
}
$before = Get-TestRootPresence
if ($before.current_user_root -or $before.local_machine_root) { throw 'Existing root trust would invalidate this experiment.' }
if (Get-Process -Name ('Uma' + 'musume' + 'Pretty' + 'Derby') -ErrorAction SilentlyContinue) { throw 'Close the game normally before preparing this experiment.' }
if (Get-NetTCPConnection -LocalPort 4327 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 4327 is already in use.' }
$bundleDirectory = Join-Path $workspace '.cache\proxy-ca-file'
[IO.Directory]::CreateDirectory($bundleDirectory) | Out-Null
$bundlePath = Join-Path $bundleDirectory 'ca-bundle.pem'
$builder = [Text.StringBuilder]::new()
$seen = @{}
# Export only certificate RawData, never private keys. Preserve ordinary public
# trust in case a backend treats SSL_CERT_FILE as its entire trust collection.
$publicRoots = @(Get-ChildItem Cert:\CurrentUser\Root) + @(Get-ChildItem Cert:\LocalMachine\Root) + @($certificate)
foreach ($rootCertificate in $publicRoots) {
    if ($seen.ContainsKey($rootCertificate.Thumbprint)) { continue }
    $seen[$rootCertificate.Thumbprint] = $true
    [void]$builder.AppendLine('-----BEGIN CERTIFICATE-----')
    [void]$builder.AppendLine([Convert]::ToBase64String($rootCertificate.RawData, [Base64FormattingOptions]::InsertLineBreaks))
    [void]$builder.AppendLine('-----END CERTIFICATE-----')
}
[IO.File]::WriteAllText($bundlePath, $builder.ToString(), [Text.Encoding]::ASCII)
$manifest = [ordered]@{
    ca_thumbprint = $ExpectedThumbprint.ToUpperInvariant()
    bundle_sha256 = (Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash
    certificate_count = $seen.Count
    prepared_at = [DateTimeOffset]::UtcNow.ToString('o')
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath ([IO.Path]::ChangeExtension($bundlePath, '.json')) -Encoding utf8
$certificate.Dispose()
. (Join-Path $PSScriptRoot 'ca-file-test-config.ps1')
$configuration = Get-CaFileTestConfiguration
Write-Output "Public-only CA bundle prepared: $($configuration.BundlePath)"
Write-Output 'Windows root stores unchanged; no certificate consent or administrator rights used.'
if ($PrepareOnly) { exit 0 }
$stopFile = Join-Path $workspace 'captures\proxy-ca-file-test.stop'
if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
$resultPath = Join-Path $workspace 'captures\proxy-ca-file-result.json'
$result = [ordered]@{
    started_at = [DateTimeOffset]::UtcNow.ToString('o')
    elevated = $false
    ca_thumbprint = $ExpectedThumbprint.ToUpperInvariant()
    bundle_sha256 = $configuration.BundleSha256
    environment_variables = @('CURL_CA_BUNDLE', 'SSL_CERT_FILE')
    roots_before = $before
    state = 'starting'
}
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultPath -Encoding utf8
try {
    & (Join-Path $PSScriptRoot 'start-proxy.ps1') -Stage Inspect -Transport Regular -TestCaFile -DurationSeconds $DurationSeconds -StopFile $stopFile
    $result['proxy_exit_code'] = $LASTEXITCODE
    if ($LASTEXITCODE -ne 0) { throw "Proxy exited with code $LASTEXITCODE." }
    $result['state'] = 'stopped'
}
catch {
    $result['state'] = 'error'
    throw
}
finally {
    $result['roots_after'] = Get-TestRootPresence
    $result['ended_at'] = [DateTimeOffset]::UtcNow.ToString('o')
    $statusPath = Join-Path $workspace 'captures\proxy-ca-file-status.json'
    if (Test-Path -LiteralPath $statusPath) { $result['counters'] = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json }
    $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultPath -Encoding utf8
    if ($result.roots_after.current_user_root -or $result.roots_after.local_machine_root) {
        throw 'Unexpected Windows root trust appeared during the test. Inspect before drawing a conclusion.'
    }
    Write-Output 'Proxy finished. Test CA remains absent from both Windows root stores.'
}
