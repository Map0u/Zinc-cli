// Shared accelerator-string normalization, used by both the renderer's
// keydown-capture ShortcutManager and the main process's before-input-event
// fallback (M4 fix: Ctrl+Tab/Ctrl+Shift+Tab are Chromium-level accelerators
// that can be consumed before a renderer-side `window.keydown` listener ever
// sees them — main needs the exact same code -> accelerator-string mapping to
// recognize a match). Kept dependency-free (no electron/dom imports) so it
// can be imported from main, preload, and renderer alike.
import { TERMINAL_RESERVED_ACCELERATORS } from './keybindings'

/** Physical-key codes that are pure modifiers — never a complete accelerator by themselves. */
export const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight'
])

/** code -> human label for keys that don't map 1:1 onto their `code` suffix. Layout-independent (uses `code`, not `key`). */
const SPECIAL_CODE_LABELS: Record<string, string> = {
  Tab: 'Tab',
  Comma: ',',
  Equal: '=',
  Minus: '-',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Space: 'Space',
  Escape: 'Escape',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  NumpadAdd: 'NumpadAdd',
  NumpadSubtract: 'NumpadSubtract',
  NumpadMultiply: 'NumpadMultiply',
  NumpadDivide: 'NumpadDivide',
  NumpadDecimal: 'NumpadDecimal',
  NumpadEnter: 'NumpadEnter'
}

const F_KEY_RE = /^F([1-9]|1[0-9]|2[0-4])$/
const NUMPAD_DIGIT_RE = /^Numpad[0-9]$/

/** Layout-independent label for the non-modifier key of a physical `code`, or `null` while only modifiers are held. */
export function labelForCode(code: string): string | null {
  if (MODIFIER_CODES.has(code)) return null
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (F_KEY_RE.test(code)) return code
  if (NUMPAD_DIGIT_RE.test(code)) return code
  return SPECIAL_CODE_LABELS[code] ?? null
}

export interface AcceleratorModifiers {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

/** Builds a normalized "Ctrl+Shift+D"-style accelerator string, or `null` if only modifiers are held so far. */
export function acceleratorFromCodeAndModifiers(code: string, mods: AcceleratorModifiers): string | null {
  const label = labelForCode(code)
  if (label === null) return null
  const parts: string[] = []
  if (mods.ctrl) parts.push('Ctrl')
  if (mods.shift) parts.push('Shift')
  if (mods.alt) parts.push('Alt')
  if (mods.meta) parts.push('Meta')
  parts.push(label)
  return parts.join('+')
}

/**
 * Rejects an accelerator as unsafe to bind to a shortcut action: a bare/
 * Shift-only printable key (would silently swallow normal typing/paste into
 * the terminal — every DEFAULT_KEYBINDINGS entry carries Ctrl, so this never
 * conflicts with a real default), any combo involving Meta/Win (reserved for
 * OS-level window management, e.g. Win+X), or one of the terminal-reserved
 * combos in the single arbitration table (keybindings.ts's
 * TERMINAL_RESERVED_ACCELERATORS). Shared by the settings page's recording UI
 * and SettingsService.normalizeKeybindings so a hand-edited settings.json
 * can't sneak an unsafe binding in either.
 */
export function isUnsafeAccelerator(accelerator: string): boolean {
  if (TERMINAL_RESERVED_ACCELERATORS.has(accelerator)) return true
  const parts = accelerator.split('+')
  if (parts.includes('Meta')) return true
  const hasClaimingModifier = parts.includes('Ctrl') || parts.includes('Alt')
  return !hasClaimingModifier
}
