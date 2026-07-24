# Launch @playwright/mcp for the Zinc repo.
# Preference:
#   1) Attach to Zinc Electron CDP on 127.0.0.1:9336 when dev is running
#   2) Otherwise start an isolated Chromium (so MCP tools still work for
#      file:// mocks, docs, and general browser work without a dead CDP)
#
# Zinc packaged builds never expose 9336 — only `npm run dev` does.

$ErrorActionPreference = 'Stop'
$cdp = if ($env:ZINC_CDP_ENDPOINT) { $env:ZINC_CDP_ENDPOINT } else { 'http://127.0.0.1:9336' }
$port = 9336
if ($cdp -match ':(\d+)\s*$') { $port = [int]$Matches[1] }

function Test-CdpAlive {
    param([string] $Url)
    try {
        $r = Invoke-WebRequest -Uri ($Url.TrimEnd('/') + '/json/version') -UseBasicParsing -TimeoutSec 1
        return $r.StatusCode -ge 200 -and $r.StatusCode -lt 500
    } catch {
        return $false
    }
}

$npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $npx) { $npx = Get-Command npx -ErrorAction SilentlyContinue }
if (-not $npx) { throw 'playwright-zinc-mcp: npx not found on PATH' }

$args = @('-y', '@playwright/mcp@latest')
if (Test-CdpAlive -Url $cdp) {
    $args += @('--cdp-endpoint', $cdp)
    [Console]::Error.WriteLine("playwright-zinc-mcp: attaching CDP $cdp")
} else {
    # Isolated profile under the repo so it does not touch user Chrome / fatality 9335.
    $profile = Join-Path $PSScriptRoot '..\.browser-profile-playwright-zinc'
    New-Item -ItemType Directory -Force -Path $profile | Out-Null
    $args += @(
        '--isolated',
        '--headless',
        '--viewport-size', '1280x800'
    )
    [Console]::Error.WriteLine("playwright-zinc-mcp: CDP $cdp down — using isolated headless Chromium (Zinc dev not required)")
}

& $npx.Source @args
exit $LASTEXITCODE
