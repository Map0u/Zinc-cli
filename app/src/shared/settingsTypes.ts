// Shared settings types, imported by main, preload, and renderer. Kept
// dependency-free like ptyProtocol.ts (no electron/node imports).

import type { Keybindings } from './keybindings'
import type { StatusBarFieldConfig, StatusBarTool } from './statusBarFields'

/** Persisted app language preference; 'auto' follows the OS/browser locale (parity §1.2/§1.7). */
export type LanguagePref = 'auto' | 'en' | 'zh'

/** Persisted light/dark preference; 'auto' follows the OS's `prefers-color-scheme`. */
export type ThemePreference = 'auto' | 'light' | 'dark'

/** Where the chrome accent color (`--color-accent`) comes from: the selected ColorScheme's own
 * hand-picked hue, or the real Windows accent color's hue (DWM's AccentColor, Light2 shade)
 * re-harmonized into this app's own saturation/lightness register (see harmonizeAccent
 * in colorSchemes.ts) rather than used as a raw passthrough. */
export type AccentSource = 'scheme' | 'system'

/** Full shape of settings.json (parity §1.2 field list + a schema `version`). */
export interface ZincSettings {
  version: 1
  FontFamily: string
  FontSize: number
  CursorBlink: boolean
  /** Opacity of the left tab rail's background, independent of `TerminalOpacity`. */
  RailOpacity: number
  /** Opacity of the right-side terminal card's background, independent of `RailOpacity`. */
  TerminalOpacity: number
  /** Electron renderer zoom factor. 1.0 is default; valid range is 0.75-2.0. */
  UiZoom: number
  /** Linux screen brightness percent. -1 means unmanaged. */
  ScreenBrightness: number
  /** Selected two-layer palette id (chrome surface tint + terminal ANSI 16) — see renderer/src/colorSchemes.ts. */
  ColorScheme: string
  /** Light/dark preference for both the chrome and the selected ColorScheme's variant. */
  ThemePreference: ThemePreference
  /** Chrome accent color source — see `AccentSource`. */
  AccentSource: AccentSource
  /** Startup preference: when true, normal launches enter AOD immediately. */
  AodEnabled: boolean
  /** OLED protection is only active while runtime AOD mode is active. */
  BurnInProtectionEnabled: boolean
  /** Stable detected-shell id. Executable locations are resolved on every startup. */
  DefaultShellId: string
  StartingDirectory: string
  Scrollback: number
  RestoreSessionsOnStartup: boolean
  ResumeAiConversations: boolean
  ShowStatusBar: boolean
  /** Which detected tools the status bar is allowed to display (parity: default is both). */
  StatusBarEnabledTools: StatusBarTool[]
  /** Ordered, per-field on/off config for the status bar's content row. */
  StatusBarFields: StatusBarFieldConfig[]
  /** Status bar text size in px, independent of the terminal's `FontSize`. */
  StatusBarFontSize: number
  /**
   * WSL `\\wsl.localhost\<distro>\home\<user>\.codex` roots to read Codex usage
   * from (parity §2.4 hardcoded-path warning — never hardcode distro/user).
   * Empty until the first auto-probe (`detectWslCodexRoots()`) populates it.
   */
  codexSessionRoots: string[]
  Language: LanguagePref
  /** action -> normalized accelerator string; 0.2.0 configurable shortcut system (parity §1.6). */
  Keybindings: Keybindings
}

/** Partial update sent from the renderer's settings page; never carries `version`. */
export type SettingsPatch = Partial<Omit<ZincSettings, 'version'>>
