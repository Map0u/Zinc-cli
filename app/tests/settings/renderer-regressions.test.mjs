import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

// Execute the shipped components with small hook/IPC stubs. The unit runner
// has no DOM, so these tests drive their real effects and JSX event handlers.
async function loadComponent(path, mocks = {}) {
  const modules = {
    react: `
      export const useState = (initial) => globalThis.__zincTest.state(initial)
      export const useRef = (initial) => globalThis.__zincTest.ref(initial)
      export const useEffect = (effect, deps) => globalThis.__zincTest.effect(effect, deps)
      export const useLayoutEffect = useEffect
      export const useMemo = (factory) => globalThis.__zincTest.memo(factory)
      export const useCallback = (fn) => fn
      export const useSyncExternalStore = (subscribe, getSnapshot) => getSnapshot()
      export const memo = (component) => component
      export const createContext = () => ({ Provider: 'provider' })
      export const useContext = () => null
    `,
    'react/jsx-runtime': `
      export const Fragment = 'fragment'
      export const jsx = (type, props) => ({ type, props: props ?? {} })
      export const jsxs = jsx
    `,
    './terminal/TerminalHostRegistry': `export const terminalHostRegistry = globalThis.__zincTest.registry`,
    './settings/SettingsContext': `export const useSettings = () => globalThis.__zincTest.settings`,
    './i18n/I18nContext': `export const useI18n = () => ({ t: (key) => key, language: globalThis.__zincTest.language })`,
    './settings/SettingsPage': `export const SettingsRailBody = () => null; export const SettingsContentBody = () => null`,
    './shortcuts/ShortcutManager': `export const shortcutManager = { on() {}, setBindings() {} }`,
    './segoeFluentIcons': `export const SegoeIcon = {}`,
    './chromeBackground': `export const surfaceBackground = () => '#000000'`,
    './terminal/grokFullscreenSurface': `export const surfaceBaseFor = () => '#000000'`,
    './colorSchemes': `
      export const getColorScheme = (id) => ({ id })
      export const resolveVariant = (scheme, mode) => ({ accent: scheme.id + '-' + mode, surfaceBase: '#000000' })
      export const harmonizeAccent = (hex, mode) => hex + '-' + mode
    `,
    './themeMode': `export const useResolvedThemeMode = () => globalThis.__zincTest.mode`,
    './assets/zinc-icon.png': `export default 'zinc.png'`,
    './shells/shellProfiles': `
      export const loadShellProfiles = () => new Promise(() => {})
      export const consumeShellFallbackNotice = () => false
    `,
    // The rail lives in its own module; App tests only look at the props it is handed.
    './tabs/TabRail': `export const TabRail = 'TabRail'`,
    './tabs/tabNav': { file: join(root, 'src/renderer/src/tabs/tabNav.ts') },
    './tabs/tabGroups': { file: join(root, 'src/renderer/src/tabs/tabGroups.ts') },
    './tabs/tabLabel': { file: join(root, 'src/renderer/src/tabs/tabLabel.ts') },
    './tabs/tabStores': `
      const titles = globalThis.__zincTest.titles
      export const tabTitleStore = { get: (id) => titles.get(id), set: (id, title) => { titles.set(id, title) } }
      export const tabActivityStore = { set() {} }
      export const tabContextStore = { set() {} }
      export const attachTabStores = () => () => {}
      export const forgetTabValues = (id) => { titles.delete(id) }
    `,
    '../../shared/sessionState': `export const MAX_TAB_TITLE_LENGTH = 256, MAX_GROUP_KEY_LENGTH = 1024`,
    './tabs/tabDragOrder': `
      export const TAB_DRAG_THRESHOLD_PX = 5, TAB_ROW_STRIDE_PX = 42
      export const ghostProbeY = (y) => y
      export const liveSlotCenters = (centers) => centers
      export const moveItem = (items, from, to) => {
        const result = [...items]; result.splice(to, 0, result.splice(from, 1)[0]); return result
      }
      export const resolveDropIndex = () => globalThis.__zincTest.dropIndex
      export const tabDragDistance = Math.hypot
      export const tabDragShiftY = () => 0
      export const tabDropLineTop = () => null
    `,
    './update/UpdateContext': `export const useUpdate = () => ({ showBadge: false, openDialog() {}, state: null })`,
    './update/UpdateDialog': `export const UpdateDialog = () => null`,
    ...mocks
  }
  const { outputFiles } = await build({
    entryPoints: [join(root, path)],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    define: { 'import.meta.env.DEV': 'false' },
    plugins: [{
      name: 'renderer-stubs',
      setup(build) {
        build.onResolve({ filter: /^(react(?:\/jsx-runtime)?|\.)/ }, ({ path }) => {
          if (!(path in modules)) throw new Error(`Missing test mock: ${path}`)
          if (typeof modules[path] === 'object') return { path: modules[path].file }
          return { path, namespace: 'renderer-stubs' }
        })
        build.onLoad({ filter: /.*/, namespace: 'renderer-stubs' }, ({ path }) => ({
          contents: modules[path], loader: 'js'
        }))
      }
    }]
  })
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', outputFiles[0].text)(module, module.exports)
  return module.exports
}

