import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const tempDir = mkdtempSync(join(tmpdir(), 'zinc-paste-for-tab-'))
const outfile = join(tempDir, 'PasteImageService.mjs')

// Route node:fs/promises through a shim whose writeFile can be held open, so
// the tests control exactly when a "slow" disk write finishes.
const gatedWrites = {
  name: 'gated-writes',
  setup(build) {
    build.onResolve({ filter: /^node:fs\/promises$/ }, (args) =>
      args.namespace === 'gated-writes' ? { path: args.path, external: true } : { path: 'fs-promises', namespace: 'gated-writes' })
    build.onLoad({ filter: /.*/, namespace: 'gated-writes' }, () => ({
      loader: 'js',
      contents: `
        import * as real from 'node:fs/promises'
        export const mkdir = real.mkdir
        export async function writeFile(path, data, options) {
          const hooks = globalThis.__pasteWriteHooks
          hooks.started.push(path)
          const gate = hooks.gates.shift()
          if (gate) await gate
          return real.writeFile(path, data, options)
        }`
    }))
  }
}
await build({
  entryPoints: [join(root, 'src/main/services/PasteImageService.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  plugins: [gatedWrites],
  logLevel: 'silent'
})
const { PasteImageService } = await import(pathToFileURL(outfile).href)

test.after(() => rmSync(tempDir, { recursive: true, force: true }))

const png = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2mT0AAAAASUVORK5CYII=',
  'base64'
))

function newHooks(gateCount = 0) {
  const releases = []
  const gates = Array.from({ length: gateCount }, () => new Promise((resolve) => releases.push(resolve)))
  globalThis.__pasteWriteHooks = { started: [], gates }
  return { started: globalThis.__pasteWriteHooks.started, releases }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function newService() {
  return new PasteImageService(mkdtempSync(join(tempDir, 'user-data-')))
}

test('the path is delivered only after the asynchronous write has finished', async () => {
  const hooks = newHooks(1)
  const service = newService()
  const delivered = []
  const done = service.pasteForTab('tab-1', 'run-1', () => 'run-1', png, 'image/png', (path) => {
    delivered.push({ path, existed: existsSync(path) })
  })
  await sleep(20)
  assert.equal(hooks.started.length, 1) // write is in flight (held open)
  assert.deepEqual(delivered, [])
  hooks.releases[0]()
  assert.equal(await done, 'delivered')
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].existed, true)
  assert.equal(delivered[0].path, hooks.started[0])
})

test('pastes for one tab are delivered in order while other tabs are not blocked', async () => {
  const hooks = newHooks(1) // only the first write is held
  const service = newService()
  const order = []
  const first = service.pasteForTab('tab-1', 'run-1', () => 'run-1', png, 'image/png', () => order.push('tab-1 first'))
  await sleep(5)
  const second = service.pasteForTab('tab-1', 'run-1', () => 'run-1', png, 'image/png', () => order.push('tab-1 second'))
  const other = service.pasteForTab('tab-2', 'run-9', () => 'run-9', png, 'image/png', () => order.push('tab-2'))
  assert.equal(await other, 'delivered')
  await sleep(20)
  // The second tab-1 paste has not even started writing behind the first.
  assert.equal(hooks.started.length, 2)
  assert.deepEqual(order, ['tab-2'])
  hooks.releases[0]()
  assert.deepEqual(await Promise.all([first, second]), ['delivered', 'delivered'])
  assert.deepEqual(order, ['tab-2', 'tab-1 first', 'tab-1 second'])
  await sleep(0)
  assert.equal(service.tabQueues.size, 0)
})

test('a tab closed or replaced during the write receives nothing', async () => {
  const hooks = newHooks(2)
  const service = newService()
  let runId = 'run-1'
  const delivered = []
  const closed = service.pasteForTab('tab-1', 'run-1', () => runId, png, 'image/png', (p) => delivered.push(p))
  await sleep(20)
  runId = null // pty closed while the file is still being written
  hooks.releases[0]()
  assert.equal(await closed, 'tab-changed')

  runId = 'run-2'
  const replaced = service.pasteForTab('tab-1', 'run-2', () => runId, png, 'image/png', (p) => delivered.push(p))
  await sleep(20)
  runId = 'run-3' // same tab id, new pty
  hooks.releases[1]()
  assert.equal(await replaced, 'tab-changed')

  assert.equal(await service.pasteForTab('tab-1', null, () => null, png, 'image/png', (p) => delivered.push(p)), 'tab-changed')
  assert.deepEqual(delivered, [])
  // The two pastes already writing finished their files; the third, whose tab
  // was gone before its turn, skipped the write entirely.
  assert.equal(hooks.started.length, 2)
})

test('keys typed during a paste reach the pty after the pasted path', async () => {
  const hooks = newHooks(1)
  const service = newService()
  const writes = []
  const paste = service.pasteForTab('tab-1', 'run-1', () => 'run-1', png, 'image/png', () => writes.push('path'))
  service.afterPendingPastes('tab-1', () => writes.push('a'))
  service.afterPendingPastes('tab-1', () => writes.push('b'))
  service.afterPendingPastes('tab-2', () => writes.push('other-tab'))
  assert.deepEqual(writes, ['other-tab'])
  await sleep(20)
  hooks.releases[0]()
  assert.equal(await paste, 'delivered')
  await sleep(5)
  assert.deepEqual(writes, ['other-tab', 'path', 'a', 'b'])
  service.afterPendingPastes('tab-1', () => writes.push('c'))
  assert.deepEqual(writes.at(-1), 'c') // nothing pending: written immediately
})

test('a failed save is reported, delivers nothing, and does not block the next paste', async () => {
  newHooks()
  const service = newService()
  const delivered = []
  const bad = service.pasteForTab('tab-1', 'run-1', () => 'run-1', Uint8Array.from([1, 2, 3]), 'image/png', (p) => delivered.push(p))
  const good = service.pasteForTab('tab-1', 'run-1', () => 'run-1', png, 'image/png', (p) => delivered.push(p))
  assert.equal(await bad, 'save-failed')
  assert.equal(await good, 'delivered')
  assert.equal(delivered.length, 1)
})

test('a throwing deliver rejects its own paste only', async () => {
  newHooks()
  const service = newService()
  const failing = service.pasteForTab('tab-1', 'run-1', () => 'run-1', png, 'image/png', () => { throw new Error('boom') })
  await sleep(5)
  const next = service.pasteForTab('tab-1', 'run-1', () => 'run-1', png, 'image/png', () => {})
  await assert.rejects(failing, /boom/)
  assert.equal(await next, 'delivered')
})
