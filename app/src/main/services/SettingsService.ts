import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { DEFAULT_KEYBINDINGS, SHORTCUT_ACTIONS, type ShortcutAction } from '../../shared/keybindings'
import { isUnsafeAccelerator } from '../../shared/shortcutAccelerator'
import type {
  AccentSource,
  CursorStyle,
  LanguagePref,
  SettingsPatch,
  ThemePreference,
  ZincSettings
} from '../../shared/settingsTypes'
import { atomicWriteFileSync } from './atomicWrite'

const SETTINGS_VERSION = 1 as const

// 0.5.0 moved the assistant/secretary feature to its own development branch.
// Existing installations can still have relay credentials in settings.json,
// so merely ignoring unknown fields in memory is insufficient: scrub every
// legacy assistant key from disk on the first launch of the public build.
const LEGACY_ASSISTANT_SETTING_KEYS = new Set([
  'SecretaryEnabled',
  'SecretaryBaseUrl',
  'SecretaryToken',
  'SecretarySshCommand',
  'NotificationMethod'
])

// 0.6.0 removed the AI usage status bar and its supporting settings. Strip
// these keys on load so old settings.json files shrink to the current shape.
const LEGACY_STATUS_BAR_SETTING_KEYS = new Set([
  'ShowStatusBar',
  'StatusBarEnabledTools',
  'StatusBarFields',
  'StatusBarFontSize',
  'codexSessionRoots'
])

// AOD / OLED burn-in / Linux brightness were kiosk-display leftovers, not part
// of the lightweight multi-shell launcher product. Strip on load.
const LEGACY_AOD_SETTING_KEYS = new Set([
  'AodEnabled',
  'BurnInProtectionEnabled',
  'ScreenBrightness'
])

type StoredSettings = Partial<ZincSettings> & Record<string, unknown>

function containsLegacyAssistantSettings(raw: Record<string, unknown>): boolean {
  return Object.keys(raw).some((key) => key.startsWith('Secretary') || LEGACY_ASSISTANT_SETTING_KEYS.has(key))
}

function containsLegacyStatusBarSettings(raw: Record<string, unknown>): boolean {
  return Object.keys(raw).some((key) => LEGACY_STATUS_BAR_SETTING_KEYS.has(key))
}

function containsLegacyAodSettings(raw: Record<string, unknown>): boolean {
  return Object.keys(raw).some((key) => LEGACY_AOD_SETTING_KEYS.has(key))
}

const VALID_LANGUAGES: LanguagePref[] = ['auto', 'en', 'zh']
const VALID_THEME_PREFERENCES: ThemePreference[] = ['auto', 'light', 'dark']
const VALID_ACCENT_SOURCES: AccentSource[] = ['scheme', 'system']
const VALID_CURSOR_STYLES: CursorStyle[] = ['block', 'bar', 'underline']

// Kept in sync with renderer/src/colorSchemes.ts's registry ids — main never
// touches palette data itself, just validates/persists the selected id.
const VALID_COLOR_SCHEMES = [
  'monochrome',
  'grok',
  'rosePine',
  'tokyoNight',
  'vesper',
  'everforest',
  'campbell'
]

/** UI-bound numeric ranges — must match the sliders/steppers in SettingsPage.tsx. */
const NUMERIC_BOUNDS: Record<
  'FontSize' | 'Scrollback' | 'RailOpacity' | 'RailWidth' | 'TerminalOpacity' | 'UiZoom',
  { min: number; max: number }
> = {
  FontSize: { min: 8, max: 32 },
  Scrollback: { min: 500, max: 100000 },
  RailOpacity: { min: 0, max: 1 },
  // Left tab rail drag width — room for number + title + close, not wider than ~half a laptop window.
  RailWidth: { min: 160, max: 520 },
  TerminalOpacity: { min: 0, max: 1 },
  UiZoom: { min: 0.75, max: 2 }
}