function hooks(seedTabs, seedGroups = []) {
  const slots = []
  const pending = []
  let index = 0
  let dirty = false
  let tabWrites = 0
  let tree
  return {
    state(initial) {
      const slot = index++
      // Slot 0 is App's rail state: the tabs plus their groups.
      if (!(slot in slots)) slots[slot] = slot === 0 && seedTabs ? { tabs: seedTabs, groups: seedGroups } : typeof initial === 'function' ? initial() : initial
      return [slots[slot], (value) => {
        if (slot === 0) tabWrites++
        const next = typeof value === 'function' ? value(slots[slot]) : value
        if (!Object.is(next, slots[slot])) { slots[slot] = next; dirty = true }
      }]
    },
    ref(initial) {
      const slot = index++
      if (!(slot in slots)) slots[slot] = { current: initial }
      return slots[slot]
    },
    // Only used with empty deps (computed once), which is all the rail callbacks need.
    memo(factory) {
      const slot = index++
      if (!(slot in slots)) slots[slot] = { value: factory() }
      return slots[slot].value
    },
    effect(effect, deps) {
      const slot = index++
      const prev = slots[slot]
      if (prev && deps && prev.deps && deps.length === prev.deps.length && deps.every((d, i) => Object.is(d, prev.deps[i]))) return
      pending.push(() => {
        prev?.cleanup?.()
        slots[slot] = { deps, cleanup: effect() }
      })
    },
    render(Component, props = {}) {
      index = 0
      dirty = false
      tree = Component(props)
      for (const run of pending.splice(0)) run()
      return tree
    },
    flush(Component, props = {}) {
      if (dirty) this.render(Component, props)
      return tree
    },
    get tabWrites() { return tabWrites },
    get tabs() { return slots[0].tabs },
    get groups() { return slots[0].groups }
  }
}

function walk(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null
  if (Array.isArray(tree)) return tree.map((item) => walk(item, predicate)).find(Boolean) ?? null
  if (predicate(tree)) return tree
  return walk(tree.props?.children, predicate)
}

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function setupApp(tabs = [{ id: 'tab-1' }, { id: 'tab-2' }], groups = []) {
  const h = hooks(tabs, groups)
  const events = new Map()
  const accentRequests = []
  const accentWrites = []
  const cwdRequests = []
  const settings = {
    ColorScheme: 'old', AccentSource: 'system', ThemePreference: 'dark',
    RailWidth: 260, RailOpacity: 0, TerminalOpacity: 0,
    Keybindings: [], DefaultShellId: 'pwsh'
  }
  const updates = { immediate: [], debounced: [] }
  Object.assign(h, {
    timers: [],
    mode: 'dark',
    titles: new Map(),
    language: 'en',
    dropIndex: 1,
    settings: {
      settings,
      updateImmediate(patch) { updates.immediate.push(patch); Object.assign(settings, patch) },
      updateDebounced(patch) { updates.debounced.push(patch) }
    },
    registry: {
      onTitleChange(callback) { h.titleChange = callback; return () => {} },
      onSurfaceTintChange() { return () => {} },
      onNotice(callback) { h.notice = callback; return () => {} },
      fitOnShow() {},
      setActiveHost() {},
      destroyHost() {}
    }
  })
  globalThis.__zincTest = h
  globalThis.window = {
    zinc: {
      window: {
        getStateSync: () => ({ platform: 'win32', fullScreen: false }),
        onStateChange: () => () => {},
        getAccentColor: () => { const request = deferred(); accentRequests.push(request); return request.promise }
      },
      session: { getRestorePayload: () => new Promise(() => {}), pushSnapshot() {} },
      pty: { getCwd(id) { const request = deferred(); cwdRequests.push({ id, ...request }); return request.promise } },
      app: { requestQuit() {} }
    },
    matchMedia: () => ({ matches: true }),
    addEventListener(name, callback) { events.set(name, callback) },
    removeEventListener(name) { events.delete(name) },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout: (fn, ms) => { h.timers.push({ fn, ms }); return h.timers.length },
    clearTimeout() {},
    innerWidth: 900, innerHeight: 700
  }
  globalThis.requestAnimationFrame = window.requestAnimationFrame
  globalThis.getComputedStyle = () => ({ backgroundColor: '#111' })
  globalThis.CSS = { escape: (id) => id }
  globalThis.document = {
    documentElement: {
      dataset: {},
      style: { setProperty(name, value) { accentWrites.push([name, value]) } }
    },
    body: { style: {} }
  }
  const { default: App } = await loadComponent('src/renderer/src/App.tsx')
  let tree = h.render(App)
  return {
    h, App, settings, updates, accentRequests, accentWrites, cwdRequests, events,
    get tree() { return tree },
    render() { tree = h.render(App); return tree },
    flush() { tree = h.flush(App); return tree }
  }
}

