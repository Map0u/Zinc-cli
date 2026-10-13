import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  TAB_DRAG_THRESHOLD_PX,
  ghostProbeY as ghostProbeYFrom,
  liveSlotCenters as liveSlotCentersFrom,
  resolveDropIndex as resolveDropIndexFrom,
  tabDragDistance,
  tabDragShiftY,
  tabDropLineTop
} from './tabDragOrder'

/** Matches index.css / chrome easing (dropdown + settings slide). */
const TAB_MOTION_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'
const TAB_SETTLE_MS = 160
/** Lift scale on the ghost (skipped under prefers-reduced-motion). */
const TAB_DRAG_SCALE = 1.02

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Pointer-capture session for rail tab reorder.
 *
 * Smooth model (avoids between-row flicker):
 * - The tab order stays frozen until pointerup (no live reorder remounts).
 * - Source row stays in flow at opacity 0 (keeps its slot).
 * - A body-level ghost (cloneNode) is position:fixed and tracks the pointer in X/Y.
 * - dropIndex only moves sibling translateY (with midline hysteresis) - written
 *   straight to the rows' styles, so a drag never re-renders React.
 * - Order commits once on drop, then the ghost settles into the target slot.
 */
interface TabDragSession {
  pointerId: number
  tabId: string
  fromIndex: number
  dropIndex: number
  startX: number
  startY: number
  grabOffsetX: number
  grabOffsetY: number
  width: number
  height: number
  active: boolean
  didReorder: boolean
  clientX: number
  clientY: number
  frame: number | null
  settling: boolean
  /** Fixed floating clone appended to document.body. */
  ghost: HTMLElement | null
  /** Source row kept in flow (opacity 0) while the ghost is up. */
  sourceEl: HTMLElement | null
  /** Row elements in order, captured at drag start (the order is frozen during the drag). */
  rows: HTMLElement[]
  /** Viewport Y of each row center at drag start (pre-shift). */
  slotCenters: number[]
  /** list.scrollTop when slotCenters were captured - adjust centers on scroll. */
  baseScrollTop: number
}

/** What the drag needs from the rail; read fresh on every use. */
export interface RailDragHost {
  list(): HTMLElement | null
  dropLine(): HTMLElement | null
  ids(): readonly string[]
  activeId(): string | null
  isRenaming(id: string): boolean
  select(id: string): void
  move(fromIndex: number, toIndex: number): void
}

export class RailDrag {
  private session: TabDragSession | null = null
  private clickSuppressed = false

  constructor(private readonly host: RailDragHost) {}

  /** True while a drag is lifted or settling. */
  get busy(): boolean {
    return this.session !== null
  }

  /** True just after a drag ends: the click that follows pointerup must not select or clone. */
  get suppressClick(): boolean {
    return this.clickSuppressed
  }

  private rowElement(tabId: string): HTMLElement | null {
    return this.host.list()?.querySelector<HTMLElement>(`[data-tabid="${CSS.escape(tabId)}"]`) ?? null
  }

  /** Slot centers in current viewport space (base capture + scroll delta only). */
  private liveSlotCenters(session: TabDragSession): number[] {
    const scrollTop = this.host.list()?.scrollTop ?? session.baseScrollTop
    return liveSlotCentersFrom(session.slotCenters, session.baseScrollTop, scrollTop)
  }

  /** Ghost vertical center (users judge insertion by the floating row, not the cursor tip). */
  private ghostProbeY(session: TabDragSession): number {
    return ghostProbeYFrom(session.clientY, session.grabOffsetY, session.height)
  }

  /** Apply dropIndex change immediately (pointer path) - not only on the scroll rAF. */
  private syncDropIndex(session: TabDragSession): void {
    const nextDrop = resolveDropIndexFrom({
      centers: this.liveSlotCenters(session),
      fromIndex: session.fromIndex,
      dropIndex: session.dropIndex,
      probeY: this.ghostProbeY(session)
    })
    if (nextDrop === session.dropIndex) return
    session.dropIndex = nextDrop
    session.didReorder = nextDrop !== session.fromIndex
    this.paintSiblings(session)
  }

