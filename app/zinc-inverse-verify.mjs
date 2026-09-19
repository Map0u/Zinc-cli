/**
 * Regression smoke for the "solid colour bar" bug (0.6.10).
 *
 * Reproduction conditions, both required:
 *   1. a LIGHT colour scheme is in effect (ThemePreference light, or a light OS
 *      theme with ThemePreference auto),
 *   2. the TUI emits inverse text (SGR 7) that keeps the default background.
 *      Claude Code styles whole blocks that way.
 *
 * TerminalOpacity does NOT gate it: a clean 0.6.9 install at the shipping
 * default (0) reproduces the bar just as an opacity-1 card does.
 *
 * Before the fix, themeFor() handed xterm `rgba(0, 0, 0, 0)` as theme.background
 * regardless of opacity. xterm derives inverse text colour from it via
 * `.xterm-fg-257 { color: opaque(theme.background) }`, and its `opaque()`
 * composites onto black — so the glyphs became #000000 while the same cell took
 * theme.foreground (#2A2520 on Vesper light) as its background. Unreadable:
 * a solid dark bar. Dark schemes hid it because their surface is near-black
 * anyway. Earlier fixes in this area all targeted the SGR-rewrite path that
 * only runs at TerminalOpacity 0, which is why they never touched this.
 *
 * This smoke asserts the rendered contrast, not the internals: whatever xterm
 * does, an inverse run must stay legible.
 */
import {
  assert,
  createTestTab,
  requireIsolatedTestProfile,
  runSmoke,
  setSetting,
  waitFor
} from './tests/cdp/smoke-helpers.mjs'

/** Inverse text must clear WCAG AA for large text; the bug scored ~1.1. */
const MIN_CONTRAST_RATIO = 3

const LIGHT_SCHEME = 'vesper'

function parseCssRgb(value) {
  const match = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)/i.exec(value ?? '')
  if (!match) return null
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4])
  }
}

