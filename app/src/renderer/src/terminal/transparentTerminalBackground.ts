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

/**
 * Rewrite SGR parameter lists so black/near-black *backgrounds* become the
 * default background (49). Returns null when nothing changed.
 *
 * Accepts the public xterm.js CSI handler shape: a flat-ish list of numbers
 * and colon-style subparam arrays (`48;2;r;g;b` or `48:[2,r,g,b]`).
 */
export function rewriteSgrParamsForTransparentBg(
  params: ReadonlyArray<number | number[]>
): (number | number[])[] | null {
  if (params.length === 0) return null

  const out: (number | number[])[] = []
  let changed = false

  for (let i = 0; i < params.length; i++) {
    const p = params[i]

    // Colon form at the top level is rare; leave it alone unless it's clearly 48:…
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

    // Extended background: 48;5;n  /  48;2;r;g;b  /  48 with subparams.
    if (p === 48) {
      const next = params[i + 1]

      // 48:[5, n] or 48:[2, r, g, b]
      if (Array.isArray(next)) {
        if (next[0] === 5 && next.length >= 2 && isNearBlackIndexed(next[1])) {
          out.push(49)
          i += 1
          changed = true
          continue
        }
        if (
          next[0] === 2 &&
          next.length >= 4 &&
          isNearBlackRgb(next[1], next[2], next[3])
        ) {
          out.push(49)
          i += 1
          changed = true
          continue
        }
        out.push(48, next)
        i += 1
        continue
      }

      // 48;5;n
      if (next === 5 && typeof params[i + 2] === 'number') {
        const index = params[i + 2] as number
        if (isNearBlackIndexed(index)) {
          out.push(49)
          i += 2
          changed = true
          continue
        }
        out.push(48, 5, index)
        i += 2
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
        if (isNearBlackRgb(r, g, b)) {
          out.push(49)
          i += 4
          changed = true
          continue
        }
        out.push(48, 2, r, g, b)
        i += 4
        continue
      }

      out.push(48)
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
