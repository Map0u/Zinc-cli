import type { TabActivity, TabActivityState } from '../../shared/tabActivity'

/**
 * Per-tab AI-CLI activity, derived from the pty stream (OSC 7501 status
 * reports, with the terminal title as a fallback), the process lifecycle and a
 * staleness check. Pure logic — PtyManager owns the pty and the IPC.
 */

const OSC_START = '\x1b]'
/** The OSC 7501 protocol caps one sequence at 4096 bytes; the carry buffer never holds more. */
const MAX_SEQUENCE = 4096
/** A working/waiting tab whose AI tool has been gone this long is reset to a plain shell. */
export const STALE_AFTER_MS = 5000
/** Main → renderer activity pushes are coalesced to at most one per tab per this interval. */
export const EMIT_COALESCE_MS = 100

/**
 * The answer to Claude Code's `OSC 7501;?` capability probe. Fixed text: it
 * never echoes anything the program sent. Claude waits ~2s for it before
 * deciding the terminal has no status support.
 */
export const PROBE_REPLY = '\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\'

type ReportedState = 'idle' | 'working' | 'done' | 'blocked' | 'error' | 'clear'
const REPORTED_STATES: ReadonlySet<string> = new Set<ReportedState>(['idle', 'working', 'done', 'blocked', 'error', 'clear'])
const WAIT_KINDS: ReadonlySet<string> = new Set(['permission', 'question', 'auth'])

export type ScanEvent =
  | { type: 'probe' }
  | { type: 'report'; state: ReportedState; kind?: TabActivity['kind'] }
  | { type: 'title'; title: string }

/**
 * Finds OSC 7501 reports/probes and OSC 0/2 titles in the pty stream, holding a
 * sequence that is split across chunks (at most MAX_SEQUENCE chars). Chunks
 * without an OSC introducer — nearly all of them — cost one `indexOf`.
 */
export function createActivityScanner(onEvent: (event: ScanEvent) => void): (data: string) => void {
  let carry = ''
  return (data) => {
    // A chunk may also end between ESC and `]`.
    if (carry === '' && data.indexOf(OSC_START) < 0 && !data.endsWith('\x1b')) return
    const text = carry + data
    carry = ''
    let from = 0
    for (;;) {
      const start = text.indexOf(OSC_START, from)
      if (start < 0) break
      let end = -1
      let terminator = 1
      let aborted = false
      const limit = Math.min(text.length, start + 2 + MAX_SEQUENCE)
      for (let i = start + 2; i < limit; i++) {
        const c = text.charCodeAt(i)
        if (c === 0x07) { end = i; break }
        if (c === 0x1b) {
          if (i + 1 >= text.length) break // ESC is the last char: the `\` may come next chunk
          if (text[i + 1] === '\\') { end = i; terminator = 2 } else aborted = true
          break
        }
      }
      if (end < 0) {
        // Ran off the end of the chunk but still within the cap: wait for the rest.
        if (!aborted && limit === text.length) { carry = text.slice(start); break }
        // Malformed or over the cap: drop this introducer, keep scanning.
        from = start + 2
        continue
      }
      dispatch(text.slice(start + 2, end), onEvent)
      from = end + terminator
    }
    if (carry === '' && text.endsWith('\x1b')) carry = '\x1b'
  }
}

function dispatch(body: string, onEvent: (event: ScanEvent) => void): void {
  const semi = body.indexOf(';')
  if (semi < 0) return
  const code = body.slice(0, semi)
  const arg = body.slice(semi + 1)
  if (code === '0' || code === '2') {
    onEvent({ type: 'title', title: arg })
  } else if (code === '7501') {
    if (arg.startsWith('?')) { onEvent({ type: 'probe' }); return }
    const report = parseReport(arg)
    if (report) onEvent(report)
  }
}

/** `state=working:app=claude-code[:id=..][:kind=..]...` — unknown fields are ignored, an invalid state drops the record. */
function parseReport(arg: string): ScanEvent | null {
  let state: string | undefined
  let kind: string | undefined
  for (const field of arg.split(':')) {
    const eq = field.indexOf('=')
    if (eq < 0) continue
    const key = field.slice(0, eq)
    const value = field.slice(eq + 1)
    // A record with an `id` belongs to a sub-agent; the tab's own state is the id-less one.
    if (key === 'id') return null
    if (key === 'state') state = value
    else if (key === 'kind') kind = value
  }
  if (!state || !REPORTED_STATES.has(state)) return null
  const report: ScanEvent = { type: 'report', state: state as ReportedState }
  if (state === 'blocked' && kind && WAIT_KINDS.has(kind)) report.kind = kind as TabActivity['kind']
  return report
}

