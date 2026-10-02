import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-claude-bg-'))

function bundle(entry, name) {
  const outfile = join(outDir, name)
  buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
  return pathToFileURL(outfile).href
}

const {
  continuedInFromTranscriptTail,
  extractClaudeAttachJobId,
  resolveClaudeRestoreTarget,
  startupCommandForRestore
} = await import(bundle(join(root, 'src/shared/sessionPersist.ts'), 'sessionPersist.mjs'))
const { ClaudeTranscripts, parseAgentsJson } = await import(
  bundle(join(root, 'src/main/services/ClaudeBackgroundJobs.ts'), 'ClaudeBackgroundJobs.mjs')
)
const { SessionStateService } = await import(
  bundle(join(root, 'src/main/services/SessionStateService.ts'), 'SessionStateService.mjs')
)
const { SessionTool } = await import(bundle(join(root, 'src/shared/sessionState.ts'), 'sessionState.mjs'))

test.after(() => rmSync(outDir, { recursive: true, force: true }))

const A = '2795737e-71eb-4162-85c8-8107c78606d8'
const B = 'acf22d95-f6a7-4fd8-a370-ff540e59e749'
const C = '8f054612-04dd-4978-8350-2e4c61a29ebd'

const line = (o) => JSON.stringify(o)
const handoff = (from, to) => line({ type: 'continued-in', sessionId: from, continuedInSessionId: to })

test('a handoff at the end of a transcript is followed', () => {
  const tail = [
    '{"type":"user","message":"cut by the tail win', // partial first line
    line({ type: 'user', sessionId: A }),
    line({ type: 'assistant', sessionId: A }),
    line({ type: 'cost-state', sessionId: A }),
    handoff(A, B),
    line({ type: 'last-prompt', sessionId: A })
  ].join('\n')
  assert.equal(continuedInFromTranscriptTail(tail, A), B)
})

test('conversation after a handoff means the original was kept in use', () => {
  const tail = [handoff(A, B), line({ type: 'user', sessionId: A })].join('\n')
  assert.equal(continuedInFromTranscriptTail(tail, A), undefined)
})

test('a handoff record of another session is ignored', () => {
  assert.equal(continuedInFromTranscriptTail(handoff(C, B), A), undefined)
})

test('the saved id itself owned by a live job is attached', () => {
  const target = resolveClaudeRestoreTarget(B, [{ id: 'acf22d95', sessionId: B }], () => undefined)
  assert.deepEqual(target, { kind: 'attach', jobId: 'acf22d95', sessionId: B })
})

test('a handed-off conversation is attached in its live job', () => {
  const chain = { [A]: B }
  const target = resolveClaudeRestoreTarget(A, [{ id: 'acf22d95', sessionId: B }], (id) => chain[id])
  assert.deepEqual(target, { kind: 'attach', jobId: 'acf22d95', sessionId: B })
})

test('a handed-off conversation whose job ended resumes the newest copy', () => {
  const chain = { [A]: B, [B]: C }
  assert.deepEqual(resolveClaudeRestoreTarget(A, [], (id) => chain[id]), { kind: 'resume', sessionId: C })
})

test('no job and no handoff keeps the saved id; cycles stop', () => {
  assert.deepEqual(resolveClaudeRestoreTarget(A, [], () => undefined), { kind: 'resume', sessionId: A })
  const loop = { [A]: B, [B]: A }
  assert.equal(resolveClaudeRestoreTarget(A, [], (id) => loop[id]).kind, 'resume')
})

test('restore command attaches a background job instead of resuming', () => {
  const base = { resumeAi: true, sessionId: B, allowCodexLast: false, allowContinue: false, claudeSettings: 'C:\\s.json' }
  assert.equal(startupCommandForRestore(SessionTool.Claude, { ...base, claudeAttachJobId: 'acf22d95' }), 'claude attach acf22d95')
  assert.equal(
    startupCommandForRestore(SessionTool.Claude, { ...base, claudeAttachJobId: '--evil' }),
    `claude --resume ${B} --settings "C:\\s.json"`
  )
  assert.equal(startupCommandForRestore(SessionTool.Claude, { ...base, resumeAi: false, claudeAttachJobId: 'acf22d95' }), undefined)
})

test('attach job id is read from the wrapped command line', () => {
  assert.equal(
    extractClaudeAttachJobId('"C:\\bin\\claude.exe" --settings C:\\zinc\\settings.json attach 8f054612'),
    '8f054612'
  )
  assert.equal(extractClaudeAttachJobId('claude.exe --resume 8f054612-04dd'), undefined)
  assert.equal(extractClaudeAttachJobId('claude.exe -p "please attach deadbeef"'), undefined)
})

