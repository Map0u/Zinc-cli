import { memo, useEffect, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { TabActivityState } from '../../../shared/tabActivity'
import { useI18n, type LocaleKey } from '../i18n/I18nContext'
import { SegoeIcon } from '../segoeFluentIcons'
import { resolveTabLabel, showsPositionNumber, tabSecondaryText, withOrdinal } from './tabLabel'
import { markActivitySeen, useTabActivity, useTabContext, useTabTitle } from './tabStores'

/** One stable object from TabRail; every handler takes the row's id so nothing is rebuilt per tab. */
export interface TabRowHandlers {
  onClick(id: string): void
  onDoubleClick(id: string): void
  onClose(id: string): void
  onContextMenu(event: MouseEvent<HTMLDivElement>, id: string): void
  onKeyDown(event: KeyboardEvent<HTMLDivElement>, id: string): void
  onPointerDown(event: PointerEvent<HTMLDivElement>, id: string): void
  onPointerMove(event: PointerEvent<HTMLDivElement>): void
  onPointerUp(event: PointerEvent<HTMLDivElement>): void
  onPointerCancel(event: PointerEvent<HTMLDivElement>): void
  onLostPointerCapture(event: PointerEvent<HTMLDivElement>): void
  onRenameCommit(id: string, raw: string): void
  onRenameCancel(): void
}

export interface TabRowProps {
  id: string
  /** Position in the rail: the Ctrl+N hint in the tooltip, and the slot's stand-in when a row has nothing else to show. */
  index: number
  active: boolean
  renaming: boolean
  customTitle?: string
  shellLabel?: string
  /** Set for a member of a group: the group's shown name. Absent = an ungrouped row. */
  groupName?: string
  /** Position among identical labels in its group (1 = plain); only read when `groupName` is set. */
  ordinal?: number
  handlers: TabRowHandlers
}

const STATE_LABEL_KEYS: Partial<Record<TabActivityState, LocaleKey>> = {
  working: 'TabStateWorking',
  waiting: 'TabStateWaiting',
  done: 'TabStateDone',
  error: 'TabStateError',
  exited: 'TabStateExited'
}

/** Fixed-size slot so labels stay aligned whether or not a tab has a status. */
export function ActivitySlot({ state }: { state: TabActivityState }) {
  switch (state) {
    case 'working':
      return <span className="icon-font tab-rail-activity-working text-[12px] text-fg-secondary">{SegoeIcon.TabWorking}</span>
    case 'waiting':
      return <span className="icon-font text-[12px] text-accent">{SegoeIcon.TabWaiting}</span>
    case 'done':
      return <span className="icon-font text-[12px] text-fg-secondary">{SegoeIcon.TabDone}</span>
    case 'error':
      return <span className="icon-font tab-rail-activity-error text-[12px]">{SegoeIcon.TabError}</span>
    case 'exited':
      return <span className="h-1.5 w-1.5 rounded-full bg-fg-tertiary opacity-60" />
    default:
      return null
  }
}

/**
 * One rail row. Props are primitives plus one stable handlers object, and the
 * per-tab title / activity / context come from their own stores, so a change to
 * any of them re-renders this row alone.
 */
export const TabRow = memo(function TabRow({
  id,
  index,
  active,
  renaming,
  customTitle,
  shellLabel,
  groupName,
  ordinal = 1,
  handlers
}: TabRowProps) {
  const { t } = useI18n()
  const title = useTabTitle(id)
  const context = useTabContext(id)
  const state = useTabActivity(id)?.state ?? 'shell'
  const group = groupName === undefined ? undefined : { name: groupName }
  const resolved = resolveTabLabel(
    {
      customTitle,
      title,
      cwd: context?.cwd,
      shellLabel,
      projectRoot: context?.projectRoot,
      tool: context?.tool
    },
    group
  )
  const { source } = resolved
  const label = group ? withOrdinal(resolved.label, ordinal) : resolved.label
  const secondary = tabSecondaryText(
    {
      label: resolved.label,
      source,
      projectName: context?.projectName,
      tool: context?.tool
    },
    group
  )
  // Leaving the name as it was shown is not a rename: it must not freeze an automatic label.
  const commitRename = (value: string): void => {
    if (value.trim() === label) handlers.onRenameCancel()
    else handlers.onRenameCommit(id, value)
  }
  const stateKey = STATE_LABEL_KEYS[state]
  const stateLabel = stateKey ? t(stateKey) : undefined
  const tooltip = [label, stateLabel, context?.cwd, index < 9 ? `Ctrl+${index + 1}` : undefined]
    .filter(Boolean)
    .join('\n')

  // A finished turn stays "done" until the user is looking at the tab.
  useEffect(() => {
    if (!active || state !== 'done') return
    const markSeen = (): void => markActivitySeen(id)
    if (document.hasFocus()) {
      markSeen()
      return
    }
    window.addEventListener('focus', markSeen, { once: true })
    return () => window.removeEventListener('focus', markSeen)
  }, [active, state, id])

  return (
    <div
      data-tabid={id}
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      draggable={false}
      title={tooltip}
      className={`group relative flex h-10 cursor-grab select-none items-center rounded pl-0.5 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        groupName === undefined ? 'mx-3' : 'ml-7 mr-3'
      } ${active ? 'bg-row-selected' : 'hover:bg-row-hover'}`}
      onClick={() => handlers.onClick(id)}
      onDoubleClick={() => handlers.onDoubleClick(id)}
      onContextMenu={(e) => handlers.onContextMenu(e, id)}
      onDragStart={(e) => e.preventDefault()}
      onPointerDown={(e) => handlers.onPointerDown(e, id)}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
      onLostPointerCapture={handlers.onLostPointerCapture}
      onKeyDown={(e) => handlers.onKeyDown(e, id)}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onMouseUp={(e) => {
        if (e.button === 1) handlers.onClose(id)
      }}
    >
      <span className="flex w-2.5 shrink-0 items-center justify-center">
        {active && <span className="h-4 w-[3px] rounded-full bg-accent" />}
      </span>
      <span
        className="flex w-5 shrink-0 items-center justify-center"
        role={stateLabel ? 'img' : undefined}
        aria-label={stateLabel}
      >
        {showsPositionNumber(source, state) ? (
          <span className="text-[11px] tabular-nums text-fg-tertiary">{index + 1}</span>
        ) : (
          <ActivitySlot state={state} />
        )}
      </span>
      {renaming ? (
        <input
          autoFocus
          defaultValue={label}
          aria-label={t('RenameTab')}
          className="min-w-0 flex-1 select-text rounded bg-transparent px-1 text-[13px] text-fg-primary outline-none ring-1 ring-accent"
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commitRename(e.currentTarget.value)
            else if (e.key === 'Escape') handlers.onRenameCancel()
          }}
          onBlur={(e) => commitRename(e.currentTarget.value)}
        />
      ) : (
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="min-w-0 truncate text-[13px] text-fg-primary">{label}</span>
          {secondary && (
            <span className="min-w-0 max-w-[50%] truncate text-[11px] text-fg-tertiary" style={{ flexShrink: 3 }}>
              {secondary}
            </span>
          )}
        </span>
      )}
      <button
        type="button"
        aria-label={t('CloseTab')}
        className="icon-font flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] text-fg-tertiary hover:bg-icon-hover-bg hover:text-icon-hover-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        onClick={(e) => {
          e.stopPropagation()
          handlers.onClose(id)
        }}
      >
        {SegoeIcon.Close}
      </button>
    </div>
  )
})
