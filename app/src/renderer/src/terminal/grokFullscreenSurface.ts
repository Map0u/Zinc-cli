import type { AiCliTool } from '../../../shared/aiCliTools'
import { getColorScheme, resolveVariant, type ThemeMode } from '../colorSchemes'
import { shouldTransparentizeTerminalBackgrounds } from './transparentTerminalBackground'

/** The selectable scheme whose surface mirrors Grok Build's own TUI canvas. */
export const GROK_SCHEME_ID = 'grok'

export interface GrokSurfaceOptions {
  /** The GrokFullscreenSurfaceTint setting. */
  enabled: boolean
  hostReady: boolean
  bufferType: string
  /**
   * AI CLI detected in this tab's process tree, or null when nothing was
   * detected / the lookup has not answered yet. Only `'grok'` tints: every
   * other full-screen TUI paints its own colors over the whole card anyway,
   * or (vim, less, htop) is expected to inherit the app's palette.
   */
  tool: AiCliTool | null
  terminalOpacity: number
}

/**
 * Whether this tab's card should wear Grok's surface color instead of the
 * selected scheme's.
 *
 * Deliberately a no-op while the card is see-through: at TerminalOpacity 0 the
 * card shows raw Acrylic and Grok's own near-black background is already
 * rewritten to the transparent default (see transparentTerminalBackground), so
 * canvas and frame already match and there is no seam to hide. Tinting there
 * would only replace Acrylic with a flat grey.
 */
export function shouldTintSurfaceForGrok(options: GrokSurfaceOptions): boolean {
  return (
    options.enabled &&
    options.hostReady &&
    options.bufferType === 'alternate' &&
    options.tool === 'grok' &&
    !shouldTransparentizeTerminalBackgrounds(options.terminalOpacity)
  )
}

/**
 * The surface base a tab should paint with: Grok's when the tint is active,
 * otherwise the selected scheme's. Mode still follows the app (light/dark), so
 * a light Zinc gets GrokDay's base rather than being forced dark.
 */
export function surfaceBaseFor(
  tinted: boolean,
  schemeId: string | undefined,
  mode: ThemeMode
): readonly [number, number, number] {
  const scheme = getColorScheme(tinted ? GROK_SCHEME_ID : schemeId)
  return resolveVariant(scheme, mode).surfaceBase
}
