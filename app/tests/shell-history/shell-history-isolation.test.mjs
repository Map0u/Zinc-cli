import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-shell-hist-'))
const outFile = join(outDir, 'shellHistoryIsolation.mjs')

buildSync({
  entryPoints: [join(root, 'src/main/services/shellHistoryIsolation.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: outFile,
  logLevel: 'silent'
})

const {
  isShellHistoryIsolationEnabled,
  resolveShellHistoryDir,
  powerShellHistoryIsolationPrelude,
  buildIsolatedShellSpawn
} = await import(pathToFileURL(outFile).href)

test.after(() => {
  rmSync(outDir, { recursive: true, force: true })
})

const pwsh = {
  id: 'pwsh',
  label: 'PowerShell 7',
  command: 'pwsh.exe',
  kind: 'powershell',
  args: ['-NoLogo']
}

const bash = {
  id: 'git-bash',
  label: 'Git Bash',
  command: 'bash.exe',
  kind: 'posix',
  args: ['-l']
}

test('isolation is off for normal developer env', () => {
  assert.equal(isShellHistoryIsolationEnabled({}), false)
  assert.equal(isShellHistoryIsolationEnabled({ ZINC_TEST_ISOLATED: '0' }), false)
})

test('isolation is on for ZINC_TEST_ISOLATED or ZINC_TEST_USER_DATA', () => {
  assert.equal(isShellHistoryIsolationEnabled({ ZINC_TEST_ISOLATED: '1' }), true)
  assert.equal(
    isShellHistoryIsolationEnabled({ ZINC_TEST_USER_DATA: 'C:\\tmp\\zinc-cdp' }),
    true
  )
})

test('history dir lives under the isolated userData tree', () => {
  const dir = resolveShellHistoryDir({ ZINC_TEST_USER_DATA: 'C:\\tmp\\zinc-cdp-run' })
  assert.equal(dir.replace(/\//g, '\\'), 'C:\\tmp\\zinc-cdp-run\\shell-history')
})

test('PowerShell prelude forces SaveNothing and an isolated HistorySavePath', () => {
  const prelude = powerShellHistoryIsolationPrelude('C:\\tmp\\hist')
  assert.match(prelude, /HistorySaveStyle SaveNothing/)
  assert.match(prelude, /HistorySavePath/)
  assert.match(prelude, /ConsoleHost_history\.txt/)
})

test('non-isolated spawn keeps default env and plain shell args', () => {
  const { env, args } = buildIsolatedShellSpawn(pwsh, undefined, {
    PATH: 'C:\\Windows',
    APPDATA: 'C:\\Users\\dev\\AppData\\Roaming'
  })
  assert.equal(env.HISTFILE, undefined)
  assert.equal(env.ZINC_SHELL_HISTORY_DIR, undefined)
  assert.deepEqual(args, ['-NoLogo'])
})

test('isolated PowerShell spawn injects history prelude and HISTFILE env', () => {
  const userData = mkdtempSync(join(tmpdir(), 'zinc-ud-'))
  try {
    const { env, args } = buildIsolatedShellSpawn(pwsh, undefined, {
      PATH: 'C:\\Windows',
      APPDATA: 'C:\\Users\\dev\\AppData\\Roaming',
      ZINC_TEST_ISOLATED: '1',
      ZINC_TEST_USER_DATA: userData
    })
    assert.ok(env.ZINC_SHELL_HISTORY_DIR?.includes('shell-history'))
    assert.ok(env.HISTFILE?.includes('bash_history'))
    assert.ok(args.includes('-NoExit'))
    assert.ok(args.includes('-Command'))
    const command = args[args.indexOf('-Command') + 1]
    assert.match(command, /SaveNothing/)
    assert.doesNotMatch(command, /AppData\\Roaming\\Microsoft\\Windows\\PowerShell\\PSReadLine/)
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('isolated PowerShell preserves an existing startup command after the prelude', () => {
  const userData = mkdtempSync(join(tmpdir(), 'zinc-ud-'))
  try {
    const { args } = buildIsolatedShellSpawn(pwsh, 'codex resume --last', {
      ZINC_TEST_ISOLATED: '1',
      ZINC_TEST_USER_DATA: userData
    })
    const command = args[args.indexOf('-Command') + 1]
    assert.match(command, /SaveNothing/)
    assert.match(command, /codex resume --last/)
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('isolated posix spawn points HISTFILE at the test tree', () => {
  const userData = mkdtempSync(join(tmpdir(), 'zinc-ud-'))
  try {
    const { env, args } = buildIsolatedShellSpawn(bash, undefined, {
      ZINC_TEST_ISOLATED: '1',
      ZINC_TEST_USER_DATA: userData
    })
    assert.ok(env.HISTFILE?.startsWith(userData) || env.HISTFILE?.includes('shell-history'))
    assert.equal(env.HISTSIZE, '100')
    // Startup export is injected when no other startup command is present.
    assert.equal(args[0], '-c')
    assert.match(args[1], /HISTFILE/)
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})
