import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-tab-context-'))
const outfile = join(outDir, 'TabContextService.mjs')
buildSync({ entryPoints: [join(root, 'src/main/services/TabContextService.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
const { TabContextService } = await import(pathToFileURL(outfile).href)
test.after(() => rmSync(outDir, { recursive: true, force: true }))

function setup() {
  test.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 })
  const state = { cwd: '/work/a', tool: null, toolCalls: 0, sent: [] }
  const service = new TabContextService({
    getCwd: () => state.cwd,
    getTool: () => { state.toolCalls++; return state.tool },
    resolveRoot: (cwd) => (cwd ? cwd.split('/').slice(0, 3).join('/') : null),
    send: (id, context) => state.sent.push([id, context]),
  })
  return { state, service }
}
function finish(service) {
  service.dispose()
  test.mock.timers.reset()
}

test('track pushes the first context at once, without a process scan', () => {
  const { state, service } = setup()
  service.track('t1')
  assert.deepEqual(state.sent, [['t1', { cwd: '/work/a', projectRoot: '/work/a', projectName: 'a', tool: null }]])
  assert.equal(state.toolCalls, 0)
  finish(service)
})

test('a cwd change after a quiet spell is pushed at once; bursts coalesce to one push per 250ms', () => {
  const { state, service } = setup()
  service.track('t1')
  test.mock.timers.tick(1000)
  state.cwd = '/work/b'
  service.noteOutput('t1')
  test.mock.timers.tick(0)
  assert.equal(state.sent.length, 2)
  assert.equal(state.sent[1][1].cwd, '/work/b')
  state.cwd = '/work/c'
  service.noteOutput('t1')
  state.cwd = '/work/d'
  service.noteOutput('t1')
  assert.equal(state.sent.length, 2, 'inside the coalescing window')
  test.mock.timers.tick(250)
  assert.equal(state.sent.length, 3)
  assert.equal(state.sent[2][1].cwd, '/work/d')
  finish(service)
})

test('a prompt-reported cwd skips the coalescing wait', () => {
  const { state, service } = setup()
  service.track('t1')
  service.noteOutput('t1')
  test.mock.timers.tick(0)
  state.cwd = '/work/b'
  service.noteOutput('t1', true)
  test.mock.timers.tick(0)
  assert.equal(state.sent.at(-1)[1].cwd, '/work/b')
  finish(service)
})

test('unchanged output pushes nothing', () => {
  const { state, service } = setup()
  service.track('t1')
  for (let i = 0; i < 20; i++) {
    test.mock.timers.tick(300)
    service.noteOutput('t1')
  }
  test.mock.timers.tick(300)
  assert.equal(state.sent.length, 1)
  finish(service)
})

test('the tool is looked up at most every 3s, and a trailing lookup catches a late change', () => {
  const { state, service } = setup()
  service.track('t1')
  test.mock.timers.tick(500)
  service.noteOutput('t1')
  test.mock.timers.tick(0)
  assert.equal(state.toolCalls, 1)
  state.tool = 'claude'
  for (let i = 0; i < 8; i++) {
    test.mock.timers.tick(250)
    service.noteOutput('t1')
  }
  assert.equal(state.toolCalls, 1, 'rate limited while output continues')
  test.mock.timers.tick(1500)
  assert.equal(state.toolCalls, 2)
  assert.equal(state.sent.at(-1)[1].tool, 'claude')
  test.mock.timers.tick(10_000)
  assert.equal(state.toolCalls, 2, 'no output, no more lookups')
  finish(service)
})

test('a failing tool lookup keeps the previous tool', () => {
  const { state, service } = setup()
  state.tool = 'codex'
  service.track('t1')
  test.mock.timers.tick(500)
  service.noteOutput('t1')
  test.mock.timers.tick(0)
  assert.equal(state.sent.at(-1)[1].tool, 'codex')
  const throwing = new TabContextService({
    getCwd: () => '/work/a',
    getTool: () => { throw new Error('snapshot failed') },
    resolveRoot: (cwd) => cwd,
    send: () => {},
  })
  throwing.track('x')
  test.mock.timers.tick(500)
  assert.doesNotThrow(() => { throwing.noteOutput('x'); test.mock.timers.tick(0) })
  throwing.dispose()
  finish(service)
})

test('resend replays the last context of live tabs only; dropped tabs go quiet', () => {
  const { state, service } = setup()
  service.track('t1')
  service.track('t2')
  service.drop('t2')
  state.sent.length = 0
  service.resend()
  assert.deepEqual(state.sent.map(([id]) => id), ['t1'])
  service.noteOutput('t2')
  test.mock.timers.tick(5000)
  assert.equal(state.sent.length, 1)
  finish(service)
})
