import { chromium } from 'playwright-core'

const CDP_ENDPOINT = process.env.ZINC_CDP_ENDPOINT || 'http://127.0.0.1:9336'
const DEFAULT_TIMEOUT_MS = 15_000
let powerShellCommandSequence = 0

export function requireIsolatedTestProfile() {
  const isolated = process.env.ZINC_TEST_ISOLATED === '1'
  const userDataOverride = Boolean(process.env.ZINC_TEST_USER_DATA?.trim())
  if (isolated && userDataOverride) return true

  console.error('FAIL: this smoke test requires an isolated Zinc test profile.')
  process.exitCode = 1
  return false
}

function safeDiagnostic(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/[A-Za-z]:[\\/][^\r\n]*/g, '<redacted-path>')
    .replace(/\\\\[^\r\n]*/g, '<redacted-path>')
    .replace(/\/(?:home|mnt|tmp|Users)\/[^\s)]+/g, '<redacted-path>')
}

export function assert(condition, message, details = '') {
  if (!condition) {
    throw new Error(details ? `${message}: ${details}` : message)
  }
  console.log(`ok: ${message}`)
}

export async function waitFor(page, predicate, arg, message, timeout = DEFAULT_TIMEOUT_MS) {
  try {
    await page.waitForFunction(predicate, arg, { timeout })
  } catch (error) {
    throw new Error(`${message} (${error instanceof Error ? error.message : String(error)})`)
  }
}

export async function runSmoke(name, body) {
  let browser
  let page
  let baseline
  let failure = null

  try {
    browser = await chromium.connectOverCDP(CDP_ENDPOINT, { timeout: DEFAULT_TIMEOUT_MS })
    const context = browser.contexts()[0]
    assert(context, 'connected to the Zinc CDP browser context')
    page = context.pages()[0] || (await context.waitForEvent('page', { timeout: DEFAULT_TIMEOUT_MS }))
    await page.waitForLoadState('domcontentloaded')
    await waitFor(
      page,
      () => Boolean(window.__zincTabs && window.__zincRegistry && window.__zincTabs.tabs.length > 0),
      undefined,
      'Zinc dev verification hooks did not become ready'
    )

    baseline = await captureBaseline(page)
    await ensureTerminalView(page)
    await body({ page, baseline })
    console.log(`\nPASS: ${name}`)
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error))
    console.error(`\nFAIL: ${name}`)
    console.error(safeDiagnostic(failure))
  } finally {
    if (page && baseline) {
      try {
        await restoreBaseline(page, baseline)
      } catch (error) {
        const cleanupError = error instanceof Error ? error : new Error(String(error))
        console.error(`cleanup failed: ${safeDiagnostic(cleanupError)}`)
        failure ||= cleanupError
      }
    }
    if (browser) {
      try {
        await browser.close()
      } catch {
        // The Electron process may already be closing; the smoke result above is authoritative.
      }
    }
  }

  if (failure) process.exitCode = 1
}

async function captureBaseline(page) {
  return page.evaluate(() => {
    const settings = window.zinc.settings.get()
    const settingsView = Boolean(document.querySelector('[data-testid="settings-back"]'))
    return Promise.resolve(settings).then((resolvedSettings) => ({
      settings: resolvedSettings,
      tabIds: window.__zincTabs.tabs.map((tab) => tab.id),
      activeId: window.__zincTabs.activeId,
      view: settingsView ? 'settings' : 'terminal',
      viewport: { width: window.innerWidth, height: window.innerHeight }
    }))
  })
}

