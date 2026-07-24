// Shared session-persistence types, imported by main, preload, and renderer.
// Kept dependency-free like ptyProtocol.ts/settingsTypes.ts (no electron/node
// imports).

/** Which AI CLI (if any) a tab's shell had running when the session was saved. */
export enum SessionTool {
  None = 0,
  Codex = 1,
  Claude = 2,
  /** Grok Build CLI (`grok`). */
  Grok = 3
}

/** One row of `session-state.json`'s `Tabs` array (parity §2.4 field names, kept for future WinUI-state import). */
export interface SessionTabState {
  WorkingDirectory: string
  Tool: SessionTool
  /** Stable shell id, absent in session files written before multi-shell support. */
  ShellId?: string
}

/** Full shape of `session-state.json` (parity §2.4). */
export interface SessionState {
  Tabs: SessionTabState[]
  ActiveIndex: number
}

/** One tab the renderer reports as currently open, in left-to-right order (main has no tab-order state of its own). */
export interface RendererTabSnapshot {
  id: string
  shellId?: string
}

/** What the renderer sends back when main asks "what tabs do you have right now" during before-quit. */
export interface RendererSessionSnapshot {
  tabs: RendererTabSnapshot[]
  activeIndex: number
}

/** One tab to recreate on startup, resolved from the last-saved session-state.json. */
export interface RestoreTab {
  cwd: string
  /** Stable shell id, omitted for backwards-compatible restoration of old sessions. */
  shellId?: string
  /** Set only when `ResumeAiConversations` is on and this tab had a known AI tool (parity §1.4). */
  startupCommand?: string
}

/** What main hands the renderer at startup instead of the single-default-tab behavior. `null` = no restore (first run, disabled, or unreadable/corrupt state file). */
export interface RestorePayload {
  tabs: RestoreTab[]
  activeIndex: number
}
