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

function hooks(seedTabs) {
  const slots = []
  const pending = []
  let index = 0
  let dirty = false
  let tabWrites = 0
  let tree
  return {
    state(initial) {
      const slot = index++
      if (!(slot in slots)) slots[slot] = slot === 0 && seedTabs ? seedTabs : typeof initial === 'function' ? initial() : initial
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
    get tabs() { return slots[0] }
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

async function setupApp(tabs = [{ id: 'tab-1', title: 'First' }, { id: 'tab-2', title: 'Second' }]) {
  const h = hooks(tabs)
  const events = new Map()
  const accentRequests = []
  const accentWrites = []
  const cwdRequests = []
  const ghosts = []
  const settings = {
    ColorScheme: 'old', AccentSource: 'system', ThemePreference: 'dark',
    RailWidth: 260, RailOpacity: 0, TerminalOpacity: 0,
    Keybindings: [], DefaultShellId: 'pwsh'
  }
  const updates = { immediate: [], debounced: [] }
  Object.assign(h, {
    mode: 'dark',
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
    setTimeout: () => 1,
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
    body: { style: {}, appendChild(ghost) { ghosts.push(ghost) } }
  }
  const { default: App } = await loadComponent('src/renderer/src/App.tsx')
  let tree = h.render(App)
  return {
    h, App, settings, updates, accentRequests, accentWrites, cwdRequests, ghosts, events,
    get tree() { return tree },
    render() { tree = h.render(App); return tree },
    flush() { tree = h.flush(App); return tree }
  }
}

function row(id, top) {
  return {
    dataset: {}, style: {},
    classList: {
      names: new Set(),
      add(name) { this.names.add(name) },
      remove(name) { this.names.delete(name) },
      contains(name) { return this.names.has(name) }
    },
    getBoundingClientRect: () => ({ left: 10, top, width: 230, height: 40 }),
    setPointerCapture() {},
    releasePointerCapture() {},
    cloneNode() {
      return {
        dataset: {}, style: {}, removeAttribute() {}, setAttribute() {},
        querySelectorAll: () => [], remove() { this.removed = true }
      }
    }
  }
}

function beginDrag(app) {
  const first = row('tab-1', 80)
  const second = row('tab-2', 122)
  const list = walk(app.tree, (node) => node.props?.role === 'tablist')
  list.props.ref.current = {
    scrollTop: 0,
    querySelectorAll: () => [first, second],
    querySelector: () => first,
    getBoundingClientRect: () => ({ top: 50, bottom: 300 })
  }
  const props = walk(app.tree, (node) => node.props?.['data-tabid'] === 'tab-1').props
  const event = (clientX, clientY) => ({
    pointerId: 3, button: 0, clientX, clientY, currentTarget: first,
    target: { closest: () => null }, preventDefault() {}
  })
  props.onPointerDown(event(20, 100))
  props.onPointerMove(event(40, 150))
  assert.equal(app.ghosts.length > 0, true)
  return { first, props, event }
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

test('repeated terminal title skips setTabs, while a new title still updates', async () => {
  const app = await setupApp()
  const before = app.h.tabWrites
  app.h.titleChange('tab-1', ' First ')
  assert.equal(app.h.tabWrites, before)
  app.h.titleChange('tab-1', 'Renamed')
  assert.equal(app.h.tabWrites, before + 1)
  app.flush()
  app.h.titleChange('tab-1', 'Renamed')
  assert.equal(app.h.tabWrites, before + 1)
  assert.equal(walk(app.tree, (node) => node.props?.['data-tabid'] === 'tab-1').props.children[2].props.title, 'Renamed')
})

test('blur and lost pointer capture cancel an active drag without reordering or leaving a ghost', async () => {
  const app = await setupApp()
  for (const interruption of ['blur', 'lostpointercapture']) {
    const { first, props, event } = beginDrag(app)
    assert.equal(first.style.opacity, '0')
    if (interruption === 'blur') app.events.get('blur')()
    else props.onLostPointerCapture(event(40, 150))
    assert.equal(app.ghosts.at(-1).removed, true)
    assert.equal(first.style.opacity, '')
    assert.equal(first.style.pointerEvents, '')
    assert.equal(document.body.style.cursor, '')
    assert.equal(document.body.style.userSelect, '')
    app.flush()
    assert.equal(walk(app.tree, (node) => node.props?.['data-tabid'] === 'tab-1').props['data-dragging'], undefined)
    assert.equal(walk(app.tree, (node) => node.props?.['data-tabid'] === 'tab-1').props.children[1].props.children, 1)
  }
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
  const source = walk(app.tree, (node) => node.props?.['data-tabid'] === 'source-1')
  source.props.onDoubleClick()
  source.props.onDoubleClick()
  assert.deepEqual(app.cwdRequests.map((request) => request.id), ['source-1'])
  app.cwdRequests[0].resolve('C:\\work')
  await Promise.resolve()
  app.flush()
  assert.equal(app.h.tabs.length, 3)
  assert.equal(app.h.tabs[2].spawnCwd, 'C:\\work')
  assert.equal(app.h.tabs[2].shellId, 'pwsh')
  assert.equal(app.h.tabs[2].startupCommand, undefined)
})

test('clone ignores a late cwd reply after source close, even before React renders the close', async () => {
  const app = await setupApp()
  const source = walk(app.tree, (node) => node.props?.['data-tabid'] === 'tab-1')
  source.props.onDoubleClick()
  const close = walk(source, (node) => node.props?.['aria-label'] === 'CloseTab')
  close.props.onClick({ stopPropagation() {} })
  app.cwdRequests[0].resolve('C:\\work')
  await Promise.resolve()
  app.flush()
  assert.deepEqual(app.h.tabs.map((tab) => tab.id), ['tab-2'])
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
