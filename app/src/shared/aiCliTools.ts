// Dependency-free AI CLI identifiers shared by session restore and process
// detection. Kept free of electron/node/koffi so unit tests can load it without
// native bindings.

export type AiCliTool = 'codex' | 'claude' | 'grok'

// Order is priority when multiple CLIs appear under one shell (Codex first,
// then Claude, then Grok Build). First matching tool in this list wins.
const TOOL_PATTERNS: ReadonlyArray<readonly [AiCliTool, RegExp]> = [
  ['codex', /(?:^|[\\/\s"'])codex(?:\.cmd|\.ps1|\.exe)?(?=$|[\\/\s"'])/i],
  ['claude', /(?:^|[\\/\s"'])claude(?:\.cmd|\.ps1|\.exe)?(?=$|[\\/\s"'])/i],
  // Grok Build TUI ships as `grok` / `grok.exe` (and shell wrappers).
  ['grok', /(?:^|[\\/\s"'])grok(?:\.cmd|\.ps1|\.exe)?(?=$|[\\/\s"'])/i]
]

/**
 * Pure command-line classifier used by process-tree detection and unit tests.
 * TOOL_PATTERNS order is the priority (first match wins).
 */
export function identifyToolFromCommandLine(commandLine: string): AiCliTool | null {
  for (const [tool, pattern] of TOOL_PATTERNS) {
    if (pattern.test(commandLine)) return tool
  }
  return null
}

/** Every AI CLI Zinc can detect and resume, in detection priority order. */
export const AI_CLI_TOOLS: readonly AiCliTool[] = TOOL_PATTERNS.map(([tool]) => tool)
