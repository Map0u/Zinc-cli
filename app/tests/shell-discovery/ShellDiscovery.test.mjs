import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const sourceUrl = new URL('../../src/main/services/ShellDiscovery.ts', import.meta.url)
const source = await readFile(sourceUrl, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`
const { buildShellSpawnArgs, discoverShells, parseWslDistroList, resolveShellId } = await import(moduleUrl)

function windowsDeps({ files = [], registry = {}, wslOutput = null } = {}) {
  const existing = new Set(files)
  return {
    platform: 'win32',
    env: {
      PATH: 'C:\\Tools;C:\\Other',
      ProgramFiles: 'C:\\Program Files',
      LOCALAPPDATA: 'C:\\Users\\A\\AppData\\Local',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe'
    },
    fileExists: (file) => existing.has(file),
    readRegistryValue: async (hive) => registry[hive] ?? null,
    execFile: async (_command, args) => {
      assert.deepEqual(args, ['-l', '-q'])
      if (wslOutput === null) throw new Error('no distributions')
      return { stdout: wslOutput }
    }
  }
}

test('Windows discovery finds PATH/MSIX PowerShell, built-ins, registry Git Bash, and WSL distros', async () => {
  const wsl = 'C:\\Windows\\System32\\wsl.exe'
  const shells = await discoverShells(windowsDeps({
    files: [
      'C:\\Tools\\pwsh.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\System32\\cmd.exe',
      'D:\\Git\\bin\\bash.exe',
      wsl
    ],
    registry: { HKLM: 'D:\\Git' },
    wslOutput: Buffer.from('Ubuntu\r\nDebian\r\n', 'utf16le')
  }))
  assert.deepEqual(shells.map((shell) => shell.id), ['pwsh', 'windows-powershell', 'cmd', 'git-bash', 'wsl:Ubuntu', 'wsl:Debian'])
  assert.deepEqual(shells.at(-1), { id: 'wsl:Debian', label: 'WSL: Debian', command: wsl, kind: 'wsl', args: ['-d', 'Debian'] })
})

test('missing Windows candidates and failed registry/WSL enumeration are silently skipped', async () => {
  const shells = await discoverShells(windowsDeps({
    files: ['C:\\Windows\\System32\\cmd.exe', 'C:\\Windows\\System32\\wsl.exe'],
    registry: {},
    wslOutput: null
  }))
  assert.deepEqual(shells.map((shell) => shell.id), ['cmd'])
})

test('MSIX PowerShell app execution alias is a discovery candidate', async () => {
  const shells = await discoverShells(windowsDeps({
    files: ['C:\\Users\\A\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe']
  }))
  assert.deepEqual(shells.map((shell) => shell.id), ['pwsh'])
})

test('WSL parser accepts UTF-16LE without BOM, UTF-8, blanks, and duplicate distro names', () => {
  assert.deepEqual(parseWslDistroList(Buffer.from('Ubuntu\r\n\r\nDebian\r\nUbuntu\r\n', 'utf16le')), ['Ubuntu', 'Debian'])
  assert.deepEqual(parseWslDistroList('Ubuntu\nDebian\n'), ['Ubuntu', 'Debian'])
})

test('Linux discovery uses $SHELL plus installed bash/zsh/fish entries only', async () => {
  const present = new Set(['/usr/bin/zsh', '/bin/bash', '/usr/bin/fish'])
  const shells = await discoverShells({
    platform: 'linux',
    env: { SHELL: '/usr/bin/zsh' },
    fileExists: (file) => present.has(file),
    readFile: () => '# comment\n/bin/bash\n/usr/bin/zsh\n/usr/bin/fish\n/bin/dash\n',
    execFile: async () => ({ stdout: '' })
  })
  assert.deepEqual(shells.map((shell) => shell.id), ['zsh', 'bash', 'fish'])
})

test('stable ID resolution returns the requested shell then follows Windows priority', () => {
  const available = [
    { id: 'cmd', label: 'Command Prompt', command: 'cmd.exe', kind: 'cmd', args: [] },
    { id: 'pwsh', label: 'PowerShell 7', command: 'pwsh.exe', kind: 'powershell', args: ['-NoLogo'] },
    { id: 'wsl:Ubuntu', label: 'WSL: Ubuntu', command: 'wsl.exe', kind: 'wsl', args: ['-d', 'Ubuntu'] }
  ]
  assert.equal(resolveShellId(available, 'wsl:Ubuntu', 'win32').shell.id, 'wsl:Ubuntu')
  assert.deepEqual(resolveShellId(available, 'git-bash', 'win32'), { shell: available[1], fellBack: true })
})

test('Linux fallback prefers $SHELL, then bash, then a safe sh emergency shell', () => {
  const available = [
    { id: 'bash', label: 'Bash', command: '/bin/bash', kind: 'posix', args: [] },
    { id: 'zsh', label: 'Zsh', command: '/usr/bin/zsh', kind: 'posix', args: [] }
  ]
  assert.equal(resolveShellId(available, 'gone', 'linux', { SHELL: '/usr/bin/zsh' }).shell.id, 'zsh')
  assert.equal(resolveShellId(available, 'gone', 'linux', { SHELL: '/usr/bin/fish' }).shell.id, 'bash')
  assert.deepEqual(resolveShellId([], 'gone', 'linux', {}), {
    shell: { id: 'sh', label: 'Sh', command: '/bin/sh', kind: 'posix', args: [] },
    fellBack: true
  })
})

test('spawn arguments preserve interactive startup behavior for every shell kind', () => {
  assert.deepEqual(
    buildShellSpawnArgs({ id: 'cmd', label: 'Command Prompt', command: 'cmd.exe', kind: 'cmd', args: [] }, 'echo ready'),
    ['/K', 'echo ready']
  )
  assert.deepEqual(
    buildShellSpawnArgs({ id: 'git-bash', label: 'Git Bash', command: 'C:\\Git\\bin\\bash.exe', kind: 'posix', args: ['--login', '-i'] }, 'pwd'),
    ['-c', "pwd; exec 'C:\\Git\\bin\\bash.exe' '--login' '-i'"]
  )
  assert.deepEqual(
    buildShellSpawnArgs({ id: 'wsl:Ubuntu', label: 'WSL: Ubuntu', command: 'wsl.exe', kind: 'wsl', args: ['-d', 'Ubuntu'] }, 'pwd'),
    ['-d', 'Ubuntu', '--', 'sh', '-lc', 'pwd; exec "${SHELL:-/bin/sh}" -l']
  )
})
