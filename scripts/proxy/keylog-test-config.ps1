# Metadata only is returned. Never print key-log contents or copy them into
# captures/: that directory is inside the user's synced workspace.
function Get-KeyLogTestConfiguration {
    $manifestPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\captures\tls-keylog-session.json'))
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.test_id -notmatch '^[a-f0-9]{32}$') { throw 'Invalid key-log test identifier.' }
    if ([DateTimeOffset]::Parse($manifest.expires_at) -lt [DateTimeOffset]::UtcNow) { throw 'Key-log test preparation expired.' }
    $directory = Join-Path (Join-Path $env:LOCALAPPDATA 'UmaTrace\tls-keylog') $manifest.test_id
    $keyPath = Join-Path $directory 'game.keys'
    if ($manifest.key_log_path -ne $keyPath) { throw 'Key log must remain in the prepared LocalAppData directory.' }
    $file = Get-Item -LiteralPath $keyPath
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Expected a regular key-log file.' }
    [pscustomobject]@{ TestId = $manifest.test_id; KeyLogPath = $keyPath; Directory = $directory; Length = $file.Length }
}

function Get-KeyLogTestSummary {
    param([Parameter(Mandatory=$true)][string]$Path)
    $result = [ordered]@{ exists = (Test-Path -LiteralPath $Path); bytes = 0; valid_records = 0; other_noncomment_lines = 0; labels = @{} }
    if (-not $result.exists) { return $result }
    $result.bytes = (Get-Item -LiteralPath $Path).Length
    if ($result.bytes -gt 1048576) { throw 'Key-log inspection limit exceeded; do not display its contents.' }
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) { continue }
        if ($line -match '^(CLIENT_RANDOM|CLIENT_EARLY_TRAFFIC_SECRET|CLIENT_HANDSHAKE_TRAFFIC_SECRET|SERVER_HANDSHAKE_TRAFFIC_SECRET|CLIENT_TRAFFIC_SECRET_[0-9]+|SERVER_TRAFFIC_SECRET_[0-9]+|EARLY_EXPORTER_SECRET|EXPORTER_SECRET)\s+[0-9A-Fa-f]{64}\s+(?:[0-9A-Fa-f]{64}|[0-9A-Fa-f]{96})\s*$') {
            $label = $Matches[1]
            $result.valid_records++
            if (-not $result.labels.ContainsKey($label)) { $result.labels[$label] = 0 }
            $result.labels[$label]++
        }
        else { $result.other_noncomment_lines++ }
    }
    return $result
}
