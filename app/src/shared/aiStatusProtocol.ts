// Shared AI-usage-status types + pure formatting helpers, imported by main,
// preload, and renderer. Kept dependency-free (no electron/node imports) so
// the renderer's status bar can format the same values main computed without
// re-deriving them, and so the IPC payload shape is typed on both ends.

export interface UsageWindow {
  usedPercent: number | null
  resetsAtEpoch: number | null
}

export interface AiStatusSnapshot {
  label: string
  model: string
  effort: string
  contextTokens: number | null
  primary: UsageWindow
  secondary: UsageWindow
  dailyCost: string | null
  weeklyCost: string | null
}

/**
 * Pushed from main to the renderer on every poll tick (parity §1.3's three
 * status-bar forms): `empty` when no codex/claude process is running in the
 * active tab's shell tree, `noData` when one is detected but its usage data
 * file couldn't be read, `usage` for the full display.
 */
export type AiStatusPayload =
  | { state: 'empty' }
  | { state: 'noData'; label: string }
  | { state: 'usage'; snapshot: AiStatusSnapshot }

/** "41%" style percentage, "?%" when unknown. */
export function formatPercent(value: number | null): string {
  return value != null ? `${Math.round(value)}%` : '?%'
}

/** Remaining time until an epoch-seconds reset: 34m / 2h5m / 3d4h, "--" when unknown/expired. */
export function formatReset(epochSeconds: number | null): string {
  if (epochSeconds == null || epochSeconds <= 0) {
    return '--'
  }
  const remaining = epochSeconds - Math.floor(Date.now() / 1000)
  if (remaining <= 0) {
    return '--'
  }
  if (remaining >= 86400) {
    return `${Math.floor(remaining / 86400)}d${Math.floor((remaining % 86400) / 3600)}h`
  }
  if (remaining >= 3600) {
    return `${Math.floor(remaining / 3600)}h${Math.floor((remaining % 3600) / 60)}m`
  }
  return `${Math.max(1, Math.floor(remaining / 60))}m`
}

/** Token count in thousands: "12k". */
export function formatK(tokens: number): string {
  return tokens <= 0 ? '0k' : `${Math.round(tokens / 1000)}k`
}

/** Usage-bar color band: <60% default, 60-85% yellow, >=85% red (parity §1.3). */
export function usageBand(percent: number | null): 'default' | 'warning' | 'critical' {
  if (percent == null) return 'default'
  if (percent >= 85) return 'critical'
  if (percent >= 60) return 'warning'
  return 'default'
}
