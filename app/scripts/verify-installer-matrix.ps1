param(
  [Parameter(Mandatory = $true)]
  [string]$SetupPath,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedVersion,
  [string]$PreviousSetupPath = "",
  # Paired with PreviousSetupPath: the upgrade leg asserts the installed version
  # before and after running the new setup.
  [string]$PreviousExpectedVersion = "",
  # No installer call may block forever: a stuck NSIS dialog, a UAC prompt nobody
  # answers, or an AV-locked setup used to hang the whole job with no diagnosis.
  [int]$InstallerTimeoutSeconds = 300,
  [string]$ProductName = "Zinc"
)

$ErrorActionPreference = "Stop"

if ($ExpectedVersion -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$') {
  throw "ExpectedVersion must be a valid semantic version."
}

if ([bool]$PreviousSetupPath -ne [bool]$PreviousExpectedVersion) {
  throw "PreviousSetupPath and PreviousExpectedVersion must be supplied together: a baseline without an expected version cannot prove which build it upgraded from, and an expected version without a baseline silently skips the upgrade leg."
}

if ($PreviousExpectedVersion -and $PreviousExpectedVersion -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
  throw "PreviousExpectedVersion must be a valid semantic version."
}

if ($InstallerTimeoutSeconds -lt 30 -or $InstallerTimeoutSeconds -gt 3600) {
  throw "InstallerTimeoutSeconds must be between 30 and 3600."
}

$SetupPath = (Resolve-Path $SetupPath).Path
if ($PreviousSetupPath) {
  $PreviousSetupPath = (Resolve-Path $PreviousSetupPath).Path
}

$script:InstallerTimeoutMs = $InstallerTimeoutSeconds * 1000

function Wait-InstallerProcess {
  param(
    [System.Diagnostics.Process]$Process,
    [string]$Path,
    [string[]]$Arguments
  )

  if ($Process.WaitForExit($script:InstallerTimeoutMs)) {
    return
  }

  & taskkill.exe /PID $Process.Id /T /F 2>&1 | Out-Null
  $killExit = $LASTEXITCODE
  $exited = $Process.WaitForExit(10000)

  $detail = "Installer did not exit within $InstallerTimeoutSeconds seconds: $Path $($Arguments -join ' ')"
  if ($killExit -ne 0 -or -not $exited) {
    $detail += " Force-kill of PID $($Process.Id) reported exit code $killExit and the process tree is" +
      $(if ($exited) { " gone." } else { " STILL RUNNING; later matrix steps may race it." })
  }
  throw $detail
}

function Invoke-NsisSetup {
  param(
    [string]$Path,
    [string[]]$Arguments = @("/S")
  )

  if (-not (Test-Path $Path)) {
    throw "Setup was not found: $Path"
  }

  # NSIS rewrites files while Zinc is running will fail or leave a half-updated
  # tree. The custom Electron wrapper used to close Zinc first; for NSIS-only
  # acceptance we force-close before every silent install/uninstall.
  Stop-ZincProcesses

  $process = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru
  Wait-InstallerProcess -Process $process -Path $Path -Arguments $Arguments
  if ($process.ExitCode -ne 0) {
    throw "NSIS setup failed with exit code $($process.ExitCode): $Path $($Arguments -join ' ')"
  }
}

function Get-ZincUninstallCommand {
  $roots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
  )

  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    foreach ($key in Get-ChildItem $root) {
      $item = Get-ItemProperty $key.PSPath
      if ($item.DisplayName -match "^$([regex]::Escape($ProductName))(\s|$)") {
        return [string]$item.QuietUninstallString
      }
    }
  }
  return $null
}

