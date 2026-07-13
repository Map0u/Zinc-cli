/**
 * Background expression shared by every surface within one "layer" of the
 * window (the rail column, or the terminal card) — see M9's split of the old
 * single BackgroundOpacity into independent RailOpacity/TerminalOpacity.
 *
 * Electron's `backgroundMaterial: 'acrylic'` does not alpha-blend partially-
 * transparent web content with the native Mica surface behind it — confirmed
 * empirically: a `rgba(255,0,0,0.5)` test div, screenshotted with a real
 * (non-CDP) system capture, rendered as a fully opaque solid red rectangle
 * with zero backdrop bleeding through. Only a literal alpha of 0 lets the OS
 * backdrop show; any alpha > 0 renders fully opaque regardless of its numeric
 * value (this is a platform/compositor limitation, not a CSS bug here).
 *
 * Because of that, every surface belonging to the same layer (e.g. every
 * part of the rail: its header, its tab list) must derive its background
 * from the same opacity value, or "half raw Mica, half solid" seams appear
 * within what should read as one continuous surface.
 */
export function surfaceBackground(opacity: number, base: readonly [number, number, number]): string {
  const clamped = Math.max(0, Math.min(1, opacity))
  const [r, g, b] = base
  return `rgba(${r}, ${g}, ${b}, ${clamped})`
}

/**
 * A surface base tinted a little toward the scheme's own accent — used where
 * a layer needs to read as visually distinct from a sibling layer that
 * shares the same opacity (e.g. the canvas card floating over the terminal
 * card) without introducing a color outside the app's existing palette.
 */
export function accentTintedBase(
  base: readonly [number, number, number],
  accentHex: string,
  ratio: number
): [number, number, number] {
  const clean = accentHex.replace('#', '')
  const accentRgb: [number, number, number] = [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16)
  ]
  return [
    base[0] + (accentRgb[0] - base[0]) * ratio,
    base[1] + (accentRgb[1] - base[1]) * ratio,
    base[2] + (accentRgb[2] - base[2]) * ratio
  ]
}
