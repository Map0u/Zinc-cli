import { existsSync, readFileSync } from 'node:fs'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { win32 } from 'node:path'

const execFile = promisify(execFileCallback)

export type ShellKind = 'powershell' | 'cmd' | 'posix' | 'wsl'

/**
 * A launchable shell as discovered on this machine. `id` is deliberately
 * machine-independent: settings and restored sessions must persist this, not
 * the executable path, which may change after an upgrade or on another PC.
 */
export interface DiscoveredShell {
  id: string
  label: string
  command: string
  kind: ShellKind
  /** Arguments required before any Zinc startup command is appended. */
  args: string[]
}

export interface ShellDiscoveryDependencies {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  fileExists?: (filePath: string) => boolean
  readFile?: (filePath: string, encoding: BufferEncoding) => string
  /** Used only for registry reads and `wsl.exe -l -q`; never starts a shell. */
  execFile?: (command: string, args: readonly string[]) => Promise<{ stdout: string | Buffer; stderr?: string | Buffer }>
  /** Optional seam for tests or a future native registry reader. */
  readRegistryValue?: (hive: 'HKLM' | 'HKCU', key: string, value: string) => Promise<string | null>
}

const GIT_FOR_WINDOWS_KEY = 'SOFTWARE\\GitForWindows'
const WINDOWS_FALLBACK_IDS = ['pwsh', 'windows-powershell', 'cmd'] as const

function defaultDependencies(): Required<Omit<ShellDiscoveryDependencies, 'readRegistryValue'>> {
  return {
    platform: process.platform,
    env: process.env,
    fileExists: existsSync,
    readFile: (filePath, encoding) => readFileSync(filePath, encoding),
    // Preserve WSL's UTF-16LE bytes for parseWslDistroList instead of letting
    // child_process decode them as the host's UTF-8 default first.
    execFile: async (command, args) => execFile(command, [...args], { encoding: 'buffer' })
  }
}

function pathEntries(value: string | undefined, delimiter: string): string[] {
  return (value ?? '').split(delimiter).map((entry) => entry.trim()).filter(Boolean)
}

function firstExisting(candidates: readonly string[], fileExists: (filePath: string) => boolean): string | null {
  for (const candidate of candidates) {
    try {
      if (fileExists(candidate)) return candidate
    } catch {
      // An inaccessible candidate is simply not available.
    }
  }
  return null
}

function windowsPathCandidates(env: NodeJS.ProcessEnv, fileName: string): string[] {
  const candidates = pathEntries(env.PATH, ';').map((directory) => win32.join(directory, fileName))
  // An App Execution Alias is the normal, accessible PowerShell MSIX entry
  // point. Do not enumerate Program Files\\WindowsApps: it is commonly
  // access-denied and discovery must remain quiet/non-blocking.
  if (fileName.toLowerCase() === 'pwsh.exe') {
    if (env.LOCALAPPDATA) candidates.push(win32.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'pwsh.exe'))
    if (env.ProgramFiles) candidates.push(win32.join(env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe'))
    if (env.ProgramW6432) candidates.push(win32.join(env.ProgramW6432, 'PowerShell', '7', 'pwsh.exe'))
  }
  return candidates
}

function registryValueFromRegOutput(stdout: string | Buffer, expectedValue: string): string | null {
  const text = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : stdout
  const escapedValue = expectedValue.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
  const expression = new RegExp(`^\\s*${escapedValue}\\s+REG_\\w+\\s+(.+?)\\s*$`, 'im')
  return text.match(expression)?.[1]?.trim() || null
}

async function readGitInstallPath(
  deps: Required<Omit<ShellDiscoveryDependencies, 'readRegistryValue'>> & Pick<ShellDiscoveryDependencies, 'readRegistryValue'>
): Promise<string | null> {
  for (const hive of ['HKLM', 'HKCU'] as const) {
    try {
      if (deps.readRegistryValue) {
        const value = await deps.readRegistryValue(hive, GIT_FOR_WINDOWS_KEY, 'InstallPath')
        if (value?.trim()) return value.trim()
        continue
      }
      const result = await deps.execFile('reg.exe', ['query', `${hive}\\${GIT_FOR_WINDOWS_KEY}`, '/v', 'InstallPath'])
      const value = registryValueFromRegOutput(result.stdout, 'InstallPath')
      if (value) return value
    } catch {
      // Git may not be installed, and querying HKLM can be denied. Both are normal.
    }
  }
  return null
}

/** Decode `wsl.exe -l -q`, which can be UTF-16LE even without a BOM. */
export function parseWslDistroList(output: string | Buffer): string[] {
  const bytes = typeof output === 'string' ? Buffer.from(output, 'utf8') : output
  const isUtf16 = bytes.length >= 2 && (bytes[0] === 0xff && bytes[1] === 0xfe || bytes.includes(0))
  const text = isUtf16 ? bytes.toString('utf16le') : bytes.toString('utf8')
  return [...new Set(text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.replace(/\0/g, '').trim()).filter(Boolean))]
}

