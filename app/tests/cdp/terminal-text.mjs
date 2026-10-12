// Renderer-independent "what does the terminal show" helpers for CDP scripts.
//
// Why: the foreground terminal may use the xterm WebGL renderer, which draws to
// a <canvas> and has no `.xterm-rows` DOM, so scraping those rows only works
// with the DOM renderer. A packaged build also has no `window.__zincRegistry`
// (dev-only hook in App.tsx). Strategies, tried in this order:
//
//   1. registry   dev builds: window.__zincRegistry.getBufferText(activeTab)
//                 (full scrollback + viewport, straight from the xterm buffer)
//   2. dom        DOM renderer: text of the visible `.xterm-rows`
//   3. selection  any renderer, packaged or dev: drag-select the visible
//                 terminal screen with the mouse, copy with Ctrl+Shift+C (the
//                 product's own copy path -> main-process clipboard), read it
//                 back through window.zinc.clipboard.readText. Viewport only;
//                 the previous clipboard text is restored afterwards.
//
// The selection strategy needs nothing from app/src and works on a packaged
// Zinc, but it takes over the system clipboard for a moment.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Dev-only: buffer text of the active tab, or null when the hook is absent. */
async function readViaRegistry(page) {
  return page.evaluate(() => {
    const registry = window.__zincRegistry
    const activeId = window.__zincTabs?.activeId
    if (!registry || typeof registry.getBufferText !== 'function' || !activeId) return null
    return registry.getBufferText(activeId)
  })
}

/** DOM renderer only: text of visible `.xterm-rows`, or null when none exist. */
async function readViaDom(page) {
  return page.evaluate(() => {
    const shown = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
    const roots = Array.from(document.querySelectorAll('.xterm')).filter(shown)
    const rows = roots.flatMap((root) => {
      const rowRoot = root.querySelector('.xterm-rows')
      return rowRoot ? [Array.from(rowRoot.children).map((row) => (row.textContent ?? '').replace(/\s+$/g, ''))] : []
    })
    return rows.length > 0 ? rows.map((r) => r.join('\n')).join('\n=====\n') : null
  })
}

/**
 * Renderer-independent: select the whole visible screen, copy through the
 * product's Ctrl+Shift+C, read the clipboard back. `forceSelection`: 'auto'
 * (default), true (Shift+drag only) or false (plain drag only).
 */
async function selectAndCopy(page, box, forceSelection) {
  const sentinel = `__zinc-read-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const previous = await page.evaluate(() => window.zinc?.clipboard?.readText?.() ?? null)
  const wrote = await page.evaluate((text) => window.zinc?.clipboard?.writeText?.(text) ?? false, sentinel)
  if (!wrote) return null
  try {
    if (forceSelection) await page.keyboard.down('Shift')
    try {
      await page.mouse.move(box.x + 1, box.y + 1)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width - 1, box.y + box.height - 1, { steps: 6 })
      await page.mouse.up()
    } finally {
      if (forceSelection) await page.keyboard.up('Shift')
    }
    await page.keyboard.press('Control+Shift+C')

    // copySelection() writes asynchronously; wait for the sentinel to be replaced.
    const deadline = Date.now() + 1500
    while (Date.now() < deadline) {
      const text = await page.evaluate(() => window.zinc.clipboard.readText())
      if (typeof text === 'string' && text !== sentinel) return text.replace(/\r\n/g, '\n')
      await sleep(80)
    }
    return null
  } finally {
    // Never leave the sentinel behind; put back whatever was on the clipboard.
    await page.evaluate((text) => window.zinc?.clipboard?.writeText?.(text ?? ''), previous).catch(() => {})
  }
}

async function readViaSelection(page, { forceSelection = 'auto' } = {}) {
  const box = await page.evaluate(() => {
    const shown = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
    const screen = Array.from(document.querySelectorAll('.xterm-screen')).find(shown)
    if (!screen) return null
    const r = screen.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })
  if (!box || box.width < 8 || box.height < 8) return null

  // Shift+drag selects even while a TUI has mouse reporting on, but with
  // reporting off xterm treats Shift+mousedown as "extend selection" and
  // selects nothing. So 'auto' tries Shift first (harmless when reporting is
  // off), then a plain drag.
  const attempts = forceSelection === 'auto' ? [true, false] : [Boolean(forceSelection)]
  for (const force of attempts) {
    const text = await selectAndCopy(page, box, force)
    if (typeof text === 'string') return text
  }
  return null
}

/**
 * Returns the visible terminal text, or throws if no strategy can read it.
 * `strategy`: 'auto' (default) | 'registry' | 'dom' | 'selection'.
 */
export async function readTerminalText(page, { strategy = 'auto', forceSelection = 'auto' } = {}) {
  const order = strategy === 'auto' ? ['registry', 'dom', 'selection'] : [strategy]
  for (const name of order) {
    const text =
      name === 'registry'
        ? await readViaRegistry(page)
        : name === 'dom'
          ? await readViaDom(page)
          : await readViaSelection(page, { forceSelection })
    if (typeof text === 'string') return text
  }
  throw new Error(`Could not read terminal text (strategies tried: ${order.join(', ')}).`)
}

/** Terminal text as an array of rows (trailing whitespace trimmed). */
export async function readTerminalRows(page, options) {
  const text = await readTerminalText(page, options)
  return text.split('\n').map((row) => row.replace(/\s+$/g, ''))
}

/** Polls readTerminalText until predicate(text) is true; throws with the last text on timeout. */
export async function waitForTerminalText(page, predicate, { timeout = 20_000, interval = 400, message = 'terminal text', ...options } = {}) {
  const deadline = Date.now() + timeout
  let last = ''
  while (Date.now() < deadline) {
    try {
      last = await readTerminalText(page, options)
      if (predicate(last)) return last
    } catch {
      // Not readable yet (page still loading); keep polling until the deadline.
    }
    await sleep(interval)
  }
  throw new Error(`Timed out after ${timeout}ms waiting for ${message}. Last text: ${JSON.stringify(last.slice(-300))}`)
}
