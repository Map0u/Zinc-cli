import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { GroupHeader, type GroupHeaderHandlers } from './GroupHeader'
import { TabRow, type TabRowHandlers } from './TabRow'
import {
  buildRailItems,
  visibleEntries,
  type MoveTarget,
  type RailEntry,
  type RailItem,
  type TabGroup
} from './tabGroups'
import { cwdBasename } from './tabLabel'
import { railEntryTarget, type RailNavKey } from './tabNav'
import { captureRailPositions, playRailFlip } from './railFlip'
import { RailDrag } from './tabRailDrag'
import { useGroupOrdinals } from './tabStores'

/** The only per-tab fields the rail needs from App; title / activity / context come from their own stores. */
export interface RailTab {
  id: string
  customTitle?: string
  shellLabel?: string
  groupId?: string
}

/** Callbacks must be stable (App routes them through a ref) or the memo below buys nothing. */
export interface TabRailProps {
  tabs: readonly RailTab[]
  groups: readonly TabGroup[]
  activeId: string | null
  renamingId: string | null
  renamingGroupId: string | null
  onSwitch(id: string): void
  onClose(id: string): void
  onClone(id: string): void
  /** A drag dropped tab `id` into a group at an index, or at a top-level position. */
  onMoveTab(id: string, target: MoveTarget): void
  /** A drag dropped group `id` before the top-level unit `before` (a tab id or group id), or at the end when null. */
  onMoveGroup(id: string, before: string | null): void
  /** Alt+Up / Alt+Down on a tab or on a group header (`isGroup`). */
  onMoveStep(id: string, direction: -1 | 1, isGroup: boolean): void
  onContextMenu(id: string, x: number, y: number): void
  onRenameCommit(id: string, raw: string): void
  onRenameCancel(): void
  onToggleGroup(id: string): void
  onGroupContextMenu(id: string, x: number, y: number): void
  onRenameGroup(id: string): void
  onGroupRenameCommit(id: string, raw: string): void
  onGroupRenameCancel(): void
}

const NAV_KEYS = new Set(['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'])

/** What App can ask of the rail without it re-rendering: whether a drag is up, and a FLIP around an automatic change. */
export interface TabRailHandle {
  dragBusy(): boolean
  /** Records where the rows are now; call the result right after the change has committed to glide them to their new places. */
  captureFlip(): () => number
}

/** Shown name of a group: the user's, else the title automation gave it, else the project folder its key names, else the placeholder. */
export function groupDisplayName(group: TabGroup, placeholder: string): string {
  if (group.name) return group.name
  if (group.title) return group.title
  if (group.key) {
    const folder = cwdBasename(group.key)
    if (folder !== '') return folder
  }
  return placeholder
}

interface GroupSectionProps {
  group: TabGroup
  members: readonly RailTab[]
  /** Flat index of the first member in `tabs` (members are contiguous). */
  firstIndex: number
  /** The active tab's id when it is a member of this group, else null: other groups need not re-render when the active tab moves elsewhere. */
  activeMemberId: string | null
  renamingMemberId: string | null
  renaming: boolean
  rowHandlers: TabRowHandlers
  groupHandlers: GroupHeaderHandlers
}

/**
 * A group: its header and its members in one wrapper. Members stay mounted
 * while collapsed (so their terminals' rows keep their state) and are hidden by
 * the grid-rows animation, then `visibility`. The ordinals that tell look-alike
 * members apart are computed here, not in the header, so the header memo never
 * sees member title ticks.
 */