  /** Sibling shifts + insertion line, as direct style writes. */
  private paintSiblings(session: TabDragSession): void {
    session.rows.forEach((row, index) => {
      if (index === session.fromIndex) return
      const shiftY = tabDragShiftY(index, session.fromIndex, session.dropIndex)
      row.style.transform = `translate3d(0, ${shiftY}px, 0)`
    })
    const line = this.host.dropLine()
    if (!line) return
    const lineTop = tabDropLineTop(session.fromIndex, session.dropIndex, session.rows.length)
    if (lineTop == null) {
      line.removeAttribute('data-active')
      return
    }
    line.style.top = `${lineTop}px`
    line.dataset.active = 'true'
  }

  /** Idempotent: drops the list's drag state and every sibling's inline shift. */
  private clearSiblings(session: TabDragSession): void {
    this.host.list()?.removeAttribute('data-dragging')
    for (const row of session.rows) {
      row.style.transform = ''
      row.style.willChange = ''
    }
    const line = this.host.dropLine()
    if (line) {
      line.removeAttribute('data-active')
      line.style.top = ''
    }
  }

  private paintGhost(session: TabDragSession): void {
    const ghost = session.ghost
    if (!ghost) return
    const x = session.clientX - session.grabOffsetX
    const y = session.clientY - session.grabOffsetY
    const scale = prefersReducedMotion() ? 1 : TAB_DRAG_SCALE
    ghost.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
    // Accent ring when the drop slot is no longer the origin - pairs with the line.
    ghost.dataset.docked = session.dropIndex !== session.fromIndex ? 'true' : 'false'
  }

