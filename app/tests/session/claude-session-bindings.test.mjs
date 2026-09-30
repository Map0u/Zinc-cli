import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const tempDir = mkdtempSync(join(tmpdir(), 'zinc-claude-bindings-'))
const outfile = join(tempDir, 'ClaudeSessionBindings.mjs')
buildSync({
  entryPoints: [join(root, 'src/main/services/ClaudeSessionBindings.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent'
})
const { ClaudeSessionBindings, appendClaudeBinding } = await import(pathToFileURL(outfile).href)
const electronExe = join(root, 'node_modules/electron/dist/electron.exe')

test.after(() => rmSync(tempDir, { recursive: true, force: true }))

// Replace only the OS ancestor lookup in the generated runtime fixture. Every
// test below still feeds the actual reporter stdin and runs its JSONL writer;
// none starts Claude or calls the native process inspector/network.
function mockReporter(userData) {
  const reportPath = join(userData, 'session-hooks/report.js')
  const script = readFileSync(reportPath, 'utf8')
  const lookup = "const {spawnSync}=require('node:child_process')"
  assert.ok(script.includes(lookup))
  writeFileSync(reportPath, script.replace(lookup,
    "const spawnSync=()=>({status:Number(process.env.MOCK_ANCESTOR_STATUS??'0'),stdout:process.env.MOCK_ANCESTOR??''})"), 'utf8')
  return reportPath
}

function reporterEnv(ancestor, tabId = 'tab-1', runId = 'run-1') {
  return { ...process.env, MOCK_ANCESTOR: ancestor, ZINC_TAB_ID: tabId, ZINC_RUN_ID: runId }
}

function reportSync(reportPath, sessionId, source, ancestor = '55|1001') {
  const result = spawnSync(process.execPath, [reportPath], {
    input: JSON.stringify({ session_id: sessionId, cwd: 'C:\\project', source }),
    encoding: 'utf8',
    env: reporterEnv(ancestor),
    timeout: 10000
  })
  assert.equal(result.status, 0, `${result.error ?? result.stderr}`)
  assert.equal(result.stderr, '')
}

function reportAsync(reportPath, sessionId, ancestor = '55|1001') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [reportPath], { env: reporterEnv(ancestor) })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0 || stderr) reject(new Error(`reporter exited ${code}: ${stderr}`))
      else resolve()
    })
    child.stdin.end(JSON.stringify({ session_id: sessionId, cwd: 'C:\\project', source: 'startup' }))
  })
}

test('SessionStart hook runs in bundled Electron without node on PATH', { skip: process.platform !== 'win32' }, () => {
  const userData = mkdtempSync(join(tempDir, 'user-data-'))
  const bindings = new ClaudeSessionBindings(userData, electronExe)
  const settingsPath = bindings.settingsFilePath()
  assert.ok(settingsPath)
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  const reportCommand = settings.hooks.SessionStart[0].hooks[0].command
  for (const entry of settings.hooks.SessionStart) assert.equal(entry.hooks[0].command, reportCommand)
  assert.match(reportCommand, /report\.cmd/i)
  const reportCmd = join(userData, 'session-hooks/report.cmd')
  const cmd = readFileSync(reportCmd, 'utf8')
  assert.match(cmd, /ELECTRON_RUN_AS_NODE=1/)
  assert.ok(cmd.includes(electronExe))

  mockReporter(userData)
  const sessionId = '15ed028a-b553-4d40-93b3-0c46ea1a426e'
  const event = JSON.stringify({ session_id: sessionId, cwd: 'C:\\project', source: 'startup' })
  const withoutAncestor = spawnSync('cmd.exe', ['/d', '/c', reportCmd], {
    input: event,
    encoding: 'utf8',
    env: { ...reporterEnv(''), MOCK_ANCESTOR_STATUS: '1', PATH: 'C:\\Windows\\System32' },
    timeout: 10000
  })
  assert.equal(withoutAncestor.status, 0, `${withoutAncestor.error ?? withoutAncestor.stderr}`)
  assert.match(withoutAncestor.stderr, /ancestor not found/)
  assert.equal(existsSync(join(userData, 'session-hooks/session-bindings.jsonl')), false)

  const result = spawnSync('cmd.exe', ['/d', '/c', reportCmd], {
    input: event,
    encoding: 'utf8',
    env: { ...reporterEnv('55|1001'), PATH: 'C:\\Windows\\System32' },
    timeout: 10000
  })
  assert.equal(result.status, 0, `${result.error ?? result.stderr}`)
  assert.equal(bindings.sessionIdFor('tab-1', 'run-1', 55, 1001), sessionId)
})

