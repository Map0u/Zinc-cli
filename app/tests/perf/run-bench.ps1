<#
.SYNOPSIS
  Zinc 前台卡顿基准启动器：为每个标签数起一个隔离的 dev 实例，跑 run-bench.mjs，再关掉整个进程树。
.EXAMPLE
  pwsh -NoProfile -File app/tests/perf/run-bench.ps1                 # 默认依次跑 N=1 和 N=10
  pwsh -NoProfile -File app/tests/perf/run-bench.ps1 -TabCounts 10 -MeasureSec 60 -Mode normal
#>
[CmdletBinding()]
param(
  [int[]]$TabCounts = @(1, 10),
  [int]$WarmupSec = 5,
  [int]$MeasureSec = 30,
  [int]$Fps = 20,
  [int]$Rows = 0,                       # 0 = 取 min(40, 终端行数-1)
  [ValidateSet('alt', 'normal')][string]$Mode = 'alt',
  [int]$TitleMs = 150,
  [switch]$Sync,                        # DEC 2026 同步输出
  [int]$InputIntervalMs = 200,
  [int]$InspectPort = 9337,             # 0 = 不测主进程事件循环延迟
  [string]$OutRoot = 'D:/tmp/cf/zinc-perf',
  [ValidateRange(15, 300)][int]$StartupTimeoutSeconds = 90
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$appRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$endpoint = 'http://127.0.0.1:9336'
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) { $npmCommand = Get-Command npm -ErrorAction Stop }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$exitCode = 0

function Test-CdpReady {
  try { return [bool](Invoke-RestMethod -Uri "$endpoint/json/version" -TimeoutSec 2).webSocketDebuggerUrl } catch { return $false }
}

function Stop-OwnedTree {
  param($Proc, [string]$Tag)
  if ($Proc -and -not $Proc.HasExited) {
    & taskkill.exe /PID $Proc.Id /T /F *> $null
  }
  # 兜底：只清理带本次唯一 tag 的 fake-tui 进程
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*fake-tui.mjs*--tag=$Tag*" } |
    ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F *> $null }
}

foreach ($n in $TabCounts) {
  if (Test-CdpReady) { throw "CDP endpoint $endpoint 已被占用，拒绝在不明实例上运行基准。" }
  if ($InspectPort -gt 0 -and (Get-NetTCPConnection -LocalPort $InspectPort -State Listen -ErrorAction SilentlyContinue)) {
    throw "inspector 端口 $InspectPort 已被占用。"
  }

  $runDir = Join-Path $OutRoot ("{0}-n{1}" -f $stamp, $n)
  $userData = Join-Path $runDir 'user-data'
  $tag = 'zpb' + [guid]::NewGuid().ToString('N').Substring(0, 12)
  New-Item -ItemType Directory -Path $userData -Force | Out-Null

  $saved = @{}
  foreach ($k in 'ZINC_TEST_SILENT', 'ZINC_TEST_ISOLATED', 'ZINC_TEST_USER_DATA', 'ZINC_CDP_ENDPOINT') { $saved[$k] = [Environment]::GetEnvironmentVariable($k) }
  $dev = $null
  try {
    $env:ZINC_TEST_SILENT = '1'
    $env:ZINC_TEST_ISOLATED = '1'
    $env:ZINC_TEST_USER_DATA = $userData
    $env:ZINC_CDP_ENDPOINT = $endpoint

    $devArgs = @('run', 'dev')
    if ($InspectPort -gt 0) { $devArgs += @('--', '--inspect', "$InspectPort") }
    $dev = Start-Process -FilePath $npmCommand.Source -ArgumentList $devArgs -WorkingDirectory $appRoot `
      -RedirectStandardOutput (Join-Path $runDir 'dev.stdout.log') -RedirectStandardError (Join-Path $runDir 'dev.stderr.log') -PassThru

    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    while (-not (Test-CdpReady)) {
      if ($dev.HasExited) { throw "dev 进程在 CDP 就绪前退出 (code $($dev.ExitCode))，见 $runDir" }
      if ([DateTime]::UtcNow -ge $deadline) { throw "等待 $endpoint 超时 ($StartupTimeoutSeconds s)" }
      Start-Sleep -Milliseconds 250
    }

    $benchArgs = @(
      (Join-Path $PSScriptRoot 'run-bench.mjs'),
      "--tabs=$n", "--warmup=$WarmupSec", "--measure=$MeasureSec", "--fps=$Fps", "--mode=$Mode",
      "--title-ms=$TitleMs", "--input-interval=$InputIntervalMs", "--inspect-port=$InspectPort",
      "--endpoint=$endpoint", "--root-pid=$($dev.Id)", "--node=$($nodeCommand.Source)", "--out=$runDir", "--tag=$tag"
    )
    if ($Rows -gt 0) { $benchArgs += "--rows=$Rows" }
    if ($Sync) { $benchArgs += '--sync' }
    Push-Location $appRoot
    try { & $nodeCommand.Source @benchArgs } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { $exitCode = $LASTEXITCODE }
  } catch {
    Write-Host "FAIL n=${n}: $($_.Exception.Message)"
    foreach ($f in 'dev.stdout.log', 'dev.stderr.log') {
      $p = Join-Path $runDir $f
      if (Test-Path -LiteralPath $p) { Write-Host "--- $f ---"; Get-Content -LiteralPath $p -Tail 40 }
    }
    $exitCode = 1
  } finally {
    Stop-OwnedTree -Proc $dev -Tag $tag
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
    # 关闭后等 CDP 端口释放，避免影响下一轮
    $until = [DateTime]::UtcNow.AddSeconds(15)
    while ((Test-CdpReady) -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 300 }
    Start-Sleep -Seconds 2
    # 临时 user-data 用完即删，保留 result.json 与日志
    try { Remove-Item -LiteralPath $userData -Recurse -Force -ErrorAction Stop } catch { Write-Warning "未能删除 $userData : $($_.Exception.Message)" }
  }
}
exit $exitCode