/**
 * Claude Code without OSC 7501 still moves its title's first glyph: a
 * four-point star when idle, a spinner frame (half-circle or braille) while
 * working (the star returning after a spinner is the end of a turn). It keeps
 * spinning while blocked on a dialog, so it can not say "waiting".
 */
function titleState(title: string): TabActivityState | null {
  const first = title.codePointAt(0)
  if (first === undefined) return null
  if (first === 0x2733) return 'idle'
  if ((first >= 0x2801 && first <= 0x28ff) || (first >= 0x25d0 && first <= 0x25d3) || (first >= 0x25f4 && first <= 0x25f7)) return 'working'
  return null
}

export interface ActivityTracker {
  feed(data: string): void
  /** The user has looked at the tab: `done` becomes `idle`. */
  markSeen(): void
  /** The pty ended: exit code 0 is `exited`, anything else `error`. Final. */
  exited(exitCode: number): void
  /** True while a staleness check can matter (working / waiting). */
  needsStaleCheck(): boolean
  /** Periodic check; `toolPresent` is whether an AI CLI is still under the shell. */
  checkStale(toolPresent: boolean, now?: number): void
  current(): TabActivity
}

export interface ActivityTrackerOptions {
  /** Answer `OSC 7501;?` probes (only meaningful when the pty runs on a console host that lets the probe through). */
  precise: boolean
  /** Writes to the pty's input. */
  reply: (data: string) => void
  onChange: (activity: TabActivity) => void
}

export function createActivityTracker({ precise, reply, onChange }: ActivityTrackerOptions): ActivityTracker {
  let state: TabActivityState = 'shell'
  let kind: TabActivity['kind']
  let fromTitle = false
  let sawReport = false
  let ended = false
  let goneSince: number | null = null

  const set = (next: TabActivityState, nextKind?: TabActivity['kind']): void => {
    if (next === state && nextKind === kind) return
    state = next
    kind = next === 'waiting' ? nextKind : undefined
    onChange(current())
  }
  const current = (): TabActivity => (kind ? { state, kind } : { state })
  const needsStaleCheck = (): boolean => !ended && (state === 'working' || state === 'waiting')

  const scan = createActivityScanner((event) => {
    if (ended) return
    if (event.type === 'probe') {
      if (precise) reply(PROBE_REPLY)
    } else if (event.type === 'report') {
      sawReport = true
      fromTitle = false
      set(event.state === 'blocked' ? 'waiting' : event.state === 'clear' ? 'shell' : event.state, event.kind)
    } else if (!sawReport) {
      const next = titleState(event.title)
      if (!next) {
        if (fromTitle) { fromTitle = false; set('shell') }
      } else if (next === 'idle') {
        // The spinner stopping is the end of a turn: surface it as `done` until seen.
        if (state === 'working') { fromTitle = true; set('done') } else if (state !== 'done') { fromTitle = true; set('idle') }
      } else {
        fromTitle = true
        set(next)
      }
    }
  })

  return {
    feed: scan,
    markSeen() {
      if (!ended && state === 'done') set('idle')
    },
    exited(exitCode) {
      if (ended) return
      set(exitCode === 0 ? 'exited' : 'error')
      ended = true
    },
    needsStaleCheck,
    checkStale(toolPresent, now = Date.now()) {
      if (!needsStaleCheck() || toolPresent) { goneSince = null; return }
      goneSince ??= now
      if (now - goneSince > STALE_AFTER_MS) { goneSince = null; fromTitle = false; set('shell') }
    },
    current
  }
}

export interface CoalescedEmitter {
  push(activity: TabActivity): void
  /** Sends the pending value now (used on exit, where there is no later tick). */
  flush(): void
  dispose(): void
}

/** Delivers only the latest value per window, and nothing if it equals what was last delivered. */
export function createCoalescedEmitter(send: (activity: TabActivity) => void, delayMs = EMIT_COALESCE_MS): CoalescedEmitter {
  let sent: TabActivity = { state: 'shell' }
  let pending: TabActivity | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    if (timer !== null) { clearTimeout(timer); timer = null }
    const next = pending
    pending = null
    if (!next || (next.state === sent.state && next.kind === sent.kind)) return
    sent = next
    send(next)
  }
  return {
    push(activity) {
      pending = activity
      if (timer === null) timer = setTimeout(flush, delayMs)
    },
    flush,
    dispose() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pending = null
    }
  }
}
