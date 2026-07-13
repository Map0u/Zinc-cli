param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedVersion,
  [string]$PreviousSetupPath = "",
  # Paired with PreviousSetupPath: the upgrade leg asserted "some older build is installed"
  # without checking which one, so a wrong or swapped baseline still reported "0.3.7 -> 0.5.0 verified".
  [string]$PreviousExpectedVersion = "",
  # No installer call may block forever: a stuck NSIS dialog, a UAC prompt nobody answers or an
  # AV-locked payload used to hang the whole job until the platform killed it with no diagnosis.
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

$InstallerPath = (Resolve-Path $InstallerPath).Path
if ($PreviousSetupPath) {
  $PreviousSetupPath = (Resolve-Path $PreviousSetupPath).Path
}

function Wait-InstallerProcess {
  param(
    [System.Diagnostics.Process]$Process,
    [string]$Path,
    [string[]]$Arguments
  )

  if ($Process.WaitForExit($script:InstallerTimeoutMs)) {
    return
  }

  # A native command's non-zero exit is not a terminating error even under $ErrorActionPreference =
  # 'Stop', so a failed taskkill would never reach a catch block: check $LASTEXITCODE, and then
  # confirm the tree is actually gone rather than trusting the kill.
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

$script:InstallerTimeoutMs = $InstallerTimeoutSeconds * 1000

function Invoke-Installer {
  param(
    [string]$Path,
    [string[]]$Arguments,
    [switch]$ExpectCliResult
  )

  if (-not (Test-Path $Path)) {
    throw "Installer was not found: $Path"
  }

  if (-not $ExpectCliResult) {
    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru
    Wait-InstallerProcess -Process $process -Path $Path -Arguments $Arguments
    if ($process.ExitCode -ne 0) {
      throw "Installer command failed with exit code $($process.ExitCode): $Path $($Arguments -join ' ')"
    }
    return
  }

  New-Item -ItemType Directory -Path $script:MatrixRuntimeRoot -Force | Out-Null
  $resultFile = Join-Path $script:MatrixRuntimeRoot ("installer-result-{0}.json" -f [guid]::NewGuid().ToString("N"))
  $previousResultFile = $env:ZINC_INSTALLER_RESULT_FILE
  try {
    $env:ZINC_INSTALLER_RESULT_FILE = $resultFile
    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru
    Wait-InstallerProcess -Process $process -Path $Path -Arguments $Arguments
  }
  finally {
    if ($null -eq $previousResultFile) {
      Remove-Item Env:ZINC_INSTALLER_RESULT_FILE -ErrorAction SilentlyContinue
    } else {
      $env:ZINC_INSTALLER_RESULT_FILE = $previousResultFile
    }
  }

  if (-not (Test-Path $resultFile -PathType Leaf)) {
    throw "Packaged installer did not report its inner operation result (outer exit code $($process.ExitCode))."
  }
  try {
    $operationResult = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
  }
  finally {
    Remove-Item -LiteralPath $resultFile -Force -ErrorAction SilentlyContinue
  }
  if ($operationResult.ok -ne $true) {
    throw "Packaged installer reported that operation '$($Arguments -join ' ')' failed."
  }
}

function Invoke-InstallerFixtureTests {
  $installerTestRoot = Join-Path (Split-Path $PSScriptRoot -Parent) "installer\tests"
  $fixtureTests = @(Get-ChildItem -LiteralPath $installerTestRoot -Filter "*.test.js" -File | Sort-Object Name)
  if ($fixtureTests.Count -eq 0) {
    throw "Installer fixture tests were not found."
  }
  & node --test @($fixtureTests.FullName) | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Installer fixture tests failed with exit code $LASTEXITCODE."
  }
}

