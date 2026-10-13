/**
 * Tiny per-key external store for `useSyncExternalStore`. Each key has its own
 * listener set, so a change to one tab's value wakes only that tab's row —
 * never App and never the other rows.
 */
export interface KeyedStore<T> {
  get(key: string): T | undefined
  /** No-op when `equals(prev, next)`, so a repeated report costs no render. */
  set(key: string, value: T): void
  delete(key: string): void
  /** The returned function unsubscribes. */
  subscribe(key: string, listener: () => void): () => void
  /** Called after any key changes (set that changed something, or delete); for the few readers that watch the whole store. */
  subscribeAll(listener: () => void): () => void
}

export function createKeyedStore<T>(equals: (a: T, b: T) => boolean = Object.is): KeyedStore<T> {
  const values = new Map<string, T>()
  const listeners = new Map<string, Set<() => void>>()
  const everyChange = new Set<() => void>()
  const notify = (key: string): void => {
    for (const listener of listeners.get(key) ?? []) listener()
    for (const listener of everyChange) listener()
  }
  return {
    get: (key) => values.get(key),
    set(key, value) {
      if (values.has(key) && equals(values.get(key) as T, value)) return
      values.set(key, value)
      notify(key)
    },
    delete(key) {
      if (!values.delete(key)) return
      notify(key)
    },
    subscribeAll(listener) {
      everyChange.add(listener)
      return () => {
        everyChange.delete(listener)
      }
    },
    subscribe(key, listener) {
      let set = listeners.get(key)
      if (!set) listeners.set(key, (set = new Set()))
      set.add(listener)
      return () => {
        set.delete(listener)
        if (set.size === 0 && listeners.get(key) === set) listeners.delete(key)
      }
    }
  }
}
