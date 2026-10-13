// Shared session-persistence types, imported by main, preload, and renderer.
// Kept dependency-free like ptyProtocol.ts/settingsTypes.ts (no electron/node
// imports).

/** Longest tab name the rail accepts, snapshots carry, and session-state.json restores. */
export const MAX_TAB_TITLE_LENGTH = 256

/** Longest group name a snapshot carries (keep in step with `MAX_GROUP_NAME_LENGTH` in tabs/tabGroups.ts). */
export const MAX_GROUP_NAME_LENGTH = 256

/** Most groups a snapshot or session file may carry: as many as tabs, since a group has at least one. */
export const MAX_SESSION_GROUPS = 256

/** Most tabs a snapshot may carry. */
export const MAX_SESSION_TABS = 256

/** Longest auto-group key (a folded project path). */
export const MAX_GROUP_KEY_LENGTH = 1024

const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/

/** Tab and group ids the renderer mints; anything else in a snapshot or session file is rejected. */
export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value)
}

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
  /** `Groups[].Id` this tab belongs to; absent = ungrouped (and in every file written before tab groups). */
  GroupId?: string
  /** The user placed this tab, so automatic grouping leaves it alone. */
  Pinned?: boolean
}

/** One tab group in `session-state.json`. */
export interface SessionGroupState {
  Id: string
  Name?: string
  /** Name automatic grouping gave an auto group (the project folder); absent in files written before it. */
  Title?: string
  Collapsed?: boolean
  /** Created by automatic grouping and never touched by the user. */
  Auto?: boolean
  /** Automatic-group project key, so a restored group keeps its identity. */
  Key?: string
}

/**
 * Full shape of `session-state.json` (parity §2.4). Readers ignore fields they
 * do not know, so older and newer Zincs can share a file.
 */
export interface SessionState {
  Tabs: SessionTabState[]
  ActiveIndex: number
  /** Absent when no tab is grouped. */
  Groups?: SessionGroupState[]
}

/** One tab the renderer reports as currently open, in left-to-right order (main has no tab-order state of its own). */
export interface RendererTabSnapshot {
  id: string
  shellId?: string
  /** Name the user gave the tab, if any. */
  customTitle?: string
  /** Id of the group the tab sits in (one of `groups[].id`). */
  groupId?: string
  /** The user placed this tab. */
  manual?: boolean
}

/** A tab group as the renderer reports it. */
export interface RendererGroupSnapshot {
  id: string
  name?: string
  title?: string
  collapsed: boolean
  auto: boolean
  key?: string
}

/** What the renderer sends back when main asks "what tabs do you have right now" during before-quit. */
export interface RendererSessionSnapshot {
  tabs: RendererTabSnapshot[]
  activeIndex: number
  /** Absent from renderers (and tests) that predate tab groups. */
  groups?: RendererGroupSnapshot[]
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
  /** Id from `RestorePayload.groups`; the renderer maps it to a fresh group id. */
  groupId?: string
  manual?: boolean
}

/** One group to recreate on startup. */
export interface RestoreGroup {
  id: string
  name?: string
  title?: string
  collapsed: boolean
  auto: boolean
  key?: string
}

/** What main hands the renderer at startup instead of the single-default-tab behavior. `null` = no restore (first run, disabled, or unreadable/corrupt state file). */
export interface RestorePayload {
  tabs: RestoreTab[]
  activeIndex: number
  /** Omitted for old session files and sessions with no groups. */
  groups?: RestoreGroup[]
}

/** Main's gate for the renderer's tab-list pushes; a rejected snapshot is silently dropped, so keep it in step with the types above. */
export function isValidRendererSnapshot(value: unknown): value is RendererSessionSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<RendererSessionSnapshot>
  if (!Array.isArray(snapshot.tabs) || snapshot.tabs.length > MAX_SESSION_TABS) return false
  if (!Number.isInteger(snapshot.activeIndex) || snapshot.activeIndex! < -1 || snapshot.activeIndex! >= snapshot.tabs.length)
    return false
  const groupIds = new Set<string>()
  if (snapshot.groups !== undefined) {
    if (!Array.isArray(snapshot.groups) || snapshot.groups.length > MAX_SESSION_GROUPS) return false
    for (const group of snapshot.groups) {
      if (!group || !isSessionId(group.id) || groupIds.has(group.id)) return false
      if (group.name !== undefined && (typeof group.name !== 'string' || group.name.length > MAX_GROUP_NAME_LENGTH)) return false
      if (group.title !== undefined && (typeof group.title !== 'string' || group.title.length > MAX_GROUP_NAME_LENGTH)) return false
      if (typeof group.collapsed !== 'boolean') return false
      if (group.auto !== undefined && typeof group.auto !== 'boolean') return false
      if (group.key !== undefined && (typeof group.key !== 'string' || group.key.length > MAX_GROUP_KEY_LENGTH)) return false
      groupIds.add(group.id)
    }
  }
  const ids = new Set<string>()
  for (const tab of snapshot.tabs) {
    if (!tab || !isSessionId(tab.id)) return false
    if (tab.groupId !== undefined && (typeof tab.groupId !== 'string' || !groupIds.has(tab.groupId))) return false
    if (tab.manual !== undefined && typeof tab.manual !== 'boolean') return false
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
