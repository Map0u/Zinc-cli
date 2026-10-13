// Per-tab activity contract between main (which derives it from the pty
// stream and process lifecycle) and the renderer's tab rail. Dependency-free
// so main, preload and renderer can all import it.

/**
 * - `shell`: no AI CLI in the foreground (plain prompt) — the rail draws nothing.
 * - `idle` / `working` / `waiting` / `done`: an AI CLI's turn state. `waiting`
 *   means it is blocked on the user (permission, question, login); `done` means a
 *   turn finished and the tab has not been looked at since.
 * - `error`: the CLI reported a failure, or the shell exited non-zero.
 * - `exited`: the tab's process ended cleanly.
 */
export type TabActivityState = 'shell' | 'idle' | 'working' | 'waiting' | 'done' | 'error' | 'exited'

export interface TabActivity {
  state: TabActivityState
  /** For `waiting`: what the CLI is blocked on, when it says. */
  kind?: 'permission' | 'question' | 'auth'
}

/** Main → renderer IPC channel carrying `(id, TabActivity)` on every state change. */
export const TAB_ACTIVITY_CHANNEL = 'pty:activity'
