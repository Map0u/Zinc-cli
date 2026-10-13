/**
 * What a rail row calls a tab. The terminal's own OSC title is often useless
 * (every pwsh tab reports its exe path) or carries a status glyph (Claude
 * Code prefixes a spinner / ✳), so the label is picked in this order:
 * user rename → cleaned terminal title → cwd folder name → shell name.
 */

import type { TabActivityState } from '../../../shared/tabActivity'

export type TabLabelSource = 'custom' | 'title' | 'cwd' | 'shell'

export interface TabLabelInput {
  customTitle?: string
  /** Latest OSC 0/2 title, already whitespace-normalised. */
  title?: string
  cwd?: string | null
  shellLabel?: string
}

/** Tool shown as dim secondary text; keys match `TabContext['tool']`. */
const TOOL_NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex', grok: 'Grok', kimi: 'Kimi' }

// Arrows, box/geometric shapes, misc symbols, dingbats, braille and misc
// symbols-and-arrows cover the spinners and status marks AI CLIs put first
// (✳ ✻ ◐ ◑ ⠋ ● ✔ …); emoji live above U+FFFF and are deliberately kept.
const LEADING_STATUS_GLYPH = /^(?:[\u2190-\u21ff\u2500-\u27bf\u2800-\u28ff\u2b00-\u2bff·•*][\ufe0e\ufe0f]?)\s+(?=\S)/u

// A title made only of such marks: Claude's working title can be a bare ◐ / ◑.
const STATUS_ONLY = /^[\u2190-\u21ff\u2500-\u27bf\u2800-\u28ff\u2b00-\u2bff·•*\ufe0e\ufe0f\s]+$/u

/** What an AI CLI titles a tab before it has a topic; the folder name tells tabs apart better. */
const DEFAULT_AI_TITLES = new Set(['claude code', 'claude', 'codex', 'grok', 'kimi'])

/** Drops a leading spinner / status glyph and the space after it from a Claude-style title. */
export function stripStatusGlyph(title: string): string {
  return title.replace(LEADING_STATUS_GLYPH, '')
}

/**
 * True for titles that carry no information: the shell's own exe path
 * (`C:\Program Files\PowerShell\7\pwsh.exe`, optionally with arguments), a bare
 * exe name, or the shell's default name.
 */
export function isGenericShellTitle(title: string, shellLabel?: string): boolean {
  const text = title.replace(/^Administrator:\s*/i, '').trim()
  if (text === '') return true
  if (/^"?(?:[a-z]:[\\/]|\\\\)[^"<>|?*]*\.(?:exe|cmd|bat)"?(?:\s+\S.*)?$/i.test(text)) return true
  if (/^[\w.-]+\.exe$/i.test(text)) return true
  const lower = text.toLowerCase()
  if (shellLabel && lower === shellLabel.toLowerCase()) return true
  return lower === 'powershell' || lower === 'windows powershell' || lower === 'command prompt'
}

/** Last folder of a path in either slash style; a drive root reads as `C:`. */
export function cwdBasename(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, '')
  const last = trimmed.slice(Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/')) + 1)
  if (last !== '') return last
  const drive = /^([a-z]:)/i.exec(cwd)
  return drive ? drive[1] : cwd
}

export function resolveTabLabel(input: TabLabelInput): { label: string; source: TabLabelSource } {
  if (input.customTitle) return { label: input.customTitle, source: 'custom' }
  if (input.title && !isGenericShellTitle(input.title, input.shellLabel)) {
    const cleaned = stripStatusGlyph(input.title).trim()
    const uninformative = STATUS_ONLY.test(cleaned) || (!!input.cwd && DEFAULT_AI_TITLES.has(cleaned.toLowerCase()))
    if (cleaned !== '' && !uninformative) return { label: cleaned, source: 'title' }
  }
  if (input.cwd) {
    const name = cwdBasename(input.cwd)
    if (name !== '') return { label: name, source: 'cwd' }
  }
  return { label: input.shellLabel || 'PowerShell', source: 'shell' }
}

/**
 * True when a row has no status icon and no name better than the shell's own, so
 * its position number fills the slot (the only thing left to tell look-alike rows apart).
 */
export function showsPositionNumber(source: TabLabelSource, state: TabActivityState): boolean {
  return source === 'shell' && (state === 'shell' || state === 'idle')
}

/**
 * Dim text after the label, only when it says something the label does not:
 * the project for a renamed / AI-titled tab, the project and tool for a tab
 * labelled by its folder. Never for the bare shell fallback.
 */
export function tabSecondaryText(options: {
  label: string
  source: TabLabelSource
  projectName?: string | null
  tool?: string | null
}): string | undefined {
  const { label, source } = options
  if (source === 'shell') return undefined
  const lowerLabel = label.toLowerCase()
  const project =
    options.projectName && options.projectName.toLowerCase() !== lowerLabel ? options.projectName : undefined
  const toolName = options.tool ? TOOL_NAMES[options.tool] : undefined
  const tool = toolName && !lowerLabel.includes(toolName.toLowerCase()) ? toolName : undefined
  const parts = source === 'cwd' ? [project, tool] : [project ?? tool]
  const text = parts.filter(Boolean).join(' \u00b7 ')
  return text === '' ? undefined : text
}
