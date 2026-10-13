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
