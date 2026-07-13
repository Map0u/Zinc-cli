import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { SessionTool } from '../../shared/sessionState'
import type { RestorePayload, RestoreTab, SessionState, SessionTabState } from '../../shared/sessionState'
import { atomicWriteFileSync } from './atomicWrite'

/** `claude --continue` / `codex resume --last` — passed as a single node-pty argv element (see PtyManager),
 *  never string-concatenated, so this is immune to the WinUI original's unescaped-injection bug (parity §1.4). */
function startupCommandFor(tool: unknown): string | undefined {
  if (tool === SessionTool.Codex) return 'codex resume --last'
  if (tool === SessionTool.Claude) return 'claude --continue'
  return undefined
}

/**
 * Owns `session-state.json` (in `app.getPath('userData')`): reads it back into
 * a restore plan at startup, and writes a fresh snapshot on every unified
 * quit (see `before-quit` in main/index.ts — parity §1.1's "close last tab"
 * bug is fixed by routing that path through the same quit flow, so an empty
 * tab list gets persisted here too, not silently dropped).
 */
export class SessionStateService {
  constructor(private readonly filePath: string) {}

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

      const tabs: RestoreTab[] = tabsRaw.map((t) => {
        const cwd = typeof t?.WorkingDirectory === 'string' && t.WorkingDirectory.length > 0 ? t.WorkingDirectory : homedir()
        const startupCommand = resumeAiConversations ? startupCommandFor(t?.Tool) : undefined
        const shellId = typeof t?.ShellId === 'string' && t.ShellId.length > 0 ? t.ShellId : undefined
        return { cwd, shellId, ...(startupCommand ? { startupCommand } : {}) }
      })

      const activeIndex =
        typeof raw.ActiveIndex === 'number' && raw.ActiveIndex >= 0 && raw.ActiveIndex < tabs.length ? raw.ActiveIndex : 0

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
    try {
      if (existsSync(this.filePath)) unlinkSync(this.filePath)
    } catch (err) {
      // Best-effort privacy cleanup — inability to delete a stale snapshot
      // must not block startup or shutdown.
      console.error('[SessionStateService] failed to clear persisted session state', err)
    }
  }

  /**
   * Best-effort snapshot + write, budgeted to `budgetMs` total (parity §1.4:
   * "2 秒超时保护，超时退化为只存 shell cwd"). `resolveShellCwd` (a single PEB
   * read) is cheap; `resolveToolMatch` (a full process-tree snapshot + BFS per
   * tab) is the expensive part, so once the deadline passes remaining tabs
   * just skip AI-tool detection (and therefore the AI-child cwd read) rather
   * than skipping the whole tab — falling back to the shell's own cwd exactly
   * matches "超时退化为只存 shell cwd".
   *
   * cwd priority when a tool *is* detected in time (parity §1.4: "cwd 优先级：
   * AI 子进程 cwd > shell cwd"): the AI child's own cwd wins over the shell's,
   * since a plain `cd`/`Set-Location` never updates pwsh's PEB cwd (parity §3
   * known issue #4) but a codex/claude child spawned mid-session does reflect
   * wherever the user actually was.
   */
  persist(
    tabsSnapshot: Array<{ id: string; shellId?: string }>,
    activeIndex: number,
    resolveShellCwd: (id: string) => string | null,
    resolveToolMatch: (id: string) => { tool: SessionTool; pid: number } | null,
    resolveAiCwd: (pid: number) => string | null,
    budgetMs = 2000
  ): void {
    const deadline = Date.now() + budgetMs
    // Every resolver call below reaches into native process inspection
    // (koffi/PEB reads via ToolDetector/getProcessCwd) that can throw for
    // reasons unrelated to this tab's own data (a stale pid, a process that
    // exited mid-snapshot, a native-call error) — each call is individually
    // guarded so one tab's failure degrades only that tab to its cheapest
    // known-good fallback (shell cwd / Tool.None) rather than aborting the
    // whole persist (and, upstream, the rest of before-quit's cleanup).
    const tabs: SessionTabState[] = tabsSnapshot.map(({ id, shellId }) => {
      let shellCwd: string
      try {
        shellCwd = resolveShellCwd(id) ?? homedir()
      } catch {
        shellCwd = homedir()
      }

      if (Date.now() >= deadline) {
        return { WorkingDirectory: shellCwd, Tool: SessionTool.None, ...(shellId ? { ShellId: shellId } : {}) }
      }

      let match: { tool: SessionTool; pid: number } | null
      try {
        match = resolveToolMatch(id)
      } catch {
        match = null
      }
      if (!match) return { WorkingDirectory: shellCwd, Tool: SessionTool.None, ...(shellId ? { ShellId: shellId } : {}) }

      // resolveToolMatch() itself (full process-tree snapshot + PEB reads) can
      // burn most/all of the budget, so re-check the deadline before the last
      // expensive read (resolveAiCwd) rather than only before resolveToolMatch —
      // otherwise before-quit could still block well past budgetMs.
      if (Date.now() >= deadline) {
        return { WorkingDirectory: shellCwd, Tool: SessionTool.None, ...(shellId ? { ShellId: shellId } : {}) }
      }

      let aiCwd: string | null
      try {
        aiCwd = resolveAiCwd(match.pid)
      } catch {
        aiCwd = null
      }
      return { WorkingDirectory: aiCwd ?? shellCwd, Tool: match.tool, ...(shellId ? { ShellId: shellId } : {}) }
    })

    const state: SessionState = { Tabs: tabs, ActiveIndex: activeIndex }
    try {
      atomicWriteFileSync(this.filePath, JSON.stringify(state, null, 2))
    } catch (err) {
      // Best-effort write — a failed save must not block quitting.
      console.error(`[SessionStateService] failed to persist ${this.filePath}`, err)
    }
  }
}