function Invoke-NsisUninstall {
  param([switch]$AllowMissing)

  $quiet = Get-ZincUninstallCommand
  if (-not $quiet) {
    if ($AllowMissing) { return }
    throw "No Zinc uninstall entry was found in the registry."
  }

  # QuietUninstallString is typically `"C:\...\Uninstall Zinc.exe" /currentuser /S`
  # Parse a leading quoted executable + remaining args without invoking a shell.
  if ($quiet -match '^\s*"(?<exe>[^"]+)"\s*(?<args>.*)$') {
    $exe = $Matches.exe
    $argLine = $Matches.args.Trim()
  } elseif ($quiet -match '^\s*(?<exe>\S+)\s*(?<args>.*)$') {
    $exe = $Matches.exe
    $argLine = $Matches.args.Trim()
  } else {
    throw "Could not parse QuietUninstallString: $quiet"
  }

  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    if ($AllowMissing) { return }
    throw "Uninstaller executable is missing: $exe"
  }

  $arguments = @()
  if ($argLine) {
    $arguments = [System.Management.Automation.Language.Parser]::ParseInput(
      "dummy $argLine",
      [ref]$null,
      [ref]$null
    ).EndBlock.Statements[0].PipelineElements[0].CommandElements |
      Select-Object -Skip 1 |
      ForEach-Object { $_.SafeGetValue() }
  }

  # Ensure silent uninstall even if the registry entry omits /S.
  if ($arguments -notcontains "/S" -and $arguments -notcontains "/s") {
    $arguments += "/S"
  }

  Stop-ZincProcesses
  $process = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru
  Wait-InstallerProcess -Process $process -Path $exe -Arguments $arguments
  if ($process.ExitCode -ne 0) {
    throw "NSIS uninstall failed with exit code $($process.ExitCode): $exe $($arguments -join ' ')"
  }
}

