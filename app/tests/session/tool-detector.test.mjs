import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-tool-detector-'))
const outfile = join(outDir, 'ToolDetector.mjs')

// Exercise the actual detector on every host without reading host processes.
globalThis.detectorFixture = {
  lines: new Map(), starts: new Map(), snapshot: () => 1n,
  first: () => false, next: () => false, close: () => true
}
await build({
  entryPoints: [join(root, 'src/main/services/ToolDetector.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent',
  define: { 'process.platform': '"win32"' },
  plugins: [{
    name: 'mock-process-access',
    setup(build) {
      build.onResolve({ filter: /^koffi$/ }, () => ({ path: 'koffi', namespace: 'fixture' }))
      build.onResolve({ filter: /processCwd$/ }, () => ({ path: 'processCwd', namespace: 'fixture' }))
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
        contents: path === 'koffi' ? `
          export default {
            load() { return { func(signature) {
              const fixture = globalThis.detectorFixture;
              if (signature.includes('CreateToolhelp32Snapshot')) return (...args) => fixture.snapshot(...args);
              if (signature.includes('Process32FirstW')) return (...args) => fixture.first(...args);
              if (signature.includes('Process32NextW')) return (...args) => fixture.next(...args);
              return (...args) => fixture.close(...args);
            } } },
            struct() { return {} }, sizeof() { return 32 }, address(handle) { return BigInt(handle) }
          }
        ` : `
          export const getProcessCommandLine = (pid) => globalThis.detectorFixture.lines.get(pid) ?? null;
          export const getProcessStartedMs = (pid) => globalThis.detectorFixture.starts.get(pid) ?? null;
        `,
        loader: 'js'
      }))
    }
  }]
})
const { identifyToolFromCommandLine, detectActiveToolMatch, snapshotProcesses } = await import(pathToFileURL(outfile))

test.after(() => {
  delete globalThis.detectorFixture
  rmSync(outDir, { recursive: true, force: true })
})

function fixture(rows, lines, starts = {}) {
  globalThis.detectorFixture.lines = new Map(Object.entries(lines).map(([pid, line]) => [Number(pid), line]))
  globalThis.detectorFixture.starts = new Map(Object.entries(starts).map(([pid, ms]) => [Number(pid), ms]))
  return rows
}

test('matches executable/entrypoint, not bare tool words inside prompts or flags', () => {
  assert.equal(identifyToolFromCommandLine('"C:\\Tools\\claude-code.exe" --prompt "run codex now"'), 'claude')
  assert.equal(identifyToolFromCommandLine('node.exe "C:\\Users\\a\\node_modules\\@anthropic-ai\\claude-code\\cli.js" "codex"'), 'claude')
  assert.equal(identifyToolFromCommandLine('node.exe C:\\tools\\app.js "claude --continue"'), null)
  assert.equal(identifyToolFromCommandLine('"D:\\npm-global\\claude.ps1" --version'), 'claude')
  assert.equal(identifyToolFromCommandLine('"D:\\npm-global\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"'), 'claude')
  assert.equal(identifyToolFromCommandLine('node -e "console.log(\'codex\')"'), null)
  assert.equal(identifyToolFromCommandLine('pwsh.exe -Command "Write-Output \'claude\'"'), null)
  assert.equal(identifyToolFromCommandLine('cmd /c echo codex'), null)
  assert.equal(identifyToolFromCommandLine('npx grok --resume'), 'grok')
  assert.equal(identifyToolFromCommandLine('cmd /c wsl.exe -d Ubuntu -- kimi'), 'kimi')
})

test('a newer CLI wins over an older preferred tool under the same terminal', () => {
  const rows = fixture([
    { pid: 10, ppid: 1, exe: 'pwsh.exe' },
    { pid: 20, ppid: 10, exe: 'codex.exe' },
    { pid: 30, ppid: 10, exe: 'claude-code.exe' }
  ], { 20: 'codex.exe resume --last', 30: 'claude-code.exe "try codex"' }, { 20: 100, 30: 200 })
  assert.deepEqual(detectActiveToolMatch(10, rows, 'codex'), {
    tool: 'claude', pid: 30, runtime: 'native', commandLine: 'claude-code.exe "try codex"'
  })
})

test('distance breaks creation-time ties; saved preference only breaks equal-distance ties', () => {
  const rows = fixture([
    { pid: 10, ppid: 1, exe: 'pwsh.exe' },
    { pid: 20, ppid: 10, exe: 'codex.exe' },
    { pid: 30, ppid: 20, exe: 'grok.exe' },
    { pid: 40, ppid: 10, exe: 'claude.exe' }
  ], { 20: 'codex', 30: 'grok', 40: 'claude' }, { 20: 100, 30: 100, 40: 100 })
  assert.equal(detectActiveToolMatch(10, rows, 'grok')?.tool, 'codex')
  assert.equal(detectActiveToolMatch(10, rows, 'claude')?.tool, 'claude')
})

test('cmd /c wsl ancestor marks a descendant CLI as WSL', () => {
  const rows = fixture([
    { pid: 10, ppid: 1, exe: 'pwsh.exe' },
    { pid: 20, ppid: 10, exe: 'cmd.exe' },
    { pid: 30, ppid: 20, exe: 'claude-code.exe' }
  ], { 20: 'C:\\Windows\\System32\\cmd.exe /d /s /c "wsl.exe -d Ubuntu --"', 30: 'claude-code.exe' }, { 30: 100 })
  assert.equal(detectActiveToolMatch(10, rows)?.runtime, 'wsl')
  globalThis.detectorFixture.lines.set(20, 'cmd.exe /c echo wsl.exe')
  assert.equal(detectActiveToolMatch(10, rows)?.runtime, 'native')
})

test('Windows snapshot errors throw instead of looking like a valid empty table', () => {
  const native = globalThis.detectorFixture
  native.snapshot = () => -1n
  assert.throws(() => snapshotProcesses(), /CreateToolhelp32Snapshot failed/)
  native.snapshot = () => 1n
  native.first = () => false
  assert.throws(() => snapshotProcesses(), /Process32FirstW failed/)
  native.first = (_, entry) => {
    Object.assign(entry, { th32ProcessID: 42, th32ParentProcessID: 10, szExeFile: 'codex.exe' })
    return true
  }
  native.next = () => false
  assert.deepEqual(snapshotProcesses(), [{ pid: 42, ppid: 10, exe: 'codex.exe' }])
})
