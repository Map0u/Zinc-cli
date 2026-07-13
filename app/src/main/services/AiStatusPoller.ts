import { utilityProcess, type UtilityProcess } from 'electron'
import type { WorkerResponse } from '../statusWorkerEntry'
import type { AiStatusPayload } from '../../shared/aiStatusProtocol'
import type { ZincSettings } from '../../shared/settingsTypes'

// Status figures do not need terminal-frame latency. Three seconds reduces
// process snapshots and filesystem probes to one sixth of the former 500 ms
// cadence. Tab switches still refresh immediately, and minimized windows pause.
const POLL_MS = 3000

/**
 * Drives the status bar's poll loop (parity §1.3, cadence: `POLL_MS`): detect codex/claude in
 * the active tab's shell process tree, read its usage snapshot, push the
 * result to the renderer. Short-circuits entirely while `ShowStatusBar` is
 * off, and pauses while the window is minimized — matching the WinUI
 * original's reentrancy/minimize-pause behavior.
 *
 * All of the actual detection/read work (Toolhelp32 snapshot + PEB reads,
 * Codex .jsonl reads over WSL's 9P/UNC path) runs in a separate
 * `utilityProcess` (see `../statusWorkerEntry.ts`), never on this — the main
 * — thread, so a slow WSL round trip stalls only that disposable child, not
 * pty I/O (codex review of m5-status-bar flagged the previous fully-sync
 * implementation for exactly this). `pending` is now a real reentrancy guard:
 * it stays true for the entire async round trip to the worker, so an
 * overlapping tick is actually skipped rather than merely claiming to guard
 * synchronous work that could never re-enter anyway.
 *
 * Any read/detect exception (surfaced by the worker as an `error` message, or
 * thrown synchronously while posting to it) emits only a bounded, redacted
 * classification to stderr and is swallowed; a status-bar hiccup must never
 * crash the app. The raw worker message and stack are never logged or written
 * to a shared temporary path.
 */
export class AiStatusPoller {
  private timer: ReturnType<typeof setInterval> | null = null
  private pending = false
  private minimized = false
  private child: UtilityProcess | null = null
  private nextRequestId = 1
  /** Shell pid a still-in-flight request was issued for — lets `handleMessage`
   * tell a same-tab response from a now-stale one (see its doc comment). */
  private pendingForShellPid: number | null = null
  private pendingForActiveTabId: string | null = null

  constructor(
    private readonly workerPath: string,
    private readonly getActiveTabId: () => string | null,
    private readonly getActiveShellPid: () => number | null,
    private readonly getSettings: () => ZincSettings,
    private readonly onPayload: (payload: AiStatusPayload) => void
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), POLL_MS)
    // Fire once immediately so a freshly-opened window doesn't wait a full tick for
    // its first status (parity: state should reflect reality as soon as
    // there's an active tab to inspect).
    this.tick()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    // Kill the worker with the poller — an un-killed utilityProcess is a leaked
    // child that outlives the app's own lifecycle management (parity: matches
    // `ptyManager.killAll()` being reached from the same `before-quit` step).
    if (this.child) {
      this.child.kill()
      this.child = null
    }
  }

  setMinimized(minimized: boolean): void {
    this.minimized = minimized
  }

  /**
   * Forces an out-of-cycle tick and restarts the poll interval from now.
   * Without this, switching the active tab only updates `activeTabId` — the
   * status bar kept showing the previous tab's (now-wrong) tool/usage for up
   * to a full `POLL_MS` until the next scheduled tick happened to land.
   */
  refreshNow(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = setInterval(() => this.tick(), POLL_MS)
    }
    this.tick()
  }

  private ensureChild(): UtilityProcess {
    if (this.child) return this.child
    const child = utilityProcess.fork(this.workerPath)
    child.on('message', (message: WorkerResponse) => this.handleMessage(message))
    child.on('exit', () => {
      // Respawn lazily on the next tick rather than leaving `pending` stuck
      // true forever if the worker crashes mid-request.
      if (this.child === child) this.child = null
      this.pending = false
    })
    this.child = child
    return child
  }

  private handleMessage(message: WorkerResponse): void {
    const requestedForShellPid = this.pendingForShellPid
    const requestedForActiveTabId = this.pendingForActiveTabId
    this.pending = false
    this.pendingForShellPid = null
    this.pendingForActiveTabId = null

    // The active tab changed while this request was in flight (codex's WSL
    // .jsonl read is the slow case — ~400-500ms measured, long enough for a
    // rapid A->B->C switch to land inside it). Delivering this result would
    // paint the *new* active tab with the *old* one's tool/usage. Drop it and
    // immediately re-tick for whichever tab is actually active now, rather
    // than waiting out the rest of the poll interval for the correction.
    if (requestedForActiveTabId !== this.getActiveTabId() || requestedForShellPid !== this.getActiveShellPid()) {
      this.tick()
      return
    }

    if (message.type === 'payload') {
      this.onPayload(message.payload)
    } else if (message.type === 'error') {
      logError('worker', message.message)
      this.onPayload({ state: 'empty' })
    }
  }

  private tick(): void {
    if (this.pending || this.minimized) return
    const settings = this.getSettings()
    if (!settings.ShowStatusBar) return

    try {
      const activeTabId = this.getActiveTabId()
      const child = this.ensureChild()
      const shellPid = this.getActiveShellPid()
      this.pending = true
      this.pendingForShellPid = shellPid
      this.pendingForActiveTabId = activeTabId
      child.postMessage({
        type: 'tick',
        requestId: this.nextRequestId++,
        shellPid,
        codexSessionRoots: settings.codexSessionRoots,
        enabledTools: settings.StatusBarEnabledTools
      })
    } catch (error) {
      this.pending = false
      this.pendingForShellPid = null
      this.pendingForActiveTabId = null
      logError('dispatch', error)
      this.onPayload({ state: 'empty' })
    }
  }
}

function logError(source: 'worker' | 'dispatch', error: unknown): void {
  try {
    const code = safeErrorCode(error)
    // Deliberately do not emit the raw message or stack: worker exceptions can
    // contain local paths or excerpts from files being inspected. This
    // fixed-shape stderr event contains no prompt, transcript, token payload,
    // username, command line, or session root, and Zinc does not persist it.
    console.warn(`[zinc] ai-status ${source}${code ? ` ${code}` : ''}`)
  } catch {
    // Even the error logger must never throw back into the poll loop.
  }
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code ?? '').toUpperCase()
    if (/^(?:E[A-Z0-9_]{1,31}|ERR_[A-Z0-9_]{1,40})$/.test(code)) return code
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const match = /\b(?:ERR_[A-Z0-9_]{1,40}|E[A-Z][A-Z0-9_]{1,31})\b/i.exec(message)
  return match ? match[0].toUpperCase() : ''
}
