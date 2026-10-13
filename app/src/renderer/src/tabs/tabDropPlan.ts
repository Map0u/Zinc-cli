/**
 * Pure drop planning for the vertical rail's drag, with variable-height entries
 * (group headers 32px, rows 40px, 2px gaps). No React, no DOM, no imports.
 *
 * The rail measures every visible entry once when a drag starts (`DragEntry`,
 * all in one coordinate space) and everything here works on that frozen layout:
 * `planTabDrag` / `planGroupDrag` turn it into an ordered list of drop slots
 * (one band of the ghost's centre Y each), `resolveSlot` picks the slot under
 * the ghost with hysteresis, and `dropLayout` says how far every entry slides
 * and where the drop line sits. Nothing here depends on a row stride.
 *
 * Tab drags follow the flat rail's feel: the ghost centre over an entry puts the
 * tab on that entry's far side (after it when the tab came from above, before it
 * when it came from below), so a neighbour swaps after about half a row of
 * travel. On top of that the group rules apply:
 *   - a member row below the ghost's origin means "after it" inside the group; a
 *     group's first member gives its upper half to index 0 and its last member
 *     (coming from below) gives its lower half to the end, so every gap is
 *     reachable;
 *   - the entry right after a group's end gives its upper half to "outside, right
 *     after the group", and the area below the last entry is the top-level end;
 *   - on a group header the upper quarter is "before the group" (top level) and
 *     the rest is "join the group" at its end (a collapsed group is joined the
 *     same way, without opening). The tab's own group's header gives "first
 *     position in the group" instead, so grazing it never reorders the group.
 * A group drag moves the whole block among the top-level units only, by where
 * the block would land.
 */

/** Stickiness on the boundary between two slots; small enough to feel immediate, large enough to kill 1px chatter. */
export const DROP_HYSTERESIS_PX = 6

export interface DragEntry {
  /** A row's tab id, or a header's group id. */
  id: string
  kind: 'header' | 'row'
  /** The group a member row belongs to; a header carries its own group's id. */
  groupId?: string
  top: number
  height: number
  /** Header only: members in the group, hidden ones included. */
  count?: number
  /** Header only: the group is collapsed (its members are not entries). */
  collapsed?: boolean
}

/**
 * Where the dragged thing lands. `into`: a tab joins (or stays in) a group;
 * `index` counts that group's members without the dragged tab, `null` = the end
 * of a collapsed group, whose members are not on screen. `top`: the top level,
 * as an index among the top-level units (loose tabs and whole groups) without
 * the dragged one - a group that the drag empties is not counted.
 */
export type DropTarget =
  | { into: string; index: number | null }
  | { top: number; /** Group drag: the top-level unit it lands before (`null` = the end). */ before?: string | null }

export interface DropSlot {
  target: DropTarget
  /** The slot owns ghost-centre Y from here to the next slot's `lo`. */
  lo: number
  /** The dragged thing is inserted before the `p`-th kept entry (`kept.length` = after the last); `null` = nothing opens (a collapsed group is joined). */
  p: number | null
  /** This slot puts the dragged thing exactly where it already is. */
  origin: boolean
}

export interface DropPlan {
  entries: readonly DragEntry[]
  /** Entries `first..last` are the dragged thing (a row, or a group's header and visible members). */
  first: number
  last: number
  /** Indexes into `entries` of everything that is not dragged, in order. */
  kept: number[]
  slots: DropSlot[]
  /** The slot at rest (under the ghost when the drag starts). */
  origin: number
  /** Dragged height plus the gap: how far the neighbours slide to close and open a slot. */
  stride: number
  /** The gap between neighbouring entries (the line sits in the middle of it). */
  gap: number
}

const DEFAULT_GAP_PX = 2

function sameTarget(a: DropTarget, b: DropTarget): boolean {
  if ('into' in a || 'into' in b) return 'into' in a && 'into' in b && a.into === b.into && a.index === b.index
  return a.top === b.top && (a.before ?? null) === (b.before ?? null)
}

