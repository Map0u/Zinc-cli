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
  assert.equal(extractCodexSessionId('cmd /c "codex resume sess-abcd-1234"'), 'sess-abcd-1234')
  assert.equal(extractCodexSessionId('codex resume xyz'), undefined)
  assert.equal(extractCodexSessionId('codex resume --flag'), undefined)
})

test('extractCodexSessionId ignores resume ids inside quoted prompts', () => {
  assert.equal(extractCodexSessionId('codex exec "Run codex resume sess-prompt-1234 in your example"'), undefined)
  assert.equal(extractCodexSessionId('codex "Try resume sess-prompt-1234 next"'), undefined)
  assert.equal(extractCodexSessionId('codex resume "sess-real-1234"'), 'sess-real-1234')
  assert.equal(extractCodexSessionId('"C:\\Program Files\\codex.exe" resume sess-real-1234'), 'sess-real-1234')
})

test('merge clears an exited tool but guards hijacks and cheap scans', () => {
  const known = { cwd: 'C:\\proj-a', tool: SessionTool.Grok }
  const missed = mergeTabPersistState(
    { shellCwd: 'C:\\stale-peb', match: null, aiCwd: null, scannedTool: true },
    known,
    'C:\\Users\\fallback'
  )
  assert.deepEqual(missed.state, { cwd: 'C:\\stale-peb', tool: SessionTool.None })
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
  try {
    const grokCwd = mkdtempSync(join(dir, 'grok-'))
    const sharedCwd = mkdtempSync(join(dir, 'shared-'))
    const kimiCwd = mkdtempSync(join(dir, 'kimi-'))
    const service = new SessionStateService(filePath)
    writeFileSync(
      filePath,
      JSON.stringify({
        Tabs: [
          // Three Grok tabs in one directory: only one may resume.
          { WorkingDirectory: grokCwd, Tool: SessionTool.Grok },
          { WorkingDirectory: grokCwd, Tool: SessionTool.Grok },
          { WorkingDirectory: grokCwd, Tool: SessionTool.Grok },
          // Different directories are independent groups.
          { WorkingDirectory: sharedCwd, Tool: SessionTool.Grok },
          // Same directory, different tool: its own group.
          { WorkingDirectory: sharedCwd, Tool: SessionTool.Claude },
          { WorkingDirectory: sharedCwd, Tool: SessionTool.Claude },
          { WorkingDirectory: kimiCwd, Tool: SessionTool.Kimi }
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
    assert.equal(payload.tabs[0].cwd, grokCwd)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempSessionFile() {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-session-file-'))
  return { dir, filePath: join(dir, 'session-state.json') }
}

test('load, bind new tab ids, then cheap persist preserves restored cwd/tool/session ids', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const claudeCwd = mkdtempSync(join(dir, 'claude-'))
    const codexCwd = mkdtempSync(join(dir, 'codex-'))
    const original = {
      Tabs: [
        { WorkingDirectory: claudeCwd, Tool: SessionTool.Claude, ShellId: 'pwsh', SessionId: 'aaaaaaaa-1111-4111-8111-111111111111' },
        { WorkingDirectory: codexCwd, Tool: SessionTool.Codex, ShellId: 'cmd', SessionId: 'sess-abcd-1234' }
      ],
      ActiveIndex: 1
    }
    writeFileSync(filePath, JSON.stringify(original))
    const service = new SessionStateService(filePath)
    const payload = service.loadRestorePayload(true, true)
    assert.deepEqual(payload.tabs.map((tab) => tab.cwd), [claudeCwd, codexCwd])
    assert.deepEqual(payload.tabs.map((tab) => tab.startupCommand), [
      'claude --resume aaaaaaaa-1111-4111-8111-111111111111',
      'codex resume sess-abcd-1234'
    ])
    const freshTabs = [{ id: 'fresh-claude', shellId: 'pwsh' }, { id: 'fresh-codex', shellId: 'cmd' }]
    service.bindRestoredTabs(freshTabs)
    assert.equal(
      service.persist(
        freshTabs, payload.activeIndex,
        () => dir, // A newly spawned shell has not yet entered its restored cwd.
        () => { throw new Error('cheap persist must not scan tools') },
        () => null,
        { scanTools: false }
      ),
      true
    )
    assert.deepEqual(JSON.parse(readFileSync(filePath, 'utf8')), original)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('persist clears exited tool and updates cwd after a completed empty scan', () => {
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
    assert.equal(second.Tabs[0].Tool, SessionTool.None)
    assert.equal(second.Tabs[0].WorkingDirectory, 'C:\\stale-peb')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an idle tab keeps its conversation id after the AI process exits', () => {
  // Regression: a tab whose Claude was quit hours ago must still resume on the
  // next start. The conversation lives on disk, so a completed scan that finds
  // no AI process is not evidence the identity went stale.
  const known = {
    cwd: 'C:\\proj-a',
    tool: SessionTool.Claude,
    sessionId: 'aaaaaaaa-1111-4111-8111-111111111111'
  }
  const afterQuit = mergeTabPersistState(
    { shellCwd: 'C:\\proj-a', match: null, aiCwd: null, ptyAlive: true, scannedTool: true },
    known,
    'C:\\Users\\fallback'
  )
  assert.deepEqual(afterQuit.state, known)
  assert.equal(afterQuit.usedFallbackOnly, false)

  // Still resumable: the kept id produces an exact resume, not a bare shell.
  assert.equal(
    startupCommandForRestore(afterQuit.state.tool, {
      resumeAi: true,
      sessionId: afterQuit.state.sessionId,
      allowCodexLast: false,
      allowContinue: false
    }),
    'claude --resume aaaaaaaa-1111-4111-8111-111111111111'
  )
})

test('a partly idle window restores every conversation on the next start', () => {
  // The reported bug: of several tabs in one directory, only the ones whose
  // Claude was still running came back. Idle tabs lost their id on the quit
  // persist, so the next start reopened them as bare shells.
  const { dir, filePath } = tempSessionFile()
  try {
    const project = mkdtempSync(join(dir, 'project-'))
    const service = new SessionStateService(filePath)
    const tabs = [
      { id: 'tab-1', shellId: 'pwsh' },
      { id: 'tab-2', shellId: 'pwsh' },
      { id: 'tab-3', shellId: 'pwsh' },
      { id: 'tab-4', shellId: 'pwsh' }
    ]
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444'
    ]
    ids.forEach((sessionId, index) => {
      service.persist(
        tabs,
        0,
        () => project,
        (id) => (id === tabs[index].id
          ? { tool: SessionTool.Claude, pid: 100 + index, sessionId }
          : null),
        () => project,
        { scanTools: true, budgetMs: 2000 }
      )
    })
    // Quitting: tabs 1 and 4 still run Claude, 2 and 3 have been idle for hours.
    service.persist(
      tabs,
      0,
      () => project,
      (id) => (id === 'tab-1' || id === 'tab-4'
        ? { tool: SessionTool.Claude, pid: 1, sessionId: ids[Number(id.slice(-1)) - 1] }
        : null),
      (pid) => project,
      { scanTools: true, budgetMs: 2000, quitting: true }
    )

    const saved = JSON.parse(readFileSync(filePath, 'utf8'))
    assert.deepEqual(saved.Tabs.map((t) => t.Tool), [2, 2, 2, 2])
    assert.deepEqual(saved.Tabs.map((t) => t.SessionId), ids)

    // A fresh service reads it exactly as a restart would.
    const restored = new SessionStateService(filePath).loadRestorePayload(true, true)
    restored.tabs.forEach((tab, index) => {
      assert.equal(
        tab.startupCommand,
        `claude --resume ${ids[index]}`,
        `tab ${index + 1} did not resume its own conversation`
      )
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an exited tool without a session id is still cleared', () => {
  // No id means nothing exact to resume; the sticky tool would be a guess.
  const cleared = mergeTabPersistState(
    { shellCwd: 'C:\\proj-a', match: null, aiCwd: null, ptyAlive: true, scannedTool: true },
    { cwd: 'C:\\proj-a', tool: SessionTool.Grok },
    'C:\\Users\\fallback'
  )
  assert.deepEqual(cleared.state, { cwd: 'C:\\proj-a', tool: SessionTool.None })
})

test('cheap and throwing scans retain sticky tool, cwd and session id', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const shellCwd = mkdtempSync(join(dir, 'shell-'))
    const aiCwd = mkdtempSync(join(dir, 'ai-'))
    const service = new SessionStateService(filePath)
    const tabs = [{ id: 'tab-1', shellId: 'pwsh' }]
    assert.equal(
      service.persist(
        tabs,
        0,
        () => shellCwd,
        () => ({ tool: SessionTool.Claude, pid: 11, sessionId: 'aaaaaaaa-1111-4111-8111-111111111111' }),
        () => aiCwd,
        { scanTools: true, budgetMs: 2000 }
      ),
      true
    )
    for (const [options, detect] of [
      [{ scanTools: false }, () => null],
      [{ scanTools: true, budgetMs: 2000 }, () => { throw new Error('scan failed') }]
    ]) {
      assert.equal(service.persist(tabs, 0, () => shellCwd, detect, () => null, options), true)
      assert.deepEqual(JSON.parse(readFileSync(filePath, 'utf8')).Tabs[0], {
        WorkingDirectory: aiCwd,
        Tool: SessionTool.Claude,
        ShellId: 'pwsh',
        SessionId: 'aaaaaaaa-1111-4111-8111-111111111111'
      })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a new same-tool process without an id cannot inherit the old conversation id', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const cwd = mkdtempSync(join(dir, 'project-'))
    const service = new SessionStateService(filePath)
    const tabs = [{ id: 'tab-1', shellId: 'pwsh' }]
    service.persist(
      tabs,
      0,
      () => cwd,
      () => ({ tool: SessionTool.Claude, pid: 11, sessionId: 'aaaaaaaa-1111-4111-8111-111111111111' }),
      () => cwd,
      { scanTools: true, budgetMs: 2000 }
    )
    service.persist(
      tabs,
      0,
      () => cwd,
      () => ({ tool: SessionTool.Claude, pid: 12 }),
      () => cwd,
      { scanTools: true, budgetMs: 2000 }
    )
    const saved = JSON.parse(readFileSync(filePath, 'utf8')).Tabs[0]
    assert.equal(saved.Tool, SessionTool.Claude)
    assert.equal(saved.SessionId, undefined)
    assert.equal(service.loadRestorePayload(true, true).tabs[0].startupCommand, 'claude --continue')
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

test('a partly degraded multi-tab persist leaves the source snapshot untouched', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const cwd = mkdtempSync(join(dir, 'project-'))
    const original = JSON.stringify({
      Tabs: [
        { WorkingDirectory: cwd, Tool: SessionTool.Claude, SessionId: 'aaaaaaaa-1111-4111-8111-111111111111' },
        { WorkingDirectory: cwd, Tool: SessionTool.Codex, SessionId: 'sess-abcd-1234' }
      ],
      ActiveIndex: 1
    }, null, 2)
    writeFileSync(filePath, original)
    const service = new SessionStateService(filePath)
    assert.equal(
      service.persist(
        [{ id: 'live', shellId: 'pwsh' }, { id: 'dead', shellId: 'pwsh' }],
        0,
        (id) => id === 'live' ? cwd : null,
        (id) => id === 'live' ? { tool: SessionTool.Claude, pid: 10, sessionId: 'bbbbbbbb-2222-4222-8222-222222222222' } : null,
        () => cwd,
        { scanTools: true, budgetMs: 2000 }
      ),
      false
    )
    assert.equal(readFileSync(filePath, 'utf8'), original)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('persist stores a Codex session id and restore uses it instead of --last', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const cwdByTab = new Map(
      ['tab-1', 'tab-2', 'tab-3'].map((id) => [id, mkdtempSync(join(dir, `${id}-`))])
    )
    const service = new SessionStateService(filePath)
    service.persist(
      [
        { id: 'tab-1', shellId: 'pwsh' },
        { id: 'tab-2', shellId: 'pwsh' },
        { id: 'tab-3', shellId: 'pwsh' }
      ],
      1,
      (id) => cwdByTab.get(id),
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
    const cwds = ['a-', 'b-', 'c-'].map((prefix) => mkdtempSync(join(dir, prefix)))
    writeFileSync(
      filePath,
      JSON.stringify(
        {
          Tabs: cwds.map((cwd) => ({ WorkingDirectory: cwd, Tool: SessionTool.Codex, ShellId: 'pwsh' })),
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

test('restore reads UTF-16LE/BE snapshots with and without a BOM', () => {
  for (const [encoding, bom] of [
    ['le', true], ['be', true], ['le', false], ['be', false]
  ]) {
    const { dir, filePath } = tempSessionFile()
    try {
      const cwd = mkdtempSync(join(dir, 'project-'))
      const json = JSON.stringify({
        Tabs: [{ WorkingDirectory: cwd, Tool: SessionTool.Claude, SessionId: 'aaaaaaaa-1111-4111-8111-111111111111' }],
        ActiveIndex: 0
      })
      const body = Buffer.from(json, 'utf16le')
      if (encoding === 'be') body.swap16()
      const bytes = bom
        ? Buffer.concat([Buffer.from(encoding === 'le' ? [0xff, 0xfe] : [0xfe, 0xff]), body])
        : body
      writeFileSync(filePath, bytes)
      const payload = new SessionStateService(filePath).loadRestorePayload(true, true)
      assert.equal(payload?.tabs[0]?.cwd, cwd, `${encoding}, BOM=${bom}`)
      assert.equal(payload?.tabs[0]?.startupCommand, 'claude --resume aaaaaaaa-1111-4111-8111-111111111111')
      assert.deepEqual(readFileSync(filePath), bytes)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('corrupt session bytes preserve an existing .bak and do not rewrite the source', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const broken = Buffer.from([0xff, 0xfe, 0x7b]) // Truncated UTF-16 JSON.
    const backup = Buffer.from('previous backup, do not replace')
    writeFileSync(filePath, broken)
    writeFileSync(`${filePath}.bak`, backup)
    const originalWarn = console.warn
    try {
      console.warn = () => {}
      assert.equal(new SessionStateService(filePath).loadRestorePayload(true, true), null)
    } finally {
      console.warn = originalWarn
    }
    assert.deepEqual(readFileSync(filePath), broken)
    assert.deepEqual(readFileSync(`${filePath}.bak`), backup)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─── Per-conversation Claude restore (the 0.6.12 fix) ───────────────────────

test('a persisted Claude session id restores with --resume, not --continue', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const cwd = mkdtempSync(join(dir, 'project-'))
    writeFileSync(
      filePath,
      JSON.stringify({
        Tabs: [{ WorkingDirectory: cwd, Tool: SessionTool.Claude, SessionId: '37f38806-ca44-4d74-95cd-705242e8de82' }],
        ActiveIndex: 0
      })
    )
    const payload = new SessionStateService(filePath).loadRestorePayload(true, true)
    assert.match(payload.tabs[0].startupCommand, /^claude --resume 37f38806-ca44-4d74-95cd-705242e8de82/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('several Claude tabs in one directory each restore their own conversation', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const cwd = mkdtempSync(join(dir, 'project-'))
    writeFileSync(
      filePath,
      JSON.stringify({
        Tabs: [
          { WorkingDirectory: cwd, Tool: SessionTool.Claude, SessionId: 'aaaaaaaa-1111-4111-8111-111111111111' },
          { WorkingDirectory: cwd, Tool: SessionTool.Claude, SessionId: 'bbbbbbbb-2222-4222-8222-222222222222' },
          { WorkingDirectory: cwd, Tool: SessionTool.Claude, SessionId: 'cccccccc-3333-4333-8333-333333333333' },
          { WorkingDirectory: cwd, Tool: SessionTool.Claude, SessionId: 'dddddddd-4444-4444-8444-444444444444' }
        ],
        ActiveIndex: 1
      })
    )
    const payload = new SessionStateService(filePath).loadRestorePayload(true, true)
    const commands = payload.tabs.map((t) => t.startupCommand)
    // Each distinct session id resumes its own conversation — no collapsing.
    assert.equal(commands[0], 'claude --resume aaaaaaaa-1111-4111-8111-111111111111')
    assert.equal(commands[1], 'claude --resume bbbbbbbb-2222-4222-8222-222222222222')
    assert.equal(commands[2], 'claude --resume cccccccc-3333-4333-8333-333333333333')
    assert.equal(commands[3], 'claude --resume dddddddd-4444-4444-8444-444444444444')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('duplicate Claude session ids are claimed by the active tab, not the first row', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const cwd = mkdtempSync(join(dir, 'project-'))
    writeFileSync(filePath, JSON.stringify({
      Tabs: [
        { WorkingDirectory: cwd, Tool: SessionTool.Claude, SessionId: 'AAAAAAAA-1111-4111-8111-111111111111' },
        { WorkingDirectory: cwd, Tool: SessionTool.Claude, SessionId: 'bbbbbbbb-2222-4222-8222-222222222222' },
        { WorkingDirectory: cwd, Tool: SessionTool.Claude, SessionId: 'aaaaaaaa-1111-4111-8111-111111111111' }
      ],
      ActiveIndex: 2
    }))
    const payload = new SessionStateService(filePath).loadRestorePayload(true, true)
    assert.deepEqual(payload.tabs.map((tab) => tab.startupCommand), [
      undefined,
      'claude --resume bbbbbbbb-2222-4222-8222-222222222222',
      'claude --resume aaaaaaaa-1111-4111-8111-111111111111'
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('claude restore commands carry the injected --settings hook path', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const cwd = mkdtempSync(join(dir, 'project-'))
    const otherCwd = mkdtempSync(join(dir, 'other-'))
    writeFileSync(
      filePath,
      JSON.stringify({
        Tabs: [
          { WorkingDirectory: cwd, Tool: SessionTool.Claude, SessionId: 'aaaaaaaa-1111-4111-8111-111111111111' },
          { WorkingDirectory: cwd, Tool: SessionTool.Claude },
          { WorkingDirectory: otherCwd, Tool: SessionTool.Claude }
        ],
        ActiveIndex: 0
      })
    )
    const service = new SessionStateService(filePath, () => 'C:/Users/Example/AppData/Roaming/zinc/session-hooks/settings.json')
    const payload = service.loadRestorePayload(true, true)
    assert.equal(
      payload.tabs[0].startupCommand,
      'claude --resume aaaaaaaa-1111-4111-8111-111111111111 --settings "C:/Users/Example/AppData/Roaming/zinc/session-hooks/settings.json"'
    )
    assert.equal(payload.tabs[1].startupCommand, undefined)
    assert.equal(
      payload.tabs[2].startupCommand,
      'claude --continue --settings "C:/Users/Example/AppData/Roaming/zinc/session-hooks/settings.json"'
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('removed cwd reopens a shell without resuming the old Claude conversation', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const removedCwd = mkdtempSync(join(dir, 'removed-'))
    writeFileSync(
      filePath,
      JSON.stringify({
        Tabs: [{ WorkingDirectory: removedCwd, Tool: SessionTool.Claude, SessionId: 'aaaaaaaa-1111-4111-8111-111111111111' }],
        ActiveIndex: 0
      })
    )
    rmSync(removedCwd, { recursive: true, force: true })
    const payload = new SessionStateService(filePath).loadRestorePayload(true, true)
    assert.equal(payload.tabs[0].cwd, removedCwd)
    assert.equal(payload.tabs[0].startupCommand, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a cwd replaced by a regular file never starts the previous AI conversation', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const cwd = join(dir, 'former-project')
    writeFileSync(cwd, 'not a directory')
    writeFileSync(filePath, JSON.stringify({
      Tabs: [{ WorkingDirectory: cwd, Tool: SessionTool.Claude, SessionId: 'aaaaaaaa-1111-4111-8111-111111111111' }],
      ActiveIndex: 0
    }))
    assert.equal(new SessionStateService(filePath).loadRestorePayload(true, true).tabs[0].startupCommand, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mixed known/unknown Claude tabs in one cwd do not collide', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const cwd = mkdtempSync(join(dir, 'project-'))
    writeFileSync(
      filePath,
      JSON.stringify({
        Tabs: [
          { WorkingDirectory: cwd, Tool: SessionTool.Claude, SessionId: 'aaaaaaaa-1111-4111-8111-111111111111' },
          { WorkingDirectory: cwd, Tool: SessionTool.Claude, SessionId: 'bbbbbbbb-2222-4222-8222-222222222222' },
          { WorkingDirectory: cwd, Tool: SessionTool.Claude } // unknown: stay a plain shell
        ],
        ActiveIndex: 0
      })
    )
    const payload = new SessionStateService(filePath).loadRestorePayload(true, true)
    assert.equal(payload.tabs[0].startupCommand, 'claude --resume aaaaaaaa-1111-4111-8111-111111111111')
    assert.equal(payload.tabs[1].startupCommand, 'claude --resume bbbbbbbb-2222-4222-8222-222222222222')
    assert.equal(payload.tabs[2].startupCommand, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