const GroupSection = memo(function GroupSection({
  group,
  members,
  firstIndex,
  activeMemberId,
  renamingMemberId,
  renaming,
  rowHandlers,
  groupHandlers
}: GroupSectionProps) {
  const { t } = useI18n()
  const name = groupDisplayName(group, t('NewGroup'))
  const ordinals = useGroupOrdinals(members, name)
  const memberKey = members.map((member) => member.id).join(' ')
  return (
    <div data-groupid={group.id} role="group" aria-label={name} className="tab-rail-group flex flex-col">
      <GroupHeader
        groupId={group.id}
        name={name}
        collapsed={group.collapsed}
        count={members.length}
        containsActive={activeMemberId !== null}
        renaming={renaming}
        memberKey={memberKey}
        handlers={groupHandlers}
      />
      <div className="tab-rail-group-body" data-collapsed={group.collapsed ? 'true' : 'false'}>
        <div className="tab-rail-group-inner" aria-hidden={group.collapsed || undefined}>
          <div className="tab-rail-group-list relative flex flex-col gap-0.5 pt-0.5">
            {members.map((tab, offset) => (
              <TabRow
                key={tab.id}
                id={tab.id}
                index={firstIndex + offset}
                active={tab.id === activeMemberId}
                renaming={tab.id === renamingMemberId}
                customTitle={tab.customTitle}
                shellLabel={tab.shellLabel}
                groupName={name}
                ordinal={ordinals[offset] ?? 1}
                handlers={rowHandlers}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
})

/**
 * The vertical tab list. Rows and group headers are memoized and read their own
 * title / activity from stores, so none of that re-renders App; drag visuals are
 * direct DOM writes (see RailDrag). Navigation works on ids over what is on
 * screen, never on DOM indexes.
 */
export const TabRail = memo(forwardRef<TabRailHandle, TabRailProps>(function TabRail(props, ref) {
  const { t } = useI18n()
  const { tabs, groups, activeId, renamingId, renamingGroupId } = props
  const latest = useRef(props)
  latest.current = props
  const listRef = useRef<HTMLDivElement | null>(null)
  const dropLineRef = useRef<HTMLDivElement | null>(null)

  const items = useMemo(() => buildRailItems(tabs, groups), [tabs, groups])

  const { drag, rowHandlers, groupHandlers } = useMemo(() => {
    const rowElement = (id: string): HTMLElement | null =>
      listRef.current?.querySelector<HTMLElement>(`[data-tabid="${CSS.escape(id)}"]`) ?? null
    const headerElement = (id: string): HTMLElement | null =>
      listRef.current?.querySelector<HTMLElement>(`[data-groupheader="${CSS.escape(id)}"]`) ?? null
    const entryElement = (entry: RailEntry): HTMLElement | null =>
      entry.kind === 'tab' ? rowElement(entry.id) : headerElement(entry.id)
    const entries = (): RailEntry[] => {
      const { tabs, groups } = latest.current
      return visibleEntries(buildRailItems(tabs, groups) as RailItem[])
    }
    /** Arrow keys visit rows and headers; landing on a row selects it (as before), landing on a header only focuses it. */
    const navigate = (from: RailEntry, key: RailNavKey): void => {
      const target = railEntryTarget(entries(), from, key)
      if (target === null) return
      if (target.kind === 'tab') latest.current.onSwitch(target.id)
      entryElement(target)?.focus()
    }
    /** A keyboard move can re-parent the row (a new element), which drops focus: put it back. */
    const refocus = (entry: RailEntry): void => {
      requestAnimationFrame(() => entryElement(entry)?.focus())
    }
    const menuAnchor = (event: KeyboardEvent<HTMLDivElement>): [number, number] => {
      const rect = event.currentTarget.getBoundingClientRect()
      return [rect.left + 32, rect.top + rect.height]
    }

    const drag = new RailDrag({
      list: () => listRef.current,
      dropLine: () => dropLineRef.current,
      activeId: () => latest.current.activeId,
      isRenaming: (kind, id) => (kind === 'group' ? latest.current.renamingGroupId : latest.current.renamingId) === id,
      select: (id) => latest.current.onSwitch(id),
      dropTab: (id, target) =>
        latest.current.onMoveTab(
          id,
          'into' in target ? { intoGroup: target.into, index: target.index ?? undefined } : { ungrouped: true, at: target.top }
        ),
      dropGroup: (id, before) => latest.current.onMoveGroup(id, before)
    })
    const rowHandlers: TabRowHandlers = {
      onClick: (id) => {
        if (!drag.suppressClick) latest.current.onSwitch(id)
      },
      onDoubleClick: (id) => {
        if (!drag.suppressClick && !drag.busy) latest.current.onClone(id)
      },
      onClose: (id) => latest.current.onClose(id),
      onContextMenu: (event, id) => {
        event.preventDefault()
        event.stopPropagation()
        latest.current.onContextMenu(id, event.clientX, event.clientY)
      },
      onKeyDown: (event, id) => {
        if (event.target !== event.currentTarget) return
        const { onSwitch, onMoveStep, onContextMenu } = latest.current
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSwitch(id)
          return
        }
        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault()
          onMoveStep(id, event.key === 'ArrowUp' ? -1 : 1, false)
          refocus({ kind: 'tab', id })
          return
        }
        if (NAV_KEYS.has(event.key)) {
          event.preventDefault()
          navigate({ kind: 'tab', id }, event.key as RailNavKey)
          return
        }
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault()
          const [x, y] = menuAnchor(event)
          onContextMenu(id, x, y)
        }
      },
      onPointerDown: (event, id) => drag.pointerDown(event, id, 'tab'),
      onPointerMove: (event) => drag.pointerMove(event),
      onPointerUp: (event) => drag.pointerUp(event),
      onPointerCancel: (event) => drag.pointerCancel(event),
      onLostPointerCapture: (event) => drag.lostPointerCapture(event),
      onRenameCommit: (id, raw) => latest.current.onRenameCommit(id, raw),
      onRenameCancel: () => latest.current.onRenameCancel()
    }
    const groupHandlers: GroupHeaderHandlers = {
      // One click toggles; there is deliberately no double-click rename (its first clicks would flash collapse-expand).
      onToggle: (id) => {
        if (!drag.suppressClick) latest.current.onToggleGroup(id)
      },
      onContextMenu: (event, id) => {
        event.preventDefault()
        event.stopPropagation()
        latest.current.onGroupContextMenu(id, event.clientX, event.clientY)
      },
      onKeyDown: (event, id) => {
        if (event.target !== event.currentTarget) return
        const { onToggleGroup, onRenameGroup, onMoveStep, onGroupContextMenu } = latest.current
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggleGroup(id)
          return
        }
        if (event.key === 'F2') {
          event.preventDefault()
          onRenameGroup(id)
          return
        }
        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault()
          onMoveStep(id, event.key === 'ArrowUp' ? -1 : 1, true)
          refocus({ kind: 'group', id })
          return
        }
        if (NAV_KEYS.has(event.key)) {
          event.preventDefault()
          navigate({ kind: 'group', id }, event.key as RailNavKey)
          return
        }
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault()
          const [x, y] = menuAnchor(event)
          onGroupContextMenu(id, x, y)
        }
      },
      onPointerDown: (event, id) => drag.pointerDown(event, id, 'group'),
      onPointerMove: (event) => drag.pointerMove(event),
      onPointerUp: (event) => drag.pointerUp(event),
      onPointerCancel: (event) => drag.pointerCancel(event),
      onLostPointerCapture: (event) => drag.lostPointerCapture(event),
      onRenameCommit: (id, raw, refocusHeader) => {
        latest.current.onGroupRenameCommit(id, raw)
        if (refocusHeader) refocus({ kind: 'group', id })
      },
      onRenameCancel: (refocusHeader) => {
        const id = latest.current.renamingGroupId
        latest.current.onGroupRenameCancel()
        if (refocusHeader && id) refocus({ kind: 'group', id })
      }
    }
    return { drag, rowHandlers, groupHandlers }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      dragBusy: () => drag.busy,
      captureFlip: () => {
        const first = captureRailPositions(listRef.current)
        return () => playRailFlip(listRef.current, first)
      }
    }),
    [drag]
  )

  useEffect(() => {
    const cancel = (): void => drag.cancel()
    // Esc puts a lifted drag back (and is not also an Esc for whatever has focus).
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || !drag.escape()) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('blur', cancel)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('blur', cancel)
      document.removeEventListener('keydown', onKeyDown, true)
      cancel()
    }
  }, [drag])

  // Keep the active row on screen: new tab, Ctrl+Tab wrap, close-picks-neighbour,
  // coming back from Settings. Not mid-drag, where the list scrolls on purpose.
  // A row inside a group that has just opened is measured again once the open
  // animation has finished, since it moved while the group grew.
  useEffect(() => {
    if (!activeId || drag.busy) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-tabid="${CSS.escape(activeId)}"]`)
    if (!row) return
    row.scrollIntoView({ block: 'nearest' })
    if (!row.closest('.tab-rail-group-body')) return
    const timer = window.setTimeout(() => {
      if (!drag.busy && row.isConnected) row.scrollIntoView({ block: 'nearest' })
    }, 200)
    return () => window.clearTimeout(timer)
  }, [activeId, drag])

  const firstIndexes = useMemo(() => {
    const map = new Map<string, number>()
    tabs.forEach((tab, index) => {
      if (tab.groupId !== undefined && !map.has(tab.groupId)) map.set(tab.groupId, index)
    })
    return map
  }, [tabs])

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={t('TerminalTabs')}
      aria-orientation="vertical"
      className="tab-rail-list chrome-scroll flex min-h-0 max-h-full shrink grow-0 flex-col gap-0.5 overflow-y-auto py-1"
    >
      {/* Inner relative stack so the drop line scrolls with the rows. */}
      <div className="relative flex flex-col gap-0.5">
        {items.map((item) =>
          item.kind === 'tab' ? (
            <TabRow
              key={item.tab.id}
              id={item.tab.id}
              index={tabs.indexOf(item.tab)}
              active={item.tab.id === activeId}
              renaming={item.tab.id === renamingId}
              customTitle={item.tab.customTitle}
              shellLabel={item.tab.shellLabel}
              handlers={rowHandlers}
            />
          ) : (
            <GroupSection
              key={`group:${item.group.id}`}
              group={item.group}
              members={item.tabs}
              firstIndex={firstIndexes.get(item.group.id) ?? 0}
              activeMemberId={item.tabs.some((tab) => tab.id === activeId) ? activeId : null}
              renamingMemberId={item.tabs.some((tab) => tab.id === renamingId) ? renamingId : null}
              renaming={item.group.id === renamingGroupId}
              rowHandlers={rowHandlers}
              groupHandlers={groupHandlers}
            />
          )
        )}
        <div ref={dropLineRef} className="tab-rail-drop-line" aria-hidden />
      </div>
    </div>
  )
}))
