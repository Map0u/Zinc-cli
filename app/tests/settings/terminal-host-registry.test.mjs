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
    './kimiFullscreenWheelPaging': `
      export const createWheelPagerState = () => ({})
      export const decideKimiFullscreenWheel = () => ({ consume: false })
      export const shouldInterceptKimiFullscreenWheel = () => false
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
    attachCustomWheelEventHandler() {}
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
  let fits = 0
  registry.fitTerminal = () => { fits++ }
  registry.applyOptions({
    fontFamily: 'JetBrains Mono', fontSize: 16, cursorBlink: true,
    cursorStyle: 'block', scrollback: 10000, colorScheme: 'default',
    themeMode: 'auto', terminalOpacity: 0,
    kimiFullscreenWheelPaging: true, grokFullscreenSurfaceTint: false
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
