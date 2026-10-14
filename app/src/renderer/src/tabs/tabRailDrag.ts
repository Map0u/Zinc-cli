import type { PointerEvent as ReactPointerEvent } from 'react'
import { TAB_DRAG_THRESHOLD_PX, ghostProbeY as ghostProbeYFrom, tabDragDistance } from './tabDragOrder'
import {
  dropLayout,
  dropOutcome,
  planGroupDrag,
  planTabDrag,
  resolveSlot,
  type DragEntry,
  type DropPlan,
  type DropTarget
} from './tabDropPlan'

/** Matches index.css / chrome easing (dropdown + settings slide). */
const TAB_MOTION_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'
const TAB_SETTLE_MS = 160
/** Lift scale on the ghost (skipped under prefers-reduced-motion). */
const TAB_DRAG_SCALE = 1.02
/** The selected-row tint over the popup surface: the ghost stays readable over the rows it passes (a row or header has no paint of its own when it is not selected). */
const GHOST_BACKGROUND = 'linear-gradient(var(--color-row-selected), var(--color-row-selected)), var(--color-popup-bg)'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** What is being dragged: one tab row, or a group's header with all its members. */
export type RailDragKind = 'tab' | 'group'

/**
 * Pointer-capture session for rail reorder: tab rows and whole groups.
 *
 * Smooth model (avoids between-row flicker):
 * - The tab order stays frozen until pointerup (no live reorder remounts).
 * - Every visible entry (group headers and rows, not the members of a collapsed
 *   group) is measured once when the drag starts; nothing is read from layout
 *   after that, and nothing is hard-coded about row heights.
 * - The source stays in flow at opacity 0 (a row, or the whole group block, which
 *   keeps its slot). A body-level ghost (cloneNode) is position:fixed and tracks
 *   the pointer in X/Y; for a group it is the header plus the member count.
 * - The drop slot (tabDropPlan.ts) only moves translateY on the entries that slide
 *   (with hysteresis) - written straight to their styles, so a drag never
 *   re-renders React.
 * - Order commits once on drop, then the ghost settles into the target slot.
 */
interface DragSession {
  pointerId: number
  kind: RailDragKind
  id: string
  startX: number
  startY: number
  grabOffsetX: number
  grabOffsetY: number
  width: number
  height: number
  /** Height the drop planner judges the ghost by: the row, or a group's whole block. */
  probeHeight: number
  active: boolean
  clientX: number
  clientY: number
  frame: number | null
  settling: boolean
  /** Fixed floating clone appended to document.body. */
  ghost: HTMLElement | null
  /** Kept in flow with opacity 0 while the ghost is up: the row, or the group's wrapper. */
  sourceEl: HTMLElement | null
  /** The frozen layout's drop slots; null when there is nothing to move past. */
  plan: DropPlan | null
  slot: number
  /** For each planned entry, the element that slides (null: the dragged ones, and members that slide with their group's wrapper). */
  els: (HTMLElement | null)[]
  /** The shift last written to each of `els`. */
  applied: number[]
  /** Top of the first entry: the origin of the drop line's coordinates in the scrolling stack. */
  originY: number
  /** list.scrollTop when the layout was measured - the frozen coordinates are adjusted by the scroll since. */
  baseScrollTop: number
  /** The list's own top / bottom, for the edge auto-scroll. */
  listTop: number
  listBottom: number
  /** The group wrapper that carries the "joins this group" accent right now. */
  accentEl: HTMLElement | null
  /** Group wrappers by id, for the accent. */
  wrappers: Map<string, HTMLElement>
  /** The list and the listener that re-resolves the slot when the wheel scrolls it under a still pointer. */
  scrollList: HTMLElement | null
  onScroll: (() => void) | null
}

/** What the drag needs from the rail; read fresh on every use. */
export interface RailDragHost {
  list(): HTMLElement | null
  dropLine(): HTMLElement | null
  activeId(): string | null
  isRenaming(kind: RailDragKind, id: string): boolean
  select(id: string): void
  /** A tab dropped on `target` (a different place than it came from). */
  dropTab(id: string, target: DropTarget): void
  /** A group dropped before the top-level unit `before` (a tab id or group id), or at the end when null. */
  dropGroup(id: string, before: string | null): void
}

export class RailDrag {
  private session: DragSession | null = null
  private clickSuppressed = false
  /** A drag was cancelled with the button still down: the pointerup that ends the press is not a click. */
  private swallowUp: number | null = null

  constructor(private readonly host: RailDragHost) {}

