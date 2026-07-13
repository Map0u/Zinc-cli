import { formatK, formatPercent, formatReset, usageBand } from '../../../shared/aiStatusProtocol'
import type { AiStatusSnapshot, UsageWindow } from '../../../shared/aiStatusProtocol'
import type { StatusBarFieldConfig, StatusBarFieldId } from '../../../shared/statusBarFields'
import type { SchemeVariant } from '../colorSchemes'

const STATUS_BAR_FONT_SIZE_MIN = 8
const STATUS_BAR_FONT_SIZE_MAX = 32

/**
 * Keeps the live bar and Settings preview tall enough for every supported
 * font size. The live host is an absolute overlay (see App.tsx), so changing
 * this height never changes the terminal host's measured box or resizes PTYs.
 */
export function getStatusBarHeight(fontSize: number): number {
  const safeFontSize = Math.min(STATUS_BAR_FONT_SIZE_MAX, Math.max(STATUS_BAR_FONT_SIZE_MIN, fontSize))
  return Math.max(32, Math.ceil(safeFontSize * 1.35) + 8)
}

/** Usage band -> the scheme's own ANSI slot, so the bar reads consistently with whatever's rendering inside the tab (parity §1.3: <60% default, 60-85% yellow, >=85% red). */
function bandColor(band: ReturnType<typeof usageBand>, scheme: SchemeVariant): string {
  switch (band) {
    case 'warning':
      return scheme.ansi.yellow as string
    case 'critical':
      return scheme.ansi.red as string
    default:
      return scheme.ansi.brightBlack as string
  }
}

export function UsageBar({
  window: win,
  title,
  scheme
}: {
  window: UsageWindow
  title: string
  scheme: SchemeVariant
}): JSX.Element {
  const band = usageBand(win.usedPercent)
  const width = win.usedPercent != null ? Math.min(100, Math.max(0, win.usedPercent)) : 0
  return (
    <div className="flex items-center gap-1.5" title={title}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: scheme.ansi.black as string }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${width}%`, background: bandColor(band, scheme) }}
        />
      </div>
      <span className="tabular-nums" style={{ color: scheme.ansi.brightBlack as string }}>
        {formatPercent(win.usedPercent)}
      </span>
      <span style={{ color: scheme.ansi.brightBlack as string }}>·</span>
      <span className="tabular-nums" style={{ color: scheme.ansi.brightBlack as string }}>
        {formatReset(win.resetsAtEpoch)}
      </span>
    </div>
  )
}

function renderField(
  id: StatusBarFieldId,
  snapshot: AiStatusSnapshot,
  scheme: SchemeVariant,
  muted: string
): JSX.Element | null {
  switch (id) {
    case 'model':
      return (
        <span key="model" style={{ color: muted }}>
          {snapshot.model}
        </span>
      )
    case 'effort':
      return snapshot.effort ? (
        <span key="effort" style={{ color: muted }}>
          {snapshot.effort}
        </span>
      ) : null
    case 'contextTokens':
      return (
        <span key="contextTokens" className="tabular-nums" style={{ color: muted }}>
          {snapshot.contextTokens == null || snapshot.contextTokens <= 0 ? '–' : formatK(snapshot.contextTokens)} ctx
        </span>
      )
    case 'primaryUsage':
      return <UsageBar key="primaryUsage" window={snapshot.primary} title="5h" scheme={scheme} />
    case 'secondaryUsage':
      return <UsageBar key="secondaryUsage" window={snapshot.secondary} title="7d" scheme={scheme} />
    case 'cost':
      return snapshot.dailyCost != null || snapshot.weeklyCost != null ? (
        <span key="cost" className="tabular-nums" style={{ color: scheme.ansi.green as string }}>
          {snapshot.dailyCost ?? '-$'} / {snapshot.weeklyCost ?? '-$'}
        </span>
      ) : null
    default:
      return null
  }
}

/**
 * Renders one tool's usage snapshot as a row of fields, driven entirely by
 * `fields` (order + on/off) and `fontSize` — the single render path shared by
 * the live status bar (StatusBar.tsx) and the settings page's preview, so the
 * preview can never drift from what actually gets shown.
 */
export function StatusBarFieldsRow({
  snapshot,
  fields,
  fontSize,
  scheme
}: {
  snapshot: AiStatusSnapshot
  fields: StatusBarFieldConfig[]
  fontSize: number
  scheme: SchemeVariant
}): JSX.Element {
  const muted = scheme.ansi.brightBlack as string
  const fg = scheme.ansi.foreground as string
  const safeFontSize = Math.min(STATUS_BAR_FONT_SIZE_MAX, Math.max(STATUS_BAR_FONT_SIZE_MIN, fontSize))
  return (
    <div
      className="flex h-full min-h-full items-center gap-3 whitespace-nowrap px-4"
      style={{ color: muted, fontSize: safeFontSize, lineHeight: 1.25 }}
    >
      <span className="font-medium" style={{ color: fg }}>
        {snapshot.label}
      </span>
      {fields.filter((f) => f.on).map((f) => renderField(f.id, snapshot, scheme, muted))}
    </div>
  )
}
