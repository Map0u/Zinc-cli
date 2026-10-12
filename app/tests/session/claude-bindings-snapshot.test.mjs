import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const tempDir = mkdtempSync(join(tmpdir(), 'zinc-bindings-snapshot-'))
const outfile = join(tempDir, 'ClaudeSessionBindings.mjs')

// Count every synchronous existence check / read the bindings code makes.
const fsSpy = {
  name: 'fs-spy',
  setup(build) {
    build.onResolve({ filter: /^node:fs$/ }, (args) =>
      args.namespace === 'fs-spy' ? { path: args.path, external: true } : { path: 'fs', namespace: 'fs-spy' })
    build.onLoad({ filter: /.*/, namespace: 'fs-spy' }, () => ({
      loader: 'js',
      contents: `
        import * as real from 'node:fs'
        export * from 'node:fs'
        export const existsSync = (p) => { globalThis.__fsCalls.exists.push(String(p)); return real.existsSync(p) }
        export const readFileSync = (p, ...rest) => { globalThis.__fsCalls.reads.push(String(p)); return real.readFileSync(p, ...rest) }`
    }))
  }
}
await build({
  entryPoints: [join(root, 'src/main/services/ClaudeSessionBindings.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  plugins: [fsSpy],
  logLevel: 'silent'
})
const { ClaudeSessionBindings, appendClaudeBinding } = await import(pathToFileURL(outfile).href)

test.after(() => rmSync(tempDir, { recursive: true, force: true }))

function newBindings() {
  const userData = mkdtempSync(join(tempDir, 'user-data-'))
  const bindings = new ClaudeSessionBindings(userData, 'electron.exe')
  bindings.settingsFilePath()
  return { bindings, file: join(userData, 'session-hooks/session-bindings.jsonl') }
}

function resetCalls() {
  globalThis.__fsCalls = { exists: [], reads: [] }
  return globalThis.__fsCalls
}

const uuid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

// The pre-snapshot implementation, verbatim, as the semantic reference.
function referenceSessionIdFor(lines, tabId, runId, matchPid, matchStartedMs) {
  if (!Number.isSafeInteger(matchPid) || matchPid <= 0 || matchStartedMs === null) return undefined
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue
    let b
    try {
      b = JSON.parse(line)
    } catch {
      continue
    }
    if (b.zinc_tab_id !== tabId || !runId || b.zinc_run_id !== runId) continue
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.session_id)) continue
    if (b.claude_pid !== matchPid || b.claude_started_ms !== matchStartedMs) continue
    return b.session_id
  }
  return undefined
}

test('one snapshot reads the bindings file once for any number of tabs', () => {
  const { bindings, file } = newBindings()
  for (let tab = 0; tab < 10; tab += 1) {
    appendClaudeBinding(file, {
      session_id: uuid(tab), zinc_tab_id: `tab-${tab}`, zinc_run_id: `run-${tab}`,
      claude_pid: 100 + tab, claude_started_ms: 5000 + tab
    })
  }
  const calls = resetCalls()
  const snapshot = bindings.snapshot()
  assert.deepEqual(calls.reads, []) // lazy: building a snapshot touches nothing
  for (let tab = 0; tab < 10; tab += 1) {
    assert.equal(snapshot.sessionIdFor(`tab-${tab}`, `run-${tab}`, 100 + tab, 5000 + tab), uuid(tab))
  }
  assert.equal(snapshot.sessionIdFor('tab-0', 'run-0', 999, 5000), undefined)
  assert.equal(calls.reads.length, 1)
  assert.equal(calls.exists.length, 1)

  // The one-off per-call path still reads once per call.
  const perCall = resetCalls()
  for (let tab = 0; tab < 10; tab += 1) bindings.sessionIdFor(`tab-${tab}`, `run-${tab}`, 100 + tab, 5000 + tab)
  assert.equal(perCall.reads.length, 10)
})

