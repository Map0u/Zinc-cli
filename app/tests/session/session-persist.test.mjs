import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-session-persist-'))

function bundle(entry, name) {
  const outfile = join(outDir, name)
  buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent'
  })
  return pathToFileURL(outfile).href
}

const {
  extractCodexSessionId,
  mergeTabPersistState,
  shouldWriteSessionSnapshot,
  startupCommandForRestore
} = await import(bundle(join(root, 'src/shared/sessionPersist.ts'), 'sessionPersist.mjs'))
const { SessionStateService } = await import(
  bundle(join(root, 'src/main/services/SessionStateService.ts'), 'SessionStateService.mjs')
)
const { SessionTool } = await import(bundle(join(root, 'src/shared/sessionState.ts'), 'sessionState.mjs'))

test.after(() => {
  rmSync(outDir, { recursive: true, force: true })
})

test('extractCodexSessionId reads resume ids and ignores --last', () => {
  assert.equal(extractCodexSessionId('codex resume --last'), undefined)
  assert.equal(extractCodexSessionId('codex resume sess-abcd-1234'), 'sess-abcd-1234')
  assert.equal(extractCodexSessionId('codex resume --session-id 0194abcd-ef01-2345'), '0194abcd-ef01-2345')
  assert.equal(extractCodexSessionId('C:\\tools\\codex.exe resume sess-abcd-1234'), 'sess-abcd-1234')
  assert.equal(extractCodexSessionId('codex resume xyz'), undefined)
  assert.equal(extractCodexSessionId('codex resume --flag'), undefined)
})

test('merge keeps sticky tool and cwd when the scan misses or hijacks', () => {
  const known = { cwd: 'C:\\proj-a', tool: SessionTool.Grok }
  const missed = mergeTabPersistState(
    { shellCwd: 'C:\\stale-peb', match: null, aiCwd: null, scannedTool: true },
    known,
    'C:\\Users\\fallback'
  )
  assert.deepEqual(missed.state, known)
  assert.equal(missed.usedFallbackOnly, false)

  const hijack = mergeTabPersistState(
    { shellCwd: 'C:\\stale-peb', match: { tool: SessionTool.Claude }, aiCwd: 'C:\\claude-cwd', scannedTool: true },
    known,
    'C:\\Users\\fallback'
  )
  assert.deepEqual(hijack.state, known)

  const cheap = mergeTabPersistState(
    { shellCwd: 'C:\\stale-peb', match: null, aiCwd: null, scannedTool: false },
    known,
    'C:\\Users\\fallback'
  )
  assert.deepEqual(cheap.state, known)
})

test('merge updates last-known when the same tool is seen again', () => {
  const known = { cwd: 'C:\\old', tool: SessionTool.Codex }
  const next = mergeTabPersistState(
    {
      shellCwd: 'C:\\stale-peb',
      match: { tool: SessionTool.Codex, sessionId: 'sess-abcd-1234' },
      aiCwd: 'C:\\proj-b',
      scannedTool: true
    },
    known,
    'C:\\Users\\fallback'
  )
  assert.equal(next.state.cwd, 'C:\\proj-b')
  assert.equal(next.state.tool, SessionTool.Codex)
  assert.equal(next.state.sessionId, 'sess-abcd-1234')
})

test('dead-PTY fallback is marked so a good file is not overwritten', () => {
  const degraded = mergeTabPersistState(
    { shellCwd: null, match: null, aiCwd: null, scannedTool: true },
    undefined,
    'C:\\Users\\fallback'
  )
  assert.equal(degraded.usedFallbackOnly, true)
  assert.equal(degraded.state.cwd, 'C:\\Users\\fallback')
  assert.equal(degraded.state.tool, SessionTool.None)
})

test('shouldWriteSessionSnapshot blocks unready, empty-live, and all-fallback writes', () => {
  assert.equal(
    shouldWriteSessionSnapshot({ snapshotReady: false, tabCount: 2, quitting: false, allDegradedToFallback: false }),
    false
  )
  assert.equal(
    shouldWriteSessionSnapshot({ snapshotReady: true, tabCount: 0, quitting: false, allDegradedToFallback: false }),
    false
  )
  assert.equal(
    shouldWriteSessionSnapshot({ snapshotReady: true, tabCount: 0, quitting: true, allDegradedToFallback: false }),
    true
  )
  assert.equal(
    shouldWriteSessionSnapshot({ snapshotReady: true, tabCount: 2, quitting: false, allDegradedToFallback: true }),
    false
  )
  assert.equal(
    shouldWriteSessionSnapshot({ snapshotReady: true, tabCount: 2, quitting: true, allDegradedToFallback: false }),
    true
  )
})

