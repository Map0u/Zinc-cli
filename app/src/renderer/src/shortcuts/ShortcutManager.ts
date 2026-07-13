import { DEFAULT_KEYBINDINGS, type Keybindings, type ShortcutAction } from '../../../shared/keybindings'
import { acceleratorFromCodeAndModifiers } from '../../../shared/shortcutAccelerator'

/** Builds a normalized "Ctrl+Shift+D"-style accelerator string from a KeyboardEvent, or `null` if only modifiers are held so far. */
export function acceleratorFromEvent(event: KeyboardEvent): string | null {
  return acceleratorFromCodeAndModifiers(event.code, {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey
  })
}

type Handler = () => void

const DEFAULT_ZOOM_ALIASES: Partial<Record<ShortcutAction, readonly string[]>> = {
  zoomIn: ['Ctrl+Shift+=', 'Ctrl+NumpadAdd'],
  zoomOut: ['Ctrl+NumpadSubtract'],
  resetZoom: ['Ctrl+Numpad0']
}

/**
 * Global shortcut dispatcher. Listens on `window` at the capture phase (fires
 * before the event can reach xterm's own DOM handlers) and only intercepts
 * (preventDefault + stopImmediatePropagation) keys that exactly match a bound
 * accelerator — every other key passes through untouched, so normal typing
 * and Ctrl+C reach the terminal exactly as before (project rule: never eat
 * unmatched keys).
 *
 * Seeded with DEFAULT_KEYBINDINGS at construction so shortcuts work during the
 * async gap before the renderer's `settings:get` round trip resolves.
 */
export class ShortcutManager {
  private bindings: Keybindings = { ...DEFAULT_KEYBINDINGS }
  /** accelerator -> action, rebuilt wholesale on every setBindings() call so a rebound key's old accelerator stops resolving. */
  private reverse = new Map<string, ShortcutAction>()
  private readonly handlers = new Map<ShortcutAction, Handler>()
  private enabled = true

  constructor() {
    this.rebuildReverse()
    window.addEventListener('keydown', this.onKeyDown, { capture: true })
    // Main-process fallback (M4 fix): Ctrl+Tab/Ctrl+Shift+Tab are Chromium-level
    // accelerators that main's `before-input-event` hook may intercept before
    // this window's own keydown-capture listener ever runs. When that happens,
    // main sends the resolved action here directly instead of a raw key event.
    window.zinc.shortcuts.onTrigger((action) => this.triggerAction(action))
  }

  /** Replaces the full binding set (e.g. from settings.Keybindings). Rebuilds the reverse lookup from scratch. */
  setBindings(bindings: Keybindings): void {
    this.bindings = bindings
    this.rebuildReverse()
  }

  /** Registers (overwriting) the handler for `action`. Safe to call every render — cheap Map set. */
  on(action: ShortcutAction, handler: Handler): void {
    this.handlers.set(action, handler)
  }

  /**
   * Pauses interception while a settings-page "record a new binding" UI is
   * capturing raw keydowns. Also tells main to stand down its own
   * before-input-event fallback while recording is active, so a combo that
   * happens to match an existing binding (e.g. re-recording over Ctrl+Tab)
   * reaches the recording UI's own keydown handler instead of being
   * intercepted and actioned by main first.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    window.zinc.shortcuts.setRecordingActive(!enabled)
  }

  private rebuildReverse(): void {
    const next = new Map<string, ShortcutAction>()
    for (const [action, accelerator] of Object.entries(this.bindings) as Array<[ShortcutAction, string]>) {
      if (accelerator) next.set(accelerator, action)
    }
    for (const [action, aliases] of Object.entries(DEFAULT_ZOOM_ALIASES) as Array<[ShortcutAction, readonly string[]]>) {
      if (this.bindings[action] !== DEFAULT_KEYBINDINGS[action]) continue
      for (const alias of aliases) {
        if (!next.has(alias)) next.set(alias, action)
      }
    }
    this.reverse = next
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return
    const accelerator = acceleratorFromEvent(event)
    if (accelerator === null) return
    const action = this.reverse.get(accelerator)
    if (!action) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.triggerAction(action)
  }

  /** Invokes `action`'s handler if one is registered and dispatch isn't paused. Shared by the DOM keydown path and main's before-input-event fallback. */
  private triggerAction(action: ShortcutAction): void {
    if (!this.enabled) return
    const handler = this.handlers.get(action)
    if (!handler) return
    handler()
  }
}

export const shortcutManager = new ShortcutManager()
