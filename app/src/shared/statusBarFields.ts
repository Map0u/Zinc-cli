// Shared status-bar field model: single source of truth for which fields
// exist, their default order, and which AI tools the bar can show — imported
// by main (defaults/normalization + worker-side provider filtering) and the
// renderer (live StatusBar + the settings page's field list/preview), so
// none of those three consumers can drift out of sync with each other.

export type StatusBarFieldId =
  | 'model'
  | 'effort'
  | 'contextTokens'
  | 'primaryUsage'
  | 'secondaryUsage'
  | 'cost'

export interface StatusBarFieldConfig {
  id: StatusBarFieldId
  on: boolean
}

/** Default display order — matches the pre-0.2.1 hardcoded render order. */
export const STATUS_BAR_FIELD_IDS: StatusBarFieldId[] = [
  'model',
  'effort',
  'contextTokens',
  'primaryUsage',
  'secondaryUsage',
  'cost'
]

export const DEFAULT_STATUS_BAR_FIELDS: StatusBarFieldConfig[] = STATUS_BAR_FIELD_IDS.map((id) => ({
  id,
  on: true
}))

/** AI tools the status bar can detect (parity §1.3's codex/claude detection). */
export type StatusBarTool = 'claude' | 'codex'

export const STATUS_BAR_TOOLS: StatusBarTool[] = ['claude', 'codex']