test('startupCommandForRestore gives --last to only the active Codex tab', () => {
  assert.equal(
    startupCommandForRestore(SessionTool.Codex, {
      resumeAi: true,
      allowCodexLast: true,
      allowContinue: false
    }),
    'codex resume --last'
  )
  assert.equal(
    startupCommandForRestore(SessionTool.Codex, {
      resumeAi: true,
      allowCodexLast: false,
      allowContinue: true
    }),
    undefined
  )
  assert.equal(
    startupCommandForRestore(SessionTool.Codex, {
      resumeAi: true,
      allowCodexLast: true,
      allowContinue: false,
      sessionId: 'sess-abcd-1234'
    }),
    'codex resume sess-abcd-1234'
  )
  assert.equal(
    startupCommandForRestore(SessionTool.Claude, {
      resumeAi: true,
      allowCodexLast: false,
      allowContinue: true
    }),
    'claude --continue'
  )
  assert.equal(
    startupCommandForRestore(SessionTool.Grok, {
      resumeAi: false,
      allowCodexLast: true,
      allowContinue: true
    }),
    undefined
  )
})

test('startupCommandForRestore withholds --continue from every loser in a cwd group', () => {
  for (const [tool, command] of [
    [SessionTool.Claude, 'claude --continue'],
    [SessionTool.Grok, 'grok --continue'],
    [SessionTool.Kimi, 'kimi --continue']
  ]) {
    assert.equal(
      startupCommandForRestore(tool, {
        resumeAi: true,
        allowCodexLast: false,
        allowContinue: true
      }),
      command
    )
    assert.equal(
      startupCommandForRestore(tool, {
        resumeAi: true,
        allowCodexLast: false,
        allowContinue: false
      }),
      undefined,
      `${command} must not be handed to a second tab in the same directory`
    )
  }
})

test('restore elects one --continue tab per (tool, cwd) group', () => {
  const { dir, filePath } = tempSessionFile()
  const service = new SessionStateService(filePath)
  writeFileSync(
    filePath,
    JSON.stringify({
      Tabs: [
        // Three Grok tabs in one directory: only one may resume.
        { WorkingDirectory: 'D:\\game\\fatality', Tool: SessionTool.Grok },
        { WorkingDirectory: 'D:\\game\\fatality', Tool: SessionTool.Grok },
        { WorkingDirectory: 'D:\\game\\fatality', Tool: SessionTool.Grok },
        // Different directories are independent groups.
        { WorkingDirectory: 'E:\\video\\HVH', Tool: SessionTool.Grok },
        // Same directory, different tool: its own group.
        { WorkingDirectory: 'E:\\video\\HVH', Tool: SessionTool.Claude },
        { WorkingDirectory: 'E:\\video\\HVH', Tool: SessionTool.Claude },
        { WorkingDirectory: 'E:\\ps', Tool: SessionTool.Kimi }
      ],
      ActiveIndex: 2
    })
  )

  const payload = service.loadRestorePayload(true, true)
  const commands = payload.tabs.map((t) => t.startupCommand)

  // The active tab (index 2) wins its group, not the leftmost one.
  assert.deepEqual(commands, [
    undefined,
    undefined,
    'grok --continue',
    'grok --continue',
    'claude --continue',
    undefined,
    'kimi --continue'
  ])
  // Losers still reopen in the right directory, just without resuming.
  assert.equal(payload.tabs[0].cwd, 'D:\\game\\fatality')
  rmSync(dir, { recursive: true, force: true })
})

function tempSessionFile() {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-session-file-'))
  return { dir, filePath: join(dir, 'session-state.json') }
}

