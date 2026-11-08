import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const stubs = {
  'node-pty': 'export const spawn = (...args) => globalThis.__ptyEcho.spawn(...args)',
  electron: 'export class MessageChannelMain { constructor() { return globalThis.__ptyEcho.channel() } }',
  '../processCwd': 'export const getProcessCwd = () => null',
  '../services/shellHistoryIsolation': 'export const buildIsolatedShellSpawn = () => ({env: {}, args: []})',
  './activityTracker': `export const createActivityTracker = () => ({feed(){}, exited(){}, markSeen(){}}); export const createCoalescedEmitter = () => ({push(){}, flush(){}, dispose(){}})`,
  './shellCwdReport': 'export const createShellCwdReader = () => () => {}'
}
const { outputFiles } = await build({
  entryPoints: [join(root, 'src/main/pty/PtyManager.ts')], bundle: true, write: false,
  platform: 'node', format: 'cjs', plugins: [{ name: 'stubs', setup(build) {
    build.onResolve({ filter: /.*/ }, ({ path }) => path in stubs ? { path, namespace: 'stubs' } : null)
    build.onLoad({ filter: /.*/, namespace: 'stubs' }, ({ path }) => ({ contents: stubs[path], loader: 'js' }))
  }}]
})
const module = { exports: {} }
new Function('module', 'exports', 'require', outputFiles[0].text)(module, module.exports, (await import('node:module')).createRequire(import.meta.url))
const { PtyManager } = module.exports

test('only small output in the 50ms input window bypasses batching', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sent = []
  let emitData
  const proc = {
    pid: 1, write() {}, kill() {},
    onData(fn) { emitData = fn; return { dispose() {} } },
    onExit() { return { dispose() {} } }
  }
  globalThis.__ptyEcho = {
    spawn: () => proc,
    channel: () => ({ port1: { start() {}, postMessage(data) { sent.push(data) }, close() {} }, port2: {} })
  }
  const sender = { id: 42, isDestroyed: () => false, once() {}, postMessage() {}, send() {} }
  const manager = new PtyManager()
  manager.create('a', {}, sender, { kind: 'other', command: 'shell' })
  emitData('background')
  assert.equal(sent.length, 0)
  manager.write('a', new Uint8Array([120]), 42)
  emitData('echo')
  assert.equal(sent.length, 1)
  assert.equal(Buffer.from(sent[0]).toString(), 'backgroundecho')
  manager.write('a', new Uint8Array([120]), 42)
  emitData('x'.repeat(16 * 1024 + 1))
  assert.equal(sent.length, 1)
  t.mock.timers.tick(16)
  assert.equal(sent.length, 2)
  manager.sessions.get('a').lastInputAt = performance.now() - 51
  emitData('late')
  assert.equal(sent.length, 2)
  t.mock.timers.tick(16)
  assert.equal(sent.length, 3)
  manager.killAll()
})
