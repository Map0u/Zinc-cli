/**
 * When automatic grouping looks at the rail again. A `cd` or a tool starting
 * is a burst of context changes, and grouping on every one of them would make
 * rows jump around under the user's eyes, so the evaluation waits for the
 * rail to be quiet: a trailing debounce, capped so a tab that never stops
 * changing (a prompt that rewrites its title all the time) still gets its turn.
 * If the user is busy with the rail (dragging, renaming, a menu open) the run
 * says so and is retried shortly, never dropped. No React and no globals but
 * the timers, which tests replace.
 */

/** Quiet time before an evaluation. */
export const AUTO_GROUP_QUIET_MS = 1500
/** Longest an evaluation is held back by a continuous stream of changes. */
export const AUTO_GROUP_MAX_WAIT_MS = 4000
/** How often a blocked evaluation checks again. */
export const AUTO_GROUP_RETRY_MS = 300

export interface AutoGroupTimers {
  now(): number
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const REAL_TIMERS: AutoGroupTimers = {
  now: () => Date.now(),
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export interface AutoGroupScheduler {
  /** Something that may change the grouping happened: (re)start the quiet period. */
  poke(): void
  /** Forget a pending evaluation (setting turned off, unmount). */
  cancel(): void
  /** True while an evaluation is waiting. */
  readonly pending: boolean
}

/**
 * `run` does one evaluation and answers `'done'` (applied, nothing to do, or not
 * wanted any more) or `'blocked'` (the user is mid-gesture: try again soon).
 */
export function createAutoGroupScheduler(
  run: () => 'done' | 'blocked',
  timers: AutoGroupTimers = REAL_TIMERS,
  quietMs = AUTO_GROUP_QUIET_MS,
  maxWaitMs = AUTO_GROUP_MAX_WAIT_MS,
  retryMs = AUTO_GROUP_RETRY_MS
): AutoGroupScheduler {
  let handle: unknown = null
  let firstPoke: number | null = null

  const fire = (): void => {
    handle = null
    if (run() === 'blocked') {
      handle = timers.set(fire, retryMs)
      return
    }
    firstPoke = null
  }

  return {
    poke() {
      const now = timers.now()
      if (firstPoke === null) firstPoke = now
      if (handle !== null) timers.clear(handle)
      handle = timers.set(fire, Math.max(0, Math.min(quietMs, firstPoke + maxWaitMs - now)))
    },
    cancel() {
      if (handle !== null) timers.clear(handle)
      handle = null
      firstPoke = null
    },
    get pending() {
      return handle !== null
    }
  }
}
