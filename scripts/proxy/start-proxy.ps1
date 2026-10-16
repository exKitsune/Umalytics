[CmdletBinding()]
param(
    [ValidateSet('Plan', 'Probe', 'Inspect')][string]$Stage = 'Plan',
    [string]$MitmDump = '',
    [string]$ConfigDirectory = (Join-Path $env:LOCALAPPDATA 'UmaTrace\proxy'),
    [ValidateRange(0, 86400)][int]$DurationSeconds = 0,
    [string]$StopFile = '',
    [ValidateSet('Local', 'Regular')][string]$Transport = 'Local',
    [ValidateRange(1024, 65535)][int]$ListenPort = 4327,
    [switch]$TestCaFile,
    [switch]$TestKeyLog
)
$ErrorActionPreference = 'Stop'
if ($TestKeyLog -and ($TestCaFile -or $Stage -ne 'Probe' -or $Transport -ne 'Regular' -or $DurationSeconds -lt 30 -or $DurationSeconds -gt 600)) {
    throw 'The key-log test requires a separate Regular Probe lasting 30-600 seconds.'
}
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not $MitmDump) { $MitmDump = Join-Path $workspace '.cache\proxy-venv\Scripts\mitmdump.exe' }
$addon = Join-Path $PSScriptRoot 'observer.py'
$inbox = Join-Path $workspace 'captures\inbox'
$status = Join-Path $workspace $(if ($Transport -eq 'Regular') { 'captures\proxy-regular-status.json' } else { 'captures\proxy-status.json' })
if ($TestCaFile) { $status = Join-Path $workspace 'captures\proxy-ca-file-status.json' }
if ($TestKeyLog) { $status = Join-Path $workspace 'captures\tls-keylog-proxy-status.json' }
$proxyMode = if ($Transport -eq 'Regular') { 'regular' } else { ('local:Uma' + 'musume' + 'Pretty' + 'Derby.exe') }
Write-Output "Stage: $Stage; transport: $proxyMode; inspection: game API only"
if ($Transport -eq 'Regular') { Write-Output "Listener: 127.0.0.1:$ListenPort; routing depends on explicit client configuration." }
Write-Output "Config: $ConfigDirectory"
Write-Output "Race-only output: $inbox"
Write-Output "Diagnostics: $status"
if ($Stage -eq 'Plan') {
    Write-Output 'No process started and no settings changed. Probe tunnels TLS unchanged. Inspect requires explicitly trusted local CA.'
    exit 0
}
if (-not (Test-Path -LiteralPath $MitmDump -PathType Leaf)) { throw 'Addon-capable mitmdump not found. See docs/proxy-capture.md for the workspace Python setup, or supply -MitmDump.' }
if ($Stage -eq 'Inspect') {
    $certificatePath = Join-Path $ConfigDirectory 'mitmproxy-ca-cert.cer'
    if (-not (Test-Path -LiteralPath $certificatePath -PathType Leaf)) { throw 'Run Probe first to generate the local CA; no certificate has been installed.' }
    $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath)
    if ($TestCaFile) {
        if ($Transport -ne 'Regular' -or $DurationSeconds -lt 30 -or $DurationSeconds -gt 600) {
            throw 'The CA-file test requires Regular transport and a 30-600 second limit.'
        }
        . (Join-Path $PSScriptRoot 'ca-file-test-config.ps1')
        $caTest = Get-CaFileTestConfiguration -ConfigDirectory $ConfigDirectory
        Write-Output "Experimental client CA file; no Windows CA trust: $($caTest.BundlePath)"
    }
    elseif (-not (Test-Path -LiteralPath "Cert:\CurrentUser\Root\$($certificate.Thumbprint)")) {
        throw "Local CA is not trusted for this Windows user. Review the certificate trust step first. Thumbprint: $($certificate.Thumbprint)"
    }
    $certificate.Dispose()
}
$mitmArguments = @(
    '--mode', $proxyMode,
    '--listen-host', '127.0.0.1',
    '--listen-port', "$ListenPort",
    '--set', "confdir=$ConfigDirectory",
    '--set', 'flow_detail=0', '--set', 'termlog_verbosity=error',
    '--set', 'ssl_insecure=false', '--set', 'save_stream_file=', '--set', 'hardump=',
    '--set', 'stream_large_bodies=16m', '--set', 'store_streamed_bodies=false',
    '--set', 'onboarding=false',
    '--set', "uma_stage=$($Stage.ToLowerInvariant())",
    '--set', "uma_duration=$DurationSeconds",
    '--set', "uma_stop_file=$StopFile",
    '--set', "uma_output=$inbox", '--set', "uma_status=$status",
    '--scripts', $addon
)
if ($Transport -eq 'Local') {
    Write-Output 'Windows may request permission for mitmproxy''s privileged WinDivert redirector.'
} else {
    Write-Output 'Regular proxy uses no packet redirector or Windows proxy setting. Only configured clients connect.'
}
Write-Output 'The duration timer or configured stop file ends this owned capture.'
& $MitmDump @mitmArguments
exit $LASTEXITCODE
