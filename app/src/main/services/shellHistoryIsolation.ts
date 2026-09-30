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

function quotePosixSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** An interactive-shell entry point, scoped to this PTY instead of the user's profile. */
export function claudeBindingPrelude(shell: DiscoveredShell, settingsPath: string): string | undefined {
  if (shell.kind === 'powershell') {
    const quotedPath = quotePowerShellSingle(settingsPath)
    return (
      `$zincClaude = Get-Command claude -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
      `if ($zincClaude) { $global:ZincClaudeExecutable = $zincClaude.Source; ` +
      `$global:ZincClaudeSettings = ${quotedPath}; ` +
      `function global:claude { if ($args -contains '--settings') { ` +
      `& $global:ZincClaudeExecutable @args } else { ` +
      `& $global:ZincClaudeExecutable --settings $global:ZincClaudeSettings @args } } }`
    )
  }
  // node-pty escapes embedded quotes in cmd /K argv as \"; cmd treats the
  // backslashes literally, so pass the quoted path through the PTY environment.
  if (shell.kind === 'cmd') return 'doskey claude=claude --settings %ZINC_CLAUDE_SETTINGS_ARG% $*'
  if (shell.kind === 'posix') {
    const path = quotePosixSingle(settingsPath.replace(/\\/g, '/'))
    return `function claude() { command claude --settings ${path} "$@"; }; export -f claude`
  }
  // A WSL distribution needs Linux-side Node and a translated hook path;
  // installing a Windows hook in that shell would claim capture that cannot work.
  return undefined
}

/**
 * PowerShell prelude: force PSReadLine to never write the global ConsoleHost
 * history file. Runs after profiles (-Command timing) so a user profile cannot
 * leave SaveIncrementally pointing at the real AppData path for this session.
 */
export function powerShellCwdPrelude(): string {
  return (
    `$global:ZincOriginalPrompt = (Get-Command prompt -CommandType Function).ScriptBlock; ` +
    `function global:prompt { ` +
    `try { $zincPath = $executionContext.SessionState.Path.CurrentFileSystemLocation.Path.Replace('\\', '/'); ` +
    `$zincUri = [uri]::EscapeDataString($zincPath).Replace('%2F', '/').Replace('%3A', ':'); ` +
    `Write-Host -NoNewline ([char]27 + ']7;file:///' + $zincUri + [char]7) } catch {}; ` +
    `& $global:ZincOriginalPrompt }`
  )
}

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
  env: NodeJS.ProcessEnv = process.env,
  identity?: { tabId?: string; runId?: string; claudeSettingsPath?: string }
): { env: { [key: string]: string }; args: string[] } {
  const baseEnv: { [key: string]: string } = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') baseEnv[key] = value
  }
  // Identity lets the injected Claude SessionStart hook bind the reported
  // session id back to the exact PTY tab that launched it.
  if (identity?.tabId) baseEnv.ZINC_TAB_ID = identity.tabId
  if (identity?.runId) baseEnv.ZINC_RUN_ID = identity.runId
  const cmdSettingsPath = shell.kind === 'cmd' ? identity?.claudeSettingsPath : undefined
  if (cmdSettingsPath) baseEnv.ZINC_CLAUDE_SETTINGS_ARG = `"${cmdSettingsPath}"`
  const bindingPrelude = identity?.claudeSettingsPath
    ? claudeBindingPrelude(shell, identity.claudeSettingsPath)
    : undefined
  const command = cmdSettingsPath
    ? startupCommand?.replaceAll(`--settings "${cmdSettingsPath}"`, '--settings %ZINC_CLAUDE_SETTINGS_ARG%')
    : startupCommand
  const shellStartup = bindingPrelude
    ? command?.trim()
      ? `${bindingPrelude}${shell.kind === 'cmd' ? ' & ' : '; '}${command}`
      : bindingPrelude
    : command
  const cwdStartup = shell.kind === 'powershell'
    ? `${powerShellCwdPrelude()}${shellStartup?.trim() ? `; ${shellStartup}` : ''}`
    : shellStartup

  if (!isShellHistoryIsolationEnabled(env)) {
    return {
      env: baseEnv,
      args: buildShellSpawnArgs(shell, cwdStartup)
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

  let startup = cwdStartup?.trim() || undefined
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
