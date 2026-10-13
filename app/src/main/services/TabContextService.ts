import type { AiCliTool } from '../../shared/aiCliTools'
import type { TabContext } from '../../shared/tabActivity'
import { projectNameOf } from './ProjectRoot'

export interface TabContextDeps {
  /** Prompt-reported cwd when the shell has one, else a live PEB read. Null when the tab has no session. */
  getCwd(id: string): string | null
  /** Foreground AI CLI; expected to ride the existing 1s foreground-tool cache and process snapshot. */
  getTool(id: string): AiCliTool | null
  resolveRoot(cwd: string | null): string | null
  send(id: string, context: TabContext): void
}

/** At most one output-driven evaluation per tab per this interval; the first one after a quiet spell is immediate. */
const COALESCE_MS = 250
/** Tool lookups walk the process table, so they are rate-limited harder than the cheap cwd read. */
const TOOL_RECHECK_MS = 3_000

interface TabState {
  last: TabContext | null
  tool: AiCliTool | null
  evaluatedAt: number
  toolAt: number
  /** Output arrived since the last tool lookup. */
  toolDirty: boolean
  timer: ReturnType<typeof setTimeout> | null
  timerAt: number
}

/**
 * Derives each tab's {@link TabContext} and pushes it whenever a field changes.
 * Nothing here polls on its own: evaluations are woken by the tab's pty output
 * (a `cd` is followed by a prompt, a CLI starting or exiting by output), so an
 * idle tab costs nothing and a busy one costs a cwd read every 250ms and a
 * tool lookup every 3s at most.
 */
export class TabContextService {
  private readonly tabs = new Map<string, TabState>()

  constructor(private readonly deps: TabContextDeps) {}

  /** Starts tracking a freshly spawned tab and pushes its first context straight away. */
  track(id: string): void {
    this.drop(id)
    const state: TabState = { last: null, tool: null, evaluatedAt: 0, toolAt: 0, toolDirty: true, timer: null, timerAt: 0 }
    this.tabs.set(id, state)
    this.evaluate(id, state)
  }

  drop(id: string): void {
    const state = this.tabs.get(id)
    if (state?.timer) clearTimeout(state.timer)
    this.tabs.delete(id)
  }

  /**
   * Any output from the tab's pty: the cwd, and now and then the foreground tool, may have changed.
   * A freshly prompt-reported cwd is a real change rather than noise, so it skips the coalescing wait.
   */
  noteOutput(id: string, cwdReported = false): void {
    const state = this.tabs.get(id)
    if (!state) return
    state.toolDirty = true
    this.arm(id, state, cwdReported ? 0 : state.evaluatedAt + COALESCE_MS)
  }

  /** Re-pushes every known context, for a renderer that just subscribed and missed the earlier ones. */
  resend(): void {
    for (const [id, state] of this.tabs) if (state.last) this.deps.send(id, state.last)
  }

  dispose(): void {
    for (const id of [...this.tabs.keys()]) this.drop(id)
  }

  private arm(id: string, state: TabState, at: number): void {
    if (state.timer && state.timerAt <= at) return
    if (state.timer) clearTimeout(state.timer)
    state.timerAt = at
    state.timer = setTimeout(() => this.evaluate(id, state), Math.max(0, at - Date.now()))
    state.timer.unref?.()
  }

  private evaluate(id: string, state: TabState): void {
    if (this.tabs.get(id) !== state) return
    state.timer = null
    const now = Date.now()
    state.evaluatedAt = now

    // The first evaluation (track) skips the lookup: the shell has not started its command yet.
    if (state.toolDirty && state.last) {
      if (now - state.toolAt >= TOOL_RECHECK_MS) {
        try {
          state.tool = this.deps.getTool(id)
        } catch {
          // A failed process scan keeps the last answer rather than flapping to "no tool".
        }
        state.toolAt = now
        state.toolDirty = false
      } else {
        this.arm(id, state, state.toolAt + TOOL_RECHECK_MS)
      }
    }

    const cwd = this.deps.getCwd(id) ?? state.last?.cwd ?? null
    const projectRoot = this.deps.resolveRoot(cwd)
    const next: TabContext = { cwd, projectRoot, projectName: projectNameOf(projectRoot), tool: state.tool }
    const prev = state.last
    if (prev && prev.cwd === next.cwd && prev.projectRoot === next.projectRoot && prev.tool === next.tool) return
    state.last = next
    this.deps.send(id, next)
  }
}
