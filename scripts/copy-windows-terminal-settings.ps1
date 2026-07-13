Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

$source = Join-Path $env:LOCALAPPDATA "Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$targetDir = Join-Path $projectRoot "settings"
$target = Join-Path $targetDir "windows-terminal-settings.snapshot.json"

if (-not (Test-Path -LiteralPath $source)) {
    throw "Windows Terminal settings not found: $source"
}

if (-not (Test-Path -LiteralPath $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir | Out-Null
}

Copy-Item -LiteralPath $source -Destination $target -Force

[pscustomobject]@{
    Source = $source
    Target = $target
    Bytes = (Get-Item -LiteralPath $target).Length
    CopiedAt = (Get-Date).ToString("s")
} | ConvertTo-Json -Compress