test('lookups that cannot match never touch the file, and a missing file is checked once', () => {
  const { bindings, file } = newBindings()
  const calls = resetCalls()
  const snapshot = bindings.snapshot()
  assert.equal(snapshot.sessionIdFor('tab-1', 'run-1', 0, 1), undefined)
  assert.equal(snapshot.sessionIdFor('tab-1', 'run-1', 55, null), undefined)
  assert.equal(snapshot.sessionIdFor('tab-1', 'run-1', 1.5, 1), undefined)
  assert.deepEqual([calls.exists.length, calls.reads.length], [0, 0])

  // File does not exist yet: one check, no read, for every tab in the pass.
  assert.equal(snapshot.sessionIdFor('tab-1', 'run-1', 55, 1001), undefined)
  assert.equal(snapshot.sessionIdFor('tab-2', 'run-2', 56, 1002), undefined)
  assert.deepEqual([calls.exists.length, calls.reads.length], [1, 0])

  // A snapshot never outlives its pass: a new one sees what hooks wrote later.
  appendClaudeBinding(file, { session_id: uuid(1), zinc_tab_id: 'tab-1', zinc_run_id: 'run-1', claude_pid: 55, claude_started_ms: 1001 })
  assert.equal(snapshot.sessionIdFor('tab-1', 'run-1', 55, 1001), undefined)
  assert.equal(bindings.snapshot().sessionIdFor('tab-1', 'run-1', 55, 1001), uuid(1))
})

test('snapshot matching is identical to the original per-call matching', () => {
  const { bindings, file } = newBindings()
  const rec = (record) => JSON.stringify(record)
  // Newest-wins rebinding, stale runs, PID reuse, bad uuid, other tabs.
  const lines = [
    rec({ session_id: uuid(1), zinc_tab_id: 'tab-1', zinc_run_id: 'run-1', claude_pid: 55, claude_started_ms: 1001 }),
    '',
    '{broken json',
    rec({ session_id: uuid(2), zinc_tab_id: 'tab-1', zinc_run_id: 'run-1', claude_pid: 55, claude_started_ms: 1001 }),
    '   ',
    rec({ session_id: 'not-a-uuid', zinc_tab_id: 'tab-1', zinc_run_id: 'run-1', claude_pid: 55, claude_started_ms: 1001 }),
    '42',
    rec({ session_id: uuid(3), zinc_tab_id: 'tab-1', zinc_run_id: 'run-2', claude_pid: 56, claude_started_ms: 2002 }),
    rec({ session_id: uuid(4), zinc_tab_id: 'tab-2', zinc_run_id: 'run-1', claude_pid: 55, claude_started_ms: 1001 }),
    rec({ session_id: uuid(5), zinc_tab_id: 'tab-3', zinc_run_id: null, claude_pid: 57, claude_started_ms: 3003 }),
    rec({ session_id: uuid(6), zinc_tab_id: 'tab-4', zinc_run_id: 'run-4', claude_pid: 58 })
  ]
  writeFileSync(file, `${lines.join('\r\n')}\n`, 'utf8')
  appendFileSync(file, '{"truncated":', 'utf8') // reporter killed mid-append, no newline
  lines.push('{"truncated":')

  const tabs = ['tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-9']
  const runs = ['run-1', 'run-2', 'run-4', null, '']
  const pids = [0, 55, 56, 57, 58, 99, -1, 1.5, NaN]
  const started = [1001, 2002, 3003, 4004, null, 0]
  const snapshot = bindings.snapshot()
  let compared = 0
  let hits = 0
  for (const tab of tabs) for (const run of runs) for (const pid of pids) for (const ms of started) {
    const expected = referenceSessionIdFor(lines, tab, run, pid, ms)
    assert.equal(snapshot.sessionIdFor(tab, run, pid, ms), expected, `${tab} ${run} ${pid} ${ms}`)
    assert.equal(bindings.sessionIdFor(tab, run, pid, ms), expected)
    compared += 1
    if (expected) hits += 1
  }
  assert.ok(compared > 1000)
  assert.ok(hits >= 3) // the matrix exercises real matches, not only misses
  assert.equal(snapshot.sessionIdFor('tab-1', 'run-1', 55, 1001), uuid(2)) // newest valid record wins
})