function clampNumber(value: unknown, fallback: number, bounds: { min: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(bounds.min, Math.min(bounds.max, value))
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function defaultShellId(): string {
  if (process.platform === 'win32') return 'pwsh'
  const name = process.env.SHELL?.split('/').filter(Boolean).pop()
  return name || 'bash'
}

/** Older settings stored an absolute executable path. Keep migration local and never persist it again. */
function legacyShellPathToId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const path = value.toLowerCase().replace(/\//g, '\\')
  if (path.endsWith('\\pwsh.exe')) return 'pwsh'
  if (path.endsWith('\\windowspowershell\\v1.0\\powershell.exe')) return 'windows-powershell'
  if (path.endsWith('\\cmd.exe')) return 'cmd'
  if (path.endsWith('\\git\\bin\\bash.exe')) return 'git-bash'
  return fallback
}

function normalizeShellId(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function normalizeLanguage(value: unknown, fallback: LanguagePref): LanguagePref {
  return typeof value === 'string' && (VALID_LANGUAGES as string[]).includes(value) ? (value as LanguagePref) : fallback
}

function normalizeThemePreference(value: unknown, fallback: ThemePreference): ThemePreference {
  return typeof value === 'string' && (VALID_THEME_PREFERENCES as string[]).includes(value)
    ? (value as ThemePreference)
    : fallback
}

function normalizeColorScheme(value: unknown, fallback: string): string {
  return typeof value === 'string' && VALID_COLOR_SCHEMES.includes(value) ? value : fallback
}

function normalizeAccentSource(value: unknown, fallback: AccentSource): AccentSource {
  return typeof value === 'string' && (VALID_ACCENT_SOURCES as string[]).includes(value)
    ? (value as AccentSource)
    : fallback
}

function normalizeCursorStyle(value: unknown, fallback: CursorStyle): CursorStyle {
  return typeof value === 'string' && (VALID_CURSOR_STYLES as string[]).includes(value)
    ? (value as CursorStyle)
    : fallback
}

/**
 * Rejects a hand-edited (or otherwise malformed) settings.json where two
 * actions were given the same accelerator. Without this, `rebuildReverse()`
 * in the renderer's ShortcutManager would let whichever action iterates last
 * silently win the Map slot, leaving the earlier action's shortcut dead with
 * no warning to the user. Resolution: first-listed action (SHORTCUT_ACTIONS
 * order) keeps the accelerator, every later duplicate is disabled (cleared to
 * `''`) and logged.
 */
function dedupeKeybindings(bindings: ZincSettings['Keybindings']): ZincSettings['Keybindings'] {
  const result = { ...bindings }
  const owners = new Map<string, ShortcutAction>()
  for (const action of SHORTCUT_ACTIONS as ShortcutAction[]) {
    const accelerator = result[action]
    if (!accelerator) continue
    const owner = owners.get(accelerator)
    if (owner) {
      console.warn(
        `[SettingsService] settings.json has "${accelerator}" bound to both "${owner}" and "${action}" — disabling "${action}"'s binding.`
      )
      result[action] = ''
    } else {
      owners.set(accelerator, action)
    }
  }
  return result
}

function normalizeKeybindings(
  value: unknown,
  fallback: ZincSettings['Keybindings']
): ZincSettings['Keybindings'] {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const result = { ...fallback }
  for (const action of SHORTCUT_ACTIONS as ShortcutAction[]) {
    const bound = raw[action]
    if (typeof bound !== 'string') continue
    if (bound === 'Ctrl+W') {
      result[action] = DEFAULT_KEYBINDINGS[action]
      continue
    }
    if (bound !== '' && isUnsafeAccelerator(bound)) {
      console.warn(
        `[SettingsService] settings.json binds "${action}" to unsafe accelerator "${bound}" (would swallow core terminal input) — ignoring.`
      )
      continue
    }
    result[action] = bound
  }
  return dedupeKeybindings(result)
}

/**
 * Discards unknown/malformed fields and clamps/coerces every known field to
 * its valid runtime shape. Applied to both a freshly-loaded settings.json
 * (which may be hand-edited or stale from an older build) and every incoming
 * `SettingsPatch` (which may carry out-of-range or malformed values from a
 * misbehaving renderer) — never lets an invalid value reach runtime consumers.
 */
function normalizeSettings(raw: Partial<ZincSettings>, base: ZincSettings): ZincSettings {
  return {
    version: SETTINGS_VERSION,
    FontFamily: normalizeString(raw.FontFamily, base.FontFamily),
    FontSize: clampNumber(raw.FontSize, base.FontSize, NUMERIC_BOUNDS.FontSize),
    CursorBlink: normalizeBoolean(raw.CursorBlink, base.CursorBlink),
    CursorStyle: normalizeCursorStyle(raw.CursorStyle, base.CursorStyle),
    RailOpacity: clampNumber(raw.RailOpacity, base.RailOpacity, NUMERIC_BOUNDS.RailOpacity),
    RailWidth: clampNumber(raw.RailWidth, base.RailWidth, NUMERIC_BOUNDS.RailWidth),
    TerminalOpacity: clampNumber(raw.TerminalOpacity, base.TerminalOpacity, NUMERIC_BOUNDS.TerminalOpacity),
    UiZoom: clampNumber(raw.UiZoom, base.UiZoom, NUMERIC_BOUNDS.UiZoom),
    ColorScheme: normalizeColorScheme(raw.ColorScheme, base.ColorScheme),
    ThemePreference: normalizeThemePreference(raw.ThemePreference, base.ThemePreference),
    AccentSource: normalizeAccentSource(raw.AccentSource, base.AccentSource),
    DefaultShellId: normalizeShellId(
      raw.DefaultShellId,
      legacyShellPathToId((raw as { ShellPath?: unknown }).ShellPath, base.DefaultShellId)
    ),
    StartingDirectory: normalizeString(raw.StartingDirectory, base.StartingDirectory),
    Scrollback: clampNumber(raw.Scrollback, base.Scrollback, NUMERIC_BOUNDS.Scrollback),
    RestoreSessionsOnStartup: normalizeBoolean(raw.RestoreSessionsOnStartup, base.RestoreSessionsOnStartup),
    ResumeAiConversations: normalizeBoolean(raw.ResumeAiConversations, base.ResumeAiConversations),
    Language: normalizeLanguage(raw.Language, base.Language),
    Keybindings: normalizeKeybindings(raw.Keybindings, base.Keybindings)
  }
}

/** Continuous controls (font size / scrollback / opacity commit) debounce their save by this long (parity §1.2). */
const DEBOUNCE_MS = 250

function defaultSettings(): ZincSettings {
  return {
    version: SETTINGS_VERSION,
    FontFamily: 'JetBrains Mono',
    FontSize: 16,
    CursorBlink: true,
    CursorStyle: 'block',
    // 0 (not the old app's opaque 1.0 default): a fresh install shows raw
    // Mica on both the rail and the terminal card until the user opts into a
    // solid tint on either one independently.
    RailOpacity: 0,
    // Matches the long-standing fixed rail width before drag-resize.
    RailWidth: 260,
    TerminalOpacity: 0,
    UiZoom: 1,
    ColorScheme: 'monochrome',
    ThemePreference: 'auto',
    AccentSource: 'scheme',
    DefaultShellId: defaultShellId(),
    // Parity §1.2: the WinUI default hardcoded a dev-machine path; 0.2.0 uses the
    // current user's profile dir instead (Windows' %USERPROFILE%).
    StartingDirectory: homedir(),
    Scrollback: 10000,
    RestoreSessionsOnStartup: true,
    ResumeAiConversations: true,
    Language: 'auto',
    Keybindings: { ...DEFAULT_KEYBINDINGS }
  }
}

/**
 * Owns settings.json (in `app.getPath('userData')`) plus the two commit modes
 * the WinUI original used: discrete controls apply+save immediately and
 * cancel any pending debounce; continuous controls (slider/number box drags)
 * merge into in-memory state right away but debounce the disk write 250ms.
 * `flush()` is the escape hatch for `before-quit`, guaranteeing no debounced
 * edit is ever lost on exit.
 */
export class SettingsService {
  private settings: ZincSettings
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<(settings: ZincSettings) => void>()

  constructor(private readonly filePath: string) {
    this.settings = this.load()
  }

  private load(): ZincSettings {
    try {
      if (existsSync(this.filePath)) {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
        const raw: StoredSettings =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as StoredSettings) : {}
        const normalized = normalizeSettings(raw, defaultSettings())

        if (
          containsLegacyAssistantSettings(raw) ||
          containsLegacyStatusBarSettings(raw) ||
          containsLegacyAodSettings(raw) ||
          Object.prototype.hasOwnProperty.call(raw, 'ShellPath')
        ) {
          try {
            atomicWriteFileSync(this.filePath, JSON.stringify(normalized, null, 2))
          } catch {
            // Never echo the removed values: they may include a relay token,
            // private host, username, or command containing a key path.
            console.error('[SettingsService] failed to remove legacy settings keys')
          }
        }

        return normalized
      }
    } catch (err) {
      // Corrupt/unreadable settings.json must never block startup — fall back silently.
      console.warn(`[SettingsService] failed to load ${this.filePath}, falling back to defaults`, err)
    }
    return defaultSettings()
  }

  get(): ZincSettings {
    return this.settings
  }

  /** Fires on every applied change (immediate or debounce-committed), not on every debounced keystroke's save-timer reset. */
  onChange(listener: (settings: ZincSettings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Discrete controls (toggles, combo boxes, textbox-on-blur): apply + save now, cancel any pending debounce. */
  updateImmediate(patch: SettingsPatch): ZincSettings {
    this.cancelDebounce()
    this.settings = normalizeSettings({ ...this.settings, ...patch }, this.settings)
    this.persist()
    this.notify()
    return this.settings
  }

  /** Continuous controls: merge into in-memory state now (renderer/terminal see it immediately), debounce the disk write. */
  updateDebounced(patch: SettingsPatch): ZincSettings {
    this.settings = normalizeSettings({ ...this.settings, ...patch }, this.settings)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.persist()
    }, DEBOUNCE_MS)
    this.notify()
    return this.settings
  }

  /** Forces any pending debounced write to disk synchronously. Call this from `before-quit`. */
  flush(): void {
    if (!this.debounceTimer) return
    clearTimeout(this.debounceTimer)
    this.debounceTimer = null
    this.persist()
  }

  private cancelDebounce(): void {
    if (!this.debounceTimer) return
    clearTimeout(this.debounceTimer)
    this.debounceTimer = null
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.settings)
  }

  private persist(): void {
    try {
      atomicWriteFileSync(this.filePath, JSON.stringify(this.settings, null, 2))
    } catch (err) {
      // Best-effort write — a failed save must not crash the app.
      console.error(`[SettingsService] failed to persist ${this.filePath}`, err)
    }
  }
}