  private mountGhost(session: TabDragSession, source: HTMLElement): void {
    const reduced = prefersReducedMotion()
    const ghost = source.cloneNode(true) as HTMLElement
    ghost.removeAttribute('data-tabid')
    ghost.removeAttribute('role')
    ghost.removeAttribute('tabindex')
    ghost.removeAttribute('title')
    ghost.setAttribute('data-tab-ghost', '')
    ghost.setAttribute('aria-hidden', 'true')
    // Strip interactive controls from the clone so it can't steal events.
    for (const node of ghost.querySelectorAll('button, input, a')) {
      node.remove()
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
    ghost.style.background = getComputedStyle(source).backgroundColor || 'var(--color-row-selected)'
    ghost.style.boxShadow = reduced
      ? 'none'
      : '0 12px 32px rgba(0,0,0,0.42), 0 0 0 1px rgba(255,255,255,0.07)'
    document.body.appendChild(ghost)
    session.ghost = ghost
    session.sourceEl = source
    source.dataset.dragging = 'true'
    source.style.opacity = '0'
    source.style.pointerEvents = 'none'
    this.paintGhost(session)
  }

  private unmountGhost(session: TabDragSession): void {
    session.ghost?.remove()
    session.ghost = null
    const source = session.sourceEl
    if (source) {
      source.removeAttribute('data-dragging')
      source.style.opacity = ''
      source.style.pointerEvents = ''
    }
    session.sourceEl = null
  }

  private autoScrollList(clientY: number): boolean {
    const list = this.host.list()
    if (!list) return false
    const rect = list.getBoundingClientRect()
    const edge = 32
    const maxStep = 16
    let delta = 0
    if (clientY < rect.top + edge) {
      const t = (rect.top + edge - clientY) / edge
      delta = -Math.ceil(maxStep * Math.min(1, Math.max(0.2, t)))
    } else if (clientY > rect.bottom - edge) {
      const t = (clientY - (rect.bottom - edge)) / edge
      delta = Math.ceil(maxStep * Math.min(1, Math.max(0.2, t)))
    }
    if (delta === 0) return false
    const before = list.scrollTop
    list.scrollTop = before + delta
    return list.scrollTop !== before
  }

  /** rAF: edge auto-scroll only; drop index is synced on the pointer path. */
  private runFrame(): void {
    const session = this.session
    if (!session?.active || session.settling) return
    session.frame = null

    const scrolled = this.autoScrollList(session.clientY)
    if (scrolled) {
      // Scroll moves slots under the ghost - re-resolve drop after the scroll step.
      this.syncDropIndex(session)
      this.paintGhost(session)
      session.frame = window.requestAnimationFrame(() => this.runFrame())
    }
  }

  private scheduleFrame(session: TabDragSession): void {
    if (session.frame != null || session.settling) return
    session.frame = window.requestAnimationFrame(() => this.runFrame())
  }

  private finish(session: TabDragSession): void {
    // A delayed settle callback must not clear the UI of a newer drag.
    if (this.session !== session) return
    this.session = null
    this.unmountGhost(session)
    this.clearSiblings(session)
    if (session.didReorder || session.active) {
      this.clickSuppressed = true
      window.setTimeout(() => {
        this.clickSuppressed = false
      }, 0)
    }
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  /**
   * Commit the order once, then settle the ghost onto the target row's box.
   * One order write -> no between-row remount flicker during the gesture.
   */
  private settleAndCommit(session: TabDragSession): void {
    session.settling = true
    const from = session.fromIndex
    const to = session.dropIndex
    // Drop sibling shifts and the list's drag state before the order commits so
    // transforms don't fight the new order for a frame (that fight is the
    // between-row flash). Both land in the same task, before paint.
    this.clearSiblings(session)
    if (from !== to) {
      session.didReorder = true
      this.host.move(from, to)
    }

    const ghost = session.ghost
    if (!ghost || prefersReducedMotion()) {
      this.finish(session)
      return
    }

    // After commit, measure the source row (same id) in its new slot.
    requestAnimationFrame(() => {
      if (this.session !== session) return
      const target = this.rowElement(session.tabId)?.getBoundingClientRect()
      if (!target || !session.ghost) {
        this.finish(session)
        return
      }
      const g = session.ghost
      g.style.transition = `transform ${TAB_SETTLE_MS}ms ${TAB_MOTION_EASE}, box-shadow ${TAB_SETTLE_MS}ms ease`
      g.style.transform = `translate3d(${target.left}px, ${target.top}px, 0) scale(1)`
      g.style.boxShadow = 'none'

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
    // If the order was already committed on pointerup, just remove the
    // settling ghost and restore the source row.
    this.finish(session)
  }

  pointerDown(event: ReactPointerEvent<HTMLDivElement>, tabId: string): void {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('button, input, textarea, a')) return
    if (this.host.isRenaming(tabId)) return
    if (this.session?.settling || this.session?.active) return
    const fromIndex = this.host.ids().indexOf(tabId)
    if (fromIndex < 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    this.session = {
      pointerId: event.pointerId,
      tabId,
      fromIndex,
      dropIndex: fromIndex,
      startX: event.clientX,
      startY: event.clientY,
      grabOffsetX: event.clientX - rect.left,
      grabOffsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      active: false,
      didReorder: false,
      clientX: event.clientX,
      clientY: event.clientY,
      frame: null,
      settling: false,
      ghost: null,
      sourceEl: null,
      rows: [],
      slotCenters: [],
      baseScrollTop: 0
    }
    event.currentTarget.setPointerCapture(event.pointerId)
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
      session.active = true
      const rect = event.currentTarget.getBoundingClientRect()
      session.width = rect.width
      session.height = rect.height
      session.grabOffsetX = event.clientX - rect.left
      session.grabOffsetY = event.clientY - rect.top
      const list = this.host.list()
      session.rows = Array.from(list?.querySelectorAll<HTMLElement>('[data-tabid]') ?? [])
      session.slotCenters = session.rows.map((el) => {
        const r = el.getBoundingClientRect()
        return r.top + r.height / 2
      })
      session.baseScrollTop = list?.scrollTop ?? 0
      this.mountGhost(session, event.currentTarget)
      if (list) list.dataset.dragging = 'true'
      for (const row of session.rows) {
        if (row === event.currentTarget) continue
        row.style.willChange = 'transform'
        row.style.transform = 'translate3d(0, 0, 0)'
      }
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
      if (session.tabId !== this.host.activeId()) this.host.select(session.tabId)
    }

    event.preventDefault()
    // Ghost + drop index on the move event (no rAF lag for either).
    this.syncDropIndex(session)
    this.paintGhost(session)
    this.scheduleFrame(session)
  }

  pointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const session = this.session
    if (!session || session.pointerId !== event.pointerId) return
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