test('only live background jobs come out of claude agents --json', () => {
  const rows = [
    { pid: 1, id: 'acf22d95', kind: 'background', sessionId: B },
    { id: '8f054612', kind: 'background', sessionId: C, state: 'stopped' },
    { pid: 2, kind: 'interactive', sessionId: A },
    { pid: 3, id: 'NOTHEX!!', kind: 'background', sessionId: A }
  ]
  assert.deepEqual(parseAgentsJson(JSON.stringify(rows)), [{ id: 'acf22d95', sessionId: B }])
  assert.deepEqual(parseAgentsJson('[]'), [])
  // Unknown is not empty: the caller must keep the saved ids then.
  assert.equal(parseAgentsJson('not json'), null)
  assert.equal(parseAgentsJson('{"error":1}'), null)
})

test('a duplicate in another directory does not fall back to --continue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-claude-restore-'))
  try {
    const filePath = join(dir, 'session-state.json')
    const x = mkdtempSync(join(dir, 'x-'))
    const y = mkdtempSync(join(dir, 'y-'))
    writeFileSync(filePath, JSON.stringify({
      Tabs: [
        { WorkingDirectory: x, Tool: SessionTool.Claude, ShellId: 'pwsh', SessionId: A },
        { WorkingDirectory: y, Tool: SessionTool.Claude, ShellId: 'pwsh', SessionId: B }
      ],
      ActiveIndex: 0
    }))
    const service = new SessionStateService(filePath)
    const chain = { [A]: B }
    const payload = service.loadRestorePayload(true, true, (id) => resolveClaudeRestoreTarget(id, [], (s) => chain[s]))
    assert.deepEqual(payload.tabs.map((t) => t.startupCommand), [`claude --resume ${B}`, undefined])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('transcripts are found by project dir or scan, and a handoff needs its target on disk', () => {
  const projects = mkdtempSync(join(tmpdir(), 'zinc-claude-projects-'))
  try {
    const cwd = 'C:\\Users\\agent\\work\\proj-a'
    const dir = join(projects, 'C--Users-agent-work-proj-a')
    mkdirSync(dir)
    writeFileSync(join(dir, `${A}.jsonl`), [line({ type: 'user', sessionId: A }), handoff(A, B)].join('\n'))
    const transcripts = new ClaudeTranscripts(projects)
    assert.equal(transcripts.continuedIn(A, cwd), undefined, 'B never reached disk')

    const other = join(projects, 'elsewhere')
    mkdirSync(other)
    writeFileSync(join(other, `${B}.jsonl`), line({ type: 'user', sessionId: B }))
    assert.equal(new ClaudeTranscripts(projects).continuedIn(A, cwd), B)
  } finally {
    rmSync(projects, { recursive: true, force: true })
  }
})

test('restore payload attaches resolved jobs and never opens one conversation twice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-claude-restore-'))
  try {
    const filePath = join(dir, 'session-state.json')
    const cwd = mkdtempSync(join(dir, 'proj-'))
    writeFileSync(filePath, JSON.stringify({
      Tabs: [
        { WorkingDirectory: cwd, Tool: SessionTool.Claude, ShellId: 'pwsh', SessionId: A },
        { WorkingDirectory: cwd, Tool: SessionTool.Claude, ShellId: 'pwsh', SessionId: B },
        { WorkingDirectory: cwd, Tool: SessionTool.Claude, ShellId: 'pwsh', SessionId: C }
      ],
      ActiveIndex: 0
    }))
    const service = new SessionStateService(filePath, () => 'C:\\s.json')
    assert.equal(service.hasClaudeSessionIds(), true)
    const chain = { [A]: B }
    const jobs = [{ id: 'acf22d95', sessionId: B }]
    const payload = service.loadRestorePayload(true, true, (id) => resolveClaudeRestoreTarget(id, jobs, (s) => chain[s]))
    assert.deepEqual(payload.tabs.map((t) => t.startupCommand), [
      'claude attach acf22d95',
      undefined, // B already attached by the active tab
      `claude --resume ${C} --settings "C:\\s.json"`
    ])

    // The resolved id is what the next persist keeps for the attached tab.
    service.bindRestoredTabs([{ id: 't1', shellId: 'pwsh' }, { id: 't2', shellId: 'pwsh' }, { id: 't3', shellId: 'pwsh' }])
    assert.equal(service.peekLastKnown('t1').sessionId, B)
    assert.equal(service.peekLastKnown('t2').sessionId, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
