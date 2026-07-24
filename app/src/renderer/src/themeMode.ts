import { useEffect, useState } from 'react'
import type { ThemeMode } from './colorSchemes'
import type { ThemePreference } from '../../shared/settingsTypes'

// `window.matchMedia('(prefers-color-scheme: dark)')` measurably disagreed
// with the real OS setting on at least one machine (registry said dark,
// matchMedia said light). `nativeTheme.shouldUseDarkColors` in main is
// Electron's own dedicated, natively-implemented reader of the same OS
// setting and doesn't share that failure mode, so it's the sole source of
// truth (see main/index.ts's `theme:get`/`theme:changed`). The initial value
// is seeded via `getSync` (not `matchMedia`) so cold start never flashes the
// wrong theme before the async correction would otherwise land.
let cached: ThemeMode = window.zinc.theme.getSync()
const listeners = new Set<(mode: ThemeMode) => void>()

function setCached(mode: ThemeMode): void {
  if (mode === cached) return
  cached = mode
  for (const listener of listeners) listener(mode)
}

window.zinc.theme.get().then(setCached)
window.zinc.theme.onChange(setCached)

export function getSystemThemeMode(): ThemeMode {
  return cached
}

/** Subscribes to OS light/dark changes (sourced from main's nativeTheme); returns an unsubscribe function. */
export function onSystemThemeModeChange(callback: (mode: ThemeMode) => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/** Live-tracks the OS light/dark setting for chrome rendered by React (App.tsx/SettingsPage.tsx). */
export function useSystemThemeMode(): ThemeMode {
  const [mode, setMode] = useState(getSystemThemeMode)
  useEffect(() => {
    // The initial `theme:get()` IPC round trip can resolve (updating `cached`)
    // before this effect subscribes — a plain promise microtask can beat
    // React's passive-effect flush. Without this re-sync, that correction
    // notifies zero listeners and the component is stuck on the matchMedia
    // placeholder value forever, not just until the next real OS theme change.
    setMode(getSystemThemeMode())
    return onSystemThemeModeChange(setMode)
  }, [])
  return mode
}

/** 'auto' defers to the OS signal; an explicit 'light'/'dark' preference overrides it outright. */
export function resolveThemeMode(preference: ThemePreference, systemMode: ThemeMode): ThemeMode {
  return preference === 'auto' ? systemMode : preference
}

/** Combines the live OS signal with the user's explicit override in one hook. */
export function useResolvedThemeMode(preference: ThemePreference): ThemeMode {
  return resolveThemeMode(preference, useSystemThemeMode())
}
