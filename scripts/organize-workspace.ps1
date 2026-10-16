[CmdletBinding()]
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$archive = Join-Path $workspace ('.cache/archives/diagnostics-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$prefix = $workspace.TrimEnd('\') + '\'

# Only development reports are candidates. Installed app data, EXEs, launcher
# helpers and captured races are never enumerated for moving.
$items = @(Get-ChildItem -LiteralPath $workspace -Directory -Filter 'tmp-*' |
    Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) })
$artifacts = Join-Path $workspace 'artifacts'
if (Test-Path -LiteralPath $artifacts) {
    $items += @(Get-ChildItem -LiteralPath $artifacts -File | Where-Object {
        $_.Extension -in '.png', '.jpg', '.webm', '.json' -and
        -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)
    })
}
$plan = @($items | ForEach-Object {
    $source = [IO.Path]::GetFullPath($_.FullName)
    if (-not $source.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Source is outside the workspace.' }
    $relative = $source.Substring($prefix.Length)
    $destination = [IO.Path]::GetFullPath((Join-Path $archive $relative))
    if (-not $destination.StartsWith($archive + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive destination is outside the archive.' }
    [pscustomobject]@{ source = $relative; destination = $destination; moved = $false }
})
if (-not $Apply) {
    $plan | Select-Object source, destination
    Write-Output "Preview: $($plan.Count) report paths. Run with -Apply to archive them. Nothing is deleted."
    return
}
if (-not $plan.Count) { Write-Output 'No loose reports to archive.'; return }
New-Item -ItemType Directory -Path $archive | Out-Null
$manifest = Join-Path $archive 'manifest.json'
$plan | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $manifest -Encoding utf8
foreach ($entry in $plan) {
    $source = Join-Path $workspace $entry.source
    $parent = Split-Path -Parent $entry.destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Move-Item -LiteralPath $source -Destination $entry.destination
    $entry.moved = $true
    $plan | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $manifest -Encoding utf8
}
Write-Output "Archived $($plan.Count) report paths in $archive. Restore paths are listed in manifest.json."
