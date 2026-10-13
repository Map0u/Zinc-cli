import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-shared-conout-'))
const bundle = (entry, name) => {
  const outfile = join(outDir, name)
  buildSync({ entryPoints: [join(root, entry)], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' })
  return outfile
}
const workerPath = bundle('src/main/pty/conoutRelayWorker.ts', 'conoutRelayWorker.cjs')
const { installSharedConout } = await import(pathToFileURL(bundle('src/main/pty/sharedConout.ts', 'sharedConout.cjs')).href).then((m) => m.default ?? m)
test.after(() => rmSync(outDir, { recursive: true, force: true }))

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const pipeName = (tag) => ['', '', '.', 'pipe', `zinc-test-conout-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`].join('\\')

class FakeConnection {}
FakeConnection.prototype.connectSocket = () => {}
FakeConnection.prototype.dispose = () => {}
Object.defineProperty(FakeConnection.prototype, 'onReady', { get: () => () => {} })

test('install swaps the export, and refuses a module that is not node-pty 1.1.0 shaped', () => {
  const mod = { ConoutConnection: FakeConnection }
  const result = installSharedConout(mod, workerPath)
  assert.equal(result.installed, true)
  assert.notEqual(mod.ConoutConnection, FakeConnection)

  const strange = { ConoutConnection: class Other {} }
  const original = strange.ConoutConnection
  assert.equal(installSharedConout(strange, workerPath).installed, false)
  assert.equal(strange.ConoutConnection, original)
  assert.equal(installSharedConout({}, workerPath).installed, false)
})

test('one worker relays several conout pipes independently, then goes away with the last one', async () => {
  const mod = { ConoutConnection: FakeConnection }
  const { host } = installSharedConout(mod, workerPath)
  const sources = []
  const conouts = []
  const names = ['a', 'b'].map((tag) => pipeName(tag))
  for (const name of names) {
    const server = createServer((socket) => sources.push({ name, socket }))
    await new Promise((resolve) => server.listen(name, resolve))
    conouts.push(server)
  }

  const tabs = names.map((name) => {
    const conn = new mod.ConoutConnection(name, false)
    const tab = { conn, socket: new Socket(), text: '' }
    tab.socket.setEncoding('utf8')
    tab.socket.on('data', (chunk) => (tab.text += chunk))
    tab.ready = new Promise((resolve) => conn.onReady(resolve))
    return tab
  })
  await Promise.all(tabs.map((tab) => tab.ready))
  assert.ok(host.worker, 'a worker was started')
  const worker = host.worker
  tabs.forEach((tab) => tab.conn.connectSocket(tab.socket))
  for (let i = 0; i < 50 && sources.length < 2; i++) await delay(20)
  assert.equal(sources.length, 2)

  // A multibyte character split across writes must come out whole.
  const bytes = Buffer.from('héllo 世界\n')
  const cut = bytes.indexOf(0xe4) + 1
  const source = (name) => sources.find((s) => s.name === name).socket
  source(names[0]).write(bytes.subarray(0, cut))
  await delay(50)
  source(names[0]).write(bytes.subarray(cut))
  source(names[1]).write('second tab only\n')
  for (let i = 0; i < 50 && !(tabs[0].text.includes('界') && tabs[1].text.includes('only')); i++) await delay(20)
  assert.equal(tabs[0].text, 'héllo 世界\n')
  assert.equal(tabs[1].text, 'second tab only\n')
  assert.equal(host.worker, worker, 'still the same single worker')

  tabs[0].conn.dispose()
  tabs[0].conn.dispose()
  await delay(1400)
  assert.equal(host.worker, worker, 'one tab still open keeps the worker')
  source(names[1]).write('still alive\n')
  for (let i = 0; i < 50 && !tabs[1].text.includes('alive'); i++) await delay(20)
  assert.match(tabs[1].text, /still alive/)

  tabs[1].conn.dispose()
  await delay(1400)
  assert.equal(host.worker, null, 'last tab closed, worker terminated')
  for (const tab of tabs) tab.socket.destroy()
  for (const { socket } of sources) socket.destroy()
  for (const server of conouts) server.close()
})
