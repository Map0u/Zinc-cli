/**
 * When the terminal card is fully transparent (TerminalOpacity 0), Zinc shows
 * the OS Acrylic/Mica surface behind xterm. Full-screen TUIs (Grok, Claude,
 * Codex, …) still paint an opaque black (or near-black) cell background via
 * SGR / OSC 11, which covers that material and looks like a solid black panel.
 *
 * The right fix is not "force a dark solid terminal" or "raise opacity" — it is
 * to keep the terminal's *default* background transparent and rewrite
 * black/near-black *background* paints to the default background (SGR 49) so
 * those cells reveal Acrylic again. Foreground colors are left untouched.
 *
 * Enable only while TerminalOpacity is 0; with a solid card the TUI's own black
 * is correct and must not be rewritten.
 */

/** 256-color indices that are pure/near black (cube black + greyscale ramp head). */
const NEAR_BLACK_INDEXED = new Set<number>([0, 16, 232, 233, 234, 235])

/** Max channel for truecolor "near black" (Grok/Claude panels are often 0 or very dark). */
const NEAR_BLACK_RGB_MAX = 40

export function isNearBlackRgb(r: number, g: number, b: number): boolean {
  if (![r, g, b].every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) return false
  return Math.max(r, g, b) <= NEAR_BLACK_RGB_MAX
}

export function isNearBlackIndexed(index: number): boolean {
  return NEAR_BLACK_INDEXED.has(index)
}

/** Near-black check for a colon-form color operand (`5:n`, `2:r:g:b`, `2:cs:r:g:b`). */
function isNearBlackColonColor(sub: readonly number[]): boolean {
  if (sub[0] === 5) return sub.length >= 2 && isNearBlackIndexed(sub[1])
  if (sub[0] === 2) {
    // ITU form carries a color-space id first: 48:2:<cs>:r:g:b (cs may be empty).
    if (sub.length >= 5) return isNearBlackRgb(sub[2], sub[3], sub[4])
    if (sub.length === 4) return isNearBlackRgb(sub[1], sub[2], sub[3])
  }
  return false
}

/**
 * Rewrite SGR parameter lists so black/near-black *backgrounds* become the
 * default background (49). Returns null when nothing changed.
 *
 * Accepts the public xterm.js CSI handler shape: a flat-ish list of numbers
 * and colon-style subparam arrays (`48;2;r;g;b` or `48:[2,r,g,b]`).
 *
 * Extended colors (38 foreground, 48 background, 58 underline) consume their
 * operands as a unit, so an operand that happens to be 40 or 48 (e.g. the
 * channel values in `38;2;40;40;40`) is never mistaken for a command; only a
 * real 40 / 48 background is rewritten.
 */
export function rewriteSgrParamsForTransparentBg(
  params: ReadonlyArray<number | number[]>
): (number | number[])[] | null {
  if (params.length === 0) return null

  const out: (number | number[])[] = []
  let changed = false

  for (let i = 0; i < params.length; i++) {
    const p = params[i]

    // A stray subparam group with no command in front of it: keep as-is.
    if (Array.isArray(p)) {
      out.push(p)
      continue
    }

    // SGR 40 = classic black background → default background.
    if (p === 40) {
      out.push(49)
      changed = true
      continue
    }

    if (p !== 38 && p !== 48 && p !== 58) {
      out.push(p)
      continue
    }

    const isBackground = p === 48
    const next = params[i + 1]

    // 48:5:n / 48:2:r:g:b / 48:2:cs:r:g:b
    if (Array.isArray(next)) {
      i += 1
      if (isBackground && isNearBlackColonColor(next)) {
        out.push(49)
        changed = true
      } else {
        out.push(p, next)
      }
      continue
    }

    // 48;5;n
    if (next === 5 && typeof params[i + 2] === 'number') {
      const index = params[i + 2] as number
      i += 2
      if (isBackground && isNearBlackIndexed(index)) {
        out.push(49)
        changed = true
      } else {
        out.push(p, 5, index)
      }
      continue
    }

    // 48;2;r;g;b
    if (
      next === 2 &&
      typeof params[i + 2] === 'number' &&
      typeof params[i + 3] === 'number' &&
      typeof params[i + 4] === 'number'
    ) {
      const r = params[i + 2] as number
      const g = params[i + 3] as number
      const b = params[i + 4] as number
      i += 4
      if (isBackground && isNearBlackRgb(r, g, b)) {
        out.push(49)
        changed = true
      } else {
        out.push(p, 2, r, g, b)
      }
      continue
    }

    out.push(p)
  }

  return changed ? out : null
}

/**
 * Serialize SGR params back to a CSI parameter string. Colon-style subparams
 * are flattened to the semicolon form xterm.js accepts (`48;2;r;g;b`).
 */
export function formatSgrParams(params: ReadonlyArray<number | number[]>): string {
  const flat: number[] = []
  for (const p of params) {
    if (Array.isArray(p)) flat.push(...p)
    else flat.push(p)
  }
  return flat.join(';')
}

/**
 * True when the terminal card itself is fully transparent (Acrylic shows
 * through). Any TerminalOpacity > 0 paints a solid CSS surface behind xterm
 * (see chromeBackground.ts) — black TUI cells are then correct as-is.
 */
export function shouldTransparentizeTerminalBackgrounds(terminalOpacity: number): boolean {
  return terminalOpacity <= 0
}

/**
 * The `background` Zinc hands xterm's theme.
 *
 * xterm does not only paint cells with this — it also derives the color of
 * *inverse* text (SGR 7) that kept the default background from it:
 *
 *   .xterm-fg-257 { color: opaque(theme.background) }
 *
 * and xterm's `opaque()` composites onto black, so a fully transparent
 * background collapses to #000000. Such a cell simultaneously takes
 * theme.foreground as its *background* — on a light scheme that is a solid
 * dark bar with pure-black, unreadable glyphs inside it. So whenever the
 * terminal card is opaque we must hand xterm the scheme's real surface color;
 * only a see-through card (TerminalOpacity 0, Acrylic behind) needs the
 * transparent value, and there xterm's foreground/background are close enough
 * in tone that inverse stays legible.
 */
export function terminalThemeBackground(
  terminalOpacity: number,
  surfaceBase: readonly [number, number, number]
): string {
  const [r, g, b] = surfaceBase.map((n) =>
    Math.round(Math.max(0, Math.min(255, Number.isFinite(n) ? n : 0)))
  )
  // See-through card: alpha 0 so Acrylic shows, but keep the surface RGB —
  // xterm's opaque() only forces alpha to 255, so inverse text (and the
  // WebGL glyph atlas, which the index.css override cannot reach) still gets
  // the scheme's real surface color instead of black.
  if (shouldTransparentizeTerminalBackgrounds(terminalOpacity)) return `rgba(${r}, ${g}, ${b}, 0)`
  return `rgb(${r}, ${g}, ${b})`
}
