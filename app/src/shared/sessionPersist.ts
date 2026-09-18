// Pure session-persist policy: last-known cwd/tool merge, write guards, and
// restore-command selection. Kept dependency-free so unit tests can load it
// without Electron or native process inspection.

import { SessionTool } from './sessionState'

/** In-memory last-known-good row for one live tab id. */
export interface LastKnownTab {
  cwd: string
  tool: SessionTool
  sessionId?: string
}

/** Live signals collected for one tab during a persist pass. */
export interface DetectedTabSignals {
  /** Shell PEB cwd; `null` if the PTY is gone or unreadable. */
  shellCwd: string | null
  match: { tool: SessionTool; sessionId?: string } | null
  aiCwd: string | null
  /** False on cheap (tab-list-only) persists and after the scan budget expires. */
  scannedTool: boolean
}

export interface MergeTabPersistResult {
  state: LastKnownTab
  /** True when this row is only the generic fallback cwd and Tool.None. */
  usedFallbackOnly: boolean
}

/**
 * Codex `resume <id>` tokens we are willing to persist and later pass as a
 * single argv element. Rejects `--last` and anything that looks like a flag.
 */
export function isSafeSessionId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(id)
}

/** Best-effort Codex session id from a descendant command line. */
export function extractCodexSessionId(commandLine: string): string | undefined {
  const match = commandLine.match(
    /(?:^|[\s"'])resume(?:\s+--session(?:-id)?\s+|\s+)(?!--)([A-Za-z0-9][A-Za-z0-9_-]{7,})(?=$|[\s"'])/i
  )
  const id = match?.[1]
  if (!id || /^(last|continue)$/i.test(id)) return undefined
  return isSafeSessionId(id) ? id : undefined
}

/**
 * Merge a persist pass into last-known state.
 *
 * - A successful tool detection updates cwd (AI child > shell > known) and tool.
 * - A sticky tool wins when the tree reports a *different* tool (leftover
 *   `claude` must not hijack a Grok/Codex tab).
 * - A scan that finds no tool keeps the sticky tool and cwd; it does not
 *   overwrite with a stale pwsh PEB cwd or Tool.None.
 * - A cheap (unscanned) pass keeps last-known; a brand-new tab may take a
 *   live shell cwd only.
 */
export function mergeTabPersistState(
  detected: DetectedTabSignals,
  known: LastKnownTab | undefined,
  fallbackCwd: string
): MergeTabPersistResult {
  if (!detected.scannedTool) {
    if (known) return { state: known, usedFallbackOnly: false }
    if (detected.shellCwd) {
      return { state: { cwd: detected.shellCwd, tool: SessionTool.None }, usedFallbackOnly: false }
    }
    return { state: { cwd: fallbackCwd, tool: SessionTool.None }, usedFallbackOnly: true }
  }

  if (detected.match && known && known.tool !== SessionTool.None && known.tool !== detected.match.tool) {
    return { state: known, usedFallbackOnly: false }
  }

  if (detected.match) {
    const cwd = detected.aiCwd ?? detected.shellCwd ?? known?.cwd ?? fallbackCwd
    const usedFallbackOnly = !detected.aiCwd && !detected.shellCwd && !known?.cwd
    const sessionId =
      (detected.match.sessionId && isSafeSessionId(detected.match.sessionId)
        ? detected.match.sessionId
        : undefined) ?? (detected.match.tool === known?.tool ? known?.sessionId : undefined)
    const state: LastKnownTab = {
      cwd,
      tool: detected.match.tool,
      ...(sessionId ? { sessionId } : {})
    }
    return { state, usedFallbackOnly }
  }

  if (known) return { state: known, usedFallbackOnly: false }
  if (detected.shellCwd) {
    return { state: { cwd: detected.shellCwd, tool: SessionTool.None }, usedFallbackOnly: false }
  }
  return { state: { cwd: fallbackCwd, tool: SessionTool.None }, usedFallbackOnly: true }
}

/** Decide whether the on-disk snapshot may be replaced. */
export function shouldWriteSessionSnapshot(input: {
  snapshotReady: boolean
  tabCount: number
  quitting: boolean
  allDegradedToFallback: boolean
}): boolean {
  if (!input.snapshotReady) return false
  if (input.tabCount === 0) return input.quitting
  if (input.allDegradedToFallback) return false
  return true
}

/**
 * Restore startup command for one saved tab.
 *
 * Two different collapses have to be avoided, and they need different guards:
 *
 * - `codex resume --last` picks the globally most recent session, so at most
 *   one tab in the whole window may use it (`allowCodexLast`). A stored
 *   session id wins over it.
 * - `--continue` (Claude/Grok/Kimi) picks the most recent session *for the
 *   working directory*, so it collapses only among tabs that share a cwd.
 *   `allowContinue` lets one tab per (tool, cwd) group keep it; the rest get
 *   no startup command and just open a shell in that directory. An active-only
 *   guard would be far too blunt here - three Grok tabs in three different
 *   directories can all be restored correctly.
 */
export function startupCommandForRestore(
  tool: unknown,
  options: {
    resumeAi: boolean
    sessionId?: string
    allowCodexLast: boolean
    allowContinue: boolean
  }
): string | undefined {
  if (!options.resumeAi) return undefined
  if (tool === SessionTool.Codex) {
    if (options.sessionId && isSafeSessionId(options.sessionId)) {
      return `codex resume ${options.sessionId}`
    }
    return options.allowCodexLast ? 'codex resume --last' : undefined
  }
  if (!options.allowContinue) return undefined
  if (tool === SessionTool.Claude) return 'claude --continue'
  if (tool === SessionTool.Grok) return 'grok --continue'
  if (tool === SessionTool.Kimi) return 'kimi --continue'
  return undefined
}
