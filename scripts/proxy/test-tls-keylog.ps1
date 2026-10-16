[CmdletBinding()]
param(
    [ValidateRange(30,600)][int]$DurationSeconds = 600,
    [switch]$PrepareOnly,
    [switch]$UsePrepared
)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this test unelevated.' }
if (Get-Process -Name ('Uma' + 'musume' + 'Pretty' + 'Derby') -ErrorAction SilentlyContinue) { throw 'Close the game normally first.' }
if (Get-NetTCPConnection -LocalPort 4327 -State Listen -ErrorAction SilentlyContinue) { throw 'Proxy port 4327 is already in use.' }
if ($env:SSLKEYLOGFILE) { throw 'The supervisor inherited SSLKEYLOGFILE; start from a session without it to keep proxy/control keys separate.' }
$thumbprint = '49019503DD723E11240A2AA7FC3091CA9B4C29C1'
function Get-KeyLogRootPresence {
    [ordered]@{
        current_user_root = (Test-Path -LiteralPath "Cert:\CurrentUser\Root\$thumbprint")
        local_machine_root = (Test-Path -LiteralPath "Cert:\LocalMachine\Root\$thumbprint")
    }
}
$before = Get-KeyLogRootPresence
if ($before.current_user_root -or $before.local_machine_root) { throw 'Remove the earlier temporary test trust before this independent test.' }
. (Join-Path $PSScriptRoot 'keylog-test-config.ps1')
$manifestPath = Join-Path $workspace 'captures\tls-keylog-session.json'
if (-not $UsePrepared) {
    if (Test-Path -LiteralPath $manifestPath) { throw 'A prior key-log session exists; inspect and clean it up before preparing another.' }
    $testId = [Guid]::NewGuid().ToString('N')
    $directory = Join-Path (Join-Path $env:LOCALAPPDATA 'UmaTrace\tls-keylog') $testId
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    # Limit the new private directory to this Windows user and SYSTEM.
    $acl = Get-Acl -LiteralPath $directory
    $acl.SetAccessRuleProtection($true, $false)
    $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', $inheritance, 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $directory -AclObject $acl
    $keyPath = Join-Path $directory 'game.keys'
    # Creating this empty file verifies the path is writable. Existence alone is
    # never counted as evidence that the game supports key logging.
    $stream = [IO.File]::Open($keyPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    $stream.Dispose()
    [ordered]@{
        test_id = $testId
        key_log_path = $keyPath
        prepared_at = [DateTimeOffset]::UtcNow.ToString('o')
        expires_at = [DateTimeOffset]::UtcNow.AddMinutes(20).ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8
}
$configuration = Get-KeyLogTestConfiguration
if ($configuration.Length -ne 0) { throw 'Prepared key-log file is not empty.' }
Write-Output "Private key-log destination prepared: $($configuration.KeyLogPath)"
if ($PrepareOnly) { Write-Output 'Preparation only; no game or proxy started and no certificate installed.'; exit 0 }
$stopFile = Join-Path $workspace 'captures\tls-keylog-test.stop'
if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
$resultPath = Join-Path $workspace 'captures\tls-keylog-result.json'
$result = [ordered]@{
    test_id = $configuration.TestId
    started_at = [DateTimeOffset]::UtcNow.ToString('o')
    elevated = $false
    environment_scope = 'game child only'
    tls_interception = $false
    roots_before = $before
    key_log_before = (Get-KeyLogTestSummary -Path $configuration.KeyLogPath)
    state = 'starting'
}
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultPath -Encoding utf8
try {
    & (Join-Path $PSScriptRoot 'start-proxy.ps1') -Stage Probe -Transport Regular -TestKeyLog -DurationSeconds $DurationSeconds -StopFile $stopFile
    $result['proxy_exit_code'] = $LASTEXITCODE
    $result['state'] = $(if ($LASTEXITCODE -eq 0) { 'stopped' } else { 'error' })
}
finally {
    $result['ended_at'] = [DateTimeOffset]::UtcNow.ToString('o')
    $result['roots_after'] = Get-KeyLogRootPresence
    $result['key_log_after'] = Get-KeyLogTestSummary -Path $configuration.KeyLogPath
    $statusPath = Join-Path $workspace 'captures\tls-keylog-proxy-status.json'
    if (Test-Path -LiteralPath $statusPath) { $result['proxy_counters'] = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json }
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultPath -Encoding utf8
    Write-Output "Passthrough proxy stopped. Key-log bytes: $($result.key_log_after.bytes); valid records: $($result.key_log_after.valid_records)."
}
