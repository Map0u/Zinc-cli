import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiscoveredShell } from './ShellDiscovery'
import { buildShellSpawnArgs } from './ShellDiscovery'

/**
 * CDP / automated smoke runs set ZINC_TEST_ISOLATED and/or ZINC_TEST_USER_DATA.
 * Those shells must not write into the developer's global PSReadLine / bash
 * history (the PTY inherits the host process environment by default).
 */
export function isShellHistoryIsolationEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.ZINC_TEST_ISOLATED === '1') return true
  return Boolean(env.ZINC_TEST_USER_DATA?.trim())
}

/** Directory under the isolated test userData (or a temp fallback) for shell history. */
export function resolveShellHistoryDir(env: NodeJS.ProcessEnv = process.env): string {
  const userData = env.ZINC_TEST_USER_DATA?.trim()
  if (userData) return join(userData, 'shell-history')
  return join(tmpdir(), 'zinc-shell-history')
}

function quotePowerShellSingle(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * PowerShell prelude: force PSReadLine to never write the global ConsoleHost
 * history file. Runs after profiles (-Command timing) so a user profile cannot
 * leave SaveIncrementally pointing at the real AppData path for this session.
 */
export function powerShellHistoryIsolationPrelude(historyDir: string): string {
  const historyPath = quotePowerShellSingle(join(historyDir, 'ConsoleHost_history.txt'))
  return (
    `try { ` +
    `Import-Module PSReadLine -ErrorAction SilentlyContinue; ` +
    `Set-PSReadLineOption -HistorySavePath ${historyPath} -HistorySaveStyle SaveNothing -ErrorAction SilentlyContinue ` +
    `} catch {}`
  )
}

/**
 * Builds spawn env + argv so automated Zinc shells keep history out of the
 * developer's shared PSReadLine / bash history files.
 */
export function buildIsolatedShellSpawn(
  shell: DiscoveredShell,
  startupCommand: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): { env: { [key: string]: string }; args: string[] } {
  const baseEnv: { [key: string]: string } = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') baseEnv[key] = value
  }

  if (!isShellHistoryIsolationEnabled(env)) {
    return {
      env: baseEnv,
      args: buildShellSpawnArgs(shell, startupCommand)
    }
  }

  const historyDir = resolveShellHistoryDir(env)
  try {
    mkdirSync(historyDir, { recursive: true })
  } catch {
    // Best-effort: still apply in-memory SaveNothing / HISTFILE even if mkdir fails.
  }

  const bashHistory = join(historyDir, 'bash_history')
  baseEnv.ZINC_SHELL_HISTORY_DIR = historyDir
  // Git Bash / POSIX shells (and anything that honors HISTFILE).
  baseEnv.HISTFILE = bashHistory
  // Cap growth of the isolated file; tests do not need long-term history.
  baseEnv.HISTSIZE = '100'
  baseEnv.HISTFILESIZE = '100'
  // Propagate HISTFILE into WSL when the launcher is wsl.exe on Windows.
  const existingWslEnv = baseEnv.WSLENV ?? ''
  const wslParts = existingWslEnv
    .split(':')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^HISTFILE(\/|$)/i.test(part) && !/^HISTSIZE(\/|$)/i.test(part))
  wslParts.push('HISTFILE/u', 'HISTSIZE/u')
  baseEnv.WSLENV = wslParts.join(':')
  // Prefer a Linux-side path when the shell is WSL so bash does not try a Windows path.
  if (shell.kind === 'wsl') {
    baseEnv.HISTFILE = '/tmp/zinc-test-bash-history'
  }

  let startup = startupCommand?.trim() || undefined
  if (shell.kind === 'powershell') {
    const prelude = powerShellHistoryIsolationPrelude(historyDir)
    startup = startup ? `${prelude}; ${startup}` : prelude
  } else if (shell.kind === 'posix' && !startup) {
    // Ensure HISTFILE is applied even if a profile later overrides it.
    startup = `export HISTFILE=${JSON.stringify(bashHistory)}; export HISTSIZE=100; export HISTFILESIZE=100`
  }

  return {
    env: baseEnv,
    args: buildShellSpawnArgs(shell, startup)
  }
}
