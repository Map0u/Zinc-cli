/**
 * What a rail row calls a tab. The terminal's own OSC title is often useless
 * (every pwsh tab reports its exe path) or carries a status glyph (Claude
 * Code prefixes a spinner / ✳), so the label is picked in this order:
 * user rename → cleaned terminal title → cwd folder name → shell name.
 *
 * Inside a group the members share a project, so the folder name says nothing:
 * user rename → cleaned title → cwd relative to the project root (when deeper)
 * → tool name → shell name, and identical labels get an ordinal (see
 * `groupOrdinals`). Ungrouped rows never take that path.
 */

import type { TabActivityState } from '../../../shared/tabActivity'

export type TabLabelSource = 'custom' | 'title' | 'cwd' | 'tool' | 'shell'

export interface TabLabelInput {
  customTitle?: string
  /** Latest OSC 0/2 title, already whitespace-normalised. */
  title?: string
  cwd?: string | null
  shellLabel?: string
  /** Only read for a grouped row: the tab's own project root and foreground AI tool. */
  projectRoot?: string | null
  tool?: string | null
}

/** Present = the row sits inside a group. */
export interface TabGroupContext {
  /** The group's shown name; secondary text never repeats it. */
  name: string
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

/**
 * `cwd` below `root`, as a short forward-slash path (`src/main`, or `…/renderer/src`
 * when deeper than two levels). Null when `cwd` is the root itself or is not under it.
 */
export function cwdRelativeToRoot(cwd: string, root: string): string | null {
  const flat = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')
  const base = flat(root)
  const here = flat(cwd)
  if (base === '' || here.length <= base.length + 1) return null
  if (here.slice(0, base.length + 1).toLowerCase() !== `${base.toLowerCase()}/`) return null
  const parts = here.slice(base.length + 1).split('/').filter(Boolean)
  if (parts.length === 0) return null
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : parts.join('/')
}

export function resolveTabLabel(
  input: TabLabelInput,
  group?: TabGroupContext
): { label: string; source: TabLabelSource } {
  if (input.customTitle) return { label: input.customTitle, source: 'custom' }
  if (input.title && !isGenericShellTitle(input.title, input.shellLabel)) {
    const cleaned = stripStatusGlyph(input.title).trim()
    const known = !!input.cwd || (!!group && !!input.tool)
    const uninformative = STATUS_ONLY.test(cleaned) || (known && DEFAULT_AI_TITLES.has(cleaned.toLowerCase()))
    if (cleaned !== '' && !uninformative) return { label: cleaned, source: 'title' }
  }
  if (!group) {
    if (input.cwd) {
      const name = cwdBasename(input.cwd)
      if (name !== '') return { label: name, source: 'cwd' }
    }
    return { label: input.shellLabel || 'PowerShell', source: 'shell' }
  }
  if (input.cwd) {
    const relative = input.projectRoot ? cwdRelativeToRoot(input.cwd, input.projectRoot) : null
    if (relative) return { label: relative, source: 'cwd' }
    // At the project root the folder is the project, which the group already names; elsewhere it still tells tabs apart.
    const atRoot = !!input.projectRoot && cwdBasename(input.cwd).toLowerCase() === cwdBasename(input.projectRoot).toLowerCase()
    const name = atRoot ? '' : cwdBasename(input.cwd)
    if (name !== '') return { label: name, source: 'cwd' }
  }
  const tool = input.tool ? TOOL_NAMES[input.tool] : undefined
  if (tool) return { label: tool, source: 'tool' }
  return { label: input.shellLabel || 'PowerShell', source: 'shell' }
}

/**
 * Ordinal of each label among identical ones, in order: 1 for the first
 * `Claude`, 2 for the next, … A row shows the ordinal only when it is above 1.
 */
export function groupOrdinals(labels: readonly string[]): number[] {
  const seen = new Map<string, number>()
  return labels.map((label) => {
    const n = (seen.get(label) ?? 0) + 1
    seen.set(label, n)
    return n
  })
}

export function withOrdinal(label: string, ordinal: number): string {
  return ordinal > 1 ? `${label} ${ordinal}` : label
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
export function tabSecondaryText(
  options: {
    label: string
    source: TabLabelSource
    projectName?: string | null
    tool?: string | null
  },
  group?: TabGroupContext
): string | undefined {
  const { label, source } = options
  if (source === 'shell') return undefined
  const lowerLabel = label.toLowerCase()
  const project =
    options.projectName &&
    options.projectName.toLowerCase() !== lowerLabel &&
    options.projectName.toLowerCase() !== group?.name.toLowerCase()
      ? options.projectName
      : undefined
  const toolName = options.tool ? TOOL_NAMES[options.tool] : undefined
  const tool = toolName && !lowerLabel.includes(toolName.toLowerCase()) ? toolName : undefined
  const parts = source === 'cwd' ? [project, tool] : source === 'tool' ? [project] : [project ?? tool]
  const text = parts.filter(Boolean).join(' \u00b7 ')
  return text === '' ? undefined : text
}
