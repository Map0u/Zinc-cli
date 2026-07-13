// Shared keybinding types/defaults, imported by main, preload, and renderer.
// Kept dependency-free like settingsTypes.ts (no electron/node imports).

/** Every user-rebindable action (parity §1.6 — 0.2.0 new configurable shortcut system). */
export type ShortcutAction =
  | 'newTab'
  | 'closeTab'
  | 'nextTab'
  | 'prevTab'
  | 'gotoTab1'
  | 'gotoTab2'
  | 'gotoTab3'
  | 'gotoTab4'
  | 'gotoTab5'
  | 'gotoTab6'
  | 'gotoTab7'
  | 'gotoTab8'
  | 'gotoTab9'
  | 'openSettings'
  | 'cloneTab'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetZoom'

/** Map of action -> normalized accelerator string (e.g. "Ctrl+Shift+D"), or "" for unbound. */
export type Keybindings = Record<ShortcutAction, string>

/** Stable display/iteration order for the settings page's shortcut list. */
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  'newTab',
  'closeTab',
  'nextTab',
  'prevTab',
  'gotoTab1',
  'gotoTab2',
  'gotoTab3',
  'gotoTab4',
  'gotoTab5',
  'gotoTab6',
  'gotoTab7',
  'gotoTab8',
  'gotoTab9',
  'openSettings',
  'cloneTab',
  'zoomIn',
  'zoomOut',
  'resetZoom'
]

// Windows-Terminal-style defaults: application-level actions all carry
// Ctrl+Shift so a bare Ctrl+<letter> is always the shell's (Ctrl+C interrupt,
// Ctrl+W delete-word, Ctrl+T transpose, …). Tab navigation keeps Ctrl+Tab /
// Ctrl+Shift+Tab and the Ctrl+<digit> jumps (digits aren't shell control
// chars, and this matches WT). Copy/paste are NOT actions here — the terminal
// layer owns Ctrl+Shift+C / Ctrl+Shift+V directly (see
// TERMINAL_RESERVED_ACCELERATORS), alongside the retained Ctrl+C-copies-
// selection / Ctrl+V-pastes behavior.
export const DEFAULT_KEYBINDINGS: Keybindings = {
  newTab: 'Ctrl+Shift+T',
  closeTab: 'Ctrl+Shift+W',
  nextTab: 'Ctrl+Tab',
  prevTab: 'Ctrl+Shift+Tab',
  gotoTab1: 'Ctrl+1',
  gotoTab2: 'Ctrl+2',
  gotoTab3: 'Ctrl+3',
  gotoTab4: 'Ctrl+4',
  gotoTab5: 'Ctrl+5',
  gotoTab6: 'Ctrl+6',
  gotoTab7: 'Ctrl+7',
  gotoTab8: 'Ctrl+8',
  gotoTab9: 'Ctrl+9',
  openSettings: 'Ctrl+,',
  cloneTab: 'Ctrl+Shift+D',
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  resetZoom: 'Ctrl+0'
}

// ---------------------------------------------------------------------------
// Single keyboard-arbitration table. Every layer that has to decide "who owns
// this key" reads from here instead of keeping its own private blacklist:
//   - DEFAULT_KEYBINDINGS above          — the app-shortcut table (renderer
//                                          ShortcutManager, capture phase).
//   - TERMINAL_RESERVED_ACCELERATORS     — combos the terminal claims for
//                                          itself, so they can never be bound
//                                          to an app action (settings
//                                          validation + the terminal's own
//                                          key handler both consult this).
//   - MAIN_FALLBACK_ACCELERATORS         — accelerators Chromium may swallow
//                                          before the renderer sees them, so
//                                          main's before-input-event hook has
//                                          to recognize and forward them.
// ---------------------------------------------------------------------------

/**
 * Combos the terminal owns and that therefore must never become an app
 * shortcut — either core shell control chars (Ctrl+C interrupt, Ctrl+D EOF,
 * Ctrl+V paste, Ctrl+W delete-word, Ctrl+S/Ctrl+Q flow control, Ctrl+Z
 * suspend, Ctrl+A/Ctrl+E line edit, Ctrl+R reverse-search, Ctrl+L clear), the
 * explicit copy/paste pair the terminal handles itself (Ctrl+Shift+C /
 * Ctrl+Shift+V), or an OS accelerator a rebind couldn't claim anyway (Alt+F4).
 */
export const TERMINAL_RESERVED_ACCELERATORS: ReadonlySet<string> = new Set<string>([
  'Alt+F4',
  'Ctrl+C',
  'Ctrl+Shift+C',
  'Ctrl+Shift+V',
  'Ctrl+D',
  'Ctrl+V',
  'Ctrl+W',
  'Ctrl+S',
  'Ctrl+Q',
  'Ctrl+Z',
  'Ctrl+X',
  'Ctrl+A',
  'Ctrl+R',
  'Ctrl+L'
])

/**
 * Accelerators Chromium may consume as a native accelerator (tab/focus
 * cycling) before a renderer-side `window.keydown` listener ever runs — main's
 * `before-input-event` fallback resolves these to whatever action is currently
 * bound and forwards it. Keyed by accelerator, not action: any action can be
 * rebound onto one of these.
 */
export const MAIN_FALLBACK_ACCELERATORS: ReadonlySet<string> = new Set<string>(['Ctrl+Tab', 'Ctrl+Shift+Tab'])
