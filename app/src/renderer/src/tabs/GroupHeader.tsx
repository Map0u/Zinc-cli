import { memo, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { SegoeIcon } from '../segoeFluentIcons'
import { ActivitySlot } from './TabRow'
import { useGroupStatus } from './tabStores'

/** One stable object from TabRail; every handler takes the group's id so nothing is rebuilt per group. */
export interface GroupHeaderHandlers {
  onToggle(id: string): void
  onContextMenu(event: MouseEvent<HTMLDivElement>, id: string): void
  onKeyDown(event: KeyboardEvent<HTMLDivElement>, id: string): void
  onPointerDown(event: PointerEvent<HTMLDivElement>, id: string): void
  onPointerMove(event: PointerEvent<HTMLDivElement>): void
  onPointerUp(event: PointerEvent<HTMLDivElement>): void
  onPointerCancel(event: PointerEvent<HTMLDivElement>): void
  onLostPointerCapture(event: PointerEvent<HTMLDivElement>): void
  /** `refocus`: the key that ended the rename (Enter / Escape) wants focus back on the header; a click elsewhere does not. */
  onRenameCommit(id: string, raw: string, refocus: boolean): void
  onRenameCancel(refocus: boolean): void
}

export interface GroupHeaderProps {
  groupId: string
  /** What the header shows: the group's name, the project folder, or the "New group" placeholder. */
  name: string
  collapsed: boolean
  count: number
  /** The active tab is one of this group's members. */
  containsActive: boolean
  renaming: boolean
  /** Member ids joined by spaces: what the aggregate status subscribes to. */
  memberKey: string
  handlers: GroupHeaderHandlers
}

/**
 * A group's header row. Props are primitives and one stable handlers object,
 * and the aggregated status is a primitive derived from the keyed activity
 * store, so the header re-renders only when its name, collapsed state, count,
 * active flag or aggregate status changes — never on a member's title tick.
 */
export const GroupHeader = memo(function GroupHeader({
  groupId,
  name,
  collapsed,
  count,
  containsActive,
  renaming,
  memberKey,
  handlers
}: GroupHeaderProps) {
  const { t } = useI18n()
  const status = useGroupStatus(memberKey)
  const activeInside = collapsed && containsActive
  // Leaving the name as it was shown is not a rename.
  const commit = (value: string, refocus: boolean): void => {
    if (value.trim() === name) handlers.onRenameCancel(refocus)
    else handlers.onRenameCommit(groupId, value, refocus)
  }
  return (
    <div
      data-groupheader={groupId}
      role="button"
      // The active tab is hidden while its group is collapsed, so the header must stay reachable by Tab.
      tabIndex={activeInside ? 0 : -1}
      aria-expanded={!collapsed}
      aria-label={`${name}, ${count}`}
      data-count={count}
      title={name}
      className={`tab-rail-group-header mx-3 flex h-8 cursor-pointer select-none items-center rounded pl-1 pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        activeInside ? 'bg-row-selected/60' : 'hover:bg-row-hover'
      }`}
      onClick={() => handlers.onToggle(groupId)}
      onContextMenu={(e) => handlers.onContextMenu(e, groupId)}
      onKeyDown={(e) => handlers.onKeyDown(e, groupId)}
      onPointerDown={(e) => handlers.onPointerDown(e, groupId)}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
      onLostPointerCapture={handlers.onLostPointerCapture}
    >
      <span
        className="tab-rail-chevron icon-font flex h-5 w-4 shrink-0 items-center justify-center text-[9px] text-fg-tertiary"
        data-open={!collapsed}
        aria-hidden
      >
        {SegoeIcon.ChevronRight}
      </span>
      {renaming ? (
        <input
          autoFocus
          defaultValue={name}
          aria-label={t('RenameGroup')}
          className="ml-1 min-w-0 flex-1 select-text rounded bg-transparent px-1 text-[12px] font-medium text-fg-primary outline-none ring-1 ring-accent"
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commit(e.currentTarget.value, true)
            else if (e.key === 'Escape') handlers.onRenameCancel(true)
          }}
          onBlur={(e) => commit(e.currentTarget.value, false)}
        />
      ) : (
        <span className="ml-1 min-w-0 flex-1 truncate px-1 text-[12px] font-medium text-fg-secondary">{name}</span>
      )}
      {/* Always in the DOM so a dragged group's ghost can show how many tabs it carries; hidden while the group is open. */}
      <span data-groupcount className={`${collapsed && !renaming ? 'flex' : 'hidden'} shrink-0 items-center gap-1.5`} aria-hidden>
        {collapsed && (
          <span className="flex w-4 items-center justify-center">
            <ActivitySlot state={status} />
          </span>
        )}
        <span className="min-w-[1ch] text-right text-[11px] tabular-nums text-fg-tertiary">{count}</span>
      </span>
    </div>
  )
})