test('old system accent reply cannot overwrite the newer selected scheme', async () => {
  const app = await setupApp()
  assert.equal(app.accentRequests.length, 1)
  app.settings.AccentSource = 'scheme'
  app.settings.ColorScheme = 'new'
  app.render()
  assert.deepEqual(app.accentWrites.at(-1), ['--color-accent', 'new-dark'])
  app.accentRequests[0].resolve('#ff0000')
  await Promise.resolve()
  assert.deepEqual(app.accentWrites.at(-1), ['--color-accent', 'new-dark'])
})

test('terminal titles are batched into the per-tab store and never touch App state', async () => {
  const app = await setupApp()
  // Title updates are batched on a 250ms timer; run just those timers.
  const flushTitles = () => {
    const due = app.h.timers.filter((t) => t.ms === 250)
    app.h.timers = app.h.timers.filter((t) => t.ms !== 250)
    for (const t of due) t.fn()
  }
  const titles = app.h.titles
  const before = app.h.tabWrites
  app.h.titleChange('tab-1', ' First ')
  assert.equal(titles.get('tab-1'), undefined)
  flushTitles()
  assert.equal(titles.get('tab-1'), 'First')
  app.h.titleChange('tab-1', 'Spinner 1')
  app.h.titleChange('tab-1', 'Renamed')
  assert.equal(titles.get('tab-1'), 'First')
  flushTitles()
  assert.equal(titles.get('tab-1'), 'Renamed')
  // A repeat of the stored title arms no timer at all.
  app.h.titleChange('tab-1', 'Renamed')
  assert.equal(app.h.timers.filter((t) => t.ms === 250).length, 0)
  // A newer title queued behind an older pending one wins.
  app.h.titleChange('tab-1', 'Working')
  app.h.titleChange('tab-1', 'Renamed')
  flushTitles()
  assert.equal(titles.get('tab-1'), 'Renamed')
  assert.equal(app.h.tabWrites, before)
})

test('rail width updates locally during moves and persists only on pointerup', async () => {
  const app = await setupApp()
  const handle = walk(app.tree, (node) => node.props?.['data-testid'] === 'rail-resize-handle').props
  const event = (clientX) => ({ pointerId: 7, button: 0, clientX,
    preventDefault() {}, currentTarget: { setPointerCapture() {}, releasePointerCapture() {} } })
  handle.onPointerDown(event(100))
  for (let x = 110; x <= 160; x += 10) handle.onPointerMove(event(x))
  app.flush()
  assert.equal(walk(app.tree, (node) => node.props?.['data-testid'] === 'tab-rail').props.style.width, 320)
  assert.deepEqual(app.updates.debounced, [])
  assert.deepEqual(app.updates.immediate, [])
  handle.onPointerUp(event(160))
  assert.deepEqual(app.updates.immediate, [{ RailWidth: 320 }])
  handle.onPointerDown(event(100))
  handle.onPointerMove(event(140))
  handle.onPointerCancel(event(140))
  assert.deepEqual(app.updates.immediate, [{ RailWidth: 320 }])
})