function bottomOf(entry: DragEntry): number {
  return entry.top + entry.height
}

/** The spacing between the dragged block and a neighbour, else the rail's 2px. */
function measureGap(entries: readonly DragEntry[], first: number, last: number): number {
  const after = entries[last + 1]
  if (after) return Math.max(0, after.top - bottomOf(entries[last]))
  const before = entries[first - 1]
  if (before) return Math.max(0, entries[first].top - bottomOf(before))
  return DEFAULT_GAP_PX
}

function slotIndexAt(slots: readonly DropSlot[], y: number): number {
  let found = 0
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].lo <= y) found = i
    else break
  }
  return found
}

/** Merges neighbours that mean the same thing, and marks the slots that change nothing. */
function finish(
  plan: Omit<DropPlan, 'slots' | 'origin'>,
  raw: DropSlot[],
  originTarget: DropTarget,
  originP: number,
  dragCentre: number
): DropPlan {
  const slots: DropSlot[] = []
  for (const slot of raw) {
    const origin = sameTarget(slot.target, originTarget)
    const next: DropSlot = origin ? { ...slot, p: originP, origin } : slot
    const prev = slots[slots.length - 1]
    if (prev && sameTarget(prev.target, next.target)) continue
    slots.push(next)
  }
  return { ...plan, slots, origin: slotIndexAt(slots, dragCentre) }
}

/**
 * Plans the drop of one tab row. Returns null when the row is not in `entries`
 * (or is all there is).
 */
export function planTabDrag(entries: readonly DragEntry[], tabId: string): DropPlan | null {
  const f = entries.findIndex((entry) => entry.kind === 'row' && entry.id === tabId)
  if (f < 0 || entries.length < 2) return null
  const dragged = entries[f]
  const ownGroup = dragged.groupId
  const kept: number[] = []
  entries.forEach((_, index) => {
    if (index !== f) kept.push(index)
  })
  const keptPos = (index: number): number => (index < f ? index : index - 1)

  // A group whose only member is the dragged tab is gone once the tab leaves it.
  const vanishing = (entry: DragEntry): boolean => entry.kind === 'header' && entry.id === ownGroup && entry.count === 1
  /** The entry closes a group's block: its last member, or its header when it has none on screen. */
  const endsGroup = (entry: DragEntry): boolean =>
    (entry.kind === 'row' && entry.groupId !== undefined) || (entry.kind === 'header' && !vanishing(entry))

  // Top-level numbering and member positions over the kept entries.
  const topOf: number[] = []
  const members = new Map<string, number[]>()
  let units = 0
  kept.forEach((index, pos) => {
    const entry = entries[index]
    if (entry.kind === 'row' && entry.groupId !== undefined) {
      topOf[pos] = units
      const list = members.get(entry.groupId)
      if (list) list.push(pos)
      else members.set(entry.groupId, [pos])
      return
    }
    topOf[pos] = units
    if (!vanishing(entry)) units++
  })

  const gap = measureGap(entries, f, f)
  const raw: DropSlot[] = []
  const emit = (lo: number, target: DropTarget, p: number | null): void => {
    raw.push({ target, lo, p, origin: false })
  }
  const zoneStart = (index: number): number =>
    index === 0 ? -Infinity : (bottomOf(entries[index - 1]) + entries[index].top) / 2

  // Where the dragged tab sits now.
  let originTarget: DropTarget
  if (ownGroup !== undefined) {
    const mine = members.get(ownGroup) ?? []
    originTarget = { into: ownGroup, index: mine.filter((pos) => pos < f).length }
  } else {
    const next = kept.findIndex((index) => index > f)
    originTarget = { top: next < 0 ? units : topOf[next] }
  }

  entries.forEach((entry, index) => {
    const lo = zoneStart(index)
    if (index === f) {
      emit(lo, originTarget, f)
      return
    }
    const pos = keptPos(index)
    const after = index > f
    const mid = entry.top + entry.height / 2
    if (entry.kind === 'header') {
      const collapsed = entry.collapsed === true
      const mine = members.get(entry.id) ?? []
      emit(lo, { top: topOf[pos] }, pos)
      let join: DropTarget
      let p: number | null
      if (entry.id === ownGroup) {
        join = { into: entry.id, index: 0 }
        p = pos + 1
      } else if (collapsed) {
        join = { into: entry.id, index: null }
        p = null
      } else {
        join = { into: entry.id, index: mine.length }
        p = mine.length > 0 ? mine[mine.length - 1] + 1 : pos + 1
      }
      emit(entry.top + entry.height / 4, join, p)
      return
    }
    if (entry.groupId === undefined) {
      if (!after) {
        emit(lo, { top: topOf[pos] }, pos)
      } else if (pos > 0 && endsGroup(entries[kept[pos - 1]])) {
        emit(lo, { top: topOf[pos] }, pos)
        emit(mid, { top: topOf[pos] + 1 }, pos + 1)
      } else {
        emit(lo, { top: topOf[pos] + 1 }, pos + 1)
      }
      return
    }
    // A member row.
    const groupId = entry.groupId
    const list = members.get(groupId) ?? []
    const i = list.indexOf(pos)
    const k = list.length
    const at = (slot: number): [DropTarget, number] => [
      { into: groupId, index: slot },
      slot < k ? list[slot] : list[k - 1] + 1
    ]
    const own = groupId === ownGroup
    if (after) {
      if (!own && i === 0) {
        emit(lo, ...at(0))
        emit(mid, ...at(1))
      } else {
        emit(lo, ...at(i + 1))
      }
    } else if (!own && i === k - 1) {
      emit(lo, ...at(i))
      emit(mid, ...at(k))
    } else {
      emit(lo, ...at(i))
    }
  })
  // Below the last entry: the top-level end.
  emit(bottomOf(entries[entries.length - 1]), { top: units }, kept.length)

  return finish(
    { entries, first: f, last: f, kept, stride: dragged.height + gap, gap },
    raw,
    originTarget,
    f,
    dragged.top + dragged.height / 2
  )
}

