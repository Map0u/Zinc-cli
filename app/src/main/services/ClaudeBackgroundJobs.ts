import { execFile } from 'node:child_process'
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  continuedInFromTranscriptTail,
  resolveClaudeRestoreTarget,
  type ClaudeBackgroundJob,
  type ClaudeRestoreTarget,
} from '../../shared/sessionPersist'

/**
 * Restore-time view of Claude's background sessions (`claude agents`).
 *
 * Claude 2.1.28x can move a tab's conversation into a daemon-run background
 * job; the tab keeps showing it, but the id Zinc captured stays the original.
 * Restore resolves that id to whatever owns the conversation now (see
 * resolveClaudeRestoreTarget). Every failure here degrades to the old plain
 * `--resume` — this never stops, starts or modifies any job.
 */

const JOB_ID = /^[a-f0-9]{8}$/
const AGENTS_TIMEOUT_MS = 8_000
const TAIL_BYTES = 256 * 1024

/**
 * Live background jobs from `claude agents --json`; jobs without a process are
 * left out. `null` means the list is unknown, which is not the same as empty.
 */
export function parseAgentsJson(stdout: string): ClaudeBackgroundJob[] | null {
  let rows: unknown
  try {
    rows = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!Array.isArray(rows)) return null
  const jobs: ClaudeBackgroundJob[] = []
  for (const row of rows as Array<Record<string, unknown>>) {
    if (!row || row.kind !== 'background') continue
    // A stopped job has no pid. Attaching would wake it, overriding the
    // user's stop; resuming its conversation in the tab is the right call.
    if (typeof row.pid !== 'number') continue
    if (typeof row.id !== 'string' || !JOB_ID.test(row.id)) continue
    if (typeof row.sessionId !== 'string') continue
    jobs.push({ id: row.id, sessionId: row.sessionId })
  }
  return jobs
}

export function listLiveClaudeBackgroundJobs(): Promise<ClaudeBackgroundJob[] | null> {
  return new Promise((resolve) => {
    // Through the shell so npm's claude.cmd shim resolves like it does in a tab.
    execFile(
      'claude agents --json',
      { shell: true, windowsHide: true, timeout: AGENTS_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          console.warn('[ClaudeBackgroundJobs] claude agents --json failed', err.message)
          resolve(null)
          return
        }
        const jobs = parseAgentsJson(stdout)
        if (jobs === null) console.warn('[ClaudeBackgroundJobs] claude agents --json returned no job list')
        resolve(jobs)
      },
    )
  })
}

function claudeProjectsDir(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim()
  return join(configDir || join(homedir(), '.claude'), 'projects')
}

/** Claude's per-project directory name: every non-alphanumeric character becomes '-'. */
function projectDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

export class ClaudeTranscripts {
  private projectDirs: string[] | null = null

  constructor(private readonly projectsDir: string = claudeProjectsDir()) {}

  find(sessionId: string, cwdHint?: string): string | undefined {
    const file = `${sessionId}.jsonl`
    if (cwdHint) {
      const direct = join(this.projectsDir, projectDirName(cwdHint), file)
      if (existsSync(direct)) return direct
    }
    // Long or unusual paths get a different directory name; fall back to a scan.
    if (this.projectDirs === null) {
      try {
        this.projectDirs = readdirSync(this.projectsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      } catch {
        this.projectDirs = []
      }
    }
    for (const dir of this.projectDirs) {
      const candidate = join(this.projectsDir, dir, file)
      if (existsSync(candidate)) return candidate
    }
    return undefined
  }

  continuedIn(sessionId: string, cwdHint?: string): string | undefined {
    const path = this.find(sessionId, cwdHint)
    if (!path) return undefined
    let tail: string
    try {
      tail = readTail(path, TAIL_BYTES)
    } catch {
      return undefined
    }
    const next = continuedInFromTranscriptTail(tail, sessionId)
    // A handoff record can be written before its fork ever ran; resuming a
    // conversation that never reached disk would just fail in the tab.
    return next && this.find(next, cwdHint) ? next : undefined
  }
}

function readTail(path: string, bytes: number): string {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const length = Math.min(size, bytes)
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, size - length)
    return buffer.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/**
 * One `claude agents` call per restore; transcript reads stay synchronous and
 * cheap. Without a job list a hand-off target may still be running, and
 * resuming it would hit Claude's refusal — so restore keeps the saved ids.
 */
export async function prepareClaudeRestoreResolver(): Promise<
  ((sessionId: string, cwd: string) => ClaudeRestoreTarget) | undefined
> {
  const jobs = await listLiveClaudeBackgroundJobs()
  if (jobs === null) return undefined
  const transcripts = new ClaudeTranscripts()
  return (sessionId, cwd) =>
    resolveClaudeRestoreTarget(sessionId, jobs, (id) => transcripts.continuedIn(id, cwd))
}