async function restoreBaseline(page, baseline) {
  await ensureTerminalView(page)

  const currentIds = await page.evaluate(() => window.__zincTabs.tabs.map((tab) => tab.id))
  const createdIds = currentIds.filter((id) => !baseline.tabIds.includes(id))
  for (const id of createdIds) {
    await page.evaluate((tabId) => window.__zincTabs.closeTab(tabId), id)
    await waitFor(
      page,
      (tabId) => !window.__zincTabs.tabs.some((tab) => tab.id === tabId),
      id,
      `test tab ${id} was not closed during cleanup`
    )
  }

  if (baseline.activeId) {
    await page.evaluate((id) => {
      if (window.__zincTabs.tabs.some((tab) => tab.id === id)) window.__zincTabs.switchTab(id)
    }, baseline.activeId)
  }

  const { version: _version, ...settingsPatch } = baseline.settings
  await page.evaluate((patch) => window.zinc.settings.updateImmediate(patch), settingsPatch)
  await waitFor(
    page,
    (expected) => {
      const actualPromise = window.zinc.settings.get()
      return Promise.resolve(actualPromise).then((actual) =>
        Object.entries(expected).every(([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value))
      )
    },
    settingsPatch,
    'settings were not restored after the smoke test'
  )

  const currentViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  if (currentViewport.width !== baseline.viewport.width || currentViewport.height !== baseline.viewport.height) {
    await page.setViewportSize(baseline.viewport)
  }

  if (baseline.view === 'settings') {
    await page.locator('[data-testid="open-settings"]').click()
    await page.locator('[data-testid="settings-back"]').waitFor({ state: 'visible' })
  }
}

export async function ensureTerminalView(page) {
  const view = await page.evaluate(() =>
    document.querySelector('[data-testid="settings-back"]') ? 'settings' : 'terminal'
  )

  if (view === 'settings') {
    await page.locator('[data-testid="settings-back"]').click()
  }

  await waitFor(
    page,
    () => {
      const activeId = window.__zincTabs.activeId
      const entry = activeId ? window.__zincRegistry.hosts?.get(activeId) : null
      return Boolean(entry && entry.state === 'ready' && entry.container.clientWidth > 0 && entry.container.clientHeight > 0)
    },
    undefined,
    'active terminal did not become visible and ready'
  )
}

export async function createTestTab(page) {
  const before = await page.evaluate(() => window.__zincTabs.tabs.map((tab) => tab.id))
  await page.evaluate(() => window.__zincTabs.addTab())
  await waitFor(
    page,
    (existingIds) => Boolean(window.__zincTabs.activeId && !existingIds.includes(window.__zincTabs.activeId)),
    before,
    'new test tab was not created'
  )
  const id = await page.evaluate(() => window.__zincTabs.activeId)
  assert(id, 'new test tab has an active id')
  await waitFor(
    page,
    (tabId) => {
      const entry = window.__zincRegistry.hosts?.get(tabId)
      return Boolean(entry && entry.state === 'ready' && entry.term.cols > 1 && entry.term.rows > 0)
    },
    id,
    'new test terminal did not become ready'
  )
  return id
}

/**
 * Builds a PowerShell expression whose source does not contain `text` in
 * plaintext. That distinction matters in terminal tests: PSReadLine echoes the
 * command being edited, so waiting for a literal embedded in the source can
 * succeed before PowerShell has executed anything.
 */
export function powerShellUtf8WriteLine(text) {
  const encoded = Buffer.from(text, 'utf8').toString('base64')
  return `[Console]::WriteLine([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))`
}

export async function runPowerShellCommand(page, tabId, command, marker, timeout = DEFAULT_TIMEOUT_MS) {
  assert(
    !command.includes(marker),
    'PowerShell command source does not contain its expected output marker',
    marker
  )

  const completionMarker = `ZINC-COMMAND-COMPLETE-${Date.now().toString(36)}-${++powerShellCommandSequence}`
  const submittedCommand = `${command}; ${powerShellUtf8WriteLine(completionMarker)}`

  await page.evaluate((id) => window.__zincRegistry.focus(id), tabId)
  await page.keyboard.insertText(submittedCommand)
  await page.keyboard.press('Enter')
  await waitFor(
    page,
    ({ id, text }) => window.__zincRegistry.getBufferText(id).includes(text),
    { id: tabId, text: completionMarker },
    `PowerShell completion marker for ${marker} was not observed`,
    timeout
  )

  const buffer = await page.evaluate((id) => window.__zincRegistry.getBufferText(id), tabId)
  assert(buffer.includes(marker), `terminal output marker ${marker} was observed after command completion`)
}

/**
 * Returns marker locations and buffer metadata without exposing the isolated
 * shell transcript (which can contain a local prompt path) in test logs.
 */
export async function terminalBufferTrace(page, tabId, markers) {
  return page.evaluate(({ id, expectedMarkers }) => {
    const entry = window.__zincRegistry.hosts?.get(id)
    if (!entry?.term) return null

    const normal = entry.term.buffer.normal
    const active = entry.term.buffer.active
    const lines = []
    for (let i = 0; i < normal.length; i++) {
      lines.push(normal.getLine(i)?.translateToString(true) ?? '')
    }

    return {
      state: entry.state,
      activeBuffer: active === normal ? 'normal' : active === entry.term.buffer.alternate ? 'alternate' : 'unknown',
      cols: entry.term.cols,
      rows: entry.term.rows,
      length: normal.length,
      baseY: normal.baseY,
      viewportY: normal.viewportY,
      cursorX: normal.cursorX,
      cursorY: normal.cursorY,
      markers: expectedMarkers.map((marker) => ({
        marker,
        lines: lines.flatMap((line, index) => (line.includes(marker) ? [index] : []))
      }))
    }
  }, { id: tabId, expectedMarkers: markers })
}

export async function terminalGeometry(page, tabId) {
  return page.evaluate((id) => {
    const entry = window.__zincRegistry.hosts?.get(id)
    if (!entry?.term?.element) return null
    const root = entry.term.element
    const viewport = root.querySelector('.xterm-viewport')
    const screen = root.querySelector('.xterm-screen')
    const rect = (element) => {
      if (!element) return null
      const value = element.getBoundingClientRect()
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height }
    }
    const cell = entry.term._core?._renderService?.dimensions?.css?.cell
    return {
      state: entry.state,
      cols: entry.term.cols,
      rows: entry.term.rows,
      scrollLeft: viewport?.scrollLeft ?? null,
      root: rect(root),
      viewport: rect(viewport),
      screen: rect(screen),
      canvases: screen ? Array.from(screen.querySelectorAll('canvas')).map(rect).filter(Boolean) : [],
      domRows: screen ? rect(screen.querySelector('.xterm-rows')) : null,
      domRowCount: screen ? screen.querySelector('.xterm-rows')?.childElementCount ?? 0 : 0,
      cell: cell ? { width: cell.width, height: cell.height } : null
    }
  }, tabId)
}

