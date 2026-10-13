import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { TabActivity, TabContext } from '../../../shared/tabActivity'
import { createKeyedStore, type KeyedStore } from './keyedStore'
import { aggregateStatus, type GroupStatus } from './tabGroups'
import { groupOrdinals, resolveTabLabel } from './tabLabel'

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

/**
 * What a group header shows for its members, as a primitive: the header
 * re-renders when the aggregate changes, not on every member's activity tick.
 * `memberKey` is the member ids joined by spaces (ids never contain one).
 */
export function useGroupStatus(memberKey: string): GroupStatus {
  const ids = useMemo(() => (memberKey === '' ? [] : memberKey.split(' ')), [memberKey])
  const subscribe = useCallback(
    (onChange: () => void) => {
      const offs = ids.map((id) => tabActivityStore.subscribe(id, onChange))
      return () => offs.forEach((off) => off())
    },
    [ids]
  )
  return useSyncExternalStore(subscribe, () => aggregateStatus(ids.map((id) => tabActivityStore.get(id)?.state)))
}

export interface GroupMemberLabelInput {
  id: string
  customTitle?: string
  shellLabel?: string
}

/**
 * Ordinal (1, 2, 3 ...) of each member's label among identical labels in its
 * group. The group subscribes to every member's title and context, but the
 * snapshot is one string, so it re-renders only when an ordinal changes — and
 * hands each row a number, so a row re-renders only when its own changes.
 */
export function useGroupOrdinals(members: readonly GroupMemberLabelInput[], groupName: string): number[] {
  const memberKey = members.map((member) => member.id).join(' ')
  const subscribe = useCallback(
    (onChange: () => void) => {
      const ids = memberKey === '' ? [] : memberKey.split(' ')
      const offs = ids.flatMap((id) => [tabTitleStore.subscribe(id, onChange), tabContextStore.subscribe(id, onChange)])
      return () => offs.forEach((off) => off())
    },
    [memberKey]
  )
  const snapshot = useSyncExternalStore(subscribe, () =>
    groupOrdinals(
      members.map((member) => {
        const context = tabContextStore.get(member.id)
        return resolveTabLabel(
          {
            customTitle: member.customTitle,
            title: tabTitleStore.get(member.id),
            cwd: context?.cwd,
            shellLabel: member.shellLabel,
            projectRoot: context?.projectRoot,
            tool: context?.tool
          },
          { name: groupName }
        ).label
      })
    ).join(',')
  )
  return useMemo(() => (snapshot === '' ? [] : snapshot.split(',').map(Number)), [snapshot])
}

/** Tells main a finished turn on `id` has been looked at. The activity workstream owns this API, so it may be absent. */
export function markActivitySeen(id: string): void {
  const pty = window.zinc?.pty as { markActivitySeen?: (id: string) => void } | undefined
  pty?.markActivitySeen?.(id)
}
