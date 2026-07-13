/// <reference path="../../../preload/index.d.ts" />
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { SettingsPatch, ZincSettings } from '../../../shared/settingsTypes'

interface SettingsContextValue {
  /** `null` until the initial `settings:get` round trip resolves. */
  settings: ZincSettings | null
  updateImmediate: (patch: SettingsPatch) => void
  updateDebounced: (patch: SettingsPatch) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

/**
 * Single source of truth for settings in the renderer. Main process owns the
 * actual persisted state (SettingsService); this just mirrors it into React
 * state for the settings page and other consumers (App.tsx's new-tab spawn
 * defaults, the i18n provider's language preference).
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ZincSettings | null>(null)

  useEffect(() => {
    let cancelled = false
    window.zinc.settings
      .get()
      .then((s) => {
        if (!cancelled) setSettings(s)
      })
      .catch((err) => {
        // Initial IPC round trip failed — fall back to main's defaults via a
        // retry rather than leaving `settings` null forever (blocks the first
        // terminal tab / TerminalHost mount).
        console.error('settings:get failed, retrying', err)
        if (!cancelled) {
          window.zinc.settings
            .get()
            .then((s) => {
              if (!cancelled) setSettings(s)
            })
            .catch((err2) => console.error('settings:get retry failed', err2))
        }
      })
    const unsubscribe = window.zinc.settings.onChange((s) => {
      if (!cancelled) setSettings(s)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  function updateImmediate(patch: SettingsPatch): void {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
    window.zinc.settings.updateImmediate(patch)
  }

  function updateDebounced(patch: SettingsPatch): void {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
    window.zinc.settings.updateDebounced(patch)
  }

  return (
    <SettingsContext.Provider value={{ settings, updateImmediate, updateDebounced }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider')
  return ctx
}