export function assertTerminalGeometry(geometry, label) {
  assert(geometry, `${label}: geometry snapshot exists`)
  assert(geometry.state === 'ready', `${label}: terminal host is ready`, String(geometry.state))
  assert(Number.isInteger(geometry.cols) && geometry.cols > 1, `${label}: terminal has valid columns`, String(geometry.cols))
  assert(Number.isInteger(geometry.rows) && geometry.rows > 0, `${label}: terminal has valid rows`, String(geometry.rows))
  assert(geometry.scrollLeft === 0, `${label}: xterm viewport is not horizontally scrolled`, String(geometry.scrollLeft))
  assert(geometry.viewport && geometry.screen, `${label}: viewport and screen geometry exist`)
  assert(geometry.cell && geometry.cell.width > 0 && geometry.cell.height > 0, `${label}: xterm cell metrics are valid`)

  const tolerance = 1.25
  assert(
    geometry.screen.left >= geometry.viewport.left - tolerance,
    `${label}: xterm screen left edge is inside the viewport`,
    `${geometry.screen.left} < ${geometry.viewport.left}`
  )
  assert(
    geometry.screen.right <= geometry.viewport.right + tolerance,
    `${label}: xterm screen right edge is inside the viewport`,
    `${geometry.screen.right} > ${geometry.viewport.right}`
  )
  // The product uses xterm's DOM renderer (the WebGL addon was deliberately
  // dropped in 9d6856d because it ignores theme alpha). Canvas layers only
  // exist if a canvas-based addon is ever reintroduced, so require the DOM
  // rows to have rendered and treat canvases as optional extra layers.
  if (geometry.canvases.length > 0) {
    for (const [index, canvas] of geometry.canvases.entries()) {
      assert(
        canvas.left >= geometry.viewport.left - tolerance && canvas.right <= geometry.viewport.right + tolerance,
        `${label}: canvas layer ${index} stays inside the viewport`,
        `${canvas.left}..${canvas.right} vs ${geometry.viewport.left}..${geometry.viewport.right}`
      )
    }
  } else {
    assert(
      geometry.domRows && geometry.domRowCount > 0,
      `${label}: xterm DOM renderer produced visible rows`,
      `rows=${geometry.domRowCount}`
    )
    assert(
      geometry.domRows.left >= geometry.viewport.left - tolerance && geometry.domRows.right <= geometry.viewport.right + tolerance,
      `${label}: DOM row layer stays inside the viewport`,
      `${geometry.domRows.left}..${geometry.domRows.right} vs ${geometry.viewport.left}..${geometry.viewport.right}`
    )
  }
}

export async function setSetting(page, key, value) {
  await page.evaluate(({ settingKey, settingValue }) => {
    window.zinc.settings.updateImmediate({ [settingKey]: settingValue })
  }, { settingKey: key, settingValue: value })
  await waitFor(
    page,
    ({ settingKey, settingValue }) => Promise.resolve(window.zinc.settings.get()).then(
      (settings) => JSON.stringify(settings[settingKey]) === JSON.stringify(settingValue)
    ),
    { settingKey: key, settingValue: value },
    `setting ${key} did not reach the expected value`
  )
}
