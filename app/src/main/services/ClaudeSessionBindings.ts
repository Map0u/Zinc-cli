import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Exact Claude session-id capture for sessions Zinc itself launches.
 *
 * `--continue` resumes the newest conversation for a working directory, so it
 * can only ever restore ONE conversation per directory. To restore each of
 * several Claude tabs in the same directory to its own conversation we need a
 * real session id — which Claude does not put on the process command line.
 *
 * The mechanism (verified 2026-09-29): Claude Code accepts a per-process
 * `--settings <file-or-json>` that can register a SessionStart hook WITHOUT
 * touching the user's global ~/.claude/settings.json. The hook receives
 * `session_id`/`cwd` on stdin and inherits the environment Zinc injected into
 * the PTY (`ZINC_TAB_ID`, `ZINC_RUN_ID`), so the reported id binds to the exact
 * tab that launched it. The hook appends one JSON line per event to
 * `session-bindings.jsonl` under userData.
 */

/** One line of session-bindings.jsonl written by the injected hook. */
export interface ClaudeBinding {
  session_id: string
  cwd?: string
  zinc_tab_id?: string | null
  zinc_run_id?: string | null
  source?: string
  /** PID and creation time of the Claude ancestor while the hook was alive. */
  claude_pid?: number
  claude_started_ms?: number
}

const HOOK_MATCHERS = ['startup', 'resume', 'clear']

function hookSettingsJson(reportCommand: string): string {
  return JSON.stringify({
    hooks: {
      SessionStart: HOOK_MATCHERS.map((matcher) => ({
        matcher,
        hooks: [{ type: 'command', command: reportCommand }],
      })),
    },
  })
}

export class ClaudeSessionBindings {
  private readonly bindingsPath: string
  private readonly settingsPath: string
  private readonly reportScriptPath: string
  private readonly reportCmdPath: string
  private settingsMaterialized = false

  /**
   * `electronExe` is `process.execPath` — the packaged Zinc binary doubles as a
   * Node runtime via ELECTRON_RUN_AS_NODE, so the hook works on machines with
   * no system Node on PATH (a clean VM install is the common case).
   */
  constructor(userDataDir: string, electronExe: string = process.execPath) {
    const dir = join(userDataDir, 'session-hooks')
    this.bindingsPath = join(dir, 'session-bindings.jsonl')
    this.settingsPath = join(dir, 'settings.json')
    this.reportScriptPath = join(dir, 'report.js')
    this.reportCmdPath = join(dir, 'report.cmd')
    this.electronExe = electronExe
  }

  private readonly electronExe: string

  /**
   * Path passed to `claude --settings`. Returns null when hooks can't be set
   * up. Uses forward slashes so the value survives being embedded in a
   * `sh -c` / `-Command` startup command, where a backslash would act as an
   * escape.
   */
  settingsFilePath(): string | null {
    if (!this.materialize()) return null
    return this.settingsPath.replace(/\\/g, '/')
  }