test('clone deduplicates while cwd is pending and keeps the source shell without its startup command', async () => {
  const app = await setupApp([
    { id: 'source-1', title: 'First', shellId: 'pwsh', startupCommand: 'claude --continue' },
    { id: 'source-2', title: 'Second' }
  ])
  const rail = walk(app.tree, (node) => node.type === 'TabRail').props
  rail.onClone('source-1')
  rail.onClone('source-1')
  assert.deepEqual(app.cwdRequests.map((request) => request.id), ['source-1'])
  app.cwdRequests[0].resolve('C:\\work')
  await Promise.resolve()
  app.flush()
  assert.equal(app.h.tabs.length, 3)
  // A duplicate lands right after its source.
  assert.equal(app.h.tabs[2].id, 'source-2')
  assert.equal(app.h.tabs[1].spawnCwd, 'C:\\work')
  assert.equal(app.h.tabs[1].shellId, 'pwsh')
  assert.equal(app.h.tabs[1].startupCommand, undefined)
})

test('clone ignores a late cwd reply after source close, even before React renders the close', async () => {
  const app = await setupApp()
  const rail = walk(app.tree, (node) => node.type === 'TabRail').props
  rail.onClone('tab-1')
  rail.onClose('tab-1')
  app.cwdRequests[0].resolve('C:\\work')
  await Promise.resolve()
  app.flush()
  assert.deepEqual(app.h.tabs.map((tab) => tab.id), ['tab-2'])
})

