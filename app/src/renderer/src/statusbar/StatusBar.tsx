import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { useSettings } from '../settings/SettingsContext'
import { getColorScheme, resolveVariant, type SchemeVariant } from '../colorSchemes'
import { useResolvedThemeMode } from '../themeMode'
import { DEFAULT_STATUS_BAR_FIELDS, type StatusBarFieldConfig } from '../../../shared/statusBarFields'
import type { AiStatusPayload } from '../../../shared/aiStatusProtocol'
import { StatusBarFieldsRow } from './StatusBarRow'

function StatusBarContent({
  payload,
  scheme,
  fields,
  fontSize
}: {
  payload: AiStatusPayload
  scheme: SchemeVariant
  fields: StatusBarFieldConfig[]
  fontSize: number
}): JSX.Element | null {
  const { t } = useI18n()
  const muted = scheme.ansi.brightBlack as string
  const fg = scheme.ansi.foreground as string

  if (payload.state === 'empty') return null

  if (payload.state === 'noData') {
    return (
      <div className="flex h-full items-center gap-2 px-4" style={{ color: muted, fontSize }}>
        <span className="font-medium" style={{ color: fg }}>
          {payload.label}
        </span>
        <span>{t('NoSessionData')}</span>
      </div>
    )
  }

  return <StatusBarFieldsRow snapshot={payload.snapshot} fields={fields} fontSize={fontSize} scheme={scheme} />
}

/**
 * Bottom-right AI usage status bar (parity §1.3). A single stable component
 * with one always-mounted subscription — state changes just swap which inner
 * fragment renders, never remounting the outer bar (mirrors the WinUI
 * original's H3 "rebuild the control tree only on form change" optimization,
 * which for React just falls out of normal prop-driven re-rendering).
 *
 * Show/hide is one slide (translateY + opacity) driven by a single
 * `shouldShow` boolean, reused for all three triggers: the ShowStatusBar
 * setting, the settings page being open, and — per advisor's animation-design
 * review — the active-tab switch. That last one is event-driven, not a
 * content-diff pulse: `collapsed` flips true the instant `activeId` changes
 * (no data needed yet — you just switched) and flips false only once the
 * detection worker's payload for the new tab actually arrives. That ordering
 * is what keeps the previous tab's stale label/usage from ever flashing on
 * screen during the detection round-trip — the bar is retracted for exactly
 * that window, then pops up already showing the right tab's content.
 *
 * `MIN_COLLAPSE_MS` exists because that round-trip isn't always slow: a
 * same-machine Claude read lands in ~20ms, well under the transition's
 * 220ms — without a floor, the retract would reverse before it's ever
 * perceptible, silently dropping the 弹出-收回-弹出 cue the user asked for
 * on every fast switch. Holding the collapse open for at least this long
 * (measured advisor round-trip: Claude ~20ms, Codex's WSL .jsonl read
 * ~400-500ms — both comfortably inside a 150ms floor without ever forcing
 * the *slow* case to wait longer than it already does) makes the retract
 * reliably visible regardless of how fast detection actually finishes.
 */
const MIN_COLLAPSE_MS = 150

export function StatusBar({
  visible,
  activeId
}: {
  visible: boolean
  activeId: string | null
}): JSX.Element {
  const [payload, setPayload] = useState<AiStatusPayload>({ state: 'empty' })
  const [collapsed, setCollapsed] = useState(false)
  const prevActiveId = useRef(activeId)
  const collapsedAt = useRef<number | null>(null)
  const popTimer = useRef<number | null>(null)
  const { settings } = useSettings()
  const themeMode = useResolvedThemeMode(settings?.ThemePreference ?? 'auto')
  const scheme = resolveVariant(getColorScheme(settings?.ColorScheme), themeMode)

  function clearPopTimer(): void {
    if (popTimer.current !== null) {
      window.clearTimeout(popTimer.current)
      popTimer.current = null
    }
  }

  useEffect(() => {
    return window.zinc.aiStatus.onUpdate((next) => {
      setPayload(next)
      clearPopTimer()
      const elapsed = collapsedAt.current === null ? Infinity : performance.now() - collapsedAt.current
      if (elapsed >= MIN_COLLAPSE_MS) {
        setCollapsed(false)
      } else {
        popTimer.current = window.setTimeout(() => setCollapsed(false), MIN_COLLAPSE_MS - elapsed)
      }
    })
  }, [])

  useEffect(() => {
    if (prevActiveId.current === activeId) return
    prevActiveId.current = activeId
    clearPopTimer()
    collapsedAt.current = performance.now()
    setCollapsed(true)
  }, [activeId])

  useEffect(() => clearPopTimer, [])

  const shouldShow = visible && payload.state !== 'empty' && !collapsed

  return (
    <div
      className="h-full transition-[transform,opacity] duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{
        transform: shouldShow ? 'translateY(0)' : 'translateY(100%)',
        opacity: shouldShow ? 1 : 0
      }}
    >
      <StatusBarContent
        payload={payload}
        scheme={scheme}
        fields={settings?.StatusBarFields ?? DEFAULT_STATUS_BAR_FIELDS}
        fontSize={settings?.StatusBarFontSize ?? 12}
      />
    </div>
  )
}
