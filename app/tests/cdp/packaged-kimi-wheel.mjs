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

  const promptText = (await visibleRows(page)).join('\n').toLowerCase()
  // 0.38 defaults the trust dialog to "Don't trust" / Exit. Enter would leave
  // fullscreen and dump into PowerShell. Move onto "Trust this folder" first.
  if (promptText.includes('trust this folder') || promptText.includes("don't trust")) {
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
  }

  await waitForRows(
    page,
    (rows) => {
      const text = rows.join('\n').toLowerCase()
      return text.includes('/help') || text.includes('shift-tab') || text.includes('plan')
    },
    'Kimi TUI did not appear after workspace trust'
  )

  // Fill the transcript without calling a model. Kimi's shell is bash here,
  // and the composer often needs a second Enter to submit.
  await page.keyboard.insertText('! seq -f WHEEL-LINE-%03g 1 160')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2000)
  await page.keyboard.press('Control+o')

  const filled = await waitForRows(
    page,
    (rows) => rows.some((row) => /WHEEL-LINE-\d{3}/.test(row)),
    'Shell dump did not appear in the Kimi transcript'
  )

  const pagingHost = page.locator('[data-zinc-wheel-paging="1"]').first()
  try {
    await pagingHost.waitFor({ state: 'attached', timeout: 20_000 })
  } catch {
    const viewport = await page.evaluate(() => {
      const vp = document.querySelector('.xterm-viewport')
      return vp
        ? { top: vp.scrollTop, height: vp.scrollHeight, client: vp.clientHeight }
        : null
    })
    throw new Error(
      `Kimi never entered the alternate buffer (data-zinc-wheel-paging=1). viewport=${JSON.stringify(viewport)}`
    )
  }

  const terminalBox = await page.locator('.xterm').first().boundingBox()
  if (!terminalBox) throw new Error('xterm bounding box missing')
  await page.mouse.move(terminalBox.x + terminalBox.width / 2, terminalBox.y + terminalBox.height / 2)

  const viewportBefore = await page.evaluate(() => {
    const viewport = document.querySelector('.xterm-viewport')
    return viewport ? { top: viewport.scrollTop, height: viewport.scrollHeight } : null
  })

  const before = await visibleRows(page)
  const expectLine = process.env.ZINC_KIMI_WHEEL_EXPECT === 'line'
  // One Windows notch. A -1200 burst used to PASS as long as any PgUp landed,
  // even when the same gesture also line-scrolled.
  const deltaY = Number(process.env.ZINC_KIMI_WHEEL_DELTA_Y || (expectLine ? -100 : -120))
  await page.mouse.wheel(0, deltaY)
  await page.waitForTimeout(400)
  const after = await visibleRows(page)
  const viewportAfter = await page.evaluate(() => {
    const viewport = document.querySelector('.xterm-viewport')
    return viewport ? { top: viewport.scrollTop, height: viewport.scrollHeight } : null
  })
  const changed = changedRowCount(before, after)
  // Transcript chrome (composer/footer) eats rows, so a page is a bit less
  // than the full xterm. Line-scroll is still ~3–6; keep the split above that.
  const minChanged = Math.max(12, Math.min(before.length, after.length) - 16)
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
    if (
      viewportBefore &&
      viewportAfter &&
      viewportAfter.top !== viewportBefore.top
    ) {
      throw new Error(
        `viewport moved while paging: before=${viewportBefore.top} after=${viewportAfter.top}`
      )
    }
    console.log(
      `PASS: Kimi full-screen wheel paged the transcript (jump=${jump}, changed=${changed}, pageMin=${minChanged}, viewport=${viewportAfter?.top ?? 'n/a'}).`
    )
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`FAIL: packaged Kimi wheel: ${redact(message)}`)
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
}
