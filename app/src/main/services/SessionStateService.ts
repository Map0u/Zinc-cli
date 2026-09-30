import { copyFileSync, existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { SessionTool } from '../../shared/sessionState'
import type { RestorePayload, RestoreTab, SessionState, SessionTabState } from '../../shared/sessionState'
import {
  isSafeSessionId,
  mergeTabPersistState,
  shouldWriteSessionSnapshot,
  startupCommandForRestore,
  type LastKnownTab
} from '../../shared/sessionPersist'
import { atomicWriteFileSync } from './atomicWrite'

export type PersistToolMatch = { tool: SessionTool; pid: number; sessionId?: string }

function isJsonLeadingByte(byte: number): boolean {
  return byte === 0x7b || byte === 0x5b || byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d
}

function decodeSessionFile(bytes: Buffer): string {
  let encoding: 'utf-8' | 'utf-16le' | 'utf-16be' = 'utf-8'
  let offset = 0
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offset = 3
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le'
    offset = 2
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be'
    offset = 2
  } else if (bytes.length >= 2 && isJsonLeadingByte(bytes[0]) && bytes[1] === 0) {
    encoding = 'utf-16le'
  } else if (bytes.length >= 2 && bytes[0] === 0 && isJsonLeadingByte(bytes[1])) {
    encoding = 'utf-16be'
  }
  return new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset))
}

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
  private pendingRestoreRows: SessionTabState[] | null = null

  constructor(
    private readonly filePath: string,
    /**
     * Supplies the per-process `--settings` path that registers the Claude
     * SessionStart binding hook. Injected so this service stays testable
     * without touching userData; returns null when hooks are unavailable.
     */
    private readonly claudeSettingsProvider: () => string | null = () => null
  ) {}

  /** Last-known row for a live tab, used to prefer that tool during detection. */
  peekLastKnown(id: string): LastKnownTab | undefined {
    return this.lastKnown.get(id)
  }

  /**
   * Bind persisted rows to freshly-created renderer ids before the first
   * cheap tab-list persist. If order or count changed during hydration, do
   * not guess which conversation belongs to which tab.
   */
  bindRestoredTabs(tabs: readonly { id: string; shellId?: string }[]): void {
    const rows = this.pendingRestoreRows
    this.pendingRestoreRows = null
    if (!rows || rows.length !== tabs.length) return
    if (rows.some((row, index) => row.ShellId && tabs[index].shellId !== row.ShellId)) return
    rows.forEach((row, index) => {
      const id = tabs[index].id
      if (!id || this.lastKnown.has(id)) return
      this.lastKnown.set(id, {
        cwd: row.WorkingDirectory,
        tool: row.Tool,
        ...(row.SessionId ? { sessionId: row.SessionId } : {})
      })
    })
  }

  /** Tab ids may be reused after a renderer reload; never inherit the old generation's identities. */
  resetRendererGeneration(): void {
    this.lastKnown.clear()
    this.pendingRestoreRows = null
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
      const parsed = JSON.parse(decodeSessionFile(readFileSync(this.filePath))) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new TypeError('session-state.json must contain an object')
      }
      const raw = parsed as Partial<SessionState>
      const tabsRaw = Array.isArray(raw.Tabs) ? raw.Tabs : []
      if (tabsRaw.length === 0) return null

      const savedActiveIndex = raw.ActiveIndex
      const activeIndex =
        typeof savedActiveIndex === 'number' && Number.isInteger(savedActiveIndex) &&
        savedActiveIndex >= 0 && savedActiveIndex < tabsRaw.length
          ? savedActiveIndex
          : 0

      const cwdFor = (t: Partial<SessionTabState> | undefined): string =>
        typeof t?.WorkingDirectory === 'string' && t.WorkingDirectory.length > 0 ? t.WorkingDirectory : homedir()

      // Grouping key: normalize only spelling-level equivalences — slash
      // direction, a trailing separator (not on a bare drive/UNC root), and
      // case. Junctions/8.3 aliases intentionally stay distinct: the CLI's
      // own `process.cwd()` preserves those aliases, so collapsing them could
      // merge genuinely separate per-directory conversation histories.
      const groupCwdFor = (cwd: string): string => {
        const normalized = cwd.replace(/\//g, '\\').toLowerCase()
        const rootOnly = /^([a-z]:\\|\\\\[^\\]+\\[^\\]+\\?)$/
        return rootOnly.test(normalized) ? normalized : normalized.replace(/\\+$/, '')
      }

      // Never start the same exact conversation twice, including when an old
      // or corrupt snapshot contains a duplicate id. Give the active tab
      // priority; duplicate rows reopen as plain shells.
      const sessionIds = new Map<number, string>()
      const claimedIds = new Set<string>()
      const priority = [activeIndex, ...tabsRaw.map((_, index) => index)].filter((index) => index >= 0)
      for (const index of priority) {
        const t = tabsRaw[index]
        if (t?.Tool !== SessionTool.Claude && t?.Tool !== SessionTool.Codex) continue
        // Windows hook settings and session files are not accessible from a
        // WSL Claude. A stale stored id must not be passed into Linux Claude.
        if (t.Tool === SessionTool.Claude && t.ShellId?.startsWith('wsl:')) continue
        const id = t.SessionId
        if (typeof id !== 'string' || !isSafeSessionId(id)) continue
        const key = `${t?.Tool}\u0000${id.toLowerCase()}`
        if (claimedIds.has(key)) continue
        claimedIds.add(key)
        sessionIds.set(index, id)
      }
      // `codex resume --last` might select a session already claimed by an
      // exact ID, depending on the CLI version's cwd filtering. Until the VM
      // test establishes its scope, give it to at most one unknown tab, and
      // never in a snapshot that already has any exact Codex ID.
      const hasExactCodexId = [...sessionIds.keys()].some((index) => tabsRaw[index]?.Tool === SessionTool.Codex)

      // `--continue` can select a conversation already assigned an exact id
      // in the same directory. In that mixed group unknown Claude tabs must
      // reopen as shells rather than silently attaching to someone else's
      // conversation. All-unknown groups keep the old single-tab fallback.
      const exactClaudeGroups = new Set<string>()
      for (const [index] of sessionIds) {
        const t = tabsRaw[index]
        if (t?.Tool === SessionTool.Claude) exactClaudeGroups.add(groupCwdFor(cwdFor(t)))
      }
      const continueWinners = new Set<number>()
      const groupWinner = new Map<string, number>()
      tabsRaw.forEach((t, index) => {
        if (t?.Tool === undefined || t.Tool === SessionTool.None || t.Tool === SessionTool.Codex) return
        if (sessionIds.has(index)) return
        const groupCwd = groupCwdFor(cwdFor(t))
        if (t.Tool === SessionTool.Claude && exactClaudeGroups.has(groupCwd)) return
        const key = `${t.Tool}\u0000${groupCwd}`
        const current = groupWinner.get(key)
        if (current === undefined || index === activeIndex) groupWinner.set(key, index)
      })
      for (const index of groupWinner.values()) continueWinners.add(index)

      // Resolve once: every restored Claude tab gets the same injected
      // `--settings` so its SessionStart hook reports the new session id back.
      const claudeSettings = resumeAiConversations ? this.claudeSettingsProvider() ?? undefined : undefined

      const tabs: RestoreTab[] = tabsRaw.map((t, index) => {
        const cwd = cwdFor(t)
        const shellId = typeof t?.ShellId === 'string' && t.ShellId.length > 0 ? t.ShellId : undefined
        const sessionId = sessionIds.get(index)
        // If the persisted directory was moved or deleted, the shell itself
        // falls back to homedir — running `claude --resume`/`--continue` there
        // would attach a conversation in the wrong project context. Drop the
        // AI command but still open the shell where it lands.
        let cwdExists = false
        try { cwdExists = statSync(cwd).isDirectory() } catch { /* deleted or inaccessible */ }
        const startupCommand = cwdExists
          ? startupCommandForRestore(t?.Tool, {
              resumeAi: resumeAiConversations,
              sessionId,
              allowCodexLast: t?.Tool === SessionTool.Codex && index === activeIndex && !hasExactCodexId,
              allowContinue: continueWinners.has(index),
              claudeSettings: t?.Tool === SessionTool.Claude && !shellId?.startsWith('wsl:')
                ? claudeSettings
                : undefined
            })
          : undefined
        return { cwd, shellId, ...(startupCommand ? { startupCommand } : {}) }
      })

      // Keep the source rows until the first persist: tabs spawn before the
      // renderer's first snapshot push, and without them a persist in that
      // window would write a real homedir/None row over restored identities.
      this.pendingRestoreRows = tabsRaw.map((t, index) => ({
        WorkingDirectory: cwdFor(t),
        Tool: resumeAiConversations && Object.values(SessionTool).includes(t?.Tool as SessionTool)
          ? t.Tool
          : SessionTool.None,
        ...(typeof t?.ShellId === 'string' ? { ShellId: t.ShellId } : {}),
        ...(resumeAiConversations && sessionIds.has(index) ? { SessionId: sessionIds.get(index) } : {})
      }))
      return { tabs, activeIndex }
    } catch (err) {
      // A damaged snapshot must not block startup, but save the original bytes
      // before a later persist replaces them. Never overwrite an existing
      // .bak: it may be the only copy of an earlier, partly recoverable file.
      try {
        if (existsSync(this.filePath) && !existsSync(`${this.filePath}.bak`)) {
          copyFileSync(this.filePath, `${this.filePath}.bak`)
        }
      } catch (backupError) {
        console.warn(`[SessionStateService] failed to back up ${this.filePath}`, backupError)
      }
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
    this.pendingRestoreRows = null
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
      let detectionFailed = false
      if (withinBudget) {
        try {
          match = resolveToolMatch(id)
        } catch {
          match = null
          detectionFailed = true
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
          ptyAlive: shellCwd !== null,
          // "Scanned" must mean a detection actually ran for this tab — a
          // budget-exhausted pass (withinBudget=false) or a throwing scan
          // must keep sticky state, not mark the tool as exited.
          scannedTool: withinBudget && !detectionFailed
        },
        known,
        fallbackCwd
      )

      if (merged.usedFallbackOnly) usedFallbackCount += 1
      else this.lastKnown.set(id, merged.state)

      return toTabState(id, shellId, merged.state)
    })

    // A single unknown/dead tab's generic homedir + None row is not a valid
    // replacement for a previously good snapshot. Wait for that tab to report
    // a real cwd rather than writing a partly degraded file on quit.
    if (usedFallbackCount > 0) return false
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