  /**
   * A binding is valid only for the exact live Claude process instance: tab,
   * PTY run, PID AND creation time must all match. PID alone may be recycled;
   * the tab/run pair alone persists across sequential CLI launches.
   */
  sessionIdFor(
    tabId: string,
    runId: string | null,
    matchPid: number,
    matchStartedMs: number | null,
  ): string | undefined {
    if (!Number.isSafeInteger(matchPid) || matchPid <= 0 || matchStartedMs === null) return undefined
    if (!existsSync(this.bindingsPath)) return undefined
    let lines: string[]
    try {
      lines = readFileSync(this.bindingsPath, 'utf8').split(/\r?\n/)
    } catch {
      return undefined
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line) continue
      let b: ClaudeBinding
      try {
        b = JSON.parse(line)
      } catch {
        continue
      }
      // Strict: a binding only counts when BOTH the tab and the exact PTY run
      // match — a stale record from an earlier spawn of this tab must never be
      // picked up for a restarted Claude that has not reported yet.
      if (b.zinc_tab_id !== tabId || !runId || b.zinc_run_id !== runId) continue
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.session_id)) continue
      // The reporter resolved this PID while the temporary cmd.exe ancestor
      // was still alive. Never infer ancestry from a later process snapshot:
      // that cmd has exited by then, and a surviving shell ancestor could
      // belong to a different invocation in the same tab.
      if (b.claude_pid !== matchPid || b.claude_started_ms !== matchStartedMs) continue
      return b.session_id
    }
    return undefined
  }

  /** Ensure the hook settings + report script exist on disk. Idempotent. */
  private materialize(): boolean {
    if (this.settingsMaterialized) return true
    try {
      mkdirSync(dirname(this.settingsPath), { recursive: true })
      // Include the PTY identity from the hook's environment, not just Claude's
      // stdin. Parse and re-serialize so every event occupies exactly one line.
      // This file is append-only, NOT capped: truncating it while independent
      // reporter processes append would lose bindings. Do not promise retention
      // or add unlocked compaction here.
      const report = [
        `'use strict'`,
        `const fs=require('node:fs')`,
        `const {spawnSync}=require('node:child_process')`,
        `// Resolve the Claude ancestor NOW, while its temporary cmd.exe hook`,
        `// launcher still exists. Once the hook exits it cannot be traced.`,
        `function claudeProcess(){`,
        `const script=[`,
        `'$ErrorActionPreference="Stop";',`,
        `'$current='+process.pid+';$seen=@{};',`,
        `'for($i=0;$i -lt 32 -and $current -gt 0;$i++){',`,
        `'if($seen.ContainsKey($current)){break};$seen[$current]=$true;',`,
        `'$p=Get-CimInstance Win32_Process -Filter ("ProcessId = " + $current) -ErrorAction Stop;',`,
        `'if(!$p){break};',`,
        `'if($p.Name -match "^(claude|claude-code)\\.exe$" -or',`,
        `' ($p.Name -match "^(node|bun|deno)\\.exe$" -and $p.CommandLine -match "[\\\\/]claude-code[\\\\/]cli\\.js")){',`,
        `'$ms=[DateTimeOffset]::new($p.CreationDate).ToUnixTimeMilliseconds();',`,
        `'[Console]::Out.WriteLine([string]$p.ProcessId+"|"+[string]$ms);exit 0};',`,
        `'$current=[int]$p.ParentProcessId}',`,
        `].join('')`,
        `const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:10000})`,
        `if(r.status!==0)return null`,
        `const m=r.stdout.trim().match(/^([0-9]+)\\|([0-9]+)$/)`,
        `return m?{pid:Number(m[1]),startedMs:Number(m[2])}:null`,
        `}`,
        `let d=''`,
        `process.stdin.on('data',c=>{if(d.length<65536)d+=c})`,
        `process.stdin.on('end',()=>{try{`,
        `const event=JSON.parse(d)`,
        `if(!event.session_id||!process.env.ZINC_TAB_ID||!process.env.ZINC_RUN_ID)return`,
        `const identity=claudeProcess();if(!identity){console.error('[Zinc] Claude session binding: ancestor not found');return}`,
        `const p=${JSON.stringify(this.bindingsPath)}`,
        `const line=JSON.stringify({session_id:event.session_id,cwd:event.cwd,source:event.source,claude_pid:identity.pid,claude_started_ms:identity.startedMs,zinc_tab_id:process.env.ZINC_TAB_ID,zinc_run_id:process.env.ZINC_RUN_ID})+'\\n'`,
        `fs.appendFileSync(p,line)`,
        `}catch(error){console.error('[Zinc] Claude session binding reporter failed:',error)}})`,
        `process.stdin.resume()`,
      ].join('\n')
      writeFileSync(this.reportScriptPath, report, 'utf8')
      // The hook command must not assume `node` is on PATH — a packaged Zinc
      // install on a clean machine usually has none. ELECTRON_RUN_AS_NODE turns
      // this app's own Electron binary into a plain Node runtime; cmd.exe runs
      // the wrapper which sets it then execs report.js under the app binary.
      const cmd = [
        `@echo off`,
        `set "ELECTRON_RUN_AS_NODE=1"`,
        `"${this.electronExe}" "${this.reportScriptPath}"`,
      ].join('\r\n')
      writeFileSync(this.reportCmdPath, `${cmd}\r\n`, 'utf8')
      writeFileSync(this.settingsPath, hookSettingsJson(quoteArg(this.reportCmdPath)), 'utf8')
      this.settingsMaterialized = true
      return true
    } catch (err) {
      console.error('[ClaudeSessionBindings] failed to materialize hook settings', err)
      return false
    }
  }
}

function quoteArg(p: string): string {
  return `"${p.replace(/\//g, '\\')}"`
}

/** Test seam: allow appending a binding without spawning a hook. */
export function appendClaudeBinding(bindingsPath: string, binding: ClaudeBinding): void {
  appendFileSync(bindingsPath, `${JSON.stringify(binding)}\n`, 'utf8')
}
