import { memo, useEffect, useMemo, useRef } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { TabRow, type TabRowHandlers } from './TabRow'
import { railNavTarget, type RailNavKey } from './tabNav'
import { RailDrag } from './tabRailDrag'

/** The only per-tab fields the rail needs from App; title / activity / context come from their own stores. */
export interface RailTab {
  id: string
  customTitle?: string
  shellLabel?: string
}

/** Callbacks must be stable (App routes them through a ref) or the memo below buys nothing. */
export interface TabRailProps {
  tabs: readonly RailTab[]
  activeId: string | null
  renamingId: string | null
  onSwitch(id: string): void
  onClose(id: string): void
  onClone(id: string): void
  onMove(fromIndex: number, toIndex: number): void
  onContextMenu(id: string, x: number, y: number, returnFocus: HTMLElement): void
  onRenameCommit(id: string, raw: string): void
  onRenameCancel(): void
}

const NAV_KEYS = new Set(['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'])

/**
 * The vertical tab list. Rows are memoized and read their own title / activity
 * from stores, so none of that re-renders App; drag visuals are direct DOM
 * writes (see RailDrag). Navigation works on tab ids, never DOM indexes.
 */
export const TabRail = memo(function TabRail(props: TabRailProps) {
  const { t } = useI18n()
  const { tabs, activeId, renamingId } = props
  const latest = useRef(props)
  latest.current = props
  const listRef = useRef<HTMLDivElement | null>(null)
  const dropLineRef = useRef<HTMLDivElement | null>(null)

  const { drag, handlers } = useMemo(() => {
    const rowElement = (id: string): HTMLElement | null =>
      listRef.current?.querySelector<HTMLElement>(`[data-tabid="${CSS.escape(id)}"]`) ?? null
    const drag = new RailDrag({
      list: () => listRef.current,
      dropLine: () => dropLineRef.current,
      ids: () => latest.current.tabs.map((tab) => tab.id),
      activeId: () => latest.current.activeId,
      isRenaming: (id) => latest.current.renamingId === id,
      select: (id) => latest.current.onSwitch(id),
      move: (from, to) => latest.current.onMove(from, to)
    })
    const handlers: TabRowHandlers = {
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
        latest.current.onContextMenu(id, event.clientX, event.clientY, event.currentTarget)
      },
      onKeyDown: (event, id) => {
        if (event.target !== event.currentTarget) return
        const { tabs, onSwitch, onMove, onContextMenu } = latest.current
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSwitch(id)
          return
        }
        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault()
          const from = tabs.findIndex((tab) => tab.id === id)
          if (from >= 0) onMove(from, event.key === 'ArrowUp' ? from - 1 : from + 1)
          return
        }
        if (NAV_KEYS.has(event.key)) {
          event.preventDefault()
          const target = railNavTarget(
            tabs.map((tab) => tab.id),
            id,
            event.key as RailNavKey
          )
          if (target === null) return
          onSwitch(target)
          rowElement(target)?.focus()
          return
        }
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          onContextMenu(id, rect.left + 32, rect.top + rect.height, event.currentTarget)
        }
      },
      onPointerDown: (event, id) => drag.pointerDown(event, id),
      onPointerMove: (event) => drag.pointerMove(event),
      onPointerUp: (event) => drag.pointerUp(event),
      onPointerCancel: (event) => drag.pointerCancel(event),
      onLostPointerCapture: (event) => drag.lostPointerCapture(event),
      onRenameCommit: (id, raw) => latest.current.onRenameCommit(id, raw),
      onRenameCancel: () => latest.current.onRenameCancel()
    }
    return { drag, handlers }
  }, [])

  useEffect(() => {
    const cancel = (): void => drag.cancel()
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('blur', cancel)
      cancel()
    }
  }, [drag])

  // Keep the active row on screen: new tab, Ctrl+Tab wrap, close-picks-neighbour,
  // coming back from Settings. Not mid-drag, where the list scrolls on purpose.
  useEffect(() => {
    if (!activeId || drag.busy) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-tabid="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeId, drag])

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
        {tabs.map((tab, index) => (
          <TabRow
            key={tab.id}
            id={tab.id}
            index={index}
            active={tab.id === activeId}
            renaming={tab.id === renamingId}
            customTitle={tab.customTitle}
            shellLabel={tab.shellLabel}
            handlers={handlers}
          />
        ))}
        <div ref={dropLineRef} className="tab-rail-drop-line" aria-hidden />
      </div>
    </div>
  )
})
