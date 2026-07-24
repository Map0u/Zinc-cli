/// <reference path="../../../preload/index.d.ts" />
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { PTY_PORT_MESSAGE_TYPE, type PtySpawnOptions, type TerminalOptionsPush } from '../../../shared/ptyProtocol'
import { DEFAULT_COLOR_SCHEME_ID, getColorScheme, resolveVariant, type ThemeMode } from '../colorSchemes'
import { getSystemThemeMode, onSystemThemeModeChange } from '../themeMode'
import {
  formatSgrParams,
  rewriteSgrParamsForTransparentBg,
  shouldTransparentizeTerminalBackgrounds
} from './transparentTerminalBackground'
import type { IDisposable } from '@xterm/xterm'

// CJK aliases sit after the Latin monospace fallbacks, before the generic
// `monospace` — Cascadia Mono/Consolas cover Latin glyphs, so those still win
// for ASCII; CJK characters (which they don't cover) fall through per-glyph
// to whichever Source Han Sans/Noto Sans CJK alias is actually installed,
// same rationale as index.css's #root stack.
const FONT_FALLBACK =
  '"Cascadia Mono", Consolas, "Source Han Sans SC", "Source Han Sans CN", "Noto Sans CJK SC", "Noto Sans SC", "思源黑体", monospace'

const DEFAULT_OPTIONS: Required<TerminalOptionsPush> = {
  fontFamily: 'JetBrains Mono',
  fontSize: 16,
  cursorBlink: true,
  scrollback: 10000,
  colorScheme: DEFAULT_COLOR_SCHEME_ID,
  themeMode: 'auto',
  // Match SettingsService: 0 = raw Acrylic through the terminal card.
  terminalOpacity: 0
}

/**
 * Explicit lifecycle of a terminal host, replacing the old ad-hoc
 * `ptyStarted` boolean + scattered "is the container measurable yet" checks:
 * - `idle`   xterm instance built but NOT opened into the DOM and NO pty
 *            spawned — the container isn't measurable yet (zero-size and/or
 *            web fonts not loaded). `activate()` is the only transition out.
 * - `starting` opened and first-fit done; pty creation is still pending.
 * - `ready`  pty creation succeeded. Input/resize flow to the pty.
 * - `exited` the pty process exited. Input/resize are suppressed; the terminal
 *            stays on screen showing its final buffer + an exit notice.
 */
type HostState = 'idle' | 'starting' | 'ready' | 'exited'

interface HostEntry {
  id: string
  container: HTMLElement
  term: Terminal
  fit: FitAddon
  spawnOptions: PtySpawnOptions
  state: HostState
  resizeObserver: ResizeObserver
  resizeTimer: number | null
  contextMenuListener: ((event: MouseEvent) => void) | null
  port: MessagePort | null
  /** Active CSI/OSC handlers that rewrite black TUI backgrounds; disposed when mode flips off. */
  transparentBgHandlers: IDisposable[]
}

/**
 * Owns every xterm.js instance + its pty binary output port. Deliberately
 * plain TypeScript, not a React component/hook: xterm manages its own DOM
 * inside the container React hands it, and must never be re-rendered by
 * React's reconciler (project rule). React only creates/removes the
 * container div and toggles its visibility.
 */
/** A transient user-facing notice the registry emits (e.g. a failed clipboard op). App maps these to localized toast text. */
export type TerminalNotice = 'copyFailed' | 'pasteFailed' | 'startFailed'

export class TerminalHostRegistry {
  private readonly hosts = new Map<string, HostEntry>()
  private readonly titleHandlers = new Set<(id: string, title: string) => void>()
  private readonly noticeHandlers = new Set<(notice: TerminalNotice) => void>()
  private currentOptions: TerminalOptionsPush = { ...DEFAULT_OPTIONS }
  private systemMode: ThemeMode = getSystemThemeMode()
  /** Explicit user override from settings ('auto' defers to systemMode) — see themeMode.ts's ThemePreference. */
  private themePreference: 'auto' | 'light' | 'dark' = 'auto'
  /**
   * Web fonts must be loaded before an xterm is opened/fit: measuring cell
   * geometry against a fallback font and then reflowing once the real font
   * swaps in is exactly the garbage-first-fit class of bug the state machine
   * exists to prevent. Flips true once `document.fonts.ready` resolves, at
   * which point every still-`idle` host is re-checked for activation.
   */
  private fontsReady = false

