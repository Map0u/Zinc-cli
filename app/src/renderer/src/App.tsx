import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { terminalHostRegistry, type TerminalNotice } from './terminal/TerminalHostRegistry'
import { useSettings } from './settings/SettingsContext'
import { useI18n } from './i18n/I18nContext'
import { SettingsRailBody, SettingsContentBody, type Category } from './settings/SettingsPage'
import { shortcutManager } from './shortcuts/ShortcutManager'
import { StatusBar } from './statusbar/StatusBar'
import { getStatusBarHeight } from './statusbar/StatusBarRow'
import { SegoeIcon } from './segoeFluentIcons'
import { surfaceBackground } from './chromeBackground'
import { getAodVariant, getColorScheme, harmonizeAccent, resolveVariant } from './colorSchemes'
import { useResolvedThemeMode } from './themeMode'
import { createBurnInController, type BurnInController } from './aod/burnInProtection'
import { getAodState, subscribeAod, subscribeAodWake, wakeAod } from './aod/aodRuntime'
import zincIcon from './assets/zinc-icon.png'
import {
  consumeShellFallbackNotice,
  loadShellProfiles,
  type ShellProfile
} from './shells/shellProfiles'
import type { ShortcutAction } from '../../shared/keybindings'
import type { RestorePayload } from '../../shared/sessionState'

/** Bounds mirrored from the settings page's font-size NumberField (SettingsPage.tsx). */
const FONT_SIZE_MIN = 8
const FONT_SIZE_MAX = 32
const DEFAULT_FONT_SIZE = 16

/**
 * Win11's own DWM window-corner rounding at 100% scale, and Fluent's
 * `OverlayCornerRadius`/largest `ControlCornerRadius` token — the terminal
 * card's rounding must match this or its corners visibly disagree with the
 * window's own corner right where they meet (M9).
 */
const WINDOW_CORNER_RADIUS = 8

interface Tab {
  id: string
  /** Auto-incrementing, never recycled — matches the WinUI original (parity §1.1). */
  num: number
  /** Last title reported by the terminal process via OSC 0/2. */
  title?: string
  /** User-provided rail label; when set, terminal title updates no longer overwrite the displayed label. */
  customTitle?: string
  /** cwd to spawn this tab's shell in; only set for clones/restored tabs. `undefined` = registry/PtyManager default. */
  spawnCwd?: string
  /** Stable shell profile id; main resolves it to the current executable at spawn time. */
  shellId?: string
  /** Friendly profile name shown until the shell provides an OSC title. */
  shellLabel?: string
  /** `claude --continue` / `codex resume --last` for a restored tab whose saved session had a known AI tool (parity §1.4). */
  startupCommand?: string
}

interface TabContextMenuState {
  tabId: string
  x: number
  y: number
}

/** Which top-level surface the rail body + content card show. */
type AppView = 'terminal' | 'settings'

