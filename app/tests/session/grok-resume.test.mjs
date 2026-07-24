import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-grok-resume-'))

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

const { SessionStateService } = await import(
  bundle(join(root, 'src/main/services/SessionStateService.ts'), 'SessionStateService.mjs')
)
const { identifyToolFromCommandLine, AI_CLI_TOOLS } = await import(
  bundle(join(root, 'src/shared/aiCliTools.ts'), 'aiCliTools.mjs')
)
const { SessionTool } = await import(
  bundle(join(root, 'src/shared/sessionState.ts'), 'sessionState.mjs')
)

test.after(() => {
  rmSync(outDir, { recursive: true, force: true })
})

test('identifyToolFromCommandLine recognizes Grok Build CLI process lines', () => {
  assert.equal(identifyToolFromCommandLine('C:\\Users\\x\\.grok\\bin\\grok.exe'), 'grok')
  assert.equal(identifyToolFromCommandLine('"C:\\Users\\x\\.grok\\bin\\grok.exe" --continue'), 'grok')
  assert.equal(identifyToolFromCommandLine('grok --continue'), 'grok')
  assert.equal(identifyToolFromCommandLine('npx grok --resume'), 'grok')
  // Must not confuse substrings inside other executable names
  assert.equal(identifyToolFromCommandLine('C:\\tools\\agrok.exe'), null)
  assert.equal(identifyToolFromCommandLine('C:\\tools\\grokhelper.exe'), null)
})

test('AI CLI priority list includes grok after codex and claude', () => {
  assert.deepEqual([...AI_CLI_TOOLS], ['codex', 'claude', 'grok'])
  assert.equal(identifyToolFromCommandLine('codex resume --last'), 'codex')
  assert.equal(identifyToolFromCommandLine('claude --continue'), 'claude')
  assert.equal(identifyToolFromCommandLine('grok -c'), 'grok')
})

test('SessionTool.Grok is a stable persisted enum value', () => {
  assert.equal(SessionTool.Grok, 3)
  assert.equal(SessionTool.Codex, 1)
  assert.equal(SessionTool.Claude, 2)
})

test('restore injects grok --continue for Grok tabs when resume is enabled', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-session-'))
  const filePath = join(dir, 'session-state.json')
  try {
    writeFileSync(
      filePath,
      JSON.stringify(
        {
          Tabs: [
            { WorkingDirectory: 'C:\\proj', Tool: SessionTool.Grok, ShellId: 'pwsh' },
            { WorkingDirectory: 'C:\\proj', Tool: SessionTool.Claude, ShellId: 'pwsh' },
            { WorkingDirectory: 'C:\\proj', Tool: SessionTool.Codex, ShellId: 'pwsh' },
            { WorkingDirectory: 'C:\\proj', Tool: SessionTool.None, ShellId: 'pwsh' }
          ],
          ActiveIndex: 0
        },
        null,
        2
      ),
      'utf8'
    )

    const service = new SessionStateService(filePath)
    const payload = service.loadRestorePayload(true, true)
    assert.ok(payload)
    assert.equal(payload.tabs[0].startupCommand, 'grok --continue')
    assert.equal(payload.tabs[1].startupCommand, 'claude --continue')
    assert.equal(payload.tabs[2].startupCommand, 'codex resume --last')
    assert.equal(payload.tabs[3].startupCommand, undefined)

    const noResume = service.loadRestorePayload(true, false)
    assert.ok(noResume)
    assert.equal(noResume.tabs[0].startupCommand, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
