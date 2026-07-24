// Shared settings types, imported by main, preload, and renderer. Kept
// dependency-free like ptyProtocol.ts (no electron/node imports).

import type { Keybindings } from './keybindings'

/** Persisted app language preference; 'auto' follows the OS/browser locale (parity §1.2/§1.7). */
export type LanguagePref = 'auto' | 'en' | 'zh'

/** Persisted light/dark preference; 'auto' follows the OS's `prefers-color-scheme`. */
export type ThemePreference = 'auto' | 'light' | 'dark'

/** Where the chrome accent color (`--color-accent`) comes from: the selected ColorScheme's own
 * hand-picked hue, or the real Windows accent color's hue (DWM's AccentColor, Light2 shade)
 * re-harmonized into this app's own saturation/lightness register (see harmonizeAccent
 * in colorSchemes.ts) rather than used as a raw passthrough. */
export type AccentSource = 'scheme' | 'system'

/** xterm.js cursor shape — block (filled cell), bar (I-beam), or underline. */
export type CursorStyle = 'block' | 'bar' | 'underline'

/** Full shape of settings.json (parity §1.2 field list + a schema `version`). */
export interface ZincSettings {
  version: 1
  FontFamily: string
  FontSize: number
  CursorBlink: boolean
  /** Terminal cursor shape; applied live to open tabs via TerminalOptionsPush. */
  CursorStyle: CursorStyle
  /** Opacity of the left tab rail's background, independent of `TerminalOpacity`. */
  RailOpacity: number
  /** Width in CSS pixels of the left tab rail (drag-resized; clamped in SettingsService). */
  RailWidth: number
  /** Opacity of the right-side terminal card's background, independent of `RailOpacity`. */
  TerminalOpacity: number
  /** Electron renderer zoom factor. 1.0 is default; valid range is 0.75-2.0. */
  UiZoom: number
  /** Selected two-layer palette id (chrome surface tint + terminal ANSI 16) — see renderer/src/colorSchemes.ts. */
  ColorScheme: string
  /** Light/dark preference for both the chrome and the selected ColorScheme's variant. */
  ThemePreference: ThemePreference
  /** Chrome accent color source — see `AccentSource`. */
  AccentSource: AccentSource
  /** Stable detected-shell id. Executable locations are resolved on every startup. */
  DefaultShellId: string
  StartingDirectory: string
  Scrollback: number
  RestoreSessionsOnStartup: boolean
  /** When restoring tabs, auto-run claude/codex/grok resume commands if a tool was detected. */
  ResumeAiConversations: boolean
  Language: LanguagePref
  /** action -> normalized accelerator string; configurable shortcut system. */
  Keybindings: Keybindings
}

/** Partial update sent from the renderer's settings page; never carries `version`. */
export type SettingsPatch = Partial<Omit<ZincSettings, 'version'>>