/**
 * Plans the drop of a whole group: its header and visible members are one block
 * that only ever lands between top-level units (loose tabs and other groups).
 * Returns null when there is nothing to move it past.
 */
export function planGroupDrag(entries: readonly DragEntry[], groupId: string): DropPlan | null {
  const first = entries.findIndex((entry) => entry.kind === 'header' && entry.id === groupId)
  if (first < 0) return null
  let last = first
  while (last + 1 < entries.length && entries[last + 1].kind === 'row' && entries[last + 1].groupId === groupId) last++

  const units: { id: string; first: number; top: number; bottom: number }[] = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (entry.kind === 'row' && entry.groupId !== undefined) continue
    let end = index
    if (entry.kind === 'header') while (end + 1 < entries.length && entries[end + 1].groupId === entry.id && entries[end + 1].kind === 'row') end++
    units.push({ id: entry.id, first: index, top: entry.top, bottom: bottomOf(entries[end]) })
    index = end
  }
  const mine = units.findIndex((unit) => unit.first === first)
  const rest = units.filter((_, index) => index !== mine)
  if (rest.length === 0) return null

  const kept: number[] = []
  entries.forEach((_, index) => {
    if (index < first || index > last) kept.push(index)
  })
  const removed = last - first + 1
  const keptPos = (index: number): number => (index < first ? index : index - removed)

  const gap = measureGap(entries, first, last)
  const height = bottomOf(entries[last]) - entries[first].top
  const centre = entries[first].top + height / 2
  // The ghost centre at which the block would land in each gap between the other units.
  const landing = (a: number): number => {
    if (a === mine) return centre
    const y =
      a === 0
        ? rest[0].top - gap / 2
        : a === rest.length
          ? rest[a - 1].bottom + gap / 2
          : (rest[a - 1].bottom + rest[a].top) / 2
    return a < mine ? y + height / 2 : y - height / 2
  }
  const raw: DropSlot[] = []
  for (let a = 0; a <= rest.length; a++) {
    const lo = a === 0 ? -Infinity : (landing(a - 1) + landing(a)) / 2
    const before = a < rest.length ? rest[a].id : null
    raw.push({
      target: { top: a, before },
      lo,
      p: a < rest.length ? keptPos(rest[a].first) : kept.length,
      origin: false
    })
  }
  const originTarget: DropTarget = { top: mine, before: mine < rest.length ? rest[mine].id : null }
  return finish(
    { entries, first, last, kept, stride: height + gap, gap },
    raw,
    originTarget,
    mine < rest.length ? keptPos(rest[mine].first) : kept.length,
    centre
  )
}