test('persist keeps last-known tool and cwd after a later empty scan', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const service = new SessionStateService(filePath)
    assert.equal(
      service.persist(
        [{ id: 'tab-1', shellId: 'pwsh' }],
        0,
        () => 'C:\\stale-peb',
        () => ({ tool: SessionTool.Grok, pid: 11 }),
        () => 'C:\\proj-a',
        { scanTools: true, budgetMs: 2000 }
      ),
      true
    )
    assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).Tabs[0].Tool, SessionTool.Grok)
    assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).Tabs[0].WorkingDirectory, 'C:\\proj-a')

    assert.equal(
      service.persist(
        [{ id: 'tab-1', shellId: 'pwsh' }],
        0,
        () => 'C:\\stale-peb',
        () => null,
        () => null,
        { scanTools: true, budgetMs: 2000 }
      ),
      true
    )
    const second = JSON.parse(readFileSync(filePath, 'utf8'))
    assert.equal(second.Tabs[0].Tool, SessionTool.Grok)
    assert.equal(second.Tabs[0].WorkingDirectory, 'C:\\proj-a')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('empty tabs overwrite the file only on quit', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    writeFileSync(
      filePath,
      JSON.stringify({ Tabs: [{ WorkingDirectory: 'C:\\keep', Tool: SessionTool.Codex }], ActiveIndex: 0 }, null, 2)
    )
    const service = new SessionStateService(filePath)
    assert.equal(
      service.persist([], -1, () => null, () => null, () => null, { scanTools: false, quitting: false }),
      false
    )
    assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).Tabs[0].WorkingDirectory, 'C:\\keep')

    assert.equal(
      service.persist([], -1, () => null, () => null, () => null, { scanTools: false, quitting: true }),
      true
    )
    assert.deepEqual(JSON.parse(readFileSync(filePath, 'utf8')).Tabs, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('dead PTYs do not replace a good snapshot with homedir fallbacks', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    writeFileSync(
      filePath,
      JSON.stringify({ Tabs: [{ WorkingDirectory: 'C:\\keep', Tool: SessionTool.Claude }], ActiveIndex: 0 }, null, 2)
    )
    const service = new SessionStateService(filePath)
    assert.equal(
      service.persist([{ id: 'tab-1' }], 0, () => null, () => null, () => null, { scanTools: true, budgetMs: 2000 }),
      false
    )
    assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).Tabs[0].WorkingDirectory, 'C:\\keep')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('persist stores a Codex session id and restore uses it instead of --last', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const service = new SessionStateService(filePath)
    service.persist(
      [
        { id: 'tab-1', shellId: 'pwsh' },
        { id: 'tab-2', shellId: 'pwsh' },
        { id: 'tab-3', shellId: 'pwsh' }
      ],
      1,
      (id) => `C:\\${id}`,
      (id) =>
        id === 'tab-2'
          ? { tool: SessionTool.Codex, pid: 22, sessionId: 'sess-abcd-1234' }
          : { tool: SessionTool.Codex, pid: 21 },
      () => null,
      { scanTools: true, budgetMs: 2000 }
    )
    const saved = JSON.parse(readFileSync(filePath, 'utf8'))
    assert.equal(saved.Tabs[1].SessionId, 'sess-abcd-1234')

    const payload = service.loadRestorePayload(true, true)
    assert.equal(payload.tabs[0].startupCommand, undefined)
    assert.equal(payload.tabs[1].startupCommand, 'codex resume sess-abcd-1234')
    assert.equal(payload.tabs[2].startupCommand, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('three Codex tabs without session ids: only the active tab gets --last', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    writeFileSync(
      filePath,
      JSON.stringify(
        {
          Tabs: [
            { WorkingDirectory: 'C:\\a', Tool: SessionTool.Codex, ShellId: 'pwsh' },
            { WorkingDirectory: 'C:\\b', Tool: SessionTool.Codex, ShellId: 'pwsh' },
            { WorkingDirectory: 'C:\\c', Tool: SessionTool.Codex, ShellId: 'pwsh' }
          ],
          ActiveIndex: 2
        },
        null,
        2
      )
    )
    const payload = new SessionStateService(filePath).loadRestorePayload(true, true)
    assert.equal(payload.tabs[0].startupCommand, undefined)
    assert.equal(payload.tabs[1].startupCommand, undefined)
    assert.equal(payload.tabs[2].startupCommand, 'codex resume --last')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
