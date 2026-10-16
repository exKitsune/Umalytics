[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework C# compiler is unavailable.' }
$directory = Join-Path $workspace '.cache\launcher'
[IO.Directory]::CreateDirectory($directory) | Out-Null
$output = Join-Path $directory 'UmaTrace.Launcher.exe'
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /warnaserror+ "/out:$output" "/win32manifest:$(Join-Path $PSScriptRoot 'launcher.manifest')" /reference:System.Runtime.Serialization.dll /reference:System.Windows.Forms.dll (Join-Path $PSScriptRoot 'UmaTraceLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
Write-Output "Built console-free launcher: $output"
Write-Output ('Steam Launch Options: "' + $output + '" -- %command%')
