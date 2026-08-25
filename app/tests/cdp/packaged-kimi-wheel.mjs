import { chromium } from 'playwright-core'

const endpoint = process.env.ZINC_CDP_ENDPOINT || 'http://127.0.0.1:19337'
const timeoutMs = Number(process.env.ZINC_KIMI_WHEEL_TIMEOUT_MS || 120_000)
let browser

function redact(value) {
  return value
    .replace(/[A-Za-z]:[\\/][^\r\n]*/g, '<redacted-path>')
    .replace(/\\\\[^\r\n]*/g, '<redacted-path>')
    .replace(/\/(?:home|mnt|tmp|Users)\/[^\s)]+/g, '<redacted-path>')
}

async function visibleRows(page) {
  return page.evaluate(() => {
    const rowRoot = document.querySelector('.xterm-rows')
    if (!rowRoot) return []
    return Array.from(rowRoot.children).map((row) => (row.textContent ?? '').replace(/\s+$/g, ''))
  })
}

function changedRowCount(before, after) {
  const n = Math.min(before.length, after.length)
  let changed = 0
  for (let i = 0; i < n; i++) {
    if (before[i] !== after[i]) changed++
  }
  changed += Math.abs(before.length - after.length)
  return changed
}

function firstWheelLine(rows) {
  for (const row of rows) {
    const match = row.match(/WHEEL-LINE-(\d{3})/)
    if (match) return Number(match[1])
  }
  return null
}

async function waitForRows(page, predicate, message) {
  const deadline = Date.now() + timeoutMs
  let last = []
  while (Date.now() < deadline) {
    last = await visibleRows(page)
    if (predicate(last)) return last
    await page.waitForTimeout(400)
  }
  throw new Error(`${message} last=${JSON.stringify(last.slice(0, 8))}`)
}

try {
  browser = await chromium.connectOverCDP(endpoint, { timeout: 20_000 })
  const context = browser.contexts()[0]
  if (!context) throw new Error('Packaged Zinc did not expose a browser context.')
  const page = context.pages()[0] || (await context.waitForEvent('page', { timeout: 20_000 }))
  await page.waitForLoadState('domcontentloaded')

  const terminalInput = page.locator('.xterm-helper-textarea').first()
  await terminalInput.waitFor({ state: 'visible', timeout: 20_000 })
  await terminalInput.click()

  await page.keyboard.insertText(String.raw`$env:KIMI_CODE_TUI_FULL_SCREEN='1'; $env:KIMI_SHELL_PATH='C:\Program Files\Git\bin\bash.exe'; & "$env:USERPROFILE\.kimi-code\bin\kimi.exe"`)
  await page.keyboard.press('Enter')

  await waitForRows(
    page,
    (rows) => {
      const text = rows.join('\n').toLowerCase()
      if (text.includes('git bash was not found')) return false
      return text.includes('/help') || text.includes('trust') || text.includes('shift-tab') || text.includes('plan')
    },
    'Kimi TUI did not appear'
  )

  // Workspace trust / first-run prompts: Enter accepts the default.
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)

  // Fill the transcript without calling a model.
  await page.keyboard.insertText("! 1..160 | ForEach-Object { 'WHEEL-LINE-' + $_.ToString().PadLeft(3,'0') + ' ' + ('x' * 24) }")
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2000)
  await page.keyboard.press('Control+o')

  const filled = await waitForRows(
    page,
    (rows) => rows.some((row) => /WHEEL-LINE-\d{3}/.test(row)),
    'Shell dump did not appear in the Kimi transcript'
  )

  const terminalBox = await page.locator('.xterm').first().boundingBox()
  if (!terminalBox) throw new Error('xterm bounding box missing')
  await page.mouse.move(terminalBox.x + terminalBox.width / 2, terminalBox.y + terminalBox.height / 2)

  const before = await visibleRows(page)
  const expectLine = process.env.ZINC_KIMI_WHEEL_EXPECT === 'line'
  // Off-switch contrast: one notch (-100) so xterm does not split a -1200
  // burst into many SGR line-scrolls that can still trip the page threshold.
  const deltaY = Number(process.env.ZINC_KIMI_WHEEL_DELTA_Y || (expectLine ? -100 : -1200))
  await page.mouse.wheel(0, deltaY)
  await page.waitForTimeout(400)
  const after = await visibleRows(page)
  const changed = changedRowCount(before, after)
  const minChanged = Math.max(8, Math.min(before.length, after.length) - 8)
  const beforeLine = firstWheelLine(before)
  const afterLine = firstWheelLine(after)
  // Unique dump lines rewrite every visible row on any ≥1-line scroll, so
  // `changed` saturates at `rows`. The WHEEL-LINE index jump is the page vs
  // line signal (page ≈ viewport, a single off-switch tick is a few lines).
  const jump =
    beforeLine != null && afterLine != null ? Math.abs(beforeLine - afterLine) : changed

  if (expectLine) {
    if (jump >= minChanged) {
      throw new Error(
        `wheel still paged with the setting off: jump=${jump} changed=${changed} min=${minChanged} rows=${before.length} before=${beforeLine} after=${afterLine}`
      )
    }
    console.log(
      `PASS: with paging off, wheel stayed near line-scroll (jump=${jump}, changed=${changed}, pageMin=${minChanged}).`
    )
  } else {
    if (jump < minChanged) {
      throw new Error(
        `wheel did not page the transcript: jump=${jump} changed=${changed} min=${minChanged} rows=${before.length} before=${beforeLine} after=${afterLine} sample=${JSON.stringify(filled.filter((row) => /WHEEL-LINE/.test(row)).slice(0, 3))}`
      )
    }
    console.log(
      `PASS: Kimi full-screen wheel paged the transcript (jump=${jump}, changed=${changed}, min=${minChanged}).`
    )
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`FAIL: packaged Kimi wheel: ${redact(message)}`)
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
}