test('closing the active tab activates its neighbour, not the last tab', async () => {
  const app = await setupApp([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
  const rail = () => walk(app.tree, (node) => node.type === 'TabRail').props
  rail().onSwitch('b')
  app.flush()
  assert.equal(rail().activeId, 'b')
  rail().onClose('b')
  app.flush()
  assert.equal(rail().activeId, 'c')
  rail().onSwitch('d')
  app.flush()
  rail().onClose('d')
  app.flush()
  assert.equal(rail().activeId, 'c')
  // A background tab closing leaves the active one alone.
  rail().onClose('a')
  app.flush()
  assert.equal(rail().activeId, 'c')
  assert.deepEqual(app.h.tabs.map((tab) => tab.id), ['c'])
})

const group = (id, extra = {}) => ({ id, collapsed: false, auto: false, ...extra })

test('a duplicate of a grouped tab lands right after it, in the same group', async () => {
  const app = await setupApp(
    [{ id: 'x' }, { id: 'a', groupId: 'g1' }, { id: 'b', groupId: 'g1' }, { id: 'y' }],
    [group('g1')]
  )
  const rail = walk(app.tree, (node) => node.type === 'TabRail').props
  rail.onClone('a')
  app.cwdRequests[0].resolve('C:\work')
  await Promise.resolve()
  app.flush()
  assert.deepEqual(app.h.tabs.map((tab) => tab.groupId), [undefined, 'g1', 'g1', 'g1', undefined])
  assert.equal(app.h.tabs[1].id, 'a')
  assert.equal(app.h.tabs[3].id, 'b')
  assert.equal(app.h.tabs[2].manual, undefined)
})

test('closing members dissolves an untouched auto group at one tab and drops an emptied group', async () => {
  const app = await setupApp(
    [{ id: 'a', groupId: 'auto' }, { id: 'b', groupId: 'auto' }, { id: 'c', groupId: 'mine' }, { id: 'd' }],
    [group('auto', { auto: true }), group('mine')]
  )
  const rail = () => walk(app.tree, (node) => node.type === 'TabRail').props
  rail().onClose('a')
  app.flush()
  assert.deepEqual(app.h.groups.map((g) => g.id), ['mine'])
  assert.equal(app.h.tabs.find((tab) => tab.id === 'b').groupId, undefined)
  rail().onClose('c')
  app.flush()
  assert.deepEqual(app.h.groups, [])
  assert.deepEqual(app.h.tabs.map((tab) => tab.id), ['b', 'd'])
})

test('switching to a tab inside a collapsed group expands it; collapsing it by hand does not fight back', async () => {
  const app = await setupApp(
    [{ id: 'x' }, { id: 'a', groupId: 'g1' }, { id: 'b', groupId: 'g1' }],
    [group('g1', { collapsed: true })]
  )
  const rail = () => walk(app.tree, (node) => node.type === 'TabRail').props
  rail().onSwitch('b')
  app.flush()
  app.flush()
  assert.equal(app.h.groups[0].collapsed, false)
  // The user collapses the group around the active tab: it stays collapsed.
  rail().onToggleGroup('g1')
  app.flush()
  assert.equal(app.h.groups[0].collapsed, true)
  assert.equal(rail().activeId, 'b')
  rail().onSwitch('x')
  app.flush()
  assert.equal(app.h.groups[0].collapsed, true)
})

test('closing the active tab picks a visible neighbour, never a member hidden in a collapsed group', async () => {
  const app = await setupApp(
    [{ id: 'x' }, { id: 'a', groupId: 'g1' }, { id: 'b', groupId: 'g1' }, { id: 'y' }],
    [group('g1', { collapsed: true })]
  )
  const rail = () => walk(app.tree, (node) => node.type === 'TabRail').props
  rail().onSwitch('x')
  app.flush()
  rail().onClose('x')
  app.flush()
  // x was active; the visible neighbour is y, not the hidden a.
  assert.equal(rail().activeId, 'y')
})

test('rail moves go through one stable callback and reorder tabs', async () => {
  const app = await setupApp([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  const rail = walk(app.tree, (node) => node.type === 'TabRail').props
  rail.onMoveTab('a', { after: 'c' })
  app.flush()
  assert.deepEqual(app.h.tabs.map((tab) => tab.id), ['b', 'c', 'a'])
  const again = walk(app.tree, (node) => node.type === 'TabRail').props
  assert.equal(again.onSwitch === rail.onSwitch, true)
  assert.equal(again.onMoveTab === rail.onMoveTab, true)
  assert.equal(again.onToggleGroup === rail.onToggleGroup, true)
})

test('failed external link uses the existing notice toast in both UI languages', async () => {
  const app = await setupApp()
  app.h.notice('openExternalFailed')
  app.flush()
  assert.equal(walk(app.tree, (node) => node.props?.role === 'status').props.children, 'Could not open link')
  app.h.language = 'zh'
  app.render()
  assert.equal(walk(app.tree, (node) => node.props?.role === 'status').props.children, '无法打开链接')
})

test('two failed settings loads replace the splash with a retryable error screen', async () => {
  const h = hooks()
  globalThis.__zincTest = h
  const requests = []
  globalThis.window = {
    zinc: { settings: {
      get() { const request = deferred(); requests.push(request); return request.promise },
      onChange() { return () => {} }
    } }
  }
  const { SettingsProvider } = await loadComponent('src/renderer/src/settings/SettingsContext.tsx')
  const props = { children: 'app-content' }
  let tree = h.render(SettingsProvider, props)
  assert.equal(requests.length, 1)
  const previousError = console.error
  console.error = () => {}
  try {
    requests[0].reject(new Error('IPC failed'))
    await new Promise(setImmediate)
    assert.equal(requests.length, 2)
    requests[1].reject(new Error('IPC failed again'))
    await new Promise(setImmediate)
    tree = h.flush(SettingsProvider, props)
    assert.equal(tree.props.children.props.role, 'alert')
    let retry = walk(tree, (node) => node.type === 'button')
    assert.equal(retry.props.children, 'Retry')
    retry.props.onClick()
    tree = h.flush(SettingsProvider, props)
    retry = walk(tree, (node) => node.type === 'button')
    assert.equal(retry.props.disabled, true)
    requests[2].reject(new Error('still failing'))
    await new Promise(setImmediate)
    tree = h.flush(SettingsProvider, props)
    retry = walk(tree, (node) => node.type === 'button')
    assert.equal(retry.props.disabled, false)
    retry.props.onClick()
    requests[3].resolve({ ColorScheme: 'new' })
    await new Promise(setImmediate)
    tree = h.flush(SettingsProvider, props)
    assert.equal(tree.type, 'provider')
    assert.equal(tree.props.children, 'app-content')
    assert.equal(tree.props.value.settings.ColorScheme, 'new')
  } finally {
    console.error = previousError
  }
})