function posixLabel(id: string): string {
  return id.length > 0 ? `${id[0].toUpperCase()}${id.slice(1)}` : 'Shell'
}

function addOnce(shells: DiscoveredShell[], shell: DiscoveredShell): void {
  if (!shells.some((candidate) => candidate.id === shell.id)) shells.push(shell)
}

async function discoverWindowsShells(deps: Required<Omit<ShellDiscoveryDependencies, 'readRegistryValue'>> & Pick<ShellDiscoveryDependencies, 'readRegistryValue'>): Promise<DiscoveredShell[]> {
  const { env, fileExists } = deps
  const shells: DiscoveredShell[] = []
  const pwsh = firstExisting(windowsPathCandidates(env, 'pwsh.exe'), fileExists)
  if (pwsh) addOnce(shells, { id: 'pwsh', label: 'PowerShell 7', command: pwsh, kind: 'powershell', args: ['-NoLogo'] })

  const systemRoot = env.SystemRoot || env.WINDIR
  const windowsPowerShell = systemRoot ? win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : null
  if (windowsPowerShell && firstExisting([windowsPowerShell], fileExists)) {
    addOnce(shells, { id: 'windows-powershell', label: 'Windows PowerShell', command: windowsPowerShell, kind: 'powershell', args: ['-NoLogo'] })
  }

  const cmd = firstExisting([env.ComSpec ?? '', ...(systemRoot ? [win32.join(systemRoot, 'System32', 'cmd.exe')] : []), ...windowsPathCandidates(env, 'cmd.exe')], fileExists)
  if (cmd) addOnce(shells, { id: 'cmd', label: 'Command Prompt', command: cmd, kind: 'cmd', args: [] })

  const gitInstallPath = await readGitInstallPath(deps)
  const gitBash = firstExisting([
    ...(gitInstallPath ? [win32.join(gitInstallPath, 'bin', 'bash.exe')] : []),
    ...(env.ProgramFiles ? [win32.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe')] : []),
    ...(env.ProgramW6432 ? [win32.join(env.ProgramW6432, 'Git', 'bin', 'bash.exe')] : [])
  ], fileExists)
  if (gitBash) addOnce(shells, { id: 'git-bash', label: 'Git Bash', command: gitBash, kind: 'posix', args: ['--login', '-i'] })

  const wsl = firstExisting([
    ...(systemRoot ? [win32.join(systemRoot, 'System32', 'wsl.exe')] : []),
    ...windowsPathCandidates(env, 'wsl.exe')
  ], fileExists)
  if (wsl) {
    try {
      const result = await deps.execFile(wsl, ['-l', '-q'])
      for (const distro of parseWslDistroList(result.stdout)) {
        addOnce(shells, { id: `wsl:${distro}`, label: `WSL: ${distro}`, command: wsl, kind: 'wsl', args: ['-d', distro] })
      }
    } catch {
      // wsl.exe may exist but not have a usable installation/distribution.
    }
  }
  return shells
}

function discoverPosixShells(deps: Required<Omit<ShellDiscoveryDependencies, 'readRegistryValue'>>): DiscoveredShell[] {
  const allowed = new Set<string>()
  try {
    for (const line of deps.readFile('/etc/shells', 'utf8').split(/\r?\n/)) {
      const value = line.trim()
      if (value && !value.startsWith('#')) allowed.add(value)
    }
  } catch {
    // Minimal containers may not have /etc/shells; $SHELL still has value.
  }
  const candidates = [deps.env.SHELL, ...[...allowed].filter((entry) => /\/(?:bash|zsh|fish)$/.test(entry))]
  const shells: DiscoveredShell[] = []
  for (const command of candidates) {
    // `$SHELL` is deliberately retained even if it is a less common shell
    // (e.g. dash): it is the documented first Linux fallback. /etc/shells is
    // otherwise restricted to bash/zsh/fish/sh to keep the picker compact.
    if (!command || (command !== deps.env.SHELL && !/(?:^|\/)(?:bash|zsh|fish)$/.test(command))) continue
    if (!firstExisting([command], deps.fileExists)) continue
    const id = command.split('/').pop()!
    addOnce(shells, { id, label: posixLabel(id), command, kind: 'posix', args: [] })
  }
  return shells
}

/** One async, failure-isolated probe. This never executes a candidate shell. */
export async function discoverShells(overrides: ShellDiscoveryDependencies = {}): Promise<DiscoveredShell[]> {
  const defaults = defaultDependencies()
  const deps: Required<Omit<ShellDiscoveryDependencies, 'readRegistryValue'>> & Pick<ShellDiscoveryDependencies, 'readRegistryValue'> = {
    platform: overrides.platform ?? defaults.platform,
    env: overrides.env ?? defaults.env,
    fileExists: overrides.fileExists ?? defaults.fileExists,
    readFile: overrides.readFile ?? defaults.readFile,
    execFile: overrides.execFile ?? defaults.execFile,
    readRegistryValue: overrides.readRegistryValue
  }
  try {
    return deps.platform === 'win32' ? await discoverWindowsShells(deps) : discoverPosixShells(deps)
  } catch {
    return []
  }
}

export interface ShellResolution {
  shell: DiscoveredShell
  /** True when the requested persisted ID was unavailable and a fallback won. */
  fellBack: boolean
}

function quotePosixArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Produces node-pty argv for a selected shell. Keeping this beside discovery
 * prevents PtyManager from accidentally applying PowerShell's flags to cmd,
 * Git Bash, or a WSL launcher. Every non-empty startup command keeps the tab
 * interactive after the command completes, matching the old PowerShell flow.
 */
export function buildShellSpawnArgs(shell: DiscoveredShell, startupCommand?: string): string[] {
  const startup = startupCommand?.trim()
  if (!startup) return [...shell.args]
  if (shell.kind === 'powershell') return [...shell.args, '-NoExit', '-Command', startup]
  if (shell.kind === 'cmd') return [...shell.args, '/K', startup]
  if (shell.kind === 'wsl') {
    // `wsl.exe -d <distro>` normally starts the distro's configured shell.
    // For a restore command, use POSIX sh then exec the user's login shell so
    // the terminal remains open and has the expected profile/environment.
    return [...shell.args, '--', 'sh', '-lc', `${startup}; exec \"${'$'}{SHELL:-/bin/sh}\" -l`]
  }
  const reexec = [quotePosixArg(shell.command), ...shell.args.map(quotePosixArg)].join(' ')
  return ['-c', `${startup}; exec ${reexec}`]
}

function emergencyShell(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): DiscoveredShell {
  if (platform === 'win32') return { id: 'cmd', label: 'Command Prompt', command: env.ComSpec || 'cmd.exe', kind: 'cmd', args: [] }
  return { id: 'sh', label: 'Sh', command: '/bin/sh', kind: 'posix', args: [] }
}

/** Resolve a persisted stable ID, with the product's documented safe fallback chain. */
export function resolveShellId(
  available: readonly DiscoveredShell[],
  requestedId: string | null | undefined,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): ShellResolution {
  const requested = requestedId?.trim()
  const exact = requested ? available.find((shell) => shell.id === requested) : undefined
  if (exact) return { shell: exact, fellBack: false }

  const fallbackIds = platform === 'win32'
    ? WINDOWS_FALLBACK_IDS
    : [env.SHELL?.split('/').pop() ?? '', 'bash', 'sh']
  for (const id of fallbackIds) {
    const shell = available.find((candidate) => candidate.id === id)
    if (shell) return { shell, fellBack: Boolean(requested && requested !== id) }
  }
  return { shell: emergencyShell(platform, env), fellBack: Boolean(requested) }
}

/**
 * Main-process cache. Calling start() deliberately does not await probing, so
 * app startup is never held up by registry or WSL enumeration latency.
 */
export class ShellDiscoveryService {
  private cached: Promise<DiscoveredShell[]> | null = null

  constructor(private readonly dependencies: ShellDiscoveryDependencies = {}) {}

  start(): void {
    void this.getShells()
  }

  getShells(): Promise<DiscoveredShell[]> {
    if (!this.cached) this.cached = discoverShells(this.dependencies).catch(() => [])
    return this.cached
  }
}
