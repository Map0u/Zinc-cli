import { useCallback, useSyncExternalStore } from 'react'
import type { TabActivity, TabContext } from '../../../shared/tabActivity'
import { createKeyedStore, type KeyedStore } from './keyedStore'

/**
 * Per-tab values the rail shows, kept outside App's state so a title tick, an
 * activity change or a cwd change re-renders exactly one row. Rows read their
 * own id through the hooks below; nothing here is ever read from App.
 */
export const tabTitleStore = createKeyedStore<string>()

export const tabActivityStore = createKeyedStore<TabActivity>(
  (a, b) => a.state === b.state && a.kind === b.kind
)

export const tabContextStore = createKeyedStore<TabContext>(
  (a, b) => a.cwd === b.cwd && a.projectRoot === b.projectRoot && a.projectName === b.projectName && a.tool === b.tool
)

/**
 * Feeds the activity / context stores from main's pushes. The preload API is
 * optional-chained so a build (or test host) without the channel just leaves
 * every row quiet. Returns the unsubscribe.
 */
export function attachTabStores(): () => void {
  const pty = window.zinc?.pty
  const offActivity = pty?.onActivity?.((id, activity) => tabActivityStore.set(id, activity))
  const offContext = pty?.onContext?.((id, context) => tabContextStore.set(id, context))
  return () => {
    offActivity?.()
    offContext?.()
  }
}

/** Drops everything remembered for a closed tab. */
export function forgetTabValues(id: string): void {
  tabTitleStore.delete(id)
  tabActivityStore.delete(id)
  tabContextStore.delete(id)
}

function useKeyed<T>(store: KeyedStore<T>, id: string): T | undefined {
  const subscribe = useCallback((onChange: () => void) => store.subscribe(id, onChange), [store, id])
  return useSyncExternalStore(subscribe, () => store.get(id))
}

export const useTabTitle = (id: string): string | undefined => useKeyed(tabTitleStore, id)
export const useTabActivity = (id: string): TabActivity | undefined => useKeyed(tabActivityStore, id)
export const useTabContext = (id: string): TabContext | undefined => useKeyed(tabContextStore, id)

/** Tells main a finished turn on `id` has been looked at. The activity workstream owns this API, so it may be absent. */
export function markActivitySeen(id: string): void {
  const pty = window.zinc?.pty as { markActivitySeen?: (id: string) => void } | undefined
  pty?.markActivitySeen?.(id)
}
