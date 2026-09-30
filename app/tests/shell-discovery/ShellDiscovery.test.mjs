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
const { buildShellSpawnArgs, discoverShells, parseWslDistroList, resolveShellId, ShellDiscoveryService } = await import(moduleUrl)

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

test('ComSpec accepts a local cmd.exe path with spaces, not a command line or unrelated executable', async () => {
  const customCmd = 'C:\\Program Files\\Custom Shell\\cmd.exe'
  const systemCmd = 'C:\\Windows\\System32\\cmd.exe'
  const files = [customCmd, systemCmd, 'C:\\Tools\\other.exe', '\\\\server\\share\\cmd.exe']
  const valid = windowsDeps({ files })
  valid.env.ComSpec = customCmd
  assert.equal((await discoverShells(valid)).find((shell) => shell.id === 'cmd')?.command, customCmd)

  for (const comSpec of ['cmd.exe', `${customCmd} /K calc`, 'C:\\Tools\\other.exe', '\\\\server\\share\\cmd.exe']) {
    const invalid = windowsDeps({ files })
    invalid.env.ComSpec = comSpec
    assert.equal((await discoverShells(invalid)).find((shell) => shell.id === 'cmd')?.command, systemCmd)
    assert.equal(resolveShellId([], 'gone', 'win32', invalid.env).shell.command, 'cmd.exe')
  }
  assert.equal(resolveShellId([], 'gone', 'win32', valid.env).shell.command, customCmd)
})

test('WSL parser accepts UTF-16LE without BOM, UTF-8, blanks, and duplicate distro names', () => {
  assert.deepEqual(parseWslDistroList(Buffer.from('Ubuntu\r\n\r\nDebian\r\nUbuntu\r\n', 'utf16le')), ['Ubuntu', 'Debian'])
  assert.deepEqual(parseWslDistroList('Ubuntu\nDebian\n'), ['Ubuntu', 'Debian'])
})

test('Linux discovery uses $SHELL plus installed bash/zsh/fish/sh entries only', async () => {
  const present = new Set(['/usr/bin/zsh', '/bin/bash', '/usr/bin/fish', '/bin/sh', '/bin/dash'])
  const shells = await discoverShells({
    platform: 'linux',
    env: { SHELL: '/usr/bin/zsh' },
    fileExists: (file) => present.has(file),
    readFile: () => '# /usr/bin/false\n/bin/bash\n/usr/bin/zsh\n/usr/bin/fish\n/bin/sh\n/bin/dash\n',
    execFile: async () => ({ stdout: '' })
  })
  assert.deepEqual(shells.map((shell) => shell.id), ['zsh', 'bash', 'fish', 'sh'])
})

test('empty and failed discovery probes are retried, but a nonempty result is cached', async () => {
  let reads = 0
  const service = new ShellDiscoveryService({
    platform: 'linux',
    env: { SHELL: '/missing' },
    fileExists: (file) => file === '/bin/sh',
    readFile: () => {
      reads++
      if (reads === 1) throw new Error('temporary /etc/shells failure')
      return reads === 2 ? '# no installed candidates\n' : '/bin/sh\n'
    }
  })
  service.start()
  const first = service.getShells()
  assert.equal(service.getShells(), first)
  assert.deepEqual(await first, [])
  assert.deepEqual(await service.getShells(), [])
  const found = service.getShells()
  assert.deepEqual((await found).map((shell) => shell.id), ['sh'])
  assert.equal(service.getShells(), found)
  assert.equal(reads, 3)
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
    ['-d', 'Ubuntu', '--', 'sh', '-c', 'user_shell="${SHELL:-/bin/sh}"; "$user_shell" -lic \'pwd\'; exec "$user_shell" -l']
  )
})

test('WSL keeps the configured shell and passes quoted compound startup as one post-initialization command', () => {
  const shell = { id: 'wsl:Ubuntu', label: 'WSL: Ubuntu', command: 'wsl.exe', kind: 'wsl', args: ['-d', 'Ubuntu'] }
  const startup = `printf '%s' "it's ready"; if true; then echo "a;b"; fi`
  const quotedStartup = String.raw`'printf '\''%s'\'' "it'\''s ready"; if true; then echo "a;b"; fi'`
  const args = buildShellSpawnArgs(shell, startup)
  assert.deepEqual(args, [
    '-d', 'Ubuntu', '--', 'sh', '-c',
    `user_shell="${'$'}{SHELL:-/bin/sh}"; "$user_shell" -lic ${quotedStartup}; exec "$user_shell" -l`
  ])
  assert.deepEqual(buildShellSpawnArgs(shell), ['-d', 'Ubuntu'])
})
