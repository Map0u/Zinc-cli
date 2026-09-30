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
  const [loadFailed, setLoadFailed] = useState(false)
  const [retrying, setRetrying] = useState(false)

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
            .catch((err2) => {
              console.error('settings:get retry failed', err2)
              if (!cancelled) setLoadFailed(true)
            })
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

  async function retryLoadSettings(): Promise<void> {
    if (retrying) return
    setRetrying(true)
    try {
      const loaded = await window.zinc.settings.get()
      setSettings(loaded)
      setLoadFailed(false)
    } catch (err) {
      console.error('settings:get manual retry failed', err)
    } finally {
      setRetrying(false)
    }
  }

  // App's splash waits for settings before creating the first tab. Replace it
  // with a real recovery path if both automatic IPC attempts fail.
  if (!settings && loadFailed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#101116] px-6 text-white">
        <div role="alert" className="w-full max-w-sm rounded-lg border border-white/15 bg-white/5 p-6 shadow-lg">
          <h1 className="text-lg font-semibold">Could not load settings</h1>
          <p className="mt-2 text-sm text-white/70">Zinc could not finish starting. Try loading your settings again.</p>
          <button
            type="button"
            className="mt-5 rounded bg-white px-4 py-2 text-sm font-medium text-[#101116] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={() => void retryLoadSettings()}
            disabled={retrying}
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      </div>
    )
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
