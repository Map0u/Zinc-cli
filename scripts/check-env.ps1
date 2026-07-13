Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

$windowsTerminalSettings = Join-Path $env:LOCALAPPDATA "Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json"
$powershell7 = "C:\Program Files\PowerShell\7\pwsh.exe"
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
    $dotnetPath = "C:\Program Files\dotnet\dotnet.exe"
    if (Test-Path -LiteralPath $dotnetPath) {
        $dotnet = Get-Item -LiteralPath $dotnetPath
    }
}
$wt = Get-Command wt.exe -ErrorAction SilentlyContinue

$visualStudioPath = $null
if (Test-Path -LiteralPath $vswhere) {
    $visualStudioPath = & $vswhere -latest -products * -property installationPath
}

$result = [pscustomobject]@{
    ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
    PowerShell = @{
        CurrentVersion = $PSVersionTable.PSVersion.ToString()
        PowerShell7Path = $powershell7
        PowerShell7Exists = Test-Path -LiteralPath $powershell7
    }
    WindowsTerminal = @{
        SettingsPath = $windowsTerminalSettings
        SettingsExists = Test-Path -LiteralPath $windowsTerminalSettings
        WtExe = if ($wt) { $wt.Source } else { $null }
    }
    Toolchain = @{
        Dotnet = if ($dotnet) { $dotnet.FullName ?? $dotnet.Source } else { $null }
        DotnetVersion = if ($dotnet) { & ($dotnet.FullName ?? $dotnet.Source) --version } else { $null }
        VswhereExists = Test-Path -LiteralPath $vswhere
        VisualStudioPath = $visualStudioPath
    }
}

$result | ConvertTo-Json -Depth 6