function Stop-ZincProcesses {
  $processNames = @("Zinc", "Zinc Installer")
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

function Start-ZincForInstallerCloseTest {
  param([string]$ExePath)

  Stop-ZincProcesses
  New-Item -ItemType Directory -Path $script:CloseTestUserDataRoot -Force | Out-Null
  $process = Start-Process -FilePath $ExePath -ArgumentList "--user-data-dir=$($script:CloseTestUserDataRoot)" -PassThru
  Wait-ZincRunning -Process $process
  Start-Sleep -Seconds 2
  if ($process.HasExited) {
    throw "Packaged Zinc did not stay running for the installer close test."
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
$previousMatrixUserData = $env:ZINC_INSTALLER_MATRIX_USER_DATA
$env:ZINC_INSTALLER_MATRIX_USER_DATA = $script:CloseTestUserDataRoot

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

  Invoke-InstallerFixtureTests

  Stop-ZincProcesses
  $matrixTouchedInstallation = $true
  Invoke-Installer -Path $InstallerPath -Arguments @("--uninstall") -ExpectCliResult
  Assert-ZincUninstalled -ExpectMarker | Out-Null

  Invoke-Installer -Path $InstallerPath -Arguments @("--install") -ExpectCliResult
  $installed = Assert-ZincInstall -Version $ExpectedVersion
  $lastInstalledExe = $installed.ExePath
  Assert-PackagedZincTerminal -ExePath $lastInstalledExe -Scenario "clean install"

  Start-ZincForInstallerCloseTest -ExePath $lastInstalledExe
  Invoke-Installer -Path $InstallerPath -Arguments @("--overwrite") -ExpectCliResult
  $installed = Assert-ZincInstall -Version $ExpectedVersion
  $lastInstalledExe = $installed.ExePath
  Assert-PackagedZincTerminal -ExePath $lastInstalledExe -Scenario "overwrite"

  Start-ZincForInstallerCloseTest -ExePath $lastInstalledExe
  Invoke-Installer -Path $InstallerPath -Arguments @("--reinstall") -ExpectCliResult
  $installed = Assert-ZincInstall -Version $ExpectedVersion
  $lastInstalledExe = $installed.ExePath
  Assert-PackagedZincTerminal -ExePath $lastInstalledExe -Scenario "reinstall"

  if ($PreviousSetupPath) {
    Stop-ZincProcesses
    Invoke-Installer -Path $InstallerPath -Arguments @("--uninstall") -ExpectCliResult
    Assert-ZincUninstalled -ExpectedExePath $lastInstalledExe -ExpectMarker | Out-Null
    Invoke-Installer -Path $PreviousSetupPath -Arguments @("/S")
    $installed = Assert-ZincInstall -Version $PreviousExpectedVersion
    $lastInstalledExe = $installed.ExePath
    Start-ZincForInstallerCloseTest -ExePath $lastInstalledExe
    Invoke-Installer -Path $InstallerPath -Arguments @("--upgrade") -ExpectCliResult
    $installed = Assert-ZincInstall -Version $ExpectedVersion
    $lastInstalledExe = $installed.ExePath
    Assert-PackagedZincTerminal -ExePath $lastInstalledExe -Scenario "upgrade"
  }

  Start-ZincForInstallerCloseTest -ExePath $lastInstalledExe
  Invoke-Installer -Path $InstallerPath -Arguments @("--uninstall") -ExpectCliResult
  Assert-ZincUninstalled -ExpectedExePath $lastInstalledExe -ExpectMarker | Out-Null

  [pscustomobject]@{
    ExpectedVersion = $ExpectedVersion
    PreviousVersion = $(if ($PreviousSetupPath) { $PreviousExpectedVersion } else { "" })
    PayloadCorruptionFixtures = "ok"
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
      Invoke-Installer -Path $InstallerPath -Arguments @("--uninstall") -ExpectCliResult
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
  if ($null -eq $previousMatrixUserData) {
    Remove-Item Env:ZINC_INSTALLER_MATRIX_USER_DATA -ErrorAction SilentlyContinue
  } else {
    $env:ZINC_INSTALLER_MATRIX_USER_DATA = $previousMatrixUserData
  }
  if (Test-Path $script:MatrixRuntimeRoot) {
    Remove-Item $script:MatrixRuntimeRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
