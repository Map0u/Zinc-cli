// Shared session-persistence types, imported by main, preload, and renderer.
// Kept dependency-free like ptyProtocol.ts/settingsTypes.ts (no electron/node
// imports).

/** Longest tab name the rail accepts, snapshots carry, and session-state.json restores. */
export const MAX_TAB_TITLE_LENGTH = 256

/** Which AI CLI (if any) a tab's shell had running when the session was saved. */
export enum SessionTool {
  None = 0,
  Codex = 1,
  Claude = 2,
  /** Grok Build CLI (`grok`). */
  Grok = 3,
  /** Kimi Code CLI (`kimi`). */
  Kimi = 4
}

/** One row of `session-state.json`'s `Tabs` array (parity §2.4 field names, kept for future WinUI-state import). */
export interface SessionTabState {
  WorkingDirectory: string
  Tool: SessionTool
  /** Stable shell id, absent in session files written before multi-shell support. */
  ShellId?: string
  /** Codex session id when persist saw `codex resume <id>` on the process command line. */
  SessionId?: string
  /** Name the user gave the tab; absent in session files written before tab renames were saved. */
  CustomTitle?: string
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
  /** Name the user gave the tab, if any. */
  customTitle?: string
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
  /** Name the user gave the tab; omitted for tabs that were never renamed and for old session files. */
  customTitle?: string
  /** Set only when `ResumeAiConversations` is on and this tab had a known AI tool (parity §1.4). */
  startupCommand?: string
}

/** What main hands the renderer at startup instead of the single-default-tab behavior. `null` = no restore (first run, disabled, or unreadable/corrupt state file). */
export interface RestorePayload {
  tabs: RestoreTab[]
  activeIndex: number
}

/** Main's gate for the renderer's tab-list pushes; a rejected snapshot is silently dropped, so keep it in step with the types above. */
export function isValidRendererSnapshot(value: unknown): value is RendererSessionSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<RendererSessionSnapshot>
  if (!Array.isArray(snapshot.tabs) || snapshot.tabs.length > 256) return false
  if (!Number.isInteger(snapshot.activeIndex) || snapshot.activeIndex! < -1 || snapshot.activeIndex! >= snapshot.tabs.length)
    return false
  const ids = new Set<string>()
  for (const tab of snapshot.tabs) {
    if (!tab || typeof tab.id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(tab.id)) return false
    if (tab.shellId !== undefined && (typeof tab.shellId !== 'string' || tab.shellId.length > 128)) return false
    if (
      tab.customTitle !== undefined &&
      (typeof tab.customTitle !== 'string' || tab.customTitle.length > MAX_TAB_TITLE_LENGTH)
    )
      return false
    if (ids.has(tab.id)) return false
    ids.add(tab.id)
  }
  return true
}
