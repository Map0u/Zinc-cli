import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import { terminalHostRegistry, type TerminalNotice } from './terminal/TerminalHostRegistry'
import { useSettings } from './settings/SettingsContext'
import { useI18n } from './i18n/I18nContext'
import { SettingsRailBody, SettingsContentBody, type Category } from './settings/SettingsPage'
import { shortcutManager } from './shortcuts/ShortcutManager'
import { SegoeIcon } from './segoeFluentIcons'
import { surfaceBackground } from './chromeBackground'
import { surfaceBaseFor } from './terminal/grokFullscreenSurface'

/** Length of the Grok surface-tint cross-fade; index.css uses the same value. */
const SURFACE_FADE_MS = 220
/** How often batched tab-title changes are applied (see the onTitleChange effect). */
const TITLE_FLUSH_MS = 250
import { getColorScheme, harmonizeAccent, resolveVariant } from './colorSchemes'
import { useResolvedThemeMode } from './themeMode'
import zincIcon from './assets/zinc-icon.png'
import {
  consumeShellFallbackNotice,
  loadShellProfiles,
  type ShellProfile
} from './shells/shellProfiles'
import type { ShortcutAction } from '../../shared/keybindings'
import { MAX_GROUP_KEY_LENGTH, MAX_TAB_TITLE_LENGTH, type RestorePayload } from '../../shared/sessionState'
import { moveItem } from './tabs/tabDragOrder'
import {
  createGroup,
  dissolveGroup,
  moveGroup,
  moveGroupStep,
  moveTabs,
  moveTabStep,
  neighborAfterClose,
  normalizeRail,
  renameGroup,
  revealTab,
  toggleCollapsed,
  ungroupTab,
  type MoveTarget,
  type RailState,
  type TabGroup
} from './tabs/tabGroups'
import { TabRail } from './tabs/TabRail'
import { cwdBasename } from './tabs/tabLabel'
import { attachTabStores, forgetTabValues, tabActivityStore, tabContextStore, tabTitleStore } from './tabs/tabStores'
import { useUpdate } from './update/UpdateContext'
import { UpdateDialog } from './update/UpdateDialog'

/** Bounds mirrored from the settings page's font-size NumberField (SettingsPage.tsx). */
const FONT_SIZE_MIN = 8
const FONT_SIZE_MAX = 32
const DEFAULT_FONT_SIZE = 16

/** Left rail width — must match SettingsService NUMERIC_BOUNDS.RailWidth. */
const RAIL_WIDTH_MIN = 160
const RAIL_WIDTH_MAX = 520
const RAIL_WIDTH_DEFAULT = 260

/**
 * Win11's own DWM window-corner rounding at 100% scale, and Fluent's
 * `OverlayCornerRadius`/largest `ControlCornerRadius` token — the terminal
 * card's rounding must match this or its corners visibly disagree with the
 * window's own corner right where they meet (M9).
 */
const WINDOW_CORNER_RADIUS = 8

function clampRailWidth(value: number): number {
  if (!Number.isFinite(value)) return RAIL_WIDTH_DEFAULT
  return Math.max(RAIL_WIDTH_MIN, Math.min(RAIL_WIDTH_MAX, Math.round(value)))
}

interface Tab {
  id: string
  /** User-provided rail label; when set, terminal title updates no longer overwrite the displayed label. */
  customTitle?: string
  /** cwd to spawn this tab's shell in; only set for clones/restored tabs. `undefined` = registry/PtyManager default. */
  spawnCwd?: string
  /** Stable shell profile id; main resolves it to the current executable at spawn time. */
  shellId?: string
  /** Friendly profile name shown until the shell provides an OSC title. */
  shellLabel?: string
  /** `claude --continue` / `codex resume --last` / `grok --continue` for a restored tab whose saved session had a known AI tool. */
  startupCommand?: string
  /** The rail group this tab sits in (see tabs/tabGroups.ts). */
  groupId?: string
  /** The user placed this tab, so automatic grouping leaves it alone. */
  manual?: boolean
}

/** A tab's menu, or a group header's. */
interface TabContextMenuState {
  kind: 'tab' | 'group'
  id: string
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
  /** A duplicate lands right after its source and joins the source's group. */
  insertAfterId?: string
}

/** One entry of the rail's context menus. */
function MenuItem({ children, onClick, indent }: { children: ReactNode; onClick(): void; indent?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={`flex h-8 w-full items-center px-3 text-left hover:bg-row-hover focus-visible:bg-row-hover focus-visible:outline-none ${
        indent ? 'pl-6' : ''
      }`}
      onClick={onClick}
    >
      <span className="min-w-0 truncate">{children}</span>
    </button>
  )
}

