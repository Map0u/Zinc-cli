/**
 * Regression smoke for the Grok full-screen surface tint (0.6.11).
 *
 * With the setting on, a tab running Grok's full-screen TUI must paint the
 * terminal card — and xterm's own background, and the colour inverse text is
 * derived from — with Grok's surface colour instead of the selected scheme's,
 * so Grok's self-painted canvas doesn't sit inside a differently coloured
 * frame. Everything must revert when the TUI exits, and the whole feature must
 * stay inert while the card is see-through.
 *
 * Grok itself is not installed here, and `window.zinc.pty` is a frozen
 * contextBridge object so its tool lookup cannot be stubbed. The smoke instead
 * lets the real buffer switch and the real (empty) tool lookup happen, then
 * writes the answer a real Grok tab would have got onto the host entry and asks
 * the registry to re-evaluate. Everything downstream is production code: the
 * decision function, retheme, the surface-tint event and React's re-render.
 * Whether the process-tree scan actually recognises Grok is covered by the
 * packaged VM run, not by CI.
 */
import {
  assert,
  createTestTab,
  requireIsolatedTestProfile,
  runSmoke,
  setSetting,
  waitFor
} from './tests/cdp/smoke-helpers.mjs'

/** colorSchemes.ts: GROK dark/light surfaceBase, and Rosé Pine dark's. */
const GROK_DARK = 'rgb(20, 20, 20)'
const SCHEME_DARK = 'rgb(30, 26, 36)'
// The CSS variable is read back as the raw inline value surfaceBackground()
// writes (always rgba with an explicit alpha), not a computed colour.
const GROK_DARK_VAR = 'rgba(20, 20, 20, 1)'
const SCHEME_DARK_VAR = 'rgba(30, 26, 36, 1)'
const SCHEME_ID = 'rosePine'

const ENTER_ALTERNATE = '\u001b[?1049h'
const LEAVE_ALTERNATE = '\u001b[?1049l'

async function switchBuffer(page, tabId, sequence) {
  await page.evaluate(({ id, data }) => {
    window.__zincRegistry.hosts.get(id).term.write(data)
  }, { id: tabId, data: sequence })
}

/**
 * Enters the alternate buffer the way a full-screen TUI does, waits for the
 * registry's own (here fruitless) tool lookup to settle, then supplies the
 * answer a Grok tab would have produced and re-runs the registry's evaluation.
 */
async function enterGrokFullscreen(page, tabId) {
  await switchBuffer(page, tabId, ENTER_ALTERNATE)
  await waitFor(
    page,
    (id) => window.__zincRegistry.hosts.get(id)?.term.buffer.active.type === 'alternate',
    tabId,
    'the terminal did not enter the alternate buffer'
  )
  await page.waitForTimeout(600)
  await page.evaluate((id) => {
    const registry = window.__zincRegistry
    const entry = registry.hosts.get(id)
    entry.tool = 'grok'
    registry.syncFullscreenState(entry)
  }, tabId)
}

/** The three colours that must move together, plus the buffer the tab is on. */
async function readSurface(page, tabId) {
  return page.evaluate((id) => {
    const entry = window.__zincRegistry.hosts.get(id)
    // The card is the ancestor that carries the inverse-text variable.
    let card = entry.container
    while (card && !card.style.getPropertyValue('--zinc-terminal-inverse-fg')) {
      card = card.parentElement
    }
    return {
      buffer: entry.term.buffer.active.type,
      themeBackground: String(entry.term.options.theme?.background ?? ''),
      cardBackground: card ? window.getComputedStyle(card).backgroundColor : null,
      inverseFg: card
        ? card.style.getPropertyValue('--zinc-terminal-inverse-fg').trim()
        : null
    }
  }, tabId)
}

/**
 * Waits for both the inline variable and the *painted* card colour. The card
 * fades over 220ms (index.css / App.tsx), so the computed value trails the
 * inline one by a few frames — reading it immediately returns a blend.
 */
async function waitForCard(page, tabId, variable, painted, message) {
  await waitFor(
    page,
    ({ id, want, paintedWant }) => {
      const entry = window.__zincRegistry.hosts.get(id)
      if (!entry) return false
      let card = entry.container
      while (card && !card.style.getPropertyValue('--zinc-terminal-inverse-fg')) {
        card = card.parentElement
      }
      if (!card) return false
      return (
        card.style.getPropertyValue('--zinc-terminal-inverse-fg').trim() === want &&
        window.getComputedStyle(card).backgroundColor === paintedWant
      )
    },
    { id: tabId, want: variable, paintedWant: painted },
    message
  )
}

if (requireIsolatedTestProfile()) {
  await runSmoke('Zinc Grok full-screen surface tint', async ({ page }) => {
    await setSetting(page, 'ColorScheme', SCHEME_ID)
    await setSetting(page, 'ThemePreference', 'dark')
    await setSetting(page, 'TerminalOpacity', 1)
    await setSetting(page, 'GrokFullscreenSurfaceTint', true)

    const tabId = await createTestTab(page)

    const before = await readSurface(page, tabId)
    assert(before.buffer === 'normal', 'the tab starts on the normal buffer')
    assert(
      before.inverseFg === SCHEME_DARK_VAR,
      'the card starts on the selected scheme surface',
      String(before.inverseFg)
    )

    await enterGrokFullscreen(page, tabId)
    await waitForCard(page, tabId, GROK_DARK_VAR, GROK_DARK, 'the card did not take Grok’s surface colour')
    const tinted = await readSurface(page, tabId)
    console.log(
      `trace: tinted: card=${tinted.cardBackground} theme=${tinted.themeBackground} inverse=${tinted.inverseFg}`
    )
    assert(tinted.cardBackground === GROK_DARK, 'the card paints Grok’s surface', String(tinted.cardBackground))
    assert(
      tinted.themeBackground === GROK_DARK,
      'xterm’s own background moves with the card (no seam, and inverse text stays derived from the right surface)',
      tinted.themeBackground
    )

    await switchBuffer(page, tabId, LEAVE_ALTERNATE)
    await waitForCard(page, tabId, SCHEME_DARK_VAR, SCHEME_DARK, 'the card did not revert when the TUI exited')
    const reverted = await readSurface(page, tabId)
    assert(
      reverted.themeBackground === SCHEME_DARK,
      'xterm’s background reverts with it',
      reverted.themeBackground
    )

    // A see-through card already shows Acrylic through Grok's own rewritten
    // background, so the tint must stay out of it entirely.
    await setSetting(page, 'TerminalOpacity', 0)
    await enterGrokFullscreen(page, tabId)
    const seeThrough = await readSurface(page, tabId)
    console.log(`trace: opacity 0: theme=${seeThrough.themeBackground} inverse=${seeThrough.inverseFg}`)
    assert(
      seeThrough.inverseFg === SCHEME_DARK_VAR,
      'a see-through card is never tinted for Grok',
      String(seeThrough.inverseFg)
    )
    await switchBuffer(page, tabId, LEAVE_ALTERNATE)

    // With the setting off the tab must behave exactly as before the feature.
    await setSetting(page, 'TerminalOpacity', 1)
    await setSetting(page, 'GrokFullscreenSurfaceTint', false)
    await enterGrokFullscreen(page, tabId)
    const disabled = await readSurface(page, tabId)
    assert(
      disabled.inverseFg === SCHEME_DARK_VAR && disabled.themeBackground === SCHEME_DARK,
      'the setting off leaves the scheme surface in place',
      `${disabled.inverseFg} / ${disabled.themeBackground}`
    )

    await switchBuffer(page, tabId, LEAVE_ALTERNATE)
  })
}