  /** True while a drag is lifted or settling. */
  get busy(): boolean {
    return this.session !== null
  }

  /** True just after a drag ends: the click that follows pointerup must not select, toggle or clone. */
  get suppressClick(): boolean {
    return this.clickSuppressed
  }

  private suppressNextClick(): void {
    this.clickSuppressed = true
    window.setTimeout(() => {
      this.clickSuppressed = false
    }, 0)
  }

  private rowElement(tabId: string): HTMLElement | null {
    return this.host.list()?.querySelector<HTMLElement>(`[data-tabid="${CSS.escape(tabId)}"]`) ?? null
  }

  private headerElement(groupId: string): HTMLElement | null {
    return this.host.list()?.querySelector<HTMLElement>(`[data-groupheader="${CSS.escape(groupId)}"]`) ?? null
  }

  /** Pick the drop slot under the ghost (pointer path - not only the scroll rAF) and repaint when it changed. */
  private syncSlot(session: DragSession): void {
    const plan = session.plan
    if (!plan) return
    const scrolled = (this.host.list()?.scrollTop ?? session.baseScrollTop) - session.baseScrollTop
    // The frozen coordinates are the viewport's at drag start: bring the ghost into them.
    const probe = ghostProbeYFrom(session.clientY, session.grabOffsetY, session.probeHeight) + scrolled
    const next = resolveSlot(plan, session.slot, probe)
    if (next === session.slot) return
    session.slot = next
    this.paintSlot(session, plan)
  }

  /**
   * Slides, drop line and group accent for the current slot, as direct style
   * writes. Whatever sits between the origin and the slot slides by the dragged
   * thing's own height plus the gap.
   */
  private paintSlot(session: DragSession, plan: DropPlan): void {
    const draggedGroup = session.kind === 'group' ? session.id : plan.entries[plan.first].groupId
    const layout = dropLayout(plan, session.slot, draggedGroup)
    session.els.forEach((el, index) => {
      if (!el || session.applied[index] === layout.shifts[index]) return
      session.applied[index] = layout.shifts[index]
      el.style.transform = `translate3d(0, ${layout.shifts[index]}px, 0)`
    })
    const line = this.host.dropLine()
    if (line) {
      if (layout.lineTop === null) {
        line.removeAttribute('data-active')
      } else {
        line.style.top = `${layout.lineTop - session.originY}px`
        if (layout.nested) line.dataset.nested = 'true'
        else line.removeAttribute('data-nested')
        line.dataset.active = 'true'
      }
    }
    const accentEl = layout.accent === null ? null : (session.wrappers.get(layout.accent) ?? null)
    if (accentEl !== session.accentEl) {
      session.accentEl?.removeAttribute('data-droptarget')
      accentEl?.setAttribute('data-droptarget', 'true')
      session.accentEl = accentEl
    }
    this.paintGhost(session)
  }

  /** Idempotent: drops the list's drag state, every entry's inline slide, the line and the accent. */
  private clearSiblings(session: DragSession): void {
    this.host.list()?.removeAttribute('data-dragging')
    if (session.scrollList && session.onScroll) session.scrollList.removeEventListener('scroll', session.onScroll)
    session.scrollList = null
    session.onScroll = null
    for (const el of session.els) {
      if (!el) continue
      el.style.transform = ''
      el.style.willChange = ''
    }
    session.accentEl?.removeAttribute('data-droptarget')
    session.accentEl = null
    const line = this.host.dropLine()
    if (line) {
      line.removeAttribute('data-active')
      line.removeAttribute('data-nested')
      line.style.top = ''
    }
  }

  private paintGhost(session: DragSession): void {
    const ghost = session.ghost
    if (!ghost) return
    const x = session.clientX - session.grabOffsetX
    const y = session.clientY - session.grabOffsetY
    const scale = prefersReducedMotion() ? 1 : TAB_DRAG_SCALE
    ghost.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
    // Accent ring when the drop slot is no longer the origin - pairs with the line.
    const plan = session.plan
    ghost.dataset.docked = plan && dropOutcome(plan, session.slot) !== null ? 'true' : 'false'
  }

