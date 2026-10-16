[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$GameExecutable,
    [ValidateRange(1024, 65535)][int]$ProxyPort = 4327,
    [switch]$Plan,
    [switch]$WaitForExit,
    [switch]$TestCaFile,
    [switch]$TestKeyLog,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$GameArguments = @()
)
$ErrorActionPreference = 'Stop'
$gameProcessName = 'Uma' + 'musume' + 'Pretty' + 'Derby'
if ($TestCaFile -and $TestKeyLog) { throw 'CA-file and key-log experiments must be separate.' }
$gamePath = [IO.Path]::GetFullPath($GameExecutable)
if ([IO.Path]::GetFileName($gamePath) -ne ($gameProcessName + '.exe') -or -not (Test-Path -LiteralPath $gamePath -PathType Leaf)) {
    throw 'Expected the installed UM:PD executable.'
}
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($elevated) { throw 'Run this experiment from a normal unelevated Windows session.' }
$proxyAddress = "http://127.0.0.1:$ProxyPort"
Write-Output "Game: $gamePath"
Write-Output "Child-only HTTP/HTTPS/ALL proxy: $proxyAddress; parent/Windows/Steam settings remain unchanged."
$caTest = $null
if ($TestCaFile) {
    . (Join-Path $PSScriptRoot 'ca-file-test-config.ps1')
    $caTest = Get-CaFileTestConfiguration
    Write-Output "Experimental child-only CURL_CA_BUNDLE and SSL_CERT_FILE: $($caTest.BundlePath)"
}
$keyLogTest = $null
if ($TestKeyLog) {
    . (Join-Path $PSScriptRoot 'keylog-test-config.ps1')
    $keyLogTest = Get-KeyLogTestConfiguration
    if ($keyLogTest.Length -ne 0) { throw 'The game key-log file must be empty before a fresh trial.' }
    Write-Output "Experimental child-only SSLKEYLOGFILE: $($keyLogTest.KeyLogPath)"
}
if ($Plan) { Write-Output 'Plan only; no game launched.'; exit 0 }
if (Get-Process -Name $gameProcessName -ErrorAction SilentlyContinue) { throw 'Close the existing game normally before this launch.' }
if (-not (Get-Process -Name steam -ErrorAction SilentlyContinue)) { throw 'Open Steam normally first; this script does not sign in.' }
$launch = [Diagnostics.ProcessStartInfo]::new()
$launch.FileName = $gamePath
$launch.WorkingDirectory = [IO.Path]::GetDirectoryName($gamePath)
$launch.UseShellExecute = $false
# Forward Steam's arguments using Windows command-line quoting, including on
# Windows PowerShell 5.1, which does not provide ProcessStartInfo.ArgumentList.
$quotedArguments = foreach ($argument in $GameArguments) {
    '"' + ([regex]::Replace([regex]::Replace($argument, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1')) + '"'
}
$launch.Arguments = $quotedArguments -join ' '
# Windows environment names are case-insensitive. Remove inherited variants,
# then set only the child's copy; no parent or persistent environment changes.
foreach ($key in @($launch.EnvironmentVariables.Keys)) {
    if ($key -in @('http_proxy', 'https_proxy', 'all_proxy', 'no_proxy')) { [void]$launch.EnvironmentVariables.Remove($key) }
}
foreach ($key in @('http_proxy', 'https_proxy', 'all_proxy')) { $launch.EnvironmentVariables[$key] = $proxyAddress }
$launch.EnvironmentVariables['no_proxy'] = 'localhost,127.0.0.1,::1'
if ($TestCaFile) {
    foreach ($key in @($launch.EnvironmentVariables.Keys)) {
        if ($key -in @('CURL_CA_BUNDLE', 'SSL_CERT_FILE', 'SSL_CERT_DIR')) { [void]$launch.EnvironmentVariables.Remove($key) }
    }
    $launch.EnvironmentVariables['CURL_CA_BUNDLE'] = $caTest.BundlePath
    $launch.EnvironmentVariables['SSL_CERT_FILE'] = $caTest.BundlePath
}
if ($TestKeyLog) {
    foreach ($key in @($launch.EnvironmentVariables.Keys)) {
        if ($key -ieq 'SSLKEYLOGFILE') { [void]$launch.EnvironmentVariables.Remove($key) }
    }
    $launch.EnvironmentVariables['SSLKEYLOGFILE'] = $keyLogTest.KeyLogPath
}
$game = [Diagnostics.Process]::Start($launch)
$record = [ordered]@{
    launched_at = [DateTimeOffset]::UtcNow.ToString('o')
    process_id = $game.Id
    parent_process_id = $PID
    launcher_elevated = $elevated
    proxy = $proxyAddress
    environment_scope = 'child-only'
    wait_for_exit = [bool]$WaitForExit
}
$recordName = 'proxy-regular-launch.json'
if ($TestCaFile) {
    $recordName = 'proxy-ca-file-launch.json'
    $record['ca_file_test'] = $true
    $record['ca_file'] = $caTest.BundlePath
    $record['ca_bundle_sha256'] = $caTest.BundleSha256
    $record['ca_thumbprint'] = $caTest.CaThumbprint
    $record['ca_environment_variables'] = @('CURL_CA_BUNDLE', 'SSL_CERT_FILE')
}
if ($TestKeyLog) {
    $recordName = 'tls-keylog-launch.json'
    $record['key_log_test_id'] = $keyLogTest.TestId
    $record['key_log_path'] = $keyLogTest.KeyLogPath
    $record['key_log_initial_bytes'] = $keyLogTest.Length
    $record['key_log_environment_variable'] = 'SSLKEYLOGFILE'
}
$recordPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\captures\$recordName"))
$record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding utf8
Write-Output "Launched game PID $($game.Id). If Steam replaces this process, proxy inheritance must be checked separately."
if ($WaitForExit) {
    $game.WaitForExit()
    $record['exited_at'] = [DateTimeOffset]::UtcNow.ToString('o')
    $record['exit_code'] = $game.ExitCode
    $record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding utf8
    exit $game.ExitCode
}