function Stop-ZincProcesses {
  $processNames = @("Zinc")
  foreach ($processName in $processNames) {
    Get-Process $processName -ErrorAction SilentlyContinue | Stop-Process -Force
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $remaining = @($processNames | ForEach-Object { Get-Process $_ -ErrorAction SilentlyContinue })
    if ($remaining.Count -eq 0) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "Zinc processes did not terminate before the next installer transition."
}

function Wait-ZincRunning {
  param(
    [System.Diagnostics.Process]$Process,
    [int]$TimeoutSeconds = 20
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if ($Process.HasExited) {
      throw "Packaged Zinc exited before its terminal became ready (exit code $($Process.ExitCode))."
    }
    if (@(Get-Process Zinc -ErrorAction SilentlyContinue).Count -gt 0) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "Packaged Zinc did not start within $TimeoutSeconds seconds."
}

function Wait-CdpReady {
  param(
    [string]$Endpoint,
    [System.Diagnostics.Process]$Process,
    [int]$TimeoutSeconds = 30
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if ($Process.HasExited) {
      throw "Packaged Zinc exited before CDP became ready (exit code $($Process.ExitCode))."
    }
    try {
      $version = Invoke-RestMethod -Uri "$Endpoint/json/version" -TimeoutSec 2
      if ($version.webSocketDebuggerUrl) { return }
    } catch {
      # Startup is still in progress.
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "Packaged Zinc CDP endpoint did not become ready within $TimeoutSeconds seconds."
}

function Assert-PackagedZincTerminal {
  param(
    [string]$ExePath,
    [string]$Scenario
  )

  if (-not (Test-Path $ExePath -PathType Leaf)) {
    throw "Packaged Zinc executable is missing for ${Scenario}."
  }

  Stop-ZincProcesses
  $runtimeRoot = Join-Path $script:MatrixRuntimeRoot ([guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
  $endpoint = "http://127.0.0.1:$($script:PackagedSmokePort)"
  $previousEndpoint = $env:ZINC_CDP_ENDPOINT
  $process = $null

  try {
    $process = Start-Process -FilePath $ExePath -ArgumentList @(
      "--remote-debugging-port=$($script:PackagedSmokePort)",
      "--user-data-dir=$runtimeRoot",
      "--disable-gpu"
    ) -PassThru
    Wait-ZincRunning -Process $process
    Wait-CdpReady -Endpoint $endpoint -Process $process
    $env:ZINC_CDP_ENDPOINT = $endpoint
    & node $script:PackagedSmokeScript | Out-Host
    if ($LASTEXITCODE -ne 0) {
      throw "Packaged Zinc terminal smoke failed for ${Scenario} with exit code $LASTEXITCODE."
    }
  }
  finally {
    if ($null -eq $previousEndpoint) {
      Remove-Item Env:ZINC_CDP_ENDPOINT -ErrorAction SilentlyContinue
    } else {
      $env:ZINC_CDP_ENDPOINT = $previousEndpoint
    }
    Stop-ZincProcesses
    if (Test-Path $runtimeRoot) {
      Remove-Item $runtimeRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Start-ZincForRunningInstallTest {
  param([string]$ExePath)

  Stop-ZincProcesses
  New-Item -ItemType Directory -Path $script:CloseTestUserDataRoot -Force | Out-Null
  $process = Start-Process -FilePath $ExePath -ArgumentList "--user-data-dir=$($script:CloseTestUserDataRoot)" -PassThru
  Wait-ZincRunning -Process $process
  Start-Sleep -Seconds 2
  if ($process.HasExited) {
    throw "Packaged Zinc did not stay running for the running-install close test."
  }
}

function Assert-ZincInstall {
  param([string]$Version)

  if ($Version) {
    $json = & $script:VerifyInstallScript -ExpectedVersion $Version -ProductName $ProductName -UserDataMarkerPath $script:MarkerPath -ExpectedUserDataMarker
  } else {
    $json = & $script:VerifyInstallScript -ProductName $ProductName -UserDataMarkerPath $script:MarkerPath -ExpectedUserDataMarker
  }
  return ($json | ConvertFrom-Json)
}

function Assert-ZincUninstalled {
  param(
    [string]$ExpectedExePath = "",
    [switch]$ExpectMarker
  )
  $arguments = @{
    ProductName = $ProductName
    ExpectedAbsent = $true
    ExpectedExePath = $ExpectedExePath
  }
  if ($ExpectMarker) {
    $arguments.UserDataMarkerPath = $script:MarkerPath
    $arguments.ExpectedUserDataMarker = $true
  }
  $json = & $script:VerifyInstallScript @arguments
  return ($json | ConvertFrom-Json)
}

$script:VerifyInstallScript = Join-Path $PSScriptRoot "verify-install.ps1"
if (-not (Test-Path $script:VerifyInstallScript -PathType Leaf)) {
  throw "Install verification script was not found."
}
$script:PackagedSmokeScript = Join-Path (Split-Path $PSScriptRoot -Parent) "tests\cdp\packaged-terminal-smoke.mjs"
if (-not (Test-Path $script:PackagedSmokeScript -PathType Leaf)) {
  throw "Packaged terminal smoke script was not found."
}
$script:PackagedSmokePort = 9337
$script:MatrixRuntimeRoot = Join-Path (Split-Path $PSScriptRoot -Parent) "dist\installer-matrix-runtime"
$script:CloseTestUserDataRoot = Join-Path $script:MatrixRuntimeRoot "close-test-user-data"

$script:MarkerPath = Join-Path $env:APPDATA "zinc\installer-matrix-user-data.marker"
$markerDirectory = Split-Path $script:MarkerPath -Parent
$markerExisted = Test-Path $script:MarkerPath -PathType Leaf
$markerBackupBase64 = if ($markerExisted) {
  [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($script:MarkerPath))
} else {
  $null
}
$matrixTouchedInstallation = $false
$pushedLocation = $false
$lastInstalledExe = ""

try {
  Push-Location (Split-Path $PSScriptRoot -Parent)
  $pushedLocation = $true

  New-Item -ItemType Directory -Path $markerDirectory -Force | Out-Null
  [System.IO.File]::WriteAllText($script:MarkerPath, "Zinc installer matrix marker: $([guid]::NewGuid())")

  Stop-ZincProcesses
  $matrixTouchedInstallation = $true
  Invoke-NsisUninstall -AllowMissing
  Assert-ZincUninstalled -ExpectMarker | Out-Null

  Invoke-NsisSetup -Path $SetupPath
  $installed = Assert-ZincInstall -Version $ExpectedVersion
  $lastInstalledExe = $installed.ExePath
  Assert-PackagedZincTerminal -ExePath $lastInstalledExe -Scenario "clean install"

  # Overwrite of the same version while the app is running: matrix force-closes
  # first (NSIS cannot request a graceful second-instance quit the way the old
  # Electron wrapper did), then re-runs silent setup.
  Start-ZincForRunningInstallTest -ExePath $lastInstalledExe
  Invoke-NsisSetup -Path $SetupPath
  $installed = Assert-ZincInstall -Version $ExpectedVersion
  $lastInstalledExe = $installed.ExePath
  Assert-PackagedZincTerminal -ExePath $lastInstalledExe -Scenario "overwrite"

  # Reinstall: uninstall then install.
  Start-ZincForRunningInstallTest -ExePath $lastInstalledExe
  Invoke-NsisUninstall
  Assert-ZincUninstalled -ExpectedExePath $lastInstalledExe -ExpectMarker | Out-Null
  Invoke-NsisSetup -Path $SetupPath
  $installed = Assert-ZincInstall -Version $ExpectedVersion
  $lastInstalledExe = $installed.ExePath
  Assert-PackagedZincTerminal -ExePath $lastInstalledExe -Scenario "reinstall"

  if ($PreviousSetupPath) {
    Stop-ZincProcesses
    Invoke-NsisUninstall
    Assert-ZincUninstalled -ExpectedExePath $lastInstalledExe -ExpectMarker | Out-Null
    Invoke-NsisSetup -Path $PreviousSetupPath
    $installed = Assert-ZincInstall -Version $PreviousExpectedVersion
    $lastInstalledExe = $installed.ExePath
    Start-ZincForRunningInstallTest -ExePath $lastInstalledExe
    Invoke-NsisSetup -Path $SetupPath
    $installed = Assert-ZincInstall -Version $ExpectedVersion
    $lastInstalledExe = $installed.ExePath
    Assert-PackagedZincTerminal -ExePath $lastInstalledExe -Scenario "upgrade"
  }

  Start-ZincForRunningInstallTest -ExePath $lastInstalledExe
  Invoke-NsisUninstall
  Assert-ZincUninstalled -ExpectedExePath $lastInstalledExe -ExpectMarker | Out-Null

  [pscustomobject]@{
    ExpectedVersion = $ExpectedVersion
    PreviousVersion = $(if ($PreviousSetupPath) { $PreviousExpectedVersion } else { "" })
    InitialUninstall = "ok"
    CleanInstall = "ok"
    OverwriteInstall = "ok"
    Reinstall = "ok"
    Upgrade = $(if ($PreviousSetupPath) { "ok" } else { "skipped" })
    FinalUninstall = "ok"
    RegistryRemoved = "ok"
    ApplicationExeRemoved = "ok"
    DesktopShortcutRemoved = "ok"
    StartMenuShortcutRemoved = "ok"
    UserDataMarkerPreserved = "ok"
    PackagedPowerShellTerminal = "ok"
    RunningApplicationClose = "ok"
  } | ConvertTo-Json
}
finally {
  Stop-ZincProcesses
  if ($matrixTouchedInstallation) {
    try {
      Invoke-NsisUninstall -AllowMissing
      Assert-ZincUninstalled -ExpectedExePath $lastInstalledExe -ExpectMarker | Out-Null
    } catch {
      Write-Warning "Best-effort final uninstall verification failed: $($_.Exception.Message)"
    }
  }

  try {
    if ($markerExisted) {
      New-Item -ItemType Directory -Path $markerDirectory -Force | Out-Null
      [System.IO.File]::WriteAllBytes($script:MarkerPath, [Convert]::FromBase64String($markerBackupBase64))
    } elseif (Test-Path $script:MarkerPath -PathType Leaf) {
      Remove-Item $script:MarkerPath -Force
      $remainingMarkerDirectoryItems = @(Get-ChildItem -LiteralPath $markerDirectory -Force -ErrorAction SilentlyContinue)
      if ($remainingMarkerDirectoryItems.Count -eq 0) {
        Remove-Item -LiteralPath $markerDirectory -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    Write-Warning "Could not restore the installer-matrix marker: $($_.Exception.Message)"
  }

  if ($pushedLocation) { Pop-Location }
  if (Test-Path $script:MatrixRuntimeRoot) {
    Remove-Item $script:MatrixRuntimeRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
