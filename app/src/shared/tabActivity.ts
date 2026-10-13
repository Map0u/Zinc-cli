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

/**
 * Where a tab is and what runs in it, pushed by main whenever any field
 * changes. `projectRoot` is the enclosing git work tree (or the cwd itself
 * when there is none), and is null when the cwd is not a plausible project:
 * a drive root, the home directory or one of its ancestors, Desktop /
 * Downloads / Documents, or a repo rooted at home (dotfiles).
 */
export interface TabContext {
  cwd: string | null
  projectRoot: string | null
  /** Display name for `projectRoot` (its basename). */
  projectName: string | null
  /** Foreground AI CLI, if any. */
  tool: 'claude' | 'codex' | 'grok' | 'kimi' | null
}

/** Main → renderer IPC channel carrying `(id, TabContext)` on every change. */
export const TAB_CONTEXT_CHANNEL = 'pty:context'

/**
 * Renderer → main, sent by `onContext` right after it attaches its listener:
 * main answers by re-pushing the last context of every live tab, so a
 * subscriber that mounts after a tab was created still gets its first value.
 */
export const TAB_CONTEXT_SUBSCRIBE_CHANNEL = 'pty:context-subscribe'