interface AddTabOptions {
  spawnCwd?: string
  startupCommand?: string
  initialTitle?: string
  customTitle?: string
  shellId?: string
  shellLabel?: string
}

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [shellProfiles, setShellProfiles] = useState<ShellProfile[]>([])
  const [shellMenuOpen, setShellMenuOpen] = useState(false)
  const [splashVisible, setSplashVisible] = useState(true)
  const [splashLeaving, setSplashLeaving] = useState(false)
  const [view, setView] = useState<AppView>('terminal')
  const [category, setCategory] = useState<Category>('appearance')
  const { settings, updateDebounced, updateImmediate } = useSettings()
  const { t } = useI18n()
  const themeMode = useResolvedThemeMode(settings?.ThemePreference ?? 'auto')
  const [aodState, setAodState] = useState(getAodState())
  const [windowState, setWindowState] = useState(window.zinc.window.getStateSync())
  const aodActive = aodState.active
  const burnInRootRef = useRef<HTMLDivElement | null>(null)
  const burnInControllerRef = useRef<BurnInController | null>(null)
  const aodActiveRef = useRef(aodActive)
  const burnInEnabledRef = useRef(settings?.BurnInProtectionEnabled ?? true)
  const tabContextMenuRef = useRef<HTMLDivElement | null>(null)
  const tabContextMenuReturnFocusRef = useRef<HTMLElement | null>(null)
  const shellMenuRef = useRef<HTMLDivElement | null>(null)
  const shellMenuTriggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => subscribeAod(setAodState), [])
  useEffect(() => window.zinc.window.onStateChange(setWindowState), [])

  // Main owns the probe and caches its result. Loading it here gives the
  // split-button and the initial tab the same profile data as Settings,
  // without ever exposing executable paths to the renderer.
  useEffect(() => {
    let alive = true
    void loadShellProfiles().then((profiles) => {
      if (!alive) return
      setShellProfiles(profiles)
      setTabs((tabs) =>
        tabs.map((tab) =>
          tab.shellLabel
            ? tab
            : { ...tab, shellLabel: profiles.find((profile) => profile.id === tab.shellId)?.label }
        )
      )
      if (consumeShellFallbackNotice()) setShellFallbackVisible(true)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    aodActiveRef.current = aodActive
    terminalHostRegistry.setAodMode(aodActive)
    if (activeId) terminalHostRegistry.fitOnShow(activeId)
    if (!aodActive || !activeId) return
    const fitTimer = window.setTimeout(() => terminalHostRegistry.fitOnShow(activeId), 180)
    return () => window.clearTimeout(fitTimer)
  }, [aodActive, activeId])

  useEffect(() => {
    burnInEnabledRef.current = settings?.BurnInProtectionEnabled ?? true
    if (aodActive && burnInEnabledRef.current) burnInControllerRef.current?.start()
    else burnInControllerRef.current?.stop()
  }, [aodActive, settings?.BurnInProtectionEnabled])

  useEffect(() => {
    const root = burnInRootRef.current
    if (!root) return
    const controller = createBurnInController({
      root,
      enabled: () => burnInEnabledRef.current,
      active: () => aodActiveRef.current
    })
    burnInControllerRef.current = controller
    if (aodActiveRef.current && burnInEnabledRef.current) controller.start()
    const unsubscribeWake = subscribeAodWake(() => controller.wake())
    return () => {
      unsubscribeWake()
      controller.stop()
      if (burnInControllerRef.current === controller) burnInControllerRef.current = null
    }
  }, [])

  // index.css's chrome light-mode tokens key off `[data-theme='light']`, not
  // `prefers-color-scheme` — that media query can't see an explicit
  // ThemePreference override, only the OS setting, which previously left
  // chrome tokens stuck on dark while the terminal switched to light.
  // useLayoutEffect (not useEffect) so this lands before the first paint —
  // otherwise a light-mode cold start briefly paints dark chrome tokens,
  // then flips once the effect runs.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = themeMode
  }, [themeMode])

  // Chrome accent (`--color-accent`, consumed by Toggle/checkbox/rail pill/
  // opacity-slider fill) has two sources, chosen by settings.AccentSource:
  // 'scheme' pulls the selected ColorScheme's own hand-picked accent hue;
  // 'system' reads the real Windows accent color (DWM's AccentColor, "Light2"
  // shade) but keeps only its hue — harmonizeAccent re-applies this app's own
  // saturation/lightness register so it sits in the same family as the
  // hand-picked scheme accents instead of Windows' raw, brighter tone.
  // Re-read every time in case the user changes it in Windows while the app
  // is open.
  useEffect(() => {
    if (!settings) return
    if (aodActive) {
      const variant = getAodVariant()
      document.documentElement.style.setProperty('--color-accent', variant.accent)
      return
    }
    if (settings.AccentSource === 'system') {
      window.zinc.window.getAccentColor().then((hex) => {
        const harmonized = harmonizeAccent(hex, themeMode)
        document.documentElement.style.setProperty('--color-accent', harmonized)
      })
    } else {
      const variant = resolveVariant(getColorScheme(settings.ColorScheme), themeMode)
      document.documentElement.style.setProperty('--color-accent', variant.accent)
    }
  }, [settings?.AccentSource, settings?.ColorScheme, themeMode, aodActive])

  const nextNumRef = useRef(1)
  const initializedRef = useRef(false)
  // Flips true only after restoreTabs()/addTab() has committed the initial
  // hydration from session-state.json. Guards the [tabs, activeId] snapshot
  // effect below: without this, the renderer mounts with tabs=[] and that
  // effect fires with an empty snapshot before getRestorePayload() resolves,
  // so a quit/crash during that startup window would overwrite the previous
  // valid session-state.json with {Tabs:[], ActiveIndex:-1}.
  const [sessionReady, setSessionReady] = useState(false)

  /** Pushes the current tab order + active id to main's live cache (see index.ts's `latestSessionSnapshot`). */
  function pushSessionSnapshot(tabsList: Tab[], activeIdValue: string | null): void {
    const idx = tabsList.findIndex((t) => t.id === activeIdValue)
    window.zinc.session.pushSnapshot({ tabs: tabsList.map((t) => ({ id: t.id, shellId: t.shellId })), activeIndex: idx })
  }

  function normalizeTabTitle(title: string): string | null {
    const clean = title.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim()
    return clean.length > 0 ? clean : null
  }

  function tabDisplayTitle(tab: Tab): string {
    return tab.customTitle ?? tab.title ?? tab.shellLabel ?? 'PowerShell'
  }

  function profileForId(shellId: string | undefined): ShellProfile | undefined {
    return shellProfiles.find((profile) => profile.id === shellId)
  }

  function addTab(options: AddTabOptions = {}): void {
    const num = nextNumRef.current++
    const id = `tab-${num}`
    const configuredShellId = settings?.DefaultShellId
    const selectedProfile = profileForId(options.shellId ?? configuredShellId) ?? (options.shellId ? undefined : shellProfiles[0])
    setTabs((prev) =>
      prev.some((t) => t.id === id)
        ? prev
        : [
            ...prev,
            {
              id,
              num,
              title: options.initialTitle,
              customTitle: options.customTitle,
              spawnCwd: options.spawnCwd,
              startupCommand: options.startupCommand,
              shellId: options.shellId ?? selectedProfile?.id ?? configuredShellId,
              shellLabel: options.shellLabel ?? selectedProfile?.label
            }
          ]
    )
    setActiveId(id)
  }

  /** Recreates every tab from a resolved session-state.json restore plan in one shot, so `ActiveIndex` lands correctly (parity §1.4) instead of drifting to whichever tab `addTab` added last. */
  function restoreTabs(payload: RestorePayload): void {
    const restored: Tab[] = payload.tabs.map((t) => {
      const num = nextNumRef.current++
      // Sessions written before multi-shell support have no id. Attach the
      // current default now so they receive the normal title and are migrated
      // the next time session state is persisted.
      const shellId = t.shellId ?? settings?.DefaultShellId
      return {
        id: `tab-${num}`,
        num,
        spawnCwd: t.cwd,
        startupCommand: t.startupCommand,
        shellId,
        shellLabel: profileForId(shellId)?.label
      }
    })
    setTabs(restored)
    const idx = payload.activeIndex >= 0 && payload.activeIndex < restored.length ? payload.activeIndex : 0
    setActiveId(restored[idx]?.id ?? null)
  }

  function switchTab(id: string): void {
    // Clicking the already-active tab still needs to refocus the terminal:
    // if `id === activeId`, the `[activeId]` effect below won't rerun (React
    // bails out of a no-op state update), so nothing would ever call back
    // into the terminal host to hand focus back to it.
    if (id === activeId) {
      terminalHostRegistry.fitOnShow(id)
      return
    }
    setActiveId(id)
  }

  function closeTab(id: string): void {
    // Derive next-tabs/active-id/quit decision from the latest previous state
    // in one functional update, not the render-closure `tabs`/`activeId` —
    // rapid close gestures (e.g. mashing middle-click) can fire this handler
    // multiple times before React commits the first update, and reading the
    // closure's stale `tabs` would resurrect an already-closed tab or pick
    // the wrong active tab.
    setTabs((prevTabs) => {
      const idx = prevTabs.findIndex((t) => t.id === id)
      if (idx === -1) return prevTabs
      const next = prevTabs.filter((t) => t.id !== id)

      if (next.length === 0) {
        // Last tab: do NOT tear down the terminal host here. The unified
        // quit path (parity §3 #9 fix) owns all PTY/session cleanup via
        // main's `before-quit` hook (persistSessionState + ptyManager.killAll()) —
        // destroying the host on the renderer side first would let a
        // before-quit mount point (session persistence, etc.) observe an
        // already-torn-down tab. Push the now-empty snapshot synchronously
        // before requesting quit so `before-quit` doesn't read the stale,
        // still-non-empty cached snapshot from the effect below.
        pushSessionSnapshot(next, null)
        window.zinc.app.requestQuit()
        return next
      }

      terminalHostRegistry.destroyHost(id)
      setActiveId((prevActiveId) =>
        prevActiveId === id ? next[next.length - 1].id : prevActiveId
      )
      return next
    })
  }

  async function cloneTab(sourceId: string): Promise<void> {
    const cwd = await window.zinc.pty.getCwd(sourceId)
    const source = tabs.find((tab) => tab.id === sourceId)
    addTab({
      spawnCwd: cwd ?? undefined,
      initialTitle: source?.title,
      customTitle: source?.customTitle,
      shellId: source?.shellId,
      shellLabel: source?.shellLabel
    })
  }

  function showTabContextMenu(tabId: string, x: number, y: number, returnFocus: HTMLElement): void {
    tabContextMenuReturnFocusRef.current = returnFocus
    setActiveId(tabId)
    setTabContextMenu({
      tabId,
      x: Math.max(8, Math.min(x, window.innerWidth - 152)),
      y: Math.max(8, Math.min(y, window.innerHeight - 92))
    })
  }

  function openTabContextMenu(event: React.MouseEvent<HTMLDivElement>, tabId: string): void {
    event.preventDefault()
    event.stopPropagation()
    showTabContextMenu(tabId, event.clientX, event.clientY, event.currentTarget)
  }

  function closeTabContextMenu(restoreFocus = false): void {
    setTabContextMenu(null)
    if (!restoreFocus) return
    const returnFocus = tabContextMenuReturnFocusRef.current
    requestAnimationFrame(() => {
      if (returnFocus?.isConnected) returnFocus.focus()
    })
  }

  // Inline rename, not window.prompt: Electron never implemented prompt() —
  // it throws synchronously — so a dialog-based rename can never work here.
  function renameTab(tabId: string): void {
    if (!tabs.some((item) => item.id === tabId)) return
    setRenamingTabId(tabId)
  }

  function commitTabRename(tabId: string, raw: string): void {
    setRenamingTabId(null)
    const clean = normalizeTabTitle(raw)
    if (!clean) return
    setTabs((prev) => prev.map((item) => (item.id === tabId ? { ...item, customTitle: clean } : item)))
  }

  function duplicateTab(tabId: string): void {
    void cloneTab(tabId)
  }

  // Auto-create the first tab once settings have loaded (so it spawns with
  // the persisted DefaultShellId/StartingDirectory rather than a stale
  // executable path). Guarded by a ref (not a `tabs.length` check inside
  // the effect) because React 18 StrictMode double-invokes effects in dev —
  // both invocations close over the same initial empty `tabs` state, so a
  // length check alone would still add two tabs.
  useEffect(() => {
    if (initializedRef.current || !settings) return
    initializedRef.current = true
    window.zinc.session.getRestorePayload().then((payload) => {
      if (payload && payload.tabs.length > 0) restoreTabs(payload)
      else addTab()
      setSessionReady(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  // Keeps main's live tab-order/active-id cache warm on every change (see
  // index.ts's `latestSessionSnapshot`) — main has no tab state of its own,
  // and by the time `before-quit` runs on an OS window-close, the renderer's
  // webContents may already be destroyed, so this can't be done lazily at
  // quit time. The close-last-tab path above pushes its own final snapshot
  // synchronously rather than waiting on this effect (see its comment).
  useEffect(() => {
    if (!sessionReady) return
    pushSessionSnapshot(tabs, activeId)
  }, [tabs, activeId, sessionReady])

  // Startup splash: holds a beat once the session is ready so the window
  // doesn't flash straight from blank to the restored tab layout, then fades.
  useEffect(() => {
    if (!sessionReady) return
    const leaveTimer = window.setTimeout(() => setSplashLeaving(true), 1000)
    const hideTimer = window.setTimeout(() => setSplashVisible(false), 1240)
    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(hideTimer)
    }
  }, [sessionReady])

  // Re-fit and refocus whenever the visible tab changes (container went from
  // display:none to display:block, or a brand new host was just created).
  useEffect(() => {
    if (activeId) terminalHostRegistry.fitOnShow(activeId)
  }, [activeId])

  useEffect(() => {
    return terminalHostRegistry.onTitleChange((id, title) => {
      const clean = normalizeTabTitle(title)
      if (!clean) return
      setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, title: clean } : tab)))
    })
  }, [])

  // Transient toast for terminal notices (currently only failed clipboard
  // ops). The registry is plain TS with no access to i18n/React, so it emits a
  // semantic code that we store and localize at render time (below) — keeping
  // the code, not the resolved string, in state means this effect never
  // depends on `t` and so subscribes/arms its dismiss timer exactly once.
  const [terminalNotice, setTerminalNotice] = useState<TerminalNotice | null>(null)
  const [shellFallbackVisible, setShellFallbackVisible] = useState(false)
  useEffect(() => {
    let clearTimer: number | null = null
    const unsubscribe = terminalHostRegistry.onNotice((notice) => {
      setTerminalNotice(notice)
      if (clearTimer !== null) window.clearTimeout(clearTimer)
      clearTimer = window.setTimeout(() => setTerminalNotice(null), 2500)
    })
    return () => {
      unsubscribe()
      if (clearTimer !== null) window.clearTimeout(clearTimer)
    }
  }, [])

  useEffect(() => {
    if (!shellFallbackVisible) return
    const clearTimer = window.setTimeout(() => setShellFallbackVisible(false), 3500)
    return () => window.clearTimeout(clearTimer)
  }, [shellFallbackVisible])

  useEffect(() => {
    if (!shellMenuOpen) return
    const focusFrame = requestAnimationFrame(() => {
      shellMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    })
    const closeIfOutside = (event: MouseEvent): void => {
      if (shellMenuRef.current?.contains(event.target as Node)) return
      setShellMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setShellMenuOpen(false)
      requestAnimationFrame(() => shellMenuTriggerRef.current?.focus())
    }
    document.addEventListener('mousedown', closeIfOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('mousedown', closeIfOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [shellMenuOpen])

  useEffect(() => {
    if (!tabContextMenu) return
    const focusFrame = requestAnimationFrame(() => {
      tabContextMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    })
    const close = (): void => closeTabContextMenu(false)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeTabContextMenu(true)
    }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [tabContextMenu])

  // Returning to the terminal view flips the terminal-content column back
  // from display:none to display:block without `activeId` changing, so the
  // effect above (keyed only on `activeId`) never reruns — the host would sit
  // at its stale pre-hidden size until an async ResizeObserver tick caught up.
  useEffect(() => {
    if (view === 'terminal' && activeId) terminalHostRegistry.fitOnShow(activeId)
  }, [view, activeId])

  // Tells main which terminal tab's shell process tree the AI status poller
  // should inspect (parity §1.3: "检测当前激活标签"). Settings has no active
  // terminal surface, so the status bar retracts while it is open.
  const statusBarHostId = view === 'terminal' ? activeId : null

  useEffect(() => {
    window.zinc.aiStatus.setActiveTab(statusBarHostId)
  }, [statusBarHostId])

  // Push the persisted keybindings into the global shortcut dispatcher
  // whenever settings load/change (rebind in the settings page round-trips
  // through here too).
  useEffect(() => {
    if (settings) shortcutManager.setBindings(settings.Keybindings)
  }, [settings])

  function bumpFontSize(delta: number): void {
    if (!settings) return
    const next = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, settings.FontSize + delta))
    updateDebounced({ FontSize: next })
  }

  // Registers (overwriting) every action's handler on every render so each
  // closes over the latest tabs/activeId/settings — cheap Map.set() calls,
  // no functional behavior tied to the render itself.
  useEffect(() => {
    shortcutManager.on('newTab', () => addTab())
    shortcutManager.on('closeTab', () => {
      if (activeId) closeTab(activeId)
    })
    shortcutManager.on('nextTab', () => {
      if (tabs.length < 2 || !activeId) return
      const idx = tabs.findIndex((t) => t.id === activeId)
      setActiveId(tabs[(idx + 1) % tabs.length].id)
    })
    shortcutManager.on('prevTab', () => {
      if (tabs.length < 2 || !activeId) return
      const idx = tabs.findIndex((t) => t.id === activeId)
      setActiveId(tabs[(idx - 1 + tabs.length) % tabs.length].id)
    })
    for (let i = 1; i <= 9; i++) {
      shortcutManager.on(`gotoTab${i}` as ShortcutAction, () => {
        const tab = tabs[i - 1]
        if (tab) switchTab(tab.id)
      })
    }
    shortcutManager.on('openSettings', () => setView('settings'))
    shortcutManager.on('cloneTab', () => {
      if (activeId) void cloneTab(activeId)
    })
    shortcutManager.on('zoomIn', () => bumpFontSize(1))
    shortcutManager.on('zoomOut', () => bumpFontSize(-1))
    shortcutManager.on('resetZoom', () => {
      // Discrete, non-repeating action (unlike zoomIn/zoomOut, which fire
      // rapidly on key-repeat) — commits immediately so a crash/quit before
      // the debounce window elapses can never lose the reset.
      if (settings) updateImmediate({ FontSize: DEFAULT_FONT_SIZE })
    })
  })

  useEffect(() => {
    if (import.meta.env.DEV) {
      // CDP verification hooks only — never relied on by product code.
      ;(
        window as unknown as {
          __zincTabs: {
            tabs: Tab[]
            activeId: string | null
            addTab: typeof addTab
            switchTab: typeof switchTab
            closeTab: typeof closeTab
            cloneTab: typeof cloneTab
          }
          __zincRegistry: typeof terminalHostRegistry
        }
      ).__zincTabs = { tabs, activeId, addTab, switchTab, closeTab, cloneTab }
      ;(window as unknown as { __zincRegistry: typeof terminalHostRegistry }).__zincRegistry =
        terminalHostRegistry
    }
  })

  // RailOpacity and TerminalOpacity (M9) are two independent surfaces, not
  // one shared expression — see chromeBackground.ts for why that's safe now:
  // Electron's Acrylic material doesn't alpha-blend partial-transparency web
  // content, but that only forces every surface *within the same layer* (the
  // whole rail, or the whole terminal card) to share one opacity — it never
  // required the rail and the terminal to match each other.
  const railOpacity = Math.max(0, Math.min(1, settings?.RailOpacity ?? 0))
  const terminalOpacity = Math.max(0, Math.min(1, settings?.TerminalOpacity ?? 0))
  const colorVariant = aodActive ? getAodVariant() : resolveVariant(getColorScheme(settings?.ColorScheme), themeMode)
  const railBg = aodActive ? '#000000' : surfaceBackground(railOpacity, colorVariant.surfaceBase)
  const terminalBg = aodActive ? '#000000' : surfaceBackground(terminalOpacity, colorVariant.surfaceBase)
  const statusBarRequested = (settings?.ShowStatusBar ?? true) && statusBarHostId !== null
  const statusBarHeight = getStatusBarHeight(settings?.StatusBarFontSize ?? 12)
  const showWindowControls = windowState.platform === 'linux' || windowState.fullScreen || aodActive

  return (
    <>
    {/* Outer background is the rail's own — it's the base layer the whole
        window sits on (M9): the terminal card floats on top of it as a
        rounded rect, so wherever the card's rounded corners cut away (its two
        left corners, which aren't at the window's true edge), this shows
        through instead of empty window backdrop. */}
    <div
      ref={burnInRootRef}
      className="aod-burn-in-frame flex h-screen w-screen text-fg-secondary"
      style={{
        background: railBg,
        padding: aodActive ? 16 : 0,
        boxSizing: 'border-box',
        transform: aodActive ? 'translate3d(var(--aod-offset-x, 0px), var(--aod-offset-y, 0px), 0)' : undefined
      }}
      onKeyDownCapture={() => {
        if (aodActive) wakeAod()
      }}
    >
      {/* Left tab rail — fixed 260px, square corners, spans the FULL window
          height (header + body), not just a middle row — this is the base
          layer the terminal card sits on top of (M9). Win11 NavigationView-
          style rows: 40px height, 4px corners, 3px selection pill in a 10px
          gutter, then a 22px slot (a sequential tab number here, an icon in
          the settings-category rail) — all copied from the old app's
          CreateTab()/rail-item construction. */}
      <div className="flex w-[260px] shrink-0 flex-col">
        {/* Top drag region's left segment — window has no native title bar
            (titleBarStyle: 'hidden'). Persists across every `view`, same as
            the old app kept its top strip visible while Settings was open. */}
        <div className="flex h-12 shrink-0 items-center gap-2 px-4 text-sm font-medium text-fg-secondary [-webkit-app-region:drag]">
          <img src={zincIcon} alt="" className="h-4 w-4 shrink-0" draggable={false} />
          Zinc
        </div>

        {/* Body swaps between the tab list and Settings' own category list —
            a plain conditional render (not a display-toggle) is fine here,
            unlike the terminal hosts below: neither tree holds xterm/pty
            state that a remount would lose. */}
        {view === 'settings' ? (
          <SettingsRailBody category={category} onSelect={setCategory} onBack={() => setView('terminal')} />
        ) : (
          <>
            <div
              role="tablist"
              aria-label={t('TerminalTabs')}
              aria-orientation="vertical"
              className="chrome-scroll flex flex-1 flex-col gap-0.5 overflow-y-auto py-1"
            >
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  data-tabid={tab.id}
                  role="tab"
                  tabIndex={tab.id === activeId ? 0 : -1}
                  aria-selected={tab.id === activeId}
                  className={`group relative mx-3 flex h-10 cursor-pointer items-center rounded pl-0.5 pr-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    tab.id === activeId ? 'bg-row-selected' : 'hover:bg-row-hover'
                  }`}
                  onClick={() => switchTab(tab.id)}
                  onDoubleClick={() => void cloneTab(tab.id)}
                  onContextMenu={(e) => openTabContextMenu(e, tab.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      switchTab(tab.id)
                      return
                    }
                    if (
                      event.key === 'ArrowDown' ||
                      event.key === 'ArrowRight' ||
                      event.key === 'ArrowUp' ||
                      event.key === 'ArrowLeft' ||
                      event.key === 'Home' ||
                      event.key === 'End'
                    ) {
                      event.preventDefault()
                      const tabElements = Array.from(
                        event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []
                      )
                      const currentIndex = tabElements.indexOf(event.currentTarget)
                      let nextIndex = currentIndex
                      if (event.key === 'Home') nextIndex = 0
                      else if (event.key === 'End') nextIndex = tabElements.length - 1
                      else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                        nextIndex = (currentIndex + 1) % tabElements.length
                      } else {
                        nextIndex = (currentIndex - 1 + tabElements.length) % tabElements.length
                      }
                      const nextTab = tabs[nextIndex]
                      if (nextTab) {
                        switchTab(nextTab.id)
                        tabElements[nextIndex]?.focus()
                      }
                      return
                    }
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                      event.preventDefault()
                      const rect = event.currentTarget.getBoundingClientRect()
                      showTabContextMenu(tab.id, rect.left + 32, rect.top + rect.height, event.currentTarget)
                    }
                  }}
                  onMouseDown={(e) => {
                    // Prevent the OS's middle-click autoscroll cursor from
                    // appearing before we handle the close on mouseup.
                    if (e.button === 1) e.preventDefault()
                  }}
                  onMouseUp={(e) => {
                    if (e.button === 1) closeTab(tab.id)
                  }}
                >
                  <span className="flex w-2.5 shrink-0 items-center justify-center">
                    {tab.id === activeId && <span className="h-4 w-[3px] rounded-full bg-accent" />}
                  </span>
                  <span className="w-[22px] shrink-0 text-[12px] text-fg-tertiary">{tab.num}</span>
                  {renamingTabId === tab.id ? (
                    <input
                      autoFocus
                      defaultValue={tabDisplayTitle(tab)}
                      aria-label={t('RenameTab')}
                      className="min-w-0 flex-1 rounded bg-transparent px-1 text-[13px] text-fg-primary outline-none ring-1 ring-accent"
                      onFocus={(e) => e.currentTarget.select()}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onMouseUp={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') commitTabRename(tab.id, e.currentTarget.value)
                        else if (e.key === 'Escape') setRenamingTabId(null)
                      }}
                      onBlur={(e) => commitTabRename(tab.id, e.currentTarget.value)}
                    />
                  ) : (
                    <span className="flex-1 truncate text-[13px] text-fg-primary" title={tabDisplayTitle(tab)}>{tabDisplayTitle(tab)}</span>
                  )}
                  <button
                    type="button"
                    aria-label={t('CloseTab')}
                    className="icon-font flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] text-fg-tertiary hover:bg-icon-hover-bg hover:text-icon-hover-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(tab.id)
                    }}
                  >
                    {SegoeIcon.Close}
                  </button>
                </div>
              ))}
            </div>

            <div ref={shellMenuRef} className="relative mx-3 mt-2 flex items-center gap-1">
              <button
                type="button"
                aria-label={t('NewTab')}
                className="icon-font flex h-9 w-10 items-center justify-center rounded text-sm text-fg-secondary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onClick={() => addTab()}
              >
                {SegoeIcon.Add}
              </button>
              <button
                ref={shellMenuTriggerRef}
                type="button"
                aria-label={t('ChooseShell')}
                aria-haspopup="menu"
                aria-expanded={shellMenuOpen}
                className={`icon-font flex h-9 w-7 items-center justify-center rounded text-[9px] text-fg-secondary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  shellMenuOpen ? 'bg-row-hover' : ''
                }`}
                onClick={() => setShellMenuOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setShellMenuOpen(true)
                  }
                }}
              >
                {SegoeIcon.ChevronDown}
              </button>
              {shellMenuOpen && (
                <div
                  role="menu"
                  aria-label={t('ChooseShell')}
                  className="absolute bottom-full left-0 z-30 mb-1.5 min-w-44 origin-bottom-left overflow-hidden rounded-lg border border-popup-border bg-popup-bg py-1 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.35),0_0_0_1px_rgba(0,0,0,0.04)] animate-[dropdown-in_120ms_cubic-bezier(0.16,1,0.3,1)]"
                  onKeyDown={(event) => {
                    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
                    if (items.length === 0) return
                    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLElement))
                    let nextIndex: number | null = null
                    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length
                    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length
                    else if (event.key === 'Home') nextIndex = 0
                    else if (event.key === 'End') nextIndex = items.length - 1
                    if (nextIndex === null) return
                    event.preventDefault()
                    items[nextIndex]?.focus()
                  }}
                >
                  {shellProfiles.length > 0 ? (
                    shellProfiles.map((profile) => (
                      <button
                        key={profile.id}
                        type="button"
                        role="menuitem"
                        className="mx-1 flex w-[calc(100%-0.5rem)] items-center rounded px-2 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        onClick={() => {
                          addTab({ shellId: profile.id, shellLabel: profile.label })
                          setShellMenuOpen(false)
                          requestAnimationFrame(() => shellMenuTriggerRef.current?.focus())
                        }}
                      >
                        {profile.label}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-fg-tertiary">{t('ShellDetecting')}</div>
                  )}
                </div>
              )}
              <button
                type="button"
                aria-label={t('SettingsTooltip')}
                data-testid="open-settings"
                className="icon-font flex h-9 w-10 items-center justify-center rounded text-sm text-fg-secondary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onClick={() => setView('settings')}
              >
                {SegoeIcon.Settings}
              </button>
            </div>
          </>
        )}
      </div>

      {tabContextMenu && (
        <div
          ref={tabContextMenuRef}
          role="menu"
          className="fixed z-50 w-36 rounded border border-card-border bg-card-bg py-1 text-[13px] text-fg-primary shadow-lg"
          style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(event) => {
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
            if (items.length === 0) return
            const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLElement))
            let nextIndex: number | null = null
            if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length
            else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length
            else if (event.key === 'Home') nextIndex = 0
            else if (event.key === 'End') nextIndex = items.length - 1
            if (nextIndex === null) return
            event.preventDefault()
            items[nextIndex].focus()
          }}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="flex h-8 w-full items-center px-3 text-left hover:bg-row-hover"
            onClick={() => {
              const tabId = tabContextMenu.tabId
              // No focus return to the tab row here: it would land one frame
              // AFTER the rename input autofocuses, blurring (and thus
              // committing/unmounting) it immediately.
              closeTabContextMenu(false)
              renameTab(tabId)
            }}
          >
            {t('RenameTab')}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="flex h-8 w-full items-center px-3 text-left hover:bg-row-hover"
            onClick={() => {
              const tabId = tabContextMenu.tabId
              closeTabContextMenu(true)
              duplicateTab(tabId)
            }}
          >
            {t('DuplicateTab')}
          </button>
        </div>
      )}

      {/* Right terminal card (M9) — a single rounded-rect overlay spanning
          the FULL window height, flush against the window's top/right/bottom
          edges. `overflow-hidden` + matching `borderRadius` clips its drag
          strip/content/status-bar to that shape; its two left corners round
          away into the rail's background painted on the outer container
          above, since this card is the only thing between the rail and the
          window's true right/top/bottom edges.

          The `boxShadow` is what actually sells "this is a layer floating
          over the rail", not just the corner radius: at RailOpacity/
          TerminalOpacity 0 (both surfaces raw Mica), the two columns would
          otherwise be visually identical texture with no depth cue at all.
          A shadow paints outside the element's own box, so — unlike the
          background — it isn't clipped by this element's own
          `overflow-hidden` and shows up over the rail regardless of either
          opacity value. Left/bottom-weighted (Fluent's ambient+key light
          convention: light from upper-left) since the card's other three
          edges sit flush against the window's own edge and can't show a
          shadow past it anyway. */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{
          background: terminalBg,
          borderRadius: aodActive ? 0 : WINDOW_CORNER_RADIUS,
          boxShadow: aodActive ? 'none' : 'inset 1px 0 0 rgba(255, 255, 255, 0.06), -12px 0 28px -6px rgba(0, 0, 0, 0.55)'
        }}
      >
        {/* Top drag region's right segment — self-drawn controls appear only when native caption buttons are unavailable or intentionally hidden. */}
        <div className="flex h-12 shrink-0 items-center justify-end gap-1 px-3 [-webkit-app-region:drag]">
          {showWindowControls && (
            <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
              <button
                type="button"
                aria-label="Minimize"
                title="Minimize"
                onClick={() => {
                  void window.zinc.window.minimize()
                }}
                className={`flex h-8 w-8 items-center justify-center rounded text-fg-tertiary transition-colors hover:bg-icon-hover-bg hover:text-icon-hover-fg ${
                  aodActive ? 'opacity-70' : ''
                }`}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
                  <path d="M3 11.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Close"
                title="Close"
                onClick={() => {
                  void window.zinc.window.close()
                }}
                className={`icon-font flex h-8 w-8 items-center justify-center rounded text-[11px] text-fg-tertiary transition-colors hover:bg-icon-hover-bg hover:text-icon-hover-fg ${
                  aodActive ? 'opacity-70' : ''
                }`}
              >
                {SegoeIcon.Close}
              </button>
            </div>
          )}
        </div>

        {/* Content band below the drag strip. Settings'
            content and the terminal hosts are both always-mounted siblings,
            display-toggled by `view` — the terminal hosts must never
            unmount mid-session (parity §1.1: "visibility switch, not
            unload"), so this can't be a plain conditional render like the
            rail body above. */}
        <div className="absolute inset-x-0 bottom-0 top-12 overflow-hidden">
          <div className="absolute inset-x-0 top-0" style={{ bottom: statusBarRequested ? statusBarHeight : 0 }}>
            <div
              className="chrome-scroll absolute inset-0 overflow-y-auto px-8 pb-8 pt-3"
              style={{ display: view === 'settings' ? 'block' : 'none' }}
            >
              <SettingsContentBody category={category} />
            </div>

          {/* `#terminal` (xterm's own mount point) used the old app's
              asymmetric `6px 0 0 14px` inset (top/left only, flush
              right/bottom) — fine when the terminal was a plain rectangle,
              but Claude Code and other CLI tools size their own box-drawn UI
              to the reported column count, which fills flush to whichever
              edge has zero padding.

              Symmetric padding alone wasn't the full fix (M10 follow-up):
              FitAddon sizes the canvas from the mount element's own
              `clientWidth`/`clientHeight`, which — per the CSS spec — already
              *includes* that element's own padding. Padding the same div
              xterm mounts into makes FitAddon overestimate the available
              space by exactly the padding amount, so the canvas overflows
              past the padded right/bottom edges while the left/top look fine
              (a normal-flow child's start position does honor its parent's
              left/top padding, only its width/height don't shrink for it) —
              confirmed by measuring the live geometry: canvas right edge sat
              past the container's own right edge. Fix: padding goes on this
              outer wrapper; xterm mounts into an unpadded inner div that
              fills it, so `clientWidth`/`clientHeight` there is the true
              available space with no padding baked in. */}
          <div className="absolute inset-0" style={{ display: view === 'terminal' ? 'block' : 'none' }}>
            {/* Inactive tabs stay laid out (never `display:none`) — that was
                the actual measured bug behind the tab-switch lag complaint:
                a `display:none` container collapses to 0x0, so a host
                created while hidden (a restored non-active tab) ran its
                first `fit.fit()` against zero size and got stuck with
                garbage tiny cols/rows (measured: 7x4) until the next
                switch-to recomputed it — a real resize+repaint round trip
                every time, on top of whatever the raw switch cost. Keeping
                every host laid out at full size at all times (just
                opacity/pointer-events toggled) means `fit.fit()` always
                sees the true size, so switching is just a paint, never a
                resize. It also makes the slide transition possible at all —
                `display` can't be CSS-transitioned, opacity/transform can. */}
            {tabs.map((tab) => {
              const isActive = tab.id === activeId
              return (
                <div
                  key={tab.id}
                  className="absolute inset-0 p-3.5 transition-[opacity,transform] duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{
                    opacity: isActive ? 1 : 0,
                    transform: isActive ? 'translateY(0)' : 'translateY(10px)',
                    pointerEvents: isActive ? 'auto' : 'none',
                    zIndex: isActive ? 1 : 0
                  }}
                >
                  <div
                    ref={(el) => {
                      if (el && settings) {
                        terminalHostRegistry.createHost(tab.id, el, {
                          shellId: tab.shellId,
                          cwd: tab.spawnCwd ?? settings.StartingDirectory,
                          startupCommand: tab.startupCommand
                        })
                      }
                    }}
                    className="h-full w-full"
                  />
                </div>
              )
            })}
          </div>

          </div>

        </div>

        {/* Bottom status bar (parity §1.3): AI usage detection for the active
            terminal tab. It retracts while Settings is open. */}
        <div
          className="absolute inset-x-0 bottom-0 overflow-hidden"
          style={{
            display: statusBarRequested ? 'block' : 'none',
            // The rendered bar and the terminal's reserved bottom inset share
            // this value, so larger configured text cannot overlap the shell.
            height: statusBarHeight
          }}
        >
          <StatusBar visible={statusBarRequested} activeId={statusBarHostId} />
        </div>
      </div>
    </div>
    {splashVisible && (
      <div className={`zinc-splash ${splashLeaving ? 'zinc-splash-leaving' : ''}`} aria-hidden="true">
        <div className="zinc-splash-mark">
          <img src={zincIcon} alt="" draggable={false} />
        </div>
      </div>
    )}
    {(terminalNotice || shellFallbackVisible) && (
      <div
        role="status"
        className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-card-border bg-card-bg px-3.5 py-2 text-[13px] text-fg-secondary shadow-lg"
      >
        {shellFallbackVisible
          ? t('DefaultShellFallback')
          : t(
              terminalNotice === 'copyFailed'
                ? 'ClipboardCopyFailed'
                : terminalNotice === 'pasteFailed'
                  ? 'ClipboardPasteFailed'
                  : 'TerminalStartFailed'
            )}
      </div>
    )}
    </>
  )
}