function relativeLuminance({ r, g, b }) {
  const channel = (raw) => {
    const c = raw / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg)
  const b = relativeLuminance(bg)
  const [lighter, darker] = a >= b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

function describe(color) {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
}

/**
 * Writes an inverse run straight into xterm. Going through the pty would add a
 * shell's quoting rules for ESC without testing anything extra: the bug lives
 * entirely in how xterm resolves colours for a cell that is already inverse.
 */
async function writeInverseRun(page, tabId, marker) {
  await page.evaluate(({ id, text }) => {
    const entry = window.__zincRegistry.hosts?.get(id)
    entry.term.write(`\r\n\u001b[7m${text}\u001b[0m\r\n`)
  }, { id: tabId, text: marker })

  await waitFor(
    page,
    ({ id, text }) => window.__zincRegistry.getBufferText(id).includes(text),
    { id: tabId, text: marker },
    'inverse run did not reach the terminal buffer'
  )

  // The DOM renderer repaints on an animation frame, so the buffer can hold the
  // run before any span carries it.
  await waitFor(
    page,
    ({ id, text }) => {
      const entry = window.__zincRegistry.hosts?.get(id)
      if (!entry) return false
      return Array.from(entry.container.querySelectorAll('span')).some(
        (node) => (node.textContent ?? '').includes(text)
      )
    },
    { id: tabId, text: marker },
    'inverse run was not painted into a DOM span'
  )
}

/** Resolves the painted colours of the span carrying the inverse marker. */
async function measureInverseRun(page, tabId, marker) {
  return page.evaluate(({ id, text }) => {
    const entry = window.__zincRegistry.hosts?.get(id)
    const root = entry.container
    const spans = Array.from(root.querySelectorAll('span'))
    const span = spans.find((node) => node.textContent && node.textContent.includes(text))
    if (!span) return { found: false }

    const style = window.getComputedStyle(span)
    // Walk up for the first non-transparent background: the DOM renderer paints
    // the cell background on the span itself, but fall back to the row/screen.
    let backgroundColor = style.backgroundColor
    let node = span
    while (node && /rgba\(0,\s*0,\s*0,\s*0\)|transparent/i.test(backgroundColor)) {
      node = node.parentElement
      if (!node) break
      backgroundColor = window.getComputedStyle(node).backgroundColor
    }

    return {
      found: true,
      color: style.color,
      backgroundColor,
      className: span.className
    }
  }, { id: tabId, text: marker })
}

async function assertLegibleInverse(page, tabId, label) {
  const marker = `ZINCINV${Date.now().toString(36).toUpperCase()}`
  await writeInverseRun(page, tabId, marker)
  const measured = await measureInverseRun(page, tabId, marker)

  assert(measured.found, `${label}: the inverse run is rendered as a DOM span`)

  const fg = parseCssRgb(measured.color)
  const bg = parseCssRgb(measured.backgroundColor)
  assert(fg, `${label}: inverse foreground resolves to a colour`, String(measured.color))
  assert(bg, `${label}: inverse background resolves to a colour`, String(measured.backgroundColor))

  const ratio = contrastRatio(fg, bg)
  console.log(
    `trace: ${label}: fg=${describe(fg)} bg=${describe(bg)} ratio=${ratio.toFixed(2)} class="${measured.className}"`
  )
  assert(
    ratio >= MIN_CONTRAST_RATIO,
    `${label}: inverse text stays legible against its own cell background`,
    `ratio=${ratio.toFixed(2)} fg=${describe(fg)} bg=${describe(bg)}`
  )
}

/**
 * Negative control. Puts back the one value the fix changed — a transparent
 * theme.background on an opaque card — and asserts the bar comes straight back.
 * Without this the smoke could pass for reasons unrelated to the fix.
 */
async function assertPreFixThemeStillReproducesTheBar(page, tabId, label) {
  const restored = await page.evaluate((id) => {
    const entry = window.__zincRegistry.hosts?.get(id)
    const previous = entry.term.options.theme
    // Undo both halves of the fix: the theme background xterm derives inverse
    // text from, and the stylesheet variable that overrides the result. A
    // non-colour token makes `color: var(...)` invalid at computed-value time,
    // so the override stops applying — as if the rule were not there.
    entry.term.options.theme = { ...previous, background: 'rgba(0, 0, 0, 0)' }
    entry.container.style.setProperty('--zinc-terminal-inverse-fg', 'notacolor')
    return previous?.background ?? null
  }, tabId)

  const marker = `ZINCBUG${Date.now().toString(36).toUpperCase()}`
  await writeInverseRun(page, tabId, marker)
  const measured = await measureInverseRun(page, tabId, marker)
  assert(measured.found, `${label}: the control inverse run is rendered`)

  const fg = parseCssRgb(measured.color)
  const bg = parseCssRgb(measured.backgroundColor)
  const ratio = fg && bg ? contrastRatio(fg, bg) : Number.NaN
  console.log(`trace: ${label}: fg=${describe(fg)} bg=${describe(bg)} ratio=${ratio.toFixed(2)}`)
  assert(
    ratio < MIN_CONTRAST_RATIO,
    `${label}: the pre-fix transparent background still reproduces the unreadable bar`,
    `ratio=${ratio.toFixed(2)}`
  )

  await page.evaluate(({ id, background }) => {
    const entry = window.__zincRegistry.hosts?.get(id)
    entry.term.options.theme = { ...entry.term.options.theme, background }
    entry.container.style.removeProperty('--zinc-terminal-inverse-fg')
  }, { id: tabId, background: restored })
}

if (requireIsolatedTestProfile()) {
  await runSmoke('Zinc inverse-text legibility (solid colour bar regression)', async ({ page }) => {
    await setSetting(page, 'ColorScheme', LIGHT_SCHEME)
    await setSetting(page, 'ThemePreference', 'light')

    const tabId = await createTestTab(page)

    await setSetting(page, 'TerminalOpacity', 1)
    await assertLegibleInverse(page, tabId, 'light scheme, opaque card')
    await assertPreFixThemeStillReproducesTheBar(page, tabId, 'negative control')

    await setSetting(page, 'TerminalOpacity', 0.5)
    await assertLegibleInverse(page, tabId, 'light scheme, half-opacity card')

    // The shipping default. xterm's theme background must stay transparent
    // here, so legibility rests entirely on the stylesheet override.
    await setSetting(page, 'TerminalOpacity', 0)
    await assertLegibleInverse(page, tabId, 'light scheme, see-through card (shipping default)')

    // The dark scheme never showed the bug, but it must not regress either.
    await setSetting(page, 'ThemePreference', 'dark')
    await setSetting(page, 'TerminalOpacity', 1)
    await assertLegibleInverse(page, tabId, 'dark scheme, opaque card')

    await setSetting(page, 'TerminalOpacity', 0)
    await assertLegibleInverse(page, tabId, 'dark scheme, see-through card')
  })
}
