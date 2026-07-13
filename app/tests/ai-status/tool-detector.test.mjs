import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const sourceUrl = new URL('../../src/main/services/ToolDetector.ts', import.meta.url)
const originalSource = await readFile(sourceUrl, 'utf8')
const commandLines = new Map()

// Keep the production detector intact while replacing its OS command-line
// lookup with deterministic test data. This exercises the real exported
// traversal, matching, priority, and runtime-classification implementation.
const testableSource = originalSource
  .replace(
    'import koffi from "koffi";',
    'const koffi = { load: () => { throw new Error("unused in deterministic tests") }, struct: () => ({}), sizeof: () => 0 };'
  )
  .replace(
    /import \{ getProcessCommandLine \} from "\.\.\/processCwd";/,
    'const getProcessCommandLine = (pid: number): string | null => globalThis.__zincToolDetectorCommands.get(pid) ?? null;'
  )
assert.notEqual(testableSource, originalSource, 'ToolDetector command-line import seam was applied')

const transpiled = ts.transpileModule(testableSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText

globalThis.__zincToolDetectorCommands = commandLines
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`
const { detectActiveToolMatch } = await import(moduleUrl)

function detect(rows, entries, shellPid = 100) {
  commandLines.clear()
  for (const [pid, commandLine] of entries) commandLines.set(pid, commandLine)
  return detectActiveToolMatch(shellPid, rows)
}

test('Codex has deterministic priority even when Claude appears first in the process table', () => {
  const rows = [
    { pid: 201, ppid: 100, exe: 'node.exe' },
    { pid: 202, ppid: 100, exe: 'node.exe' }
  ]
  assert.deepEqual(
    detect(rows, [
      [201, 'node C:\\tools\\claude.cmd'],
      [202, 'node C:\\tools\\codex.cmd']
    ]),
    { tool: 'codex', pid: 202, runtime: 'native' }
  )
})

test('tool names require command-line token boundaries', () => {
  const rows = [
    { pid: 210, ppid: 100, exe: 'node.exe' },
    { pid: 211, ppid: 100, exe: 'node.exe' },
    { pid: 212, ppid: 100, exe: 'node.exe' }
  ]
  assert.equal(
    detect(rows, [
      [210, 'node C:\\tools\\mycodex.cmd'],
      [211, 'node C:\\tools\\claude-helper.exe'],
      [212, 'node --label=codexical']
    ]),
    null
  )
  assert.deepEqual(
    detect(rows, [[211, 'node "C:\\Program Files\\Claude\\claude.cmd" --resume']]),
    { tool: 'claude', pid: 211, runtime: 'native' }
  )
})

test('classifies descendants of a WSL launcher separately from native tools', () => {
  const rows = [
    { pid: 220, ppid: 100, exe: 'wsl.exe' },
    { pid: 221, ppid: 220, exe: 'node' },
    { pid: 222, ppid: 100, exe: 'node.exe' }
  ]
  assert.deepEqual(detect(rows, [[221, '/usr/bin/node /usr/bin/codex']]), {
    tool: 'codex',
    pid: 221,
    runtime: 'wsl'
  })
  assert.deepEqual(detect(rows, [[222, 'node C:\\tools\\codex.cmd']]), {
    tool: 'codex',
    pid: 222,
    runtime: 'native'
  })
})

test('cyclic and duplicate process rows terminate without revisiting descendants', () => {
  const rows = [
    { pid: 230, ppid: 100, exe: 'node.exe' },
    { pid: 231, ppid: 230, exe: 'node.exe' },
    // A racing/inconsistent snapshot can contain a duplicate PID that points
    // back into the graph. The visited set must still bound traversal.
    { pid: 230, ppid: 231, exe: 'node.exe' },
    { pid: 240, ppid: 241, exe: 'node.exe' },
    { pid: 241, ppid: 240, exe: 'node.exe' }
  ]
  assert.deepEqual(detect(rows, [[231, 'node C:\\tools\\claude.cmd']]), {
    tool: 'claude',
    pid: 231,
    runtime: 'native'
  })
  assert.equal(detect(rows, [[240, 'node C:\\tools\\codex.cmd']]), null)
})

test.after(() => {
  delete globalThis.__zincToolDetectorCommands
})