  private get mode(): ThemeMode {
    return this.themePreference === 'auto' ? this.systemMode : this.themePreference
  }

  constructor() {
    // The pty output port arrives via window.postMessage, not the zinc API —
    // see PTY_PORT_MESSAGE_TYPE's doc comment (contextBridge can't carry a
    // live MessagePort through a callback argument).
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window || event.data?.type !== PTY_PORT_MESSAGE_TYPE) return
      const port = event.ports[0]
      if (port) this.attachPort(event.data.id as string, port)
    })
    window.zinc.pty.onExit((id, exitCode) => this.handleExit(id, exitCode))
    window.zinc.onTerminalOptions((options) => this.applyOptions(options))
    // Windows-only fallback (see main's before-input-event handler): Alt+M/
    // Alt+V get swallowed by Chromium's system-accelerator handling before
    // this host's own attachCustomKeyEventHandler below ever sees them, so
    // main resolves the target host itself and hands us the raw sequence.
    window.zinc.shortcuts.onAltSequence((hostId, sequence) => {
      const entry = this.hosts.get(hostId)
      if (entry?.state !== 'ready') return
      window.zinc.pty.write(hostId, new TextEncoder().encode(sequence))
    })
    // Once real fonts are loaded, every host that was waiting on them (built
    // but not yet opened) can activate. Cell geometry measured against the
    // fallback font would otherwise force a reflow when the real font swaps in.
    document.fonts.ready
      .then(() => {
        this.fontsReady = true
        for (const entry of this.hosts.values()) this.tryActivate(entry)
      })
      .catch(() => {
        // `document.fonts.ready` rejecting is not something the spec really
        // allows, but never leave hosts stuck idle over it — treat fonts as
        // ready and let activation proceed against whatever is loaded.
        this.fontsReady = true
        for (const entry of this.hosts.values()) this.tryActivate(entry)
      })
    // Flipping the OS light/dark setting must re-theme already-open tabs the
    // same way a manual ColorScheme change does (same glyph-atlas staleness
    // problem — see applyOptions's comment).
    onSystemThemeModeChange((mode) => {
      this.systemMode = mode
      for (const entry of this.hosts.values()) this.retheme(entry)
    })
  }

  /** Creates an xterm instance in `container` and lazily spawns its pty once the terminal is open+fit. */
  createHost(id: string, container: HTMLElement, spawnOptions: PtySpawnOptions): void {
    if (this.hosts.has(id)) return

    const term = new Terminal({
      fontFamily: this.fontFamilyString(),
      fontSize: this.currentOptions.fontSize ?? DEFAULT_OPTIONS.fontSize,
      cursorBlink: this.currentOptions.cursorBlink ?? DEFAULT_OPTIONS.cursorBlink,
      scrollback: this.currentOptions.scrollback ?? DEFAULT_OPTIONS.scrollback,
      allowProposedApi: true,
      // Needed so xterm actually renders its (always fully transparent, see
      // themeFor) theme background instead of forcing it opaque - the real
      // TerminalOpacity tint comes entirely from the host div's CSS
      // background (App.tsx's `terminalSurfaceBg`, see chromeBackground.ts)
      // sitting behind the canvas.
      allowTransparency: true,
      theme: this.themeFor()
    })
    term.onTitleChange((title) => {
      for (const handler of this.titleHandlers) handler(id, title)
    })
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const key = event.key.toLowerCase()

      // Copy. Ctrl+Shift+C always copies the selection (WT-style). Bare Ctrl+C
      // copies only when there IS a selection, otherwise it falls through as
      // the shell's interrupt (\x03) — the retained legacy behavior.
      if (event.ctrlKey && !event.altKey && !event.metaKey && key === 'c') {
        if (event.shiftKey) {
          this.copySelection(term)
          return false
        }
        return !this.copySelection(term)
      }

      // Ctrl+Shift+V: explicit paste via the native clipboard (text only).
      // Returning false only makes xterm skip the key — Chromium's own
      // Ctrl+Shift+V "paste as plain text" default still fires a native paste
      // event into the textarea, so it must be preventDefault-ed here or the
      // text lands twice (once native, once via pasteFromClipboard).
      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && key === 'v') {
        event.preventDefault()
        this.pasteFromClipboard(term)
        return false
      }

      // Alt+M and Alt+V: pass through to PTY as ESC sequences.
      if (event.altKey && !event.ctrlKey && !event.metaKey && (key === 'm' || key === 'v')) {
        const sequence = key === 'm' ? '\x1bm' : '\x1bv'
        window.zinc.pty.write(id, new TextEncoder().encode(sequence))
        return false
      }

      // Ctrl+V (without Shift): let the browser's native paste event drive the
      // existing handlePaste/xterm chain (this is also the image-paste path).
      // Returning false only stops xterm from writing Ctrl+V (\x16) to the pty.
      // Kept as the native path deliberately — the a5385c3 double-paste fix.
      if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && key === 'v') {
        return false
      }

      return true
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.loadAddon(new WebLinksAddon((_event, uri) => {
      void window.zinc.shell.openExternal(uri)
    }))
    term.unicode.activeVersion = '11'

    const entry: HostEntry = {
      id,
      container,
      term,
      fit,
      spawnOptions,
      state: 'idle',
      resizeObserver: null as unknown as ResizeObserver,
      resizeTimer: null,
      contextMenuListener: null,
      port: null,
      transparentBgHandlers: []
    }
    this.syncTransparentBackgroundHandlers(entry)

    entry.contextMenuListener = (event) => this.handleContextMenu(entry, event)
    container.addEventListener('contextmenu', entry.contextMenuListener)

    // Single resize path: the ResizeObserver is the *only* thing that reacts to
    // the container changing size. When the host is still `idle` a size change
    // is an activation trigger (the container just became measurable); once
    // `ready` it debounces a re-fit, and the resulting `term.resize` (below)
    // is what reports the new size to the pty — there is no separate resize
    // report anywhere, so a size is never sent twice. The 40ms debounce
    // coalesces resize storms (drag-resizing the window) into one fit.
    const observer = new ResizeObserver(() => {
      if (entry.resizeTimer !== null) window.clearTimeout(entry.resizeTimer)
      entry.resizeTimer = window.setTimeout(() => {
        if (entry.state === 'idle') {
          this.tryActivate(entry)
          return
        }
        if (entry.state !== 'ready') return
        // display:none/block toggles fire the observer even at 0x0 — never fit
        // a hidden container (that was the garbage-tiny-size regression).
        if (container.clientWidth > 0 && container.clientHeight > 0) {
          this.fitTerminal(entry)
        }
      }, 40)
    })
    observer.observe(container)
    entry.resizeObserver = observer

    term.onData((data) => {
      // Suppress input once the shell has exited (state !== 'ready'): the pty
      // is gone, so keystrokes have nowhere to go and must not resurrect a
      // dead session's write path.
      if (entry.state !== 'ready') return
      window.zinc.pty.write(id, new TextEncoder().encode(data))
    })
    term.onResize(({ cols, rows }) => {
      // The sole resize-report path. Gated on `ready` (Trap: the initial fit in
      // activate() fires this before the pty exists, and activate() sends the
      // starting size to create() itself — reporting here too would double-send
      // it). Also suppressed after exit.
      if (entry.state === 'ready') window.zinc.pty.resize(id, cols, rows)
    })

    this.hosts.set(id, entry)

    // Spawn is deferred to activate(): don't open/fit/spawn until the container
    // is actually measurable (non-zero size) and web fonts are loaded. Attempt
    // it now (the always-laid-out container usually already has a size); if not
    // yet ready, the ResizeObserver above and/or the fonts.ready handler will
    // retry.
    this.tryActivate(entry)
  }

  /**
   * Advances an `idle` host to `ready` iff its container is measurable and web
   * fonts are loaded. Idempotent and safe to call from any of the three
   * activation triggers (createHost, the ResizeObserver, fonts.ready) — a
   * no-op for hosts that are already activated or not yet eligible.
   */
  private tryActivate(entry: HostEntry): void {
    if (entry.state !== 'idle') return
    if (!this.fontsReady) return
    const rect = entry.container.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    this.activate(entry)
  }

  /** Opens the terminal, does the first fit, and starts its pty (state idle → starting → ready). */
  private activate(entry: HostEntry): void {
    entry.term.open(entry.container)

    // Capture-phase paste interception (parity §1.5): if the clipboard holds
    // an image file item, stop xterm from ever seeing it (preventDefault +
    // stopImmediatePropagation before xterm's own bubble-phase listener runs)
    // and route the bytes to main over IPC instead. Plain-text pastes fall
    // through untouched — xterm's own handler still runs them. Attached here,
    // not in createHost, because `term.textarea` only exists after open().
    entry.term.textarea?.addEventListener('paste', (event: ClipboardEvent) => this.handlePaste(entry.id, event), true)

    // First fit happens while still `idle`, so the onResize it triggers does
    // NOT report to the pty — create() below sends the starting size instead.
    this.fitTerminal(entry)
    entry.state = 'starting'

    // Lazily start the pty now, mirroring the WinUI `ready{cols,rows}` handshake.
    window.zinc.pty
      .create(entry.id, { ...entry.spawnOptions, cols: entry.term.cols, rows: entry.term.rows })
      .then(() => {
        // The tab may have been closed (or the process may already have
        // exited) while the async create handshake was in flight.
        if (this.hosts.get(entry.id) !== entry || entry.state !== 'starting') {
          window.zinc.pty.kill(entry.id)
          return
        }
        entry.state = 'ready'
        if (entry.container.clientWidth > 0 && entry.container.clientHeight > 0) {
          this.fitTerminal(entry)
          entry.term.focus()
        }
      })
      .catch((err: unknown) => {
        console.error(`[terminal] failed to start pty for ${entry.id}:`, err)
        if (this.hosts.get(entry.id) !== entry || entry.state !== 'starting') return
        entry.state = 'exited'
        this.closePort(entry)
        this.notify('startFailed')
      })
  }

  /** Subscribes to transient notices (e.g. failed clipboard ops). Returns an unsubscribe function. */
  onNotice(handler: (notice: TerminalNotice) => void): () => void {
    this.noticeHandlers.add(handler)
    return () => this.noticeHandlers.delete(handler)
  }

  private notify(notice: TerminalNotice): void {
    for (const handler of this.noticeHandlers) handler(notice)
  }

  /**
   * Copies the terminal's current selection via the main-process clipboard
   * (never navigator.clipboard, which is permission/focus-gated in a sandboxed
   * renderer). Returns whether a copy was initiated (i.e. there was a
   * selection); emits a `copyFailed` notice if the write itself fails.
   */
  private copySelection(term: Terminal): boolean {
    if (!term.hasSelection()) return false
    const text = term.getSelection()
    term.clearSelection()
    window.zinc.clipboard
      .writeText(text)
      .then((ok) => {
        if (!ok) this.notify('copyFailed')
      })
      .catch(() => this.notify('copyFailed'))
    return true
  }

  /** Pastes clipboard text into the terminal via the main-process clipboard; emits a `pasteFailed` notice on read failure. */
  private pasteFromClipboard(term: Terminal): void {
    window.zinc.clipboard
      .readText()
      .then((text) => {
        // null = read failed (surface it); '' = genuinely empty clipboard (no-op).
        if (text === null) {
          this.notify('pasteFailed')
          return
        }
        if (text) term.paste(text)
      })
      .catch(() => this.notify('pasteFailed'))
  }

  /** Re-fits and refocuses a host after its container becomes visible (e.g. tab switch from display:none). */
  fitOnShow(id: string): void {
    const entry = this.hosts.get(id)
    if (!entry) return
    // Wait a frame to let React fully update the DOM (especially important for
    // display:none→block transitions), then fit. This RAF is a transition-settle
    // delay, distinct from the readiness state machine: the ResizeObserver would
    // normally catch the size change, but delaying here ensures fit runs before
    // any subsequent ResizeObserver callbacks.
    requestAnimationFrame(() => {
      if (entry.container.clientWidth <= 0 || entry.container.clientHeight <= 0) return
      // A host that never became measurable while hidden may still be idle when
      // first shown — activate it now rather than fit an unopened terminal.
      if (entry.state === 'idle') {
        this.tryActivate(entry)
        return
      }
      if (entry.state === 'ready') this.fitTerminal(entry)
      entry.term.focus()
    })
  }

  focus(id: string): void {
    this.hosts.get(id)?.term.focus()
  }

  onTitleChange(handler: (id: string, title: string) => void): () => void {
    this.titleHandlers.add(handler)
    return () => this.titleHandlers.delete(handler)
  }

  /** Applies a pushed settings change to every open terminal, then fits and reports the resulting size (parity §2.3). */
  applyOptions(options: TerminalOptionsPush): void {
    this.currentOptions = { ...this.currentOptions, ...options }
    if (options.themeMode !== undefined && (options.themeMode === 'auto' || options.themeMode === 'light' || options.themeMode === 'dark')) {
      this.themePreference = options.themeMode
    }
    for (const entry of this.hosts.values()) {
      if (options.fontFamily !== undefined) entry.term.options.fontFamily = this.fontFamilyString()
      if (options.fontSize !== undefined) entry.term.options.fontSize = options.fontSize
      if (options.cursorBlink !== undefined) entry.term.options.cursorBlink = options.cursorBlink
      if (options.scrollback !== undefined) entry.term.options.scrollback = options.scrollback
      // Re-theme already-open tabs live, not just tabs opened after the
      // switch — unlike ShellPath/StartingDirectory (new-tab-only), a color
      // scheme change must visibly apply to whatever's already running.
      if (options.colorScheme !== undefined || options.themeMode !== undefined) this.retheme(entry)
      if (options.terminalOpacity !== undefined) this.syncTransparentBackgroundHandlers(entry)
      // Only ready hosts have an opened terminal to fit; the fit's own
      // onResize reports the new size to the pty (single resize path — no
      // separate report here). A font-size change that alters cell geometry
      // changes cols/rows and thus fires that report; an unchanged size
      // correctly reports nothing.
      if (entry.state === 'ready') this.fitTerminal(entry)
    }
  }

  destroyHost(id: string): void {
    const entry = this.hosts.get(id)
    if (!entry) return
    entry.resizeObserver.disconnect()
    if (entry.resizeTimer !== null) window.clearTimeout(entry.resizeTimer)
    if (entry.contextMenuListener) entry.container.removeEventListener('contextmenu', entry.contextMenuListener)
    this.clearTransparentBackgroundHandlers(entry)
    this.closePort(entry)
    entry.term.dispose()
    window.zinc.pty.kill(id)
    this.hosts.delete(id)
  }

  /**
   * While TerminalOpacity is 0, install xterm parser hooks that map black /
   * near-black *background* SGR (and OSC 11 default-bg) onto the transparent
   * default background so full-screen TUIs do not cover Acrylic. See
   * transparentTerminalBackground.ts.
   */
  private syncTransparentBackgroundHandlers(entry: HostEntry): void {
    const want = shouldTransparentizeTerminalBackgrounds(
      this.currentOptions.terminalOpacity ?? DEFAULT_OPTIONS.terminalOpacity
    )
    const have = entry.transparentBgHandlers.length > 0
    if (want === have) return
    if (!want) {
      this.clearTransparentBackgroundHandlers(entry)
      return
    }

    // Most-recently-registered CSI handlers run first. We consume only the
    // sequences we rewrote; everything else falls through to xterm's default.
    const sgr = entry.term.parser.registerCsiHandler({ final: 'm' }, (params) => {
      const rewritten = rewriteSgrParamsForTransparentBg(params)
      if (!rewritten) return false
      // Re-inject the rewritten SGR; our handler returns false for the new
      // sequence (no near-black bg left), so xterm applies it normally.
      entry.term.write(`\x1b[${formatSgrParams(rewritten)}m`)
      return true
    })
    // OSC 11 sets the terminal's default background color. TUIs often push
    // `#000000` here for a "theme"; swallowing it keeps our transparent default.
    const osc11 = entry.term.parser.registerOscHandler(11, () => true)
    entry.transparentBgHandlers = [sgr, osc11]
  }

  private clearTransparentBackgroundHandlers(entry: HostEntry): void {
    for (const d of entry.transparentBgHandlers) {
      try {
        d.dispose()
      } catch {
        // dispose is idempotent in practice; never block host teardown on it.
      }
    }
    entry.transparentBgHandlers = []
  }

  /** Debug/verification helper: current scrollback+viewport text for a host. */
  getBufferText(id: string): string {
    const entry = this.hosts.get(id)
    if (!entry) return ''
    const buffer = entry.term.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
    }
    return lines.join('\n')
  }

  /** Looks for an image file among a paste event's clipboard items (parity §1.5). */
  private handlePaste(id: string, event: ClipboardEvent): void {
    const items = event.clipboardData?.items
    if (!items) return
    let imageFile: File | null = null
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        imageFile = item.getAsFile()
        if (imageFile) break
      }
    }
    if (!imageFile) return // plain text/no image: let xterm's own handler run normally.

    event.preventDefault()
    event.stopImmediatePropagation()

    const mime = imageFile.type
    imageFile
      .arrayBuffer()
      .then((buffer) => {
        window.zinc.pty.pasteImage(id, new Uint8Array(buffer), mime)
      })
      .catch(() => {
        // Silent on failure per spec — a failed read just means the paste
        // has no visible effect.
      })
  }

  private handleContextMenu(entry: HostEntry, event: MouseEvent): void {
    event.preventDefault()
    // No copy/paste target before the terminal is opened or after it exits.
    if (entry.state !== 'ready') return
    // Right-click copies a selection if there is one, otherwise pastes —
    // matching the WinUI original. Both route through the main-process
    // clipboard helpers (which surface a notice on failure).
    if (entry.term.hasSelection()) {
      this.copySelection(entry.term)
    } else {
      this.pasteFromClipboard(entry.term)
    }
    entry.term.focus()
  }

  private attachPort(id: string, port: MessagePort): void {
    const entry = this.hosts.get(id)
    if (!entry) {
      port.close()
      return
    }
    // A session replacement (e.g. reconnect) can hand us a new port for an
    // id that already has one open — close the stale port and its listener
    // before wiring up the new one, otherwise both stay live until teardown.
    this.closePort(entry)
    entry.port = port
    // Write raw bytes straight into xterm's own streaming UTF-8 decoder —
    // do not TextDecoder.decode() to a string first, which can mangle a
    // multibyte character split across two chunks.
    port.onmessage = (event: MessageEvent<ArrayBuffer>) => this.writePtyOutput(entry, new Uint8Array(event.data))
  }

  private closePort(entry: HostEntry): void {
    if (!entry.port) return
    entry.port.onmessage = null
    entry.port.close()
    entry.port = null
  }

  private handleExit(id: string, exitCode: number): void {
    const entry = this.hosts.get(id)
    if (!entry) return
    // Unbind immediately: mark the host exited so onData/onResize stop routing
    // to the now-dead pty, then leave the final buffer on screen with a notice.
    entry.state = 'exited'
    entry.term.write(`\r\n\x1b[31m[process exited with code ${exitCode}]\x1b[0m\r\n`)
  }

  // Reassigning `theme` alone isn't enough for already-painted rows —
  // `refresh()` forces xterm to actually repaint every row against the new
  // theme instead of only the next line of fresh pty output. An idle host has
  // no opened terminal to refresh; the new theme option it's given here applies
  // when it opens.
  private retheme(entry: HostEntry): void {
    entry.term.options.theme = this.themeFor()
    if (entry.state !== 'idle') entry.term.refresh(0, entry.term.rows - 1)
  }

  private fitTerminal(entry: HostEntry): void {
    this.preserveScrollPosition(entry, () => {
      const viewport = entry.term.element?.querySelector('.xterm-viewport') as HTMLElement | null
      if (viewport) viewport.scrollLeft = 0

      const dimensions = this.proposeDimensions(entry)
      if (!dimensions) return
      if (entry.term.cols === dimensions.cols && entry.term.rows === dimensions.rows) return

      // Keep the custom dimension proposal's scroll-position behavior, but
      // preserve FitAddon's other critical resize semantic: clear every canvas
      // layer before changing cols/rows. Without this, transparent xterm canvas
      // layers can retain pieces of the previous frame after a resize (most
      // visibly a full-screen TUI's right border), which reads as clipped or
      // horizontally displaced terminal content.
      const core = (entry.term as any)._core
      core?._renderService?.clear()
      entry.term.resize(dimensions.cols, dimensions.rows)
      entry.term.refresh(0, entry.term.rows - 1)

      // A hidden horizontal overflow axis can retain a non-zero scroll offset
      // even though it exposes no scrollbar. Reset immediately and once more
      // after Chromium has committed the resized canvas geometry.
      if (viewport) {
        viewport.scrollLeft = 0
        requestAnimationFrame(() => {
          if (viewport.isConnected) viewport.scrollLeft = 0
        })
      }
    })
  }

  private proposeDimensions(entry: HostEntry): { cols: number; rows: number } | null {
    const core = (entry.term as any)._core
    const cell = core?._renderService?.dimensions?.css?.cell
    if (!cell || cell.width <= 0 || cell.height <= 0) return null

    const rect = entry.container.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null

    const viewport = entry.term.element?.querySelector('.xterm-viewport') as HTMLElement | null
    const measuredScrollbarWidth = viewport ? Math.max(0, viewport.offsetWidth - viewport.clientWidth) : 0
    const coreScrollbarWidth = entry.term.options.scrollback === 0 ? 0 : (core?.viewport?.scrollBarWidth ?? 0)
    const scrollbarWidth = Math.max(measuredScrollbarWidth, coreScrollbarWidth)

    const availableWidth = Math.max(0, rect.width - scrollbarWidth - 1)
    const availableHeight = Math.max(0, rect.height)
    return {
      cols: Math.max(2, Math.floor(availableWidth / cell.width)),
      rows: Math.max(1, Math.floor(availableHeight / cell.height))
    }
  }

  private writePtyOutput(entry: HostEntry, data: Uint8Array): void {
    const before = this.captureScrollPosition(entry)
    entry.term.write(data, () => this.restoreScrollPosition(entry, before))
  }

  private preserveScrollPosition(entry: HostEntry, action: () => void): void {
    const before = this.captureScrollPosition(entry)
    action()
    this.restoreScrollPosition(entry, before)
  }

  private captureScrollPosition(entry: HostEntry): { viewportY: number; wasAtBottom: boolean } {
    const buffer = entry.term.buffer.active
    return {
      viewportY: buffer.viewportY,
      wasAtBottom: buffer.viewportY >= buffer.baseY
    }
  }

  private restoreScrollPosition(entry: HostEntry, before: { viewportY: number; wasAtBottom: boolean }): void {
    const restore = (): void => {
      if (before.wasAtBottom) {
        entry.term.scrollToBottom()
        return
      }
      entry.term.scrollToLine(Math.min(before.viewportY, entry.term.buffer.active.baseY))
    }

    restore()
    requestAnimationFrame(restore)
  }

  private fontFamilyString(): string {
    return `"${this.currentOptions.fontFamily ?? DEFAULT_OPTIONS.fontFamily}", ${FONT_FALLBACK}`
  }

  // Always fully transparent, regardless of TerminalOpacity: xterm's own
  // canvas paints ON TOP of the host div's CSS background (App.tsx's
  // `terminalSurfaceBg`, see chromeBackground.ts, which already carries the
  // real rgba(12,12,12,opacity) tint). If this theme background were ALSO an opaque-ish rgba, both
  // layers would blend against the true window backdrop independently and
  // stack (e.g. two 0.4-alpha layers compose to ~0.64, not 0.4) - measured
  // via direct pixel sampling: canvas showed A=255 with the WebGL addon
  // (which additionally ignores theme alpha outright) and A=163 without it
  // (the double-blend math: 0.4 + 0.4*(1-0.4) = 0.64 ≈ 163/255), while the
  // surrounding CSS-only padding gap correctly showed A=102 (0.4). Only one
  // layer should ever paint the tint - the CSS one, since it's the whole
  // rectangle including the gap the canvas doesn't cover.
  private themeFor(): ITheme {
    const scheme = getColorScheme(this.currentOptions.colorScheme)
    const variant = resolveVariant(scheme, this.mode)
    return { ...variant.ansi, background: 'rgba(0, 0, 0, 0)' }
  }
}

export const terminalHostRegistry = new TerminalHostRegistry()
