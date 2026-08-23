import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { SessionTool } from '../../shared/sessionState'
import type { RestorePayload, RestoreTab, SessionState, SessionTabState } from '../../shared/sessionState'
import {
  mergeTabPersistState,
  shouldWriteSessionSnapshot,
  startupCommandForRestore,
  type LastKnownTab
} from '../../shared/sessionPersist'
import { atomicWriteFileSync } from './atomicWrite'

export type PersistToolMatch = { tool: SessionTool; pid: number; sessionId?: string }

export interface PersistOptions {
  budgetMs?: number
  /** Expensive process-tree scan. Tab-list debounce passes set this false. */
  scanTools?: boolean
  /** Empty tab lists may overwrite the file only on the unified quit path. */
  quitting?: boolean
}

function toTabState(id: string, shellId: string | undefined, known: LastKnownTab): SessionTabState {
  return {
    WorkingDirectory: known.cwd,
    Tool: known.tool,
    ...(shellId ? { ShellId: shellId } : {}),
    ...(known.sessionId ? { SessionId: known.sessionId } : {})
  }
}

/**
 * Owns `session-state.json` (in `app.getPath('userData')`): reads it back into
 * a restore plan at startup, and writes snapshots on a running-app timer,
 * after tab-list changes, and on the unified quit path (see `before-quit` in
 * main/index.ts). Closing the last tab still routes through that quit flow so
 * an empty tab list is persisted instead of being silently dropped.
 */
export class SessionStateService {
  private readonly lastKnown = new Map<string, LastKnownTab>()

  constructor(private readonly filePath: string) {}

  /** Last-known row for a live tab, used to prefer that tool during detection. */
  peekLastKnown(id: string): LastKnownTab | undefined {
    return this.lastKnown.get(id)
  }

  /** Drop sticky state for tabs that are no longer in the renderer snapshot. */
  pruneLastKnown(liveIds: readonly string[]): void {
    const live = new Set(liveIds)
    for (const id of [...this.lastKnown.keys()]) {
      if (!live.has(id)) this.lastKnown.delete(id)
    }
  }

  /**
   * `null` means "don't restore" — startup should fall back to the normal
   * single-default-tab behavior (restore disabled, first run, or the file is
   * missing/corrupt/empty).
   */
  loadRestorePayload(restoreEnabled: boolean, resumeAiConversations: boolean): RestorePayload | null {
    if (!restoreEnabled) {
      this.clear()
      return null
    }
    try {
      if (!existsSync(this.filePath)) return null
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<SessionState>
      const tabsRaw = Array.isArray(raw.Tabs) ? raw.Tabs : []
      if (tabsRaw.length === 0) return null

      const activeIndex =
        typeof raw.ActiveIndex === 'number' && raw.ActiveIndex >= 0 && raw.ActiveIndex < tabsRaw.length
          ? raw.ActiveIndex
          : 0

      const tabs: RestoreTab[] = tabsRaw.map((t, index) => {
        const cwd = typeof t?.WorkingDirectory === 'string' && t.WorkingDirectory.length > 0 ? t.WorkingDirectory : homedir()
        const shellId = typeof t?.ShellId === 'string' && t.ShellId.length > 0 ? t.ShellId : undefined
        const sessionId = typeof t?.SessionId === 'string' && t.SessionId.length > 0 ? t.SessionId : undefined
        const startupCommand = startupCommandForRestore(t?.Tool, {
          resumeAi: resumeAiConversations,
          sessionId,
          allowCodexLast: t?.Tool === SessionTool.Codex && index === activeIndex
        })
        return { cwd, shellId, ...(startupCommand ? { startupCommand } : {}) }
      })

      return { tabs, activeIndex }
    } catch (err) {
      // Corrupt/unreadable session-state.json must never block startup.
      console.warn(`[SessionStateService] failed to load ${this.filePath}, skipping restore`, err)
      return null
    }
  }

  /**
   * Removes the persisted restore snapshot without touching any live PTY or
   * renderer tab state. This is used when session restore is disabled so old
   * working-directory paths do not remain on disk or get written again at
   * shutdown.
   */
  clear(): void {
    this.lastKnown.clear()
    try {
      if (existsSync(this.filePath)) unlinkSync(this.filePath)
    } catch (err) {
      // Best-effort privacy cleanup — inability to delete a stale snapshot
      // must not block startup or shutdown.
      console.error('[SessionStateService] failed to clear persisted session state', err)
    }
  }

  /**
   * Best-effort snapshot + write. Tool detection is budgeted to `budgetMs`
   * when `scanTools` is on (parity §1.4: timeout degrades to last-known /
   * shell cwd instead of Tool.None). Cheap tab-list persists skip the scan
   * and rewrite last-known rows so a crash still has a recent tab order.
   *
   * Dead PTYs and failed scans keep last-known cwd/tool. An all-fallback
   * snapshot (every tab is homedir + Tool.None with no prior sticky state)
   * is not written over a good file. Empty tab lists write only on quit.
   */
  persist(
    tabsSnapshot: Array<{ id: string; shellId?: string }>,
    activeIndex: number,
    resolveShellCwd: (id: string) => string | null,
    resolveToolMatch: (id: string) => PersistToolMatch | null,
    resolveAiCwd: (pid: number) => string | null,
    options: PersistOptions = {}
  ): boolean {
    const fallbackCwd = homedir()
    const scanTools = options.scanTools !== false
    const quitting = options.quitting === true
    const deadline = Date.now() + (scanTools ? (options.budgetMs ?? 2000) : 0)

    this.pruneLastKnown(tabsSnapshot.map((tab) => tab.id))

    let usedFallbackCount = 0
    const tabs: SessionTabState[] = tabsSnapshot.map(({ id, shellId }) => {
      let shellCwd: string | null = null
      try {
        shellCwd = resolveShellCwd(id)
      } catch {
        shellCwd = null
      }

      const known = this.lastKnown.get(id)
      const withinBudget = scanTools && Date.now() < deadline
      let match: PersistToolMatch | null = null
      if (withinBudget) {
        try {
          match = resolveToolMatch(id)
        } catch {
          match = null
        }
      }

      let aiCwd: string | null = null
      if (match && Date.now() < deadline) {
        try {
          aiCwd = resolveAiCwd(match.pid)
        } catch {
          aiCwd = null
        }
      }

      const merged = mergeTabPersistState(
        {
          shellCwd,
          match: match ? { tool: match.tool, sessionId: match.sessionId } : null,
          aiCwd,
          scannedTool: withinBudget
        },
        known,
        fallbackCwd
      )

      if (merged.usedFallbackOnly) usedFallbackCount += 1
      else this.lastKnown.set(id, merged.state)

      return toTabState(id, shellId, merged.state)
    })

    const allDegradedToFallback = tabsSnapshot.length > 0 && usedFallbackCount === tabsSnapshot.length
    if (
      !shouldWriteSessionSnapshot({
        snapshotReady: true,
        tabCount: tabsSnapshot.length,
        quitting,
        allDegradedToFallback
      })
    ) {
      return false
    }

    const state: SessionState = { Tabs: tabs, ActiveIndex: activeIndex }
    try {
      atomicWriteFileSync(this.filePath, JSON.stringify(state, null, 2))
      return true
    } catch (err) {
      // Best-effort write — a failed save must not block quitting or the timer.
      console.error(`[SessionStateService] failed to persist ${this.filePath}`, err)
      return false
    }
  }
}