/**
 * The slot to use for a ghost centred at `y`, given the current one. The current
 * slot keeps `y` a little beyond its edges (hysteresis; narrower on a thin slot so
 * it can still be entered).
 */
export function resolveSlot(plan: DropPlan, current: number, y: number, hysteresisPx = DROP_HYSTERESIS_PX): number {
  const slots = plan.slots
  const raw = slotIndexAt(slots, y)
  if (raw === current || current < 0 || current >= slots.length) return raw
  const lo = slots[current].lo
  const hi = current + 1 < slots.length ? slots[current + 1].lo : Infinity
  const width = hi - lo
  const below = current > 0 ? lo - slots[current - 1].lo : Infinity
  const above = current + 2 < slots.length ? slots[current + 2].lo - hi : Infinity
  const stickLow = Math.min(hysteresisPx, width / 3, below / 3)
  const stickHigh = Math.min(hysteresisPx, width / 3, above / 3)
  return y >= lo - stickLow && y < hi + stickHigh ? current : raw
}

/** What the drop does, or null when the slot puts everything where it already is. */
export function dropOutcome(plan: DropPlan, slot: number): DropTarget | null {
  const chosen = plan.slots[slot]
  return !chosen || chosen.origin ? null : chosen.target
}

export interface DropLayout {
  /** Per entry (same order as `plan.entries`): how far it slides down; 0 for the dragged entries. */
  shifts: number[]
  /** Y of the drop line in the entries' coordinate space, or null when no gap opens. */
  lineTop: number | null
  /** The slot is inside a group: the line is indented like a member row. */
  nested: boolean
  /** The group the tab joins (the target group's wrapper gets the accent), or null. */
  accent: string | null
}

/** Closes the gap the dragged thing leaves, opens one at the slot, and says where the line goes. */
export function dropLayout(plan: DropPlan, slot: number, draggedGroup?: string): DropLayout {
  const chosen = plan.slots[slot]
  const { entries, kept, stride, gap } = plan
  const shifts = new Array<number>(entries.length).fill(0)
  const p = chosen?.p ?? null
  kept.forEach((index, pos) => {
    let shift = 0
    if (index > plan.last) shift -= stride
    if (p !== null && pos >= p) shift += stride
    shifts[index] = shift
  })
  const target = chosen?.target
  const into = target && 'into' in target ? target.into : null
  if (!chosen || chosen.origin || p === null || kept.length === 0) {
    return { shifts, lineTop: null, nested: false, accent: into !== null && into !== draggedGroup ? into : null }
  }
  const boxTop =
    p < kept.length
      ? entries[kept[p]].top + shifts[kept[p]] - stride
      : bottomOf(entries[kept[kept.length - 1]]) + shifts[kept[kept.length - 1]] + gap
  return {
    shifts,
    lineTop: boxTop - gap / 2,
    nested: into !== null,
    accent: into !== null && into !== draggedGroup ? into : null
  }
}