test('a binding must belong to the detected live invocation, not just a tab and PTY run', () => {
  const userData = mkdtempSync(join(tempDir, 'binding-check-'))
  const bindings = new ClaudeSessionBindings(userData, electronExe)
  bindings.settingsFilePath()
  const file = join(userData, 'session-hooks/session-bindings.jsonl')
  const sessionId = '983ac0ee-273c-4c05-93cb-a52788718d1d'
  appendClaudeBinding(file, {
    session_id: sessionId,
    zinc_tab_id: 'tab-1',
    zinc_run_id: 'run-1',
    claude_pid: 55,
    claude_started_ms: 1001
  })
  assert.equal(bindings.sessionIdFor('tab-1', 'run-1', 55, 1001), sessionId)
  assert.equal(bindings.sessionIdFor('tab-1', 'run-1', 55, 1002), undefined)
  assert.equal(bindings.sessionIdFor('tab-1', 'run-1', 55, null), undefined)
  assert.equal(bindings.sessionIdFor('tab-1', 'run-1', 99, 1001), undefined)
  assert.equal(bindings.sessionIdFor('tab-1', 'run-2', 55, 1001), undefined)
  assert.equal(bindings.sessionIdFor('tab-2', 'run-1', 55, 1001), undefined)
})

test('same tab/run rebinds on /clear, and Claude A cannot bind Claude B before B reports', () => {
  const userData = mkdtempSync(join(tempDir, 'same-run-'))
  const bindings = new ClaudeSessionBindings(userData, electronExe)
  bindings.settingsFilePath()
  const reportPath = mockReporter(userData)
  const startupId = '11111111-1111-1111-1111-111111111111'
  const clearId = '22222222-2222-2222-2222-222222222222'
  const nextClaudeId = '33333333-3333-3333-3333-333333333333'

  reportSync(reportPath, startupId, 'startup', '55|1001')
  assert.equal(bindings.sessionIdFor('tab-1', 'run-1', 55, 1001), startupId)
  reportSync(reportPath, clearId, 'clear', '55|1001')
  assert.equal(bindings.sessionIdFor('tab-1', 'run-1', 55, 1001), clearId)

  // Zinc may persist immediately after A exits, before the next Claude's
  // SessionStart hook runs. Reusing the tab/run does not make A's ID B's ID.
  assert.equal(bindings.sessionIdFor('tab-1', 'run-1', 56, 2002), undefined)
  assert.equal(bindings.sessionIdFor('tab-1', 'run-1', 55, 2002), undefined) // PID reuse
  reportSync(reportPath, nextClaudeId, 'startup', '56|2002')
  assert.equal(bindings.sessionIdFor('tab-1', 'run-1', 56, 2002), nextClaudeId)
  assert.equal(bindings.sessionIdFor('tab-1', 'run-2', 56, 2002), undefined)

  const events = readFileSync(join(userData, 'session-hooks/session-bindings.jsonl'), 'utf8')
    .trimEnd().split('\n').map(JSON.parse)
  assert.deepEqual(events.map(({ source }) => source), ['startup', 'clear', 'startup'])
})

test('concurrent reporters append complete JSONL records without discarding earlier entries', async () => {
  const userData = mkdtempSync(join(tempDir, 'concurrent-'))
  const bindings = new ClaudeSessionBindings(userData, electronExe)
  bindings.settingsFilePath()
  const reportPath = mockReporter(userData)
  const file = join(userData, 'session-hooks/session-bindings.jsonl')
  // Deliberately exceed 1 MiB. This reporter is append-only, not capped; a
  // competing truncation/rotation would make the integrity assertion fail.
  const oldId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const oldCount = 1800
  const oldLine = `${JSON.stringify({ session_id: oldId, cwd: 'x'.repeat(600) })}\n`
  writeFileSync(file, oldLine.repeat(oldCount), 'utf8')
  const before = statSync(file).size
  assert.ok(before > 1024 * 1024)

  const count = 24
  const ids = Array.from({ length: count }, (_, i) =>
    `00000000-0000-0000-0000-${i.toString(16).padStart(12, '0')}`)
  await Promise.all(ids.map((id) => reportAsync(reportPath, id, '55|1001')))
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n')
  assert.equal(lines.length, oldCount + count)
  const records = lines.map(JSON.parse) // each concurrent write is a full JSON line
  assert.equal(records.filter(({ session_id }) => session_id === oldId).length, oldCount)
  assert.deepEqual(new Set(records.slice(oldCount).map(({ session_id }) => session_id)), new Set(ids))
  assert.ok(statSync(file).size > before) // falsifiable evidence of unbounded growth
})

test('reporter surfaces write failures instead of silently losing bindings', () => {
  const userData = mkdtempSync(join(tempDir, 'write-error-'))
  const bindings = new ClaudeSessionBindings(userData, electronExe)
  bindings.settingsFilePath()
  const reportPath = mockReporter(userData)
  mkdirSync(join(userData, 'session-hooks/session-bindings.jsonl'))
  const result = spawnSync(process.execPath, [reportPath], {
    input: JSON.stringify({ session_id: '44444444-4444-4444-4444-444444444444' }),
    encoding: 'utf8',
    env: reporterEnv('55|1001'),
    timeout: 10000
  })
  assert.equal(result.status, 0, `${result.error ?? result.stderr}`)
  assert.match(result.stderr, /\[Zinc\] Claude session binding reporter failed:/)
})