export default function App() {
  // Tabs and groups live in one state so every mutation can be normalized
  // against the other (see tabs/tabGroups.ts): nothing leaves `setRail` unless
  // the group invariants hold.
  const [rail, setRailState] = useState<RailState<Tab>>({ tabs: [], groups: [] })
  const { tabs, groups } = rail
  function setRail(update: (prev: RailState<Tab>) => RailState<Tab>): void {
    setRailState((prev) => {
      const raw = update(prev)
      const next = normalizeRail(raw.tabs, raw.groups)
      return next.tabs === prev.tabs && next.groups === prev.groups ? prev : next
    })
  }
  function setTabs(update: (prev: Tab[]) => Tab[]): void {
    setRail((prev) => ({ tabs: update(prev.tabs), groups: prev.groups }))
  }
  // Title events arrive through a once-registered listener; keep its no-op
  // check current without resubscribing on every tab render.
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const groupsRef = useRef(groups)
  groupsRef.current = groups
  const pendingCloneIdsRef = useRef(new Set<string>())
  // A close can be queued before React commits tabsRef's next value.
  const closingTabIdsRef = useRef(new Set<string>())
  useEffect(() => {
    // After the removal renders, tabsRef itself rejects late clones; the
    // synchronous close marker is no longer needed.
    for (const id of closingTabIdsRef.current) {
      if (!tabs.some((tab) => tab.id === id)) closingTabIdsRef.current.delete(id)
    }
  }, [tabs])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  /** Monotonic id suffix for `grp-${n}` only. */
  const nextGroupIdRef = useRef(1)
  const [shellProfiles, setShellProfiles] = useState<ShellProfile[]>([])
  const [shellMenuOpen, setShellMenuOpen] = useState(false)
  const [splashVisible, setSplashVisible] = useState(true)
  const [splashLeaving, setSplashLeaving] = useState(false)
  const [view, setView] = useState<AppView>('terminal')
  const [category, setCategory] = useState<Category>('appearance')
  const { settings, updateDebounced, updateImmediate } = useSettings()
  const { t, language } = useI18n()
  const { showBadge, openDialog, state: updateState } = useUpdate()
  const themeMode = useResolvedThemeMode(settings?.ThemePreference ?? 'auto')
  const [windowState, setWindowState] = useState(window.zinc.window.getStateSync())
  const tabContextMenuRef = useRef<HTMLDivElement | null>(null)
  const tabContextMenuReturnFocusRef = useRef<HTMLElement | null>(null)
  const shellMenuRef = useRef<HTMLDivElement | null>(null)
  const shellMenuTriggerRef = useRef<HTMLButtonElement | null>(null)
  /** Live width while the user drags the rail splitter (avoids waiting on settings round-trips). */
  const [railWidthLive, setRailWidthLive] = useState<number | null>(null)
  const railResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
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
    let cancelled = false
    if (settings.AccentSource === 'system') {
      window.zinc.window.getAccentColor().then((hex) => {
        // A scheme/source/theme change can paint its new accent before this IPC
        // reply arrives. Never let the old lookup replace that newer choice.
        if (cancelled) return
        const harmonized = harmonizeAccent(hex, themeMode)
        document.documentElement.style.setProperty('--color-accent', harmonized)
      })
    } else {
      const variant = resolveVariant(getColorScheme(settings.ColorScheme), themeMode)
      document.documentElement.style.setProperty('--color-accent', variant.accent)
    }
    return () => {
      cancelled = true
    }
  }, [settings?.AccentSource, settings?.ColorScheme, themeMode])

  /** Monotonic id suffix for `tab-${n}` only. */
  const nextIdRef = useRef(1)
  const initializedRef = useRef(false)
  // Flips true only after restoreTabs()/addTab() has committed the initial
  // hydration from session-state.json. Guards the [tabs, activeId] snapshot
  // effect below: without this, the renderer mounts with tabs=[] and that
  // effect fires with an empty snapshot before getRestorePayload() resolves,
  // so a quit/crash during that startup window would overwrite the previous
  // valid session-state.json with {Tabs:[], ActiveIndex:-1}.
  const [sessionReady, setSessionReady] = useState(false)

  /** Pushes the current tab order + groups + active id to main's live cache (see index.ts's `latestSessionSnapshot`). */
  function pushSessionSnapshot(tabsList: Tab[], activeIdValue: string | null, groupsList: TabGroup[]): void {
    const idx = tabsList.findIndex((t) => t.id === activeIdValue)
    window.zinc.session.pushSnapshot({
      tabs: tabsList.map((t) => ({
        id: t.id,
        shellId: t.shellId,
        customTitle: t.customTitle,
        ...(t.groupId ? { groupId: t.groupId } : {}),
        ...(t.manual ? { manual: true } : {})
      })),
      activeIndex: idx,
      ...(groupsList.length > 0
        ? {
            groups: groupsList.map((g) => ({
              id: g.id,
              collapsed: g.collapsed,
              auto: g.auto,
              ...(g.name ? { name: g.name } : {}),
              ...(g.key && g.key.length <= MAX_GROUP_KEY_LENGTH ? { key: g.key } : {})
            }))
          }
        : {})
    })
  }

  function normalizeTabTitle(title: string): string | null {
    const clean = title.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TAB_TITLE_LENGTH)
    return clean.length > 0 ? clean : null
  }

  function profileForId(shellId: string | undefined): ShellProfile | undefined {
    return shellProfiles.find((profile) => profile.id === shellId)
  }

  function addTab(options: AddTabOptions = {}): void {
    const id = `tab-${nextIdRef.current++}`
    const configuredShellId = settings?.DefaultShellId
    const selectedProfile = profileForId(options.shellId ?? configuredShellId) ?? (options.shellId ? undefined : shellProfiles[0])
    setRail((prev) => {
      if (prev.tabs.some((t) => t.id === id)) return prev
      const tab: Tab = {
        id,
        customTitle: options.customTitle,
        spawnCwd: options.spawnCwd,
        startupCommand: options.startupCommand,
        shellId: options.shellId ?? selectedProfile?.id ?? configuredShellId,
        shellLabel: options.shellLabel ?? selectedProfile?.label
      }
      const at = options.insertAfterId ? prev.tabs.findIndex((t) => t.id === options.insertAfterId) : -1
      if (at < 0) return { tabs: [...prev.tabs, tab], groups: prev.groups }
      // Right after the source, in the source's group.
      const groupId = prev.tabs[at].groupId
      const inserted = groupId === undefined ? tab : { ...tab, groupId }
      return { tabs: [...prev.tabs.slice(0, at + 1), inserted, ...prev.tabs.slice(at + 1)], groups: prev.groups }
    })
    if (options.initialTitle) tabTitleStore.set(id, options.initialTitle)
    setActiveId(id)
  }

  /** Recreates every tab from a resolved session-state.json restore plan in one shot, so `ActiveIndex` lands correctly (parity §1.4) instead of drifting to whichever tab `addTab` added last. */
  function restoreTabs(payload: RestorePayload): void {
    // Saved group ids are only labels for this file; the live groups get fresh ids.
    const groupIds = new Map<string, string>()
    const restoredGroups: TabGroup[] = (payload.groups ?? []).map((g) => {
      const id = `grp-${nextGroupIdRef.current++}`
      groupIds.set(g.id, id)
      return { id, collapsed: g.collapsed, auto: g.auto, ...(g.name ? { name: g.name } : {}), ...(g.key ? { key: g.key } : {}) }
    })
    const restored: Tab[] = payload.tabs.map((t) => {
      const id = `tab-${nextIdRef.current++}`
      const groupId = t.groupId === undefined ? undefined : groupIds.get(t.groupId)
      // Sessions written before multi-shell support have no id. Attach the
      // current default now so they receive the normal title and are migrated
      // the next time session state is persisted.
      const shellId = t.shellId ?? settings?.DefaultShellId
      return {
        id,
        customTitle: t.customTitle,
        spawnCwd: t.cwd,
        startupCommand: t.startupCommand,
        shellId,
        shellLabel: profileForId(shellId)?.label,
        ...(groupId ? { groupId } : {}),
        ...(t.manual ? { manual: true } : {})
      }
    })
    // Main binds saved cwd / AI sessions to the new tabs by index, so the order must survive
    // normalization. A file whose groups would need tabs reordered (hand-edited) restores ungrouped.
    const normalized = normalizeRail(restored, restoredGroups)
    const keepsOrder = normalized.tabs.every((tab, i) => tab.id === restored[i].id)
    setRailState(keepsOrder ? normalized : { tabs: restored.map(({ groupId: _g, ...rest }) => rest), groups: [] })
    const idx = payload.activeIndex >= 0 && payload.activeIndex < restored.length ? payload.activeIndex : 0
    setActiveId(restored[idx]?.id ?? null)
  }

  /** A drag dropped a tab into a group or at a top-level position. */
  function moveTab(id: string, target: MoveTarget): void {
    setRail((prev) => moveTabs(prev.tabs, prev.groups, id, target))
  }

  /** A drag dropped a whole group before a top-level tab / group (null = at the end). */
  function moveGroupTo(id: string, before: string | null): void {
    setRail((prev) => moveGroup(prev.tabs, prev.groups, id, before))
  }

  /** Alt+Up / Alt+Down: one visible position for a tab, or for a whole group. */
  function moveStep(id: string, direction: -1 | 1, isGroup: boolean): void {
    setRail((prev) =>
      isGroup ? moveGroupStep(prev.tabs, prev.groups, id, direction) : moveTabStep(prev.tabs, prev.groups, id, direction)
    )
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
    closingTabIdsRef.current.add(id)
    // Derive next-tabs/active-id/quit decision from the latest previous state
    // in one functional update, not the render-closure `tabs`/`activeId` —
    // rapid close gestures (e.g. mashing middle-click) can fire this handler
    // multiple times before React commits the first update, and reading the
    // closure's stale `tabs` would resurrect an already-closed tab or pick
    // the wrong active tab.
    setRail((prevRail) => {
      const prevTabs = prevRail.tabs
      const idx = prevTabs.findIndex((t) => t.id === id)
      if (idx === -1) return prevRail
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
        pushSessionSnapshot(next, null, [])
        window.zinc.app.requestQuit()
        return { tabs: next, groups: prevRail.groups }
      }

      terminalHostRegistry.destroyHost(id)
      setGrokTintedIds((prev) => {
        if (!prev.has(id)) return prev
        const rest = new Set(prev)
        rest.delete(id)
        return rest
      })
      // The neighbour in visible order (next tab, else previous) takes over, not the last tab.
      setActiveId((prevActiveId) => neighborAfterClose(prevTabs, prevRail.groups, id, prevActiveId))
      return { tabs: next, groups: prevRail.groups }
    })
    forgetTabValues(id)
  }

  async function cloneTab(sourceId: string): Promise<void> {
    if (pendingCloneIdsRef.current.has(sourceId) || closingTabIdsRef.current.has(sourceId)) return
    if (!tabsRef.current.some((tab) => tab.id === sourceId)) return
    pendingCloneIdsRef.current.add(sourceId)
    try {
      const cwd = await window.zinc.pty.getCwd(sourceId)
      // The source can close while getCwd is in flight (even before React
      // commits its removal); never turn that late answer into a new tab.
      if (closingTabIdsRef.current.has(sourceId)) return
      const source = tabsRef.current.find((tab) => tab.id === sourceId)
      if (!source) return
      addTab({
        spawnCwd: cwd ?? undefined,
        initialTitle: tabTitleStore.get(sourceId),
        customTitle: source.customTitle,
        shellId: source.shellId,
        shellLabel: source.shellLabel,
        insertAfterId: sourceId
      })
    } catch (err) {
      console.error(`[tabs] failed to read cwd for ${sourceId}:`, err)
    } finally {
      pendingCloneIdsRef.current.delete(sourceId)
    }
  }

  /** Rows the menu will show, to keep it on screen: a group's has 3 items; a tab's grows with the groups it can join. */
  function openRailMenu(kind: 'tab' | 'group', id: string, x: number, y: number): void {
    let items = 3
    let extras = 0
    if (kind === 'tab') {
      const own = tabsRef.current.find((tab) => tab.id === id)?.groupId
      const others = groupsRef.current.filter((group) => group.id !== own).length
      items = 3 + (own ? 1 : 0) + others
      extras = 9 + (others > 0 ? 9 + 24 : 0)
    }
    setTabContextMenu({
      kind,
      id,
      x: Math.max(8, Math.min(x, window.innerWidth - 268)),
      y: Math.max(8, Math.min(y, window.innerHeight - (16 + items * 32 + extras)))
    })
  }

  function showTabContextMenu(tabId: string, x: number, y: number, returnFocus: HTMLElement): void {
    tabContextMenuReturnFocusRef.current = returnFocus
    setActiveId(tabId)
    openRailMenu('tab', tabId, x, y)
  }

  function showGroupContextMenu(groupId: string, x: number, y: number, returnFocus: HTMLElement): void {
    tabContextMenuReturnFocusRef.current = returnFocus
    openRailMenu('group', groupId, x, y)
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

  // Groups. Every change goes through `setRail`, so the invariants hold afterwards.
  function newGroupWithTab(tabId: string): void {
    const groupId = `grp-${nextGroupIdRef.current++}`
    setRail((prev) => createGroup(prev.tabs, prev.groups, [tabId], groupId))
    // The header opens straight into its name field.
    setRenamingGroupId(groupId)
  }

  function removeFromGroup(tabId: string): void {
    setRail((prev) => ungroupTab(prev.tabs, prev.groups, tabId))
  }

  function addToGroup(tabId: string, groupId: string): void {
    setRail((prev) => {
      const moved = moveTabs(prev.tabs, prev.groups, tabId, { intoGroup: groupId })
      // The tab being added is the active one; it must not vanish into a collapsed group.
      return revealTab(moved.tabs, moved.groups, tabId)
    })
  }

  function toggleGroup(groupId: string): void {
    setRail((prev) => toggleCollapsed(prev.tabs, prev.groups, groupId))
  }

  function ungroup(groupId: string): void {
    setRenamingGroupId((current) => (current === groupId ? null : current))
    setRail((prev) => dissolveGroup(prev.tabs, prev.groups, groupId))
  }

  function startGroupRename(groupId: string): void {
    if (groupsRef.current.some((group) => group.id === groupId)) setRenamingGroupId(groupId)
  }

  function commitGroupRename(groupId: string, raw: string): void {
    setRenamingGroupId(null)
    const clean = normalizeTabTitle(raw)
    if (!clean) return
    setRail((prev) => renameGroup(prev.tabs, prev.groups, groupId, clean))
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
  // Keyed on what the snapshot actually carries (ids, shells, order, active
  // tab, rename) — not on `tabs` itself, which also changes when a shell label
  // resolves and would resend an identical snapshot (and restart main's save debounce).
  // Group membership, names and collapsed state are part of what the snapshot carries.
  const snapshotKey =
    tabs.map((t) => `${t.id}:${t.shellId}:${t.customTitle ?? ''}:${t.groupId ?? ''}:${t.manual ? 1 : 0}`).join('|') +
    JSON.stringify(groups)
  useEffect(() => {
    if (!sessionReady) return
    pushSessionSnapshot(tabsRef.current, activeId, groupsRef.current)
  }, [snapshotKey, activeId, sessionReady])

  // Whatever makes a tab active - a click, Ctrl+Tab, Ctrl+N, a duplicate, closing
  // the active tab, restore - must not leave it hidden inside a collapsed group.
  // Layout effect: the group is open before the first paint of the new selection.
  useLayoutEffect(() => {
    if (activeId) setRail((prev) => revealTab(prev.tabs, prev.groups, activeId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

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

  // Tells the registry which host is on screen before any fit/focus runs this
  // commit — hidden hosts must neither take focus nor re-fit eagerly.
  useLayoutEffect(() => {
    terminalHostRegistry.setActiveHost(view === 'terminal' ? activeId : null)
  }, [view, activeId])

  // Which tabs currently wear Grok's surface color. The registry owns the
  // decision (it sees the buffer type and the detected tool); React only needs
  // the answer for whichever tab is on screen, since the card is shared.
  const [grokTintedIds, setGrokTintedIds] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    return terminalHostRegistry.onSurfaceTintChange((id, tinted) => {
      setGrokTintedIds((prev) => {
        if (prev.has(id) === tinted) return prev
        const next = new Set(prev)
        if (tinted) next.add(id)
        else next.delete(id)
        return next
      })
    })
  }, [])

  // The fade is armed only around a Grok tint change, never left on. xterm
  // repaints its rows against a new theme immediately but its canvas colour
  // would transition, so an always-on transition would show new-scheme glyphs
  // over the old scheme's background for the length of the fade every time the
  // colour scheme or light/dark mode changed.
  const activeTabIsGrokTinted = activeId ? grokTintedIds.has(activeId) : false
  const [surfaceFading, setSurfaceFading] = useState(false)
  const lastGrokTintRef = useRef(activeTabIsGrokTinted)
  useEffect(() => {
    if (lastGrokTintRef.current === activeTabIsGrokTinted) return
    lastGrokTintRef.current = activeTabIsGrokTinted
    setSurfaceFading(true)
    const timer = window.setTimeout(() => setSurfaceFading(false), SURFACE_FADE_MS + 40)
    return () => window.clearTimeout(timer)
  }, [activeTabIsGrokTinted])

  // Titles are coalesced: Claude Code and similar CLIs animate a spinner in
  // the title several times a second. One batched write per TITLE_FLUSH_MS is
  // plenty for a label in the tab rail, and the titles live in a per-tab store
  // (not in `tabs`), so a flush re-renders only the rows whose title changed.
  useEffect(() => {
    const pending = new Map<string, string>()
    let timer: number | null = null
    const flush = (): void => {
      timer = null
      for (const [id, title] of pending) tabTitleStore.set(id, title)
      pending.clear()
    }
    const unsubscribe = terminalHostRegistry.onTitleChange((id, title) => {
      const clean = normalizeTabTitle(title)
      if (!clean) return
      if ((pending.get(id) ?? tabTitleStore.get(id)) === clean) return
      pending.set(id, clean)
      if (timer === null) timer = window.setTimeout(flush, TITLE_FLUSH_MS)
    })
    return () => {
      unsubscribe()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  // Activity / context pushes from main land in the same kind of per-tab store.
  useEffect(() => attachTabStores(), [])

  // Transient toast for terminal notices. The registry is plain TS with no
  // access to i18n/React, so it emits a
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

  // Re-fit and refocus whenever the visible tab changes (a brand new host was
  // just created, or another tab was shown) and when returning to the
  // terminal view, which flips the terminal-content column back from
  // display:none without `activeId` changing — the host would otherwise sit
  // at its stale pre-hidden size until an async ResizeObserver tick caught up.
  useEffect(() => {
    if (view === 'terminal' && activeId) terminalHostRegistry.fitOnShow(activeId)
  }, [view, activeId])

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
            groups: TabGroup[]
            groupOp: (op: string, ...args: any[]) => void // eslint-disable-line @typescript-eslint/no-explicit-any
            activeId: string | null
            addTab: typeof addTab
            switchTab: typeof switchTab
            closeTab: typeof closeTab
            cloneTab: typeof cloneTab
            reorderTab: (fromIndex: number, toIndex: number) => void
          }
          __zincRegistry: typeof terminalHostRegistry
        }
      ).__zincTabs = {
            tabs,
            groups,
            /** Test helper: run one pure group op on the live rail (create / move / toggle / rename / ungroup / dissolve). */
            groupOp: (op, ...args) =>
              setRail((prev) => {
                switch (op) {
                  case 'create':
                    return createGroup(prev.tabs, prev.groups, args[0], args[1], args[2])
                  case 'move':
                    return moveTabs(prev.tabs, prev.groups, args[0], args[1])
                  case 'toggle':
                    return toggleCollapsed(prev.tabs, prev.groups, args[0], args[1])
                  case 'rename':
                    return renameGroup(prev.tabs, prev.groups, args[0], args[1])
                  case 'ungroup':
                    return ungroupTab(prev.tabs, prev.groups, args[0])
                  case 'dissolve':
                    return dissolveGroup(prev.tabs, prev.groups, args[0])
                  default:
                    return prev
                }
              }),
            activeId,
            addTab,
            switchTab,
            closeTab,
            cloneTab,
            /** Test helper: move tab at fromIndex to toIndex (display numbers follow order). */
            reorderTab: (fromIndex: number, toIndex: number) => {
              setTabs((prev) => moveItem(prev, fromIndex, toIndex))
            }
          }
      ;(window as unknown as { __zincRegistry: typeof terminalHostRegistry }).__zincRegistry =
        terminalHostRegistry
      // Rail verification only: fake the per-tab pushes main will send.
      ;(window as unknown as { __zincRail: unknown }).__zincRail = {
        setActivity: tabActivityStore.set,
        setContext: tabContextStore.set,
        setTitle: tabTitleStore.set
      }
    }
  })

  // The rail is memoized, so it gets callbacks whose identity never changes;
  // each forwards to this render's closure over tabs / activeId / settings.
  const railActions = {
    onSwitch: switchTab,
    onClose: closeTab,
    onClone: (id: string) => void cloneTab(id),
    onMoveTab: moveTab,
    onMoveGroup: moveGroupTo,
    onMoveStep: moveStep,
    onContextMenu: showTabContextMenu,
    onRenameCommit: commitTabRename,
    onRenameCancel: () => setRenamingTabId(null),
    onToggleGroup: toggleGroup,
    onGroupContextMenu: showGroupContextMenu,
    onRenameGroup: startGroupRename,
    onGroupRenameCommit: commitGroupRename,
    onGroupRenameCancel: () => setRenamingGroupId(null)
  }
  const railActionsRef = useRef(railActions)
  railActionsRef.current = railActions
  const railHandlers = useMemo<typeof railActions>(
    () => ({
      onSwitch: (id) => railActionsRef.current.onSwitch(id),
      onClose: (id) => railActionsRef.current.onClose(id),
      onClone: (id) => railActionsRef.current.onClone(id),
      onMoveTab: (id, target) => railActionsRef.current.onMoveTab(id, target),
      onMoveGroup: (id, before) => railActionsRef.current.onMoveGroup(id, before),
      onMoveStep: (id, direction, isGroup) => railActionsRef.current.onMoveStep(id, direction, isGroup),
      onContextMenu: (id, x, y, el) => railActionsRef.current.onContextMenu(id, x, y, el),
      onRenameCommit: (id, raw) => railActionsRef.current.onRenameCommit(id, raw),
      onRenameCancel: () => railActionsRef.current.onRenameCancel(),
      onToggleGroup: (id) => railActionsRef.current.onToggleGroup(id),
      onGroupContextMenu: (id, x, y, el) => railActionsRef.current.onGroupContextMenu(id, x, y, el),
      onRenameGroup: (id) => railActionsRef.current.onRenameGroup(id),
      onGroupRenameCommit: (id, raw) => railActionsRef.current.onGroupRenameCommit(id, raw),
      onGroupRenameCancel: () => railActionsRef.current.onGroupRenameCancel()
    }),
    []
  )

  // RailOpacity and TerminalOpacity (M9) are two independent surfaces, not
  // one shared expression — see chromeBackground.ts for why that's safe now:
  // Electron's Acrylic material doesn't alpha-blend partial-transparency web
  // content, but that only forces every surface *within the same layer* (the
  // whole rail, or the whole terminal card) to share one opacity — it never
  // required the rail and the terminal to match each other.
  const railOpacity = Math.max(0, Math.min(1, settings?.RailOpacity ?? 0))
  const terminalOpacity = Math.max(0, Math.min(1, settings?.TerminalOpacity ?? 0))
  const colorVariant = resolveVariant(getColorScheme(settings?.ColorScheme), themeMode)
  const railBg = surfaceBackground(railOpacity, colorVariant.surfaceBase)
  // The rail keeps the scheme's own surface; only the terminal card follows
  // Grok, and only while Grok's full-screen TUI is the visible tab.
  const terminalSurfaceBase = surfaceBaseFor(activeTabIsGrokTinted, settings?.ColorScheme, themeMode)
  const terminalBg = surfaceBackground(terminalOpacity, terminalSurfaceBase)
  const showWindowControls = windowState.platform === 'linux' || windowState.fullScreen
  const configuredShellId = settings?.DefaultShellId
  const defaultShellLabel =
    shellProfiles.find((profile) => profile.id === configuredShellId)?.label ??
    shellProfiles[0]?.label ??
    t('ShellDetecting')
  const railWidth = clampRailWidth(railWidthLive ?? settings?.RailWidth ?? RAIL_WIDTH_DEFAULT)
  const menuTab = tabContextMenu?.kind === 'tab' ? tabs.find((tab) => tab.id === tabContextMenu.id) : undefined
  const menuGroup = tabContextMenu?.kind === 'group' ? groups.find((group) => group.id === tabContextMenu.id) : undefined

  function endRailResize(pointerId: number, finalWidth: number): void {
    const session = railResizeRef.current
    if (!session || session.pointerId !== pointerId) return
    railResizeRef.current = null
    const width = clampRailWidth(finalWidth)
    setRailWidthLive(null)
    updateImmediate({ RailWidth: width })
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  function onRailResizePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    event.preventDefault()
    const startWidth = clampRailWidth(settings?.RailWidth ?? RAIL_WIDTH_DEFAULT)
    railResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth
    }
    setRailWidthLive(startWidth)
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function onRailResizePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const session = railResizeRef.current
    if (!session || session.pointerId !== event.pointerId) return
    const next = clampRailWidth(session.startWidth + (event.clientX - session.startX))
    setRailWidthLive(next)
  }

  function onRailResizePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const session = railResizeRef.current
    if (!session || session.pointerId !== event.pointerId) return
    const next = clampRailWidth(session.startWidth + (event.clientX - session.startX))
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    endRailResize(event.pointerId, next)
  }

  function onRailResizePointerCancel(event: ReactPointerEvent<HTMLDivElement>): void {
    if (railResizeRef.current?.pointerId !== event.pointerId) return
    railResizeRef.current = null
    setRailWidthLive(null)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  return (
    <>
    {/* Outer background is the rail's own — it's the base layer the whole
        window sits on (M9): the terminal card floats on top of it as a
        rounded rect, so wherever the card's rounded corners cut away (its two
        left corners, which aren't at the window's true edge), this shows
        through instead of empty window backdrop. */}
    <div
      className="flex h-screen w-screen text-fg-secondary"
      style={{
        background: railBg,
        boxSizing: 'border-box'
      }}
    >
      {/* Left tab rail — drag-resizable width (default 260px), square corners,
          spans the FULL window height (header + body). This is the base layer
          the terminal card sits on top of (M9). Win11 NavigationView-style
          rows: 40px height, 4px corners, 3px selection pill in a 10px gutter,
          then a 20px slot (tab activity / settings category icon). */}
      <div
        className="relative flex shrink-0 flex-col"
        style={{ width: railWidth }}
        data-testid="tab-rail"
      >
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
            {/* Tabby-style rail: tabs size to content; compact + / shell icons
                sit directly under the last tab; empty space below; settings
                pinned at the rail foot. */}
            <div className="flex min-h-0 flex-1 flex-col">
              <TabRail
                tabs={tabs}
                groups={groups}
                activeId={activeId}
                renamingId={renamingTabId}
                renamingGroupId={renamingGroupId}
                {...railHandlers}
              />

              {/* Compact icon strip under the last tab (Tabby-style), not a full-width shell label row. */}
              <div
                ref={shellMenuRef}
                className="relative mx-3 mt-0.5 flex shrink-0 items-center gap-0.5 px-0.5"
                data-testid="rail-new-tab-row"
              >
                <button
                  type="button"
                  aria-label={t('NewTab')}
                  data-testid="new-tab"
                  className="icon-font flex h-7 w-7 shrink-0 items-center justify-center rounded text-[12px] text-fg-secondary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
                  data-testid="choose-shell"
                  title={defaultShellLabel}
                  className={`icon-font flex h-7 w-7 shrink-0 items-center justify-center rounded text-[12px] text-fg-secondary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
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
                  {SegoeIcon.Terminal}
                </button>
                {shellMenuOpen && (
                  <div
                    role="menu"
                    aria-label={t('ChooseShell')}
                    className="absolute left-0 top-full z-30 mt-1 min-w-44 origin-top-left overflow-hidden rounded-lg border border-popup-border bg-popup-bg py-1 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.35),0_0_0_1px_rgba(0,0,0,0.04)] animate-[dropdown-in_120ms_cubic-bezier(0.16,1,0.3,1)]"
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
              </div>

              <div className="min-h-2 min-w-0 flex-1" aria-hidden />

              <div className="mx-3 mb-2 flex shrink-0 items-center gap-0.5 px-0.5">
                <button
                  type="button"
                  aria-label={t('SettingsTooltip')}
                  data-testid="open-settings"
                  className="icon-font flex h-7 w-7 items-center justify-center rounded text-[12px] text-fg-secondary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  onClick={() => setView('settings')}
                >
                  {SegoeIcon.Settings}
                </button>
                {showBadge ? (
                  <button
                    type="button"
                    data-testid="update-badge"
                    aria-label={
                      updateState?.availableVersion
                        ? `${t('UpdateBadgeLabel')} ${updateState.availableVersion}`
                        : t('UpdateBadgeLabel')
                    }
                    title={
                      updateState?.availableVersion
                        ? `${t('UpdateBadgeLabel')} ${updateState.availableVersion}`
                        : t('UpdateBadgeLabel')
                    }
                    className="icon-font relative flex h-7 w-7 items-center justify-center rounded text-[12px] text-accent hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    onClick={openDialog}
                  >
                    {SegoeIcon.Update}
                    <span
                      className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent"
                      aria-hidden
                    />
                  </button>
                ) : null}
              </div>
            </div>
          </>
        )}

        {/* Vertical splitter — sits on the rail/terminal seam so the cursor
            over the middle edge can drag the rail width freely. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('ResizeTabRail')}
          aria-valuemin={RAIL_WIDTH_MIN}
          aria-valuemax={RAIL_WIDTH_MAX}
          aria-valuenow={railWidth}
          data-testid="rail-resize-handle"
          className="absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize touch-none [-webkit-app-region:no-drag]"
          onPointerDown={onRailResizePointerDown}
          onPointerMove={onRailResizePointerMove}
          onPointerUp={onRailResizePointerUp}
          onPointerCancel={onRailResizePointerCancel}
          onDoubleClick={() => {
            setRailWidthLive(null)
            updateImmediate({ RailWidth: RAIL_WIDTH_DEFAULT })
          }}
        />
      </div>

      {tabContextMenu && (
        <div
          ref={tabContextMenuRef}
          role="menu"
          className="fixed z-50 max-h-[calc(100vh-16px)] min-w-44 max-w-64 overflow-y-auto rounded border border-popup-border bg-popup-bg py-1 text-[13px] text-fg-primary shadow-lg"
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
          {tabContextMenu.kind === 'tab' ? (
            <>
              <MenuItem
                onClick={() => {
                  // No focus return to the tab row here: it would land one frame
                  // AFTER the rename input autofocuses, blurring (and thus
                  // committing/unmounting) it immediately.
                  closeTabContextMenu(false)
                  renameTab(tabContextMenu.id)
                }}
              >
                {t('RenameTab')}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  closeTabContextMenu(true)
                  duplicateTab(tabContextMenu.id)
                }}
              >
                {t('DuplicateTab')}
              </MenuItem>
              <div role="separator" className="my-1 h-px bg-popup-border" />
              <MenuItem
                onClick={() => {
                  // The new header's name field takes focus, so no focus return either.
                  closeTabContextMenu(false)
                  newGroupWithTab(tabContextMenu.id)
                }}
              >
                {t('NewGroupWithTab')}
              </MenuItem>
              {menuTab?.groupId && (
                <MenuItem
                  onClick={() => {
                    closeTabContextMenu(true)
                    removeFromGroup(tabContextMenu.id)
                  }}
                >
                  {t('RemoveFromGroup')}
                </MenuItem>
              )}
              {groups.some((group) => group.id !== menuTab?.groupId) && (
                <>
                  <div role="separator" className="my-1 h-px bg-popup-border" />
                  <div role="presentation" className="px-3 pb-0.5 pt-1 text-[11px] text-fg-tertiary">
                    {t('AddToGroup')}
                  </div>
                  {groups
                    .filter((group) => group.id !== menuTab?.groupId)
                    .map((group) => (
                      <MenuItem
                        key={group.id}
                        indent
                        onClick={() => {
                          closeTabContextMenu(true)
                          addToGroup(tabContextMenu.id, group.id)
                        }}
                      >
                        {group.name || (group.key ? cwdBasename(group.key) : t('NewGroup'))}
                      </MenuItem>
                    ))}
                </>
              )}
            </>
          ) : (
            <>
              <MenuItem
                onClick={() => {
                  closeTabContextMenu(false)
                  startGroupRename(tabContextMenu.id)
                }}
              >
                {t('RenameGroup')}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  closeTabContextMenu(true)
                  toggleGroup(tabContextMenu.id)
                }}
              >
                {menuGroup?.collapsed ? t('ExpandGroup') : t('CollapseGroup')}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  closeTabContextMenu(true)
                  ungroup(tabContextMenu.id)
                }}
              >
                {t('UngroupGroup')}
              </MenuItem>
            </>
          )}
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
        data-zinc-surface-fade={surfaceFading ? '1' : undefined}
        style={{
          background: terminalBg,
          // Colour for inverse (SGR 7) terminal text that kept the default
          // background — see index.css. xterm derives that colour from
          // theme.background, which must stay fully transparent while the card
          // is see-through, and its opaque() collapses transparency to black:
          // unreadable dark-on-dark. This variable gives the stylesheet the
          // scheme's real surface colour to use instead.
          ['--zinc-terminal-inverse-fg' as string]: surfaceBackground(1, terminalSurfaceBase),
          // Grok's tint fades in/out instead of snapping. index.css carries the
          // matching transition for xterm's own background, which is painted by
          // xterm's stylesheet rather than this style object, and keys off the
          // same data attribute.
          transition: surfaceFading ? `background-color ${SURFACE_FADE_MS}ms ease` : undefined,
          borderRadius: WINDOW_CORNER_RADIUS,
          boxShadow: 'inset 1px 0 0 rgba(255, 255, 255, 0.06), -12px 0 28px -6px rgba(0, 0, 0, 0.55)'
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
                className="flex h-8 w-8 items-center justify-center rounded text-fg-tertiary transition-colors hover:bg-icon-hover-bg hover:text-icon-hover-fg"
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
                className="icon-font flex h-8 w-8 items-center justify-center rounded text-[11px] text-fg-tertiary transition-colors hover:bg-icon-hover-bg hover:text-icon-hover-fg"
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
          <div className="absolute inset-x-0 top-0 bottom-0">
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
                  className={`absolute inset-0 p-3.5 ${isActive ? 'zinc-tab-enter' : ''}`}
                  style={
                    isActive
                      ? { zIndex: 1 }
                      : {
                          // Parked outside the viewport at full size (never
                          // 0x0, see above). Opacity alone kept every hidden
                          // tab intersecting the viewport, so xterm's
                          // IntersectionObserver never paused it and all of
                          // them kept rebuilding their rows on the one shared
                          // renderer thread. Off-screen, xterm stops painting
                          // but keeps parsing, and repaints in full on return.
                          transform: 'translateX(-200vw)',
                          visibility: 'hidden',
                          pointerEvents: 'none',
                          zIndex: 0
                        }
                  }
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
          : terminalNotice === 'openExternalFailed'
            ? language === 'zh' ? '无法打开链接' : 'Could not open link'
            : t(
                terminalNotice === 'copyFailed'
                  ? 'ClipboardCopyFailed'
                  : terminalNotice === 'pasteFailed'
                    ? 'ClipboardPasteFailed'
                    : 'TerminalStartFailed'
              )}
      </div>
    )}
    <UpdateDialog />
    </>
  )
}