  private mountGhost(session: DragSession, clone: HTMLElement, hide: HTMLElement): void {
    const reduced = prefersReducedMotion()
    const ghost = clone.cloneNode(true) as HTMLElement
    ghost.removeAttribute('data-tabid')
    ghost.removeAttribute('data-groupheader')
    ghost.removeAttribute('role')
    ghost.removeAttribute('tabindex')
    ghost.removeAttribute('title')
    ghost.setAttribute('data-tab-ghost', '')
    ghost.setAttribute('aria-hidden', 'true')
    // Strip interactive controls from the clone so it can't steal events.
    for (const node of ghost.querySelectorAll('button, input, a')) {
      node.remove()
    }
    // A group's ghost always shows how many tabs it carries.
    const count = ghost.querySelector('[data-groupcount]')
    if (count) {
      count.classList.remove('hidden')
      count.classList.add('flex')
    }
    ghost.style.position = 'fixed'
    ghost.style.left = '0'
    ghost.style.top = '0'
    ghost.style.right = 'auto'
    ghost.style.bottom = 'auto'
    ghost.style.width = `${session.width}px`
    ghost.style.height = `${session.height}px`
    ghost.style.margin = '0'
    ghost.style.zIndex = '10000'
    ghost.style.pointerEvents = 'none'
    ghost.style.transformOrigin = '0 0'
    ghost.style.transition = 'none'
    ghost.style.willChange = 'transform'
    ghost.style.boxSizing = 'border-box'
    ghost.style.cursor = 'grabbing'
    ghost.style.opacity = '1'
    ghost.style.background = GHOST_BACKGROUND
    ghost.style.boxShadow = reduced
      ? 'none'
      : '0 12px 32px rgba(0,0,0,0.42), 0 0 0 1px rgba(255,255,255,0.07)'
    document.body.appendChild(ghost)
    session.ghost = ghost
    this.hideSource(session, hide)
    this.paintGhost(session)
  }

  /** Keeps the source's slot in flow but invisible and inert while the ghost stands in for it. */
  private hideSource(session: DragSession, source: HTMLElement): void {
    if (session.sourceEl && session.sourceEl !== source) this.showSource(session)
    session.sourceEl = source
    source.dataset.dragging = 'true'
    source.style.opacity = '0'
    source.style.pointerEvents = 'none'
  }

  private showSource(session: DragSession): void {
    const source = session.sourceEl
    if (source) {
      source.removeAttribute('data-dragging')
      source.style.opacity = ''
      source.style.pointerEvents = ''
    }
    session.sourceEl = null
  }

  private unmountGhost(session: DragSession): void {
    session.ghost?.remove()
    session.ghost = null
    this.showSource(session)
  }

  private autoScrollList(session: DragSession): boolean {
    const list = this.host.list()
    if (!list) return false
    const edge = 32
    const maxStep = 16
    let delta = 0
    if (session.clientY < session.listTop + edge) {
      const t = (session.listTop + edge - session.clientY) / edge
      delta = -Math.ceil(maxStep * Math.min(1, Math.max(0.2, t)))
    } else if (session.clientY > session.listBottom - edge) {
      const t = (session.clientY - (session.listBottom - edge)) / edge
      delta = Math.ceil(maxStep * Math.min(1, Math.max(0.2, t)))
    }
    if (delta === 0) return false
    const before = list.scrollTop
    list.scrollTop = before + delta
    return list.scrollTop !== before
  }

  /** rAF: edge auto-scroll only; the drop slot is synced on the pointer path. */
  private runFrame(): void {
    const session = this.session
    if (!session?.active || session.settling) return
    session.frame = null

    const scrolled = this.autoScrollList(session)
    if (scrolled) {
      // Scroll moves the slots under the ghost - re-resolve after the scroll step.
      this.syncSlot(session)
      this.paintGhost(session)
      session.frame = window.requestAnimationFrame(() => this.runFrame())
    }
  }

  private scheduleFrame(session: DragSession): void {
    if (session.frame != null || session.settling) return
    session.frame = window.requestAnimationFrame(() => this.runFrame())
  }

