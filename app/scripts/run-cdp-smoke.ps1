[CmdletBinding()]
param(
  [ValidateRange(15, 300)]
  [int]$StartupTimeoutSeconds = 90
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$appRoot = Split-Path -Parent $PSScriptRoot
$endpoint = 'http://127.0.0.1:9336'
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$runRoot = Join-Path $tempRoot ("zinc-cdp-{0}-{1}" -f $PID, [guid]::NewGuid().ToString('N'))
$userDataRoot = Join-Path $runRoot 'user-data'
$stdoutLog = Join-Path $runRoot 'dev.stdout.log'
$stderrLog = Join-Path $runRoot 'dev.stderr.log'
$devProcess = $null
$locationPushed = $false

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  $npmCommand = Get-Command npm -ErrorAction Stop
}

$previousEnvironment = @{
  Silent = $env:ZINC_TEST_SILENT
  Isolated = $env:ZINC_TEST_ISOLATED
  UserData = $env:ZINC_TEST_USER_DATA
  Endpoint = $env:ZINC_CDP_ENDPOINT
}

function Test-CdpReady {
  try {
    $version = Invoke-RestMethod -Uri "$endpoint/json/version" -TimeoutSec 2
    return [bool]$version.webSocketDebuggerUrl
  } catch {
    return $false
  }
}

function Write-DevLog {
  param(
    [string]$Label,
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  Write-Host "`n--- $Label ---"
  Get-Content -LiteralPath $Path -Tail 200
}

function Restore-EnvironmentValue {
  param(
    [string]$Name,
    [AllowNull()]
    [string]$Value
  )

  if ($null -eq $Value) {
    Remove-Item "Env:$Name" -ErrorAction SilentlyContinue
  } else {
    Set-Item "Env:$Name" $Value
  }
}

try {
  if (Test-CdpReady) {
    throw "CDP endpoint $endpoint is already in use; refusing to run smoke tests against an unrelated Zinc instance."
  }

  New-Item -ItemType Directory -Path $userDataRoot -Force | Out-Null
  $env:ZINC_TEST_SILENT = '1'
  $env:ZINC_TEST_ISOLATED = '1'
  $env:ZINC_TEST_USER_DATA = $userDataRoot
  $env:ZINC_CDP_ENDPOINT = $endpoint

  Push-Location $appRoot
  $locationPushed = $true
  $devProcess = Start-Process `
    -FilePath $npmCommand.Source `
    -ArgumentList @('run', 'dev') `
    -WorkingDirectory $appRoot `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

  $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
  while (-not (Test-CdpReady)) {
    if ($devProcess.HasExited) {
      throw "Zinc dev process exited with code $($devProcess.ExitCode) before CDP became ready."
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      throw "Timed out after $StartupTimeoutSeconds seconds waiting for $endpoint."
    }
    Start-Sleep -Milliseconds 250
  }

  & $npmCommand.Source run verify:cdp
  if ($LASTEXITCODE -ne 0) {
    throw "CDP smoke suite failed with exit code $LASTEXITCODE."
  }
} catch {
  Write-DevLog -Label 'Zinc dev stdout' -Path $stdoutLog
  Write-DevLog -Label 'Zinc dev stderr' -Path $stderrLog
  throw
} finally {
  if ($devProcess -and -not $devProcess.HasExited) {
    try {
      & taskkill.exe /PID $devProcess.Id /T /F *> $null
    } catch {
      Write-Warning "Could not terminate the Zinc dev process tree: $($_.Exception.Message)"
    }
  }

  if ($locationPushed) { Pop-Location }
  Restore-EnvironmentValue -Name 'ZINC_TEST_SILENT' -Value $previousEnvironment.Silent
  Restore-EnvironmentValue -Name 'ZINC_TEST_ISOLATED' -Value $previousEnvironment.Isolated
  Restore-EnvironmentValue -Name 'ZINC_TEST_USER_DATA' -Value $previousEnvironment.UserData
  Restore-EnvironmentValue -Name 'ZINC_CDP_ENDPOINT' -Value $previousEnvironment.Endpoint

  if (Test-Path -LiteralPath $runRoot) {
    try {
      Remove-Item -LiteralPath $runRoot -Recurse -Force
    } catch {
      Write-Warning "Could not remove CDP smoke temporary directory ${runRoot}: $($_.Exception.Message)"
    }
  }
}
