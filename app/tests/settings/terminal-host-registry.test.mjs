import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

async function loadRegistry() {
  const modules = {
    '@xterm/xterm': 'export class Terminal { constructor(options) { return new globalThis.__registryTest.Terminal(options) } }',
    '@xterm/addon-fit': 'export class FitAddon {}',
    '@xterm/addon-unicode11': 'export class Unicode11Addon {}',
    '@xterm/addon-web-links': 'export class WebLinksAddon { constructor(handler) { this.handler = handler } }',
    '@xterm/addon-webgl': 'export class WebglAddon { onContextLoss() {} dispose() {} }',
    '@xterm/xterm/css/xterm.css': '',
    '../../../shared/ptyProtocol': `export const PTY_PORT_MESSAGE_TYPE = 'zinc:pty-port'`,
    '../colorSchemes': `
      export const DEFAULT_COLOR_SCHEME_ID = 'default'
      export const getColorScheme = (id) => ({ id })
      export const resolveVariant = () => ({ ansi: {} })
    `,
    '../themeMode': `
      export const getSystemThemeMode = () => 'dark'
      export const onSystemThemeModeChange = () => () => {}
    `,
    './transparentTerminalBackground': `
      export const formatSgrParams = () => ''
      export const rewriteSgrParamsForTransparentBg = () => null
      export const shouldTransparentizeTerminalBackgrounds = () => false
      export const terminalThemeBackground = () => '#000'
    `,
    './transparentSgrStream': `
      export class TransparentSgrStream { push(data) { return data } reset() { return new Uint8Array(0) } }
    `,
    './grokFullscreenSurface': `
      export const shouldTintSurfaceForGrok = () => false
      export const surfaceBaseFor = () => [0, 0, 0]
    `
  }
  const { outputFiles } = await build({
    entryPoints: [join(root, 'src/renderer/src/terminal/TerminalHostRegistry.ts')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    plugins: [{
      name: 'registry-stubs',
      setup(build) {
        build.onResolve({ filter: /^(?:@xterm\/|\.)/ }, ({ path }) => {
          if (!(path in modules)) throw new Error(`Missing test mock: ${path}`)
          return { path, namespace: 'registry-stubs' }
        })
        build.onLoad({ filter: /.*/, namespace: 'registry-stubs' }, ({ path }) => ({
          contents: modules[path], loader: 'js'
        }))
      }
    }]
  })
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', outputFiles[0].text)(module, module.exports)
  return module.exports.TerminalHostRegistry
}

const h = { term: null, openExternal: () => Promise.resolve(true) }
globalThis.__registryTest = h
// The module exports a singleton in addition to the class, so its constructor
// needs the bridge and fonts before evaluation.
globalThis.window = {
  addEventListener() {},
  zinc: { pty: { onExit() {} }, onTerminalOptions() {}, shortcuts: { onAltSequence() {} } }
}
globalThis.document = { fonts: { ready: new Promise(() => {}) } }
const TerminalHostRegistry = await loadRegistry()

function createHost() {
  class FakeTerminal {
    constructor(options) {
      this.writes = []
      this.refreshes = 0
      this.options = new Proxy(options, {
        set: (target, key, value) => {
          this.writes.push([key, value])
          target[key] = value
          return true
        }
      })
      this.buffer = { active: { type: 'normal' }, onBufferChange() {} }
      this.parser = {
        registerCsiHandler: () => ({ dispose() {} }),
        registerOscHandler: () => ({ dispose() {} })
      }
      this.unicode = {}
      this.addons = []
      h.term = this
    }
    loadAddon(addon) { this.addons.push(addon) }
    onTitleChange() {}
    attachCustomKeyEventHandler() {}
    onData() {}
    onResize() {}
    refresh() { this.refreshes++ }
    write(data, callback) {
      this.output ??= []
      this.output.push(data)
      if (callback) this.callbacks.push(callback)
    }
    callbacks = []
  }
  h.Terminal = FakeTerminal
  globalThis.window = {
    addEventListener() {},
    zinc: {
      pty: { onExit() {} },
      onTerminalOptions() {},
      shortcuts: { onAltSequence() {} },
      shell: { openExternal(uri) { return h.openExternal(uri) } }
    }
  }
  globalThis.document = { fonts: { ready: new Promise(() => {}) } }
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  const container = { dataset: {}, addEventListener() {}, getBoundingClientRect: () => ({ width: 100, height: 100 }) }
  const registry = new TerminalHostRegistry()
  registry.createHost('tab-1', container, { shellId: 'pwsh' })
  return { registry, term: h.term }
}

test('background output is sliced, ordered and prioritized on activation without pausing the PTY', () => {
  const frames = []
  const { registry, term } = createHost()
  globalThis.window.setTimeout = (fn) => { frames.push(fn); return frames.length }
  const entry = registry.hosts.get('tab-1')
  const controls = []
  entry.port = { postMessage: (message) => controls.push(message), close() {} }
  registry.setActiveHost(null)
  const bytes = new Uint8Array(1024 * 1024).fill(65)
  registry.writePtyOutput(entry, bytes)
  assert.equal(term.output, undefined)
  assert.deepEqual(controls, [])
  frames.shift()()
  assert.equal(term.output[0].length, 24 * 1024)
  registry.setActiveHost('tab-1')
  registry.writePtyOutput(entry, new Uint8Array([66]))
  while (term.callbacks.length || frames.length) {
    if (term.callbacks.length) term.callbacks.shift()()
    else frames.shift()()
  }
  assert.equal(term.output.reduce((n, chunk) => n + chunk.length, 0), bytes.length + 1)
  assert.equal(term.output.at(-1).at(-1), 66)
  assert.deepEqual(controls, [])
  registry.writePtyOutput(entry, new Uint8Array([67]))
  assert.equal(term.output.at(-1)[0], 67, 'active empty queue writes immediately')
})

test('large background backlogs use a 256 KiB slice and a 4 ms timer', () => {
  const timers = []
  const { registry, term } = createHost()
  window.setTimeout = (fn, delay) => { timers.push({ fn, delay }); return timers.length }
  window.clearTimeout = (id) => { timers[id - 1] = null }
  const entry = registry.hosts.get('tab-1')
  const warn = console.warn
  try {
    console.warn = () => {}
    registry.writePtyOutput(entry, new Uint8Array(9 * 1024 * 1024).fill(65))
    assert.equal(timers[0].delay, 4)
    timers[0].fn()
    assert.equal(term.output[0].byteLength, 256 * 1024)
    term.callbacks.shift()()
    assert.equal(timers[1].delay, 4)
    entry.pendingChunks = []
    entry.pendingBytes = 0
    timers[1].fn()
    registry.writePtyOutput(entry, new Uint8Array(1024))
    assert.equal(timers[2].delay, 16)
    timers[2].fn()
    assert.equal(term.output.at(-1).byteLength, 1024)
    term.callbacks.shift()()
  } finally { console.warn = warn }
})

test('restart isolates delayed parser callbacks and preserves the new pump lock', () => {
  const frames = []
  const { registry, term } = createHost()
  window.setTimeout = (fn) => { frames.push(fn); return frames.length }
  window.clearTimeout = () => {}
  const port = () => ({ close() {}, postMessage() {} })
  const entry = registry.hosts.get('tab-1')
  registry.setActiveHost(null)
  registry.attachPort('tab-1', port())
  registry.writePtyOutput(entry, new Uint8Array([65]))
  frames.shift()()
  const oldDone = term.callbacks.shift()
  registry.attachPort('tab-1', port())
  registry.writePtyOutput(entry, new Uint8Array([66]))
  frames.shift()()
  const newDone = term.callbacks.shift()
  assert.equal(entry.writeInFlight, true)
  oldDone()
  assert.equal(entry.writeInFlight, true)
  assert.equal(registry.backgroundWriteOwner.entry, entry)
  newDone()
  assert.equal(entry.writeInFlight, false)
  assert.equal(registry.backgroundWriteOwner, null)
})

test('SGR rewrite occurs before enqueue and cuts avoid UTF-8 continuation and ESC', () => {
  const { registry } = createHost()
  window.setTimeout = () => 1
  const entry = registry.hosts.get('tab-1')
  let calls = 0
  entry.sgrStream = { push(raw) { calls++; return new Uint8Array([...raw, 33]) }, reset() { return new Uint8Array() } }
  registry.writePtyOutput(entry, new Uint8Array([65]))
  assert.equal(calls, 1)
  assert.deepEqual([...entry.pendingChunks[0]], [65, 33])
  const bytes = new Uint8Array([65, 0xe4, 0xb8, 0xad, 66])
  assert.deepEqual([...registry.slicePendingChunk(bytes, 2)], [65])
  assert.deepEqual([...registry.slicePendingChunk(new Uint8Array([65, 27, 91, 109]), 2)], [65])
})

test('applyOptions ignores equal values and fits only on geometry changes', () => {
  const { registry, term } = createHost()
  registry.hosts.get('tab-1').state = 'ready'
  registry.setActiveHost('tab-1')
  let fits = 0
  registry.fitTerminal = () => { fits++ }
  registry.applyOptions({
    fontFamily: 'JetBrains Mono', fontSize: 16, cursorBlink: true,
    cursorStyle: 'block', scrollback: 3000, colorScheme: 'default',
    themeMode: 'auto', terminalOpacity: 0,
    grokFullscreenSurfaceTint: false
  })
  assert.deepEqual(term.writes, [])
  assert.equal(term.refreshes, 0)
  assert.equal(fits, 0)

  registry.applyOptions({ cursorBlink: false, colorScheme: 'other' })
  assert.deepEqual(term.writes.map(([key]) => key), ['cursorBlink', 'theme'])
  assert.equal(term.refreshes, 1)
  assert.equal(fits, 0)
  registry.applyOptions({ cursorBlink: false, colorScheme: 'other' })
  assert.equal(term.writes.length, 2)
  assert.equal(term.refreshes, 1)
  assert.equal(fits, 0)

  registry.applyOptions({ fontSize: 18 })
  assert.equal(fits, 1)
  registry.applyOptions({ fontSize: 18 })
  assert.equal(fits, 1)
  registry.applyOptions({ scrollback: 0 })
  assert.equal(fits, 2)

  // A hidden host does not reflow now; it is marked and fitted when shown.
  registry.setActiveHost(null)
  registry.applyOptions({ fontSize: 20 })
  assert.equal(fits, 2)
  assert.equal(registry.hosts.get('tab-1').geometryDirty, true)
})

test('OSC 8 and plain-text links show a notice on false, rejection, or throw', async () => {
  const { registry, term } = createHost()
  const notices = []
  registry.onNotice((notice) => notices.push(notice))
  const oscLink = term.options.linkHandler.activate
  const plainLink = term.addons.find((addon) => 'handler' in addon).handler
  const uri = 'https://example.com'

  h.openExternal = () => Promise.resolve(true)
  oscLink({}, uri)
  await new Promise(setImmediate)
  assert.deepEqual(notices, [])

  h.openExternal = () => Promise.resolve(false)
  oscLink({}, uri)
  await new Promise(setImmediate)
  assert.deepEqual(notices, ['openExternalFailed'])

  h.openExternal = () => Promise.reject(new Error('IPC failed'))
  plainLink({}, uri)
  await new Promise(setImmediate)
  assert.deepEqual(notices, ['openExternalFailed', 'openExternalFailed'])

  h.openExternal = () => { throw new Error('sync failure') }
  plainLink({}, uri)
  assert.deepEqual(notices, ['openExternalFailed', 'openExternalFailed', 'openExternalFailed'])
})

test('GPU rendering is opt-in: the visible host follows the setting and only it gets the lighter-glyph weight fix', () => {
  globalThis.requestAnimationFrame = (fn) => fn()
  const { registry, term } = createHost()
  const entry = registry.hosts.get('tab-1')
  entry.state = 'ready'
  registry.setActiveHost('tab-1')
  const fits = []
  registry.fitTerminal = (e) => { fits.push(e.id) }

  // Default: DOM renderer, even for the host on screen.
  const baseAddons = term.addons.length
  registry.attachWebgl(entry)
  assert.equal(entry.webgl, null)
  assert.equal(term.addons.length, baseAddons)

  registry.applyOptions({ gpuRendering: true })
  assert.ok(entry.webgl, 'the visible host moves to WebGL')
  assert.equal(term.options.fontWeight, '500')
  assert.deepEqual(fits, ['tab-1'], 'and re-fits, since the renderers measure cells differently')

  registry.applyOptions({ gpuRendering: false })
  assert.equal(entry.webgl, null)
  assert.equal(term.options.fontWeight, 'normal')
  assert.deepEqual(fits, ['tab-1', 'tab-1'])

  // A hidden host is not drawn on the GPU; it only re-fits when next shown.
  registry.setActiveHost(null)
  registry.applyOptions({ gpuRendering: true })
  assert.equal(entry.webgl, null)
  assert.equal(entry.geometryDirty, true)
})