  private finish(session: DragSession): void {
    // A delayed settle callback must not clear the UI of a newer drag.
    if (this.session !== session) return
    this.session = null
    this.unmountGhost(session)
    this.clearSiblings(session)
    if (session.active) this.suppressNextClick()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  /**
   * Commit the drop once, then settle the ghost onto where the dragged thing now
   * is. One order write -> no between-row remount flicker during the gesture.
   */
  private settleAndCommit(session: DragSession): void {
    session.settling = true
    const outcome = session.plan ? dropOutcome(session.plan, session.slot) : null
    // Drop the slides and the list's drag state before the order commits so
    // transforms don't fight the new order for a frame (that fight is the
    // between-row flash). Both land in the same task, before paint.
    this.clearSiblings(session)
    if (outcome) {
      if (session.kind === 'group') this.host.dropGroup(session.id, 'top' in outcome ? (outcome.before ?? null) : null)
      else this.host.dropTab(session.id, outcome)
    }

    const ghost = session.ghost
    if (!ghost || prefersReducedMotion()) {
      this.finish(session)
      return
    }

    // After commit, measure where the dragged thing now sits. A tab that joined a
    // collapsed group has no row on screen: the ghost sinks into that group's header.
    requestAnimationFrame(() => {
      if (this.session !== session) return
      const sinks = outcome !== null && 'into' in outcome && outcome.index === null
      const target =
        session.kind === 'group' || sinks
          ? this.headerElement(sinks && outcome && 'into' in outcome ? outcome.into : session.id)
          : this.rowElement(session.id)
      const rect = target?.getBoundingClientRect()
      if (!target || !rect || !session.ghost) {
        this.finish(session)
        return
      }
      // A tab that changed group is a new element (re-parented): keep it hidden under the ghost until it lands.
      if (session.kind === 'tab' && !sinks) this.hideSource(session, target)
      const g = session.ghost
      g.style.transition = `transform ${TAB_SETTLE_MS}ms ${TAB_MOTION_EASE}, box-shadow ${TAB_SETTLE_MS}ms ease, opacity ${TAB_SETTLE_MS}ms ${TAB_MOTION_EASE}`
      g.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0) scale(1)`
      g.style.boxShadow = 'none'
      if (sinks) g.style.opacity = '0'

      let finished = false
      const done = (): void => {
        if (finished) return
        finished = true
        g.removeEventListener('transitionend', onEnd)
        this.finish(session)
      }
      const onEnd = (event: TransitionEvent): void => {
        if (event.propertyName !== 'transform') return
        done()
      }
      g.addEventListener('transitionend', onEnd)
      window.setTimeout(done, TAB_SETTLE_MS + 40)
    })
  }

  private end(pointerId: number): void {
    const session = this.session
    if (!session || session.pointerId !== pointerId || session.settling) return
    if (session.frame != null) {
      window.cancelAnimationFrame(session.frame)
      session.frame = null
    }
    if (session.active) {
      // The click that follows this release (same task) must not toggle a group header or select a row.
      this.suppressNextClick()
      // A wheel may have scrolled the list since the last pointer move: drop where the ghost is now.
      this.syncSlot(session)
      this.settleAndCommit(session)
      return
    }
    this.finish(session)
  }

  /** Blur / pointer loss / unmount is not a drop. */
  cancel(): void {
    const session = this.session
    if (!session) return
    if (session.frame != null) {
      window.cancelAnimationFrame(session.frame)
      session.frame = null
    }
    // The press may still be down: its pointerup must not count as a click.
    if (session.active && !session.settling) this.swallowUp = session.pointerId
    // If the order was already committed on pointerup, just remove the
    // settling ghost and restore the source.
    this.finish(session)
  }

  /**
   * The rail's structure (tabs, their groups, collapsed groups) changed under a lifted
   * drag - a tab closed, a group opened from the keyboard: the frozen layout no longer
   * describes the rail, so the drag is put back instead of dropped on stale slots.
   * A drag that is already settling is the commit's own change and carries on.
   */
  structureChanged(): void {
    const session = this.session
    if (session?.active && !session.settling) this.cancel()
  }

  /** Esc: cancels a lifted drag (not one that is already settling). True when it did. */
  escape(): boolean {
    const session = this.session
    if (!session?.active || session.settling) return false
    this.cancel()
    return true
  }

  pointerDown(event: ReactPointerEvent<HTMLDivElement>, id: string, kind: RailDragKind = 'tab'): void {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('button, input, textarea, a')) return
    if (this.host.isRenaming(kind, id)) return
    if (this.session?.settling || this.session?.active) return
    this.swallowUp = null
    const rect = event.currentTarget.getBoundingClientRect()
    this.session = {
      pointerId: event.pointerId,
      kind,
      id,
      startX: event.clientX,
      startY: event.clientY,
      grabOffsetX: event.clientX - rect.left,
      grabOffsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      probeHeight: rect.height,
      active: false,
      clientX: event.clientX,
      clientY: event.clientY,
      frame: null,
      settling: false,
      ghost: null,
      sourceEl: null,
      plan: null,
      slot: 0,
      els: [],
      applied: [],
      originY: 0,
      baseScrollTop: 0,
      listTop: 0,
      listBottom: 0,
      accentEl: null,
      wrappers: new Map(),
      scrollList: null,
      onScroll: null
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  /**
   * The one layout read of a drag: every entry on screen - rows and group
   * headers, not the members of a collapsed group - with its box.
   */
  private freeze(session: DragSession, list: HTMLElement): void {
    const nodes = Array.from(list.querySelectorAll<HTMLElement>('[data-tabid], [data-groupheader]')).filter(
      (el) => !el.closest('[data-collapsed="true"]')
    )
    const rects = nodes.map((el) => el.getBoundingClientRect())
    const entries: DragEntry[] = nodes.map((el, index) => {
      const top = rects[index].top
      const height = rects[index].height
      const groupId = el.getAttribute('data-groupheader')
      if (groupId !== null) {
        const wrapper = el.closest<HTMLElement>('[data-groupid]')
        if (wrapper) session.wrappers.set(groupId, wrapper)
        return {
          id: groupId,
          kind: 'header',
          groupId,
          top,
          height,
          count: Number(el.getAttribute('data-count')),
          collapsed: el.getAttribute('aria-expanded') === 'false'
        }
      }
      const owner = el.closest<HTMLElement>('[data-groupid]')
      if (owner) {
        const id = owner.getAttribute('data-groupid')
        if (id !== null && !session.wrappers.has(id)) session.wrappers.set(id, owner)
      }
      return {
        id: el.getAttribute('data-tabid') ?? '',
        kind: 'row',
        groupId: owner?.getAttribute('data-groupid') ?? undefined,
        top,
        height
      }
    })
    const plan = session.kind === 'group' ? planGroupDrag(entries, session.id) : planTabDrag(entries, session.id)
    session.plan = plan
    session.originY = entries[0]?.top ?? 0
    session.baseScrollTop = list.scrollTop
    const listRect = list.getBoundingClientRect()
    session.listTop = listRect.top
    session.listBottom = listRect.bottom
    if (!plan) return
    session.slot = plan.origin
    if (session.kind === 'group') {
      session.probeHeight = entries[plan.last].top + entries[plan.last].height - entries[plan.first].top
    }
    // A group slides as one block (its wrapper); a tab drag slides rows and headers one by one.
    session.els = nodes.map((el, index) => {
      if (index >= plan.first && index <= plan.last) return null
      if (session.kind === 'tab') return el
      if (el.hasAttribute('data-groupheader')) return el.closest<HTMLElement>('[data-groupid]')
      return el.closest('[data-groupid]') ? null : el
    })
    session.applied = nodes.map(() => 0)
  }

  pointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const session = this.session
    if (!session || session.pointerId !== event.pointerId || session.settling) return
    session.clientX = event.clientX
    session.clientY = event.clientY

    if (!session.active) {
      if (tabDragDistance(event.clientX - session.startX, event.clientY - session.startY) < TAB_DRAG_THRESHOLD_PX) {
        return
      }
      const list = this.host.list()
      if (!list) {
        this.cancel()
        return
      }
      session.active = true
      const rect = event.currentTarget.getBoundingClientRect()
      session.width = rect.width
      session.height = rect.height
      session.probeHeight = rect.height
      session.grabOffsetX = event.clientX - rect.left
      session.grabOffsetY = event.clientY - rect.top
      this.freeze(session, list)
      const wrapper = session.kind === 'group' ? event.currentTarget.closest<HTMLElement>('[data-groupid]') : null
      this.mountGhost(session, event.currentTarget, wrapper ?? event.currentTarget)
      list.dataset.dragging = 'true'
      session.scrollList = list
      session.onScroll = () => this.syncSlot(session)
      list.addEventListener('scroll', session.onScroll, { passive: true })
      for (const el of session.els) {
        if (!el) continue
        el.style.willChange = 'transform'
        el.style.transform = 'translate3d(0, 0, 0)'
      }
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
      if (session.kind === 'tab' && session.id !== this.host.activeId()) this.host.select(session.id)
    }

    event.preventDefault()
    // Ghost + drop slot on the move event (no rAF lag for either).
    this.syncSlot(session)
    this.paintGhost(session)
    this.scheduleFrame(session)
  }

  pointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const session = this.session
    if (!session) {
      if (this.swallowUp === event.pointerId) {
        this.swallowUp = null
        this.suppressNextClick()
      }
      return
    }
    if (session.pointerId !== event.pointerId) return
    // Mark the drop as settled before release can emit lostpointercapture.
    this.end(event.pointerId)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
  }

  pointerCancel(event: ReactPointerEvent<HTMLDivElement>): void {
    if (this.session?.pointerId === event.pointerId) this.cancel()
  }

  lostPointerCapture(event: ReactPointerEvent<HTMLDivElement>): void {
    if (this.session?.pointerId === event.pointerId && !this.session.settling) this.cancel()
  }
}
