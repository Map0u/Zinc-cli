// Shared types for the pty bridge, imported by main, preload, and renderer.
// Kept dependency-free (no electron/node imports) so it can be pulled into
// any of the three build targets without pulling in the wrong runtime.

/** Options a caller provides when asking the registry to spawn a new shell. */
export interface PtySpawnOptions {
  /** Stable shell id resolved by the main process against this machine's discovery cache. */
  shellId?: string
  /** Working directory. Falls back to the user profile dir if invalid. */
  cwd?: string
  /** Optional command run via `-NoExit -Command <cmd>` right after the shell starts. */
  startupCommand?: string
}

/** Full session-creation payload sent to the main process (adds terminal size). */
export interface PtyCreateOptions extends PtySpawnOptions {
  cols: number
  rows: number
}

/** Appearance options pushed from settings into every open terminal (parity §2.3 `options`). */
export interface TerminalOptionsPush {
  fontFamily?: string
  fontSize?: number
  cursorBlink?: boolean
  scrollback?: number
  /** Palette id — see renderer/src/colorSchemes.ts. Main only forwards the id, never palette data. */
  colorScheme?: string
  /** 'auto' | 'light' | 'dark' — see shared/settingsTypes.ts's ThemePreference. */
  themeMode?: string
  /**
   * Terminal card opacity (0–1). When 0 the card is fully transparent over Acrylic;
   * the renderer then rewrites black TUI backgrounds so full-screen tools (Grok, …)
   * do not paint an opaque black panel over the material.
   */
  terminalOpacity?: number
}

/**
 * window.postMessage channel used to forward a session's MessagePort from
 * preload into the main world. contextBridge deep-clones function arguments
 * (see Electron's "Parameter / Error / Return Type support" docs), so a
 * MessagePort handed through a contextBridge-exposed callback arrives as an
 * inert plain object, not a live port — window.postMessage with a transfer
 * list is the documented workaround.
 */
export const PTY_PORT_MESSAGE_TYPE = 'zinc:pty-port'
