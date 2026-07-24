import type { BrowserWindow } from 'electron'

/**
 * Wires up runtime behavior for the Acrylic backdrop on an *already*
 * constructed window.
 *
 * electron-spike/MATERIAL-RESULT.md's conclusion A: `backgroundMaterial:
 * 'acrylic'` only renders if passed to the `BrowserWindow` constructor
 * itself (this module does not — and must not — set it for the first time
 * here); `transparent`/`backgroundColor` in that same constructor call would
 * paint an opaque surface over the material. This module's only remaining
 * job is the defensive re-apply on `restore` *and* `focus`: the spike
 * observed both a minimize/restore cycle and a focus-loss cycle silently
 * degrading Acrylic to a solid fill.
 *
 * There used to also be a KeepBackdropWhenUnfocused-driven visibility flag
 * pushed to the renderer, so losing focus could paint the rail/terminal
 * opaque instead of raw Mica. Removed (M9): RailOpacity/TerminalOpacity now
 * each render as a plain rgba over the backdrop regardless of focus state,
 * so there's no longer a distinct "hidden" state for this module to report.
 */
export function applyWindowMaterial(win: BrowserWindow): void {
  if (process.platform !== 'win32') return

  win.on('restore', () => {
    if (!win.isDestroyed()) win.setBackgroundMaterial('acrylic')
  })
  win.on('focus', () => {
    // Same defensive re-apply as `restore` — MATERIAL-RESULT.md observed the
    // backdrop can also degrade to a solid fill after a focus-loss cycle,
    // not just minimize/restore.
    if (!win.isDestroyed()) win.setBackgroundMaterial('acrylic')
  })
}
