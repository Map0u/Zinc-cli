import type { AiCliTool } from '../../../shared/aiCliTools'

/** CSI sequences Kimi (and most full-screen TUIs) treat as PageUp / PageDown. */
export const PAGE_UP = '\x1b[5~'
export const PAGE_DOWN = '\x1b[6~'

/** Windows WM_MOUSEWHEEL notch. Chromium pixel-mode wheel events use this. */
export const PIXEL_NOTCH = 120

/** Default Windows "lines per notch"; used to scale DOM_DELTA_LINE into notches. */
export const LINES_PER_NOTCH = 3

export const DOM_DELTA_PIXEL = 0
export const DOM_DELTA_LINE = 1
export const DOM_DELTA_PAGE = 2

export interface WheelPagerState {
  acc: number
}

export function createWheelPagerState(): WheelPagerState {
  return { acc: 0 }
}

export interface WheelInterceptOptions {
  enabled: boolean
  hostReady: boolean
  bufferType: string
  /**
   * AI CLI detected in this tab's process tree, or null when nothing was
   * detected / the lookup failed / it has not answered yet. Only `'kimi'`
   * intercepts: vim, less, htop and the Codex/Grok TUIs all use the alternate
   * buffer too and must keep xterm's native line scrolling.
   */
  tool: AiCliTool | null
}

export function shouldInterceptKimiFullscreenWheel(options: WheelInterceptOptions): boolean {
  return (
    options.enabled &&
    options.hostReady &&
    options.bufferType === 'alternate' &&
    options.tool === 'kimi'
  )
}

export type WheelDecision = {
  /** Steal the event from xterm / the compositor even if this tick does not page. */
  consume: boolean
  sequence: string | null
}

/**
 * Convert one wheel event into at most one PgUp/PgDn. Sub-notch movement is
 * accumulated so a trackpad flick pages in discrete steps instead of once per
 * pixel; a direction change discards the leftover. `deltaY === 0` never pages.
 *
 * Callers that intercept must still consume when `sequence` is null — otherwise
 * xterm turns the leftover into ↑/↓ or a viewport twitch.
 */
export function decideKimiFullscreenWheel(
  options: WheelInterceptOptions,
  state: WheelPagerState,
  deltaY: number,
  deltaMode: number
): WheelDecision {
  if (!shouldInterceptKimiFullscreenWheel(options)) {
    state.acc = 0
    return { consume: false, sequence: null }
  }

  const dir = consumeWheelNotch(state, deltaY, deltaMode)
  return { consume: true, sequence: dir === 'up' ? PAGE_UP : dir === 'down' ? PAGE_DOWN : null }
}

export function consumeWheelNotch(
  state: WheelPagerState,
  deltaY: number,
  deltaMode: number
): 'up' | 'down' | null {
  if (deltaY === 0 || !Number.isFinite(deltaY)) return null

  const units = wheelUnits(deltaY, deltaMode)
  if (units === 0) return null

  if (state.acc !== 0 && Math.sign(units) !== Math.sign(state.acc)) {
    state.acc = 0
  }
  state.acc += units

  if (Math.abs(state.acc) < PIXEL_NOTCH) return null

  const dir = state.acc < 0 ? 'up' : 'down'
  // At most one page per event so a synthetic burst (deltaY = ±1200) or a
  // pixel-mode flick does not dump a stack of PgUp into the pty at once.
  state.acc -= Math.sign(state.acc) * PIXEL_NOTCH
  return dir
}

function wheelUnits(deltaY: number, deltaMode: number): number {
  if (deltaMode === DOM_DELTA_PAGE) {
    return Math.sign(deltaY) * PIXEL_NOTCH * Math.max(1, Math.round(Math.abs(deltaY)))
  }
  if (deltaMode === DOM_DELTA_LINE) {
    return (deltaY / LINES_PER_NOTCH) * PIXEL_NOTCH
  }
  return deltaY
}
