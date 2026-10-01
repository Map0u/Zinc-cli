// Pure session-persist policy: last-known cwd/tool merge, write guards, and
// restore-command selection. Kept dependency-free so unit tests can load it
// without Electron or native process inspection.

import { identifyToolFromCommandLine } from './aiCliTools'
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
  /** A live PTY is required before an empty scan proves the AI process exited. */
  ptyAlive?: boolean
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
  if (identifyToolFromCommandLine(commandLine) !== 'codex') return undefined
  // Search argv, not the raw line: prose inside a quoted prompt may contain
  // `resume <id>` but is not a Codex subcommand.
  const args = [...commandLine.matchAll(/"([^"]*)"|'([^']*)'|([^\s"']+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3]
  )
  const cliIndex = args.findIndex((arg) =>
    /(?:^|[\\/])codex(?:\.(?:exe|cmd|ps1|js|mjs|cjs))?$/i.test(arg) ||
    /(?:^|[\\/])@openai[\\/]codex[\\/](?:[^\\/]+[\\/])*cli\.(?:js|mjs|cjs)$/i.test(arg)
  )
  if (cliIndex < 0) {
    // Shell wrappers can put the entire real command in one quoted argument.
    const shell = args[0]?.split(/[\\/]/).at(-1)?.toLowerCase()
    const commandIndex = args.findIndex((arg, index) => index > 0 && (
      (/^cmd(?:\.exe)?$/.test(shell ?? '') && /^\/(?:c|k)$/i.test(arg)) ||
      (/^(?:pwsh|powershell)(?:\.exe)?$/.test(shell ?? '') && /^(?:-command|-c)$/i.test(arg)) ||
      (/^(?:sh|bash|zsh|fish)(?:\.exe)?$/.test(shell ?? '') && /^-.*c$/.test(arg))
    ))
    return commandIndex < 0 ? undefined : extractCodexSessionId(args.slice(commandIndex + 1).join(' '))
  }
  if (args[cliIndex + 1]?.toLowerCase() !== 'resume') return undefined
  const next = args[cliIndex + 2]
  const id = next === '--session' || next === '--session-id' ? args[cliIndex + 3] : next
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
    // Only the id read from THIS process is persisted. A fresh same-tool
    // process without a resolvable id (plain `codex`, or a `claude` launched
    // through a path the hook did not cover) must NOT inherit the previous
    // session's id — resuming the wrong conversation is worse than falling
    // back to a plain shell.
    const sessionId =
      detected.match.sessionId && isSafeSessionId(detected.match.sessionId)
        ? detected.match.sessionId
        : undefined
    const state: LastKnownTab = {
      cwd,
      tool: detected.match.tool,
      ...(sessionId ? { sessionId } : {})
    }
    return { state, usedFallbackOnly }
  }

  if (known) {
    // A completed scan proves the AI exited only when the tab's PTY is still
    // alive. A dead PTY (or failed cwd read) can produce the same null match;
    // keep the last good row instead of erasing its restore identity.
    const ptyAlive = detected.ptyAlive ?? detected.shellCwd !== null
    if (!ptyAlive || !detected.shellCwd) return { state: known, usedFallbackOnly: false }
    // A conversation outlives its process: the CLI stores it on disk, so a tab
    // whose Claude was quit hours ago still resumes exactly with its id. No
    // AI process at all is therefore NOT evidence that the identity is stale —
    // drop it only when a live process reported an unusable id, which the
    // `detected.match` branch above already handles. Keep `known.cwd` too: the
    // conversation belongs to the directory it ran in, and resuming it from a
    // directory the user later cd'd into would attach it to the wrong project.
    if (known.sessionId) return { state: known, usedFallbackOnly: false }
    return { state: { cwd: detected.shellCwd, tool: SessionTool.None }, usedFallbackOnly: false }
  }
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
    /** Per-process `--settings` path that registers the SessionStart binding hook. */
    claudeSettings?: string
  }
): string | undefined {
  if (!options.resumeAi) return undefined
  const sid = options.sessionId && isSafeSessionId(options.sessionId) ? options.sessionId : undefined
  if (tool === SessionTool.Codex) {
    if (sid) return `codex resume ${sid}`
    return options.allowCodexLast ? 'codex resume --last' : undefined
  }
  // `--settings` lets the SessionStart hook report this run's session id back
  // to Zinc, so the NEXT restart can resume it exactly instead of --continue.
  const claudeSettingsArg = options.claudeSettings ? ` --settings "${options.claudeSettings}"` : ''
  // A known session id resumes exactly that conversation — this is what lets
  // several Claude tabs in one directory each come back, where --continue
  // could only ever restore the newest one.
  if (sid) {
    if (tool === SessionTool.Claude) return `claude --resume ${sid}${claudeSettingsArg}`
    return undefined
  }
  if (!options.allowContinue) return undefined
  if (tool === SessionTool.Claude) return `claude --continue${claudeSettingsArg}`
  if (tool === SessionTool.Grok) return 'grok --continue'
  if (tool === SessionTool.Kimi) return 'kimi --continue'
  return undefined
}
