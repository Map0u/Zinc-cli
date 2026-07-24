/**
 * Pure helpers for vertical tab-rail reorder.
 * Kept outside App.tsx so unit tests can drive the real drop-index logic.
 */

/** Row height (h-10) + gap-0.5 — sibling shift while the array stays frozen. */
export const TAB_ROW_STRIDE_PX = 42

/**
 * Stickiness on the *boundary between* two slots (not past a target center).
 * Small enough to feel immediate; large enough to kill 1px midline chatter.
 */
export const TAB_DROP_HYSTERESIS_PX = 6

/** Any-direction movement before a press becomes a reorder drag. */
export const TAB_DRAG_THRESHOLD_PX = 3

export function moveItem<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return list
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) {
    return list
  }
  const next = list.slice()
  const [item] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, item)
  return next
}

export function tabDragDistance(dx: number, dy: number): number {
  return Math.hypot(dx, dy)
}

/**
 * Sibling shift while the tab array is frozen during drag (dnd-kit-style).
 * Moving down: items between from and drop slide up; moving up: they slide down.
 */
export function tabDragShiftY(
  index: number,
  fromIndex: number,
  dropIndex: number,
  stridePx: number = TAB_ROW_STRIDE_PX
): number {
  if (fromIndex === dropIndex) return 0
  if (fromIndex < dropIndex) {
    if (index > fromIndex && index <= dropIndex) return -stridePx
  } else if (index >= dropIndex && index < fromIndex) {
    return stridePx
  }
  return 0
}

/**
 * Content-Y of the insertion line inside the scrollable tab stack.
 * Sits on the opened gap (not on the ghost) so the drop slot reads clearly.
 */
export function tabDropLineTop(
  fromIndex: number,
  dropIndex: number,
  count: number,
  stridePx: number = TAB_ROW_STRIDE_PX
): number | null {
  if (fromIndex === dropIndex || count <= 0) return null
  if (dropIndex < fromIndex) {
    return dropIndex * stridePx
  }
  return (dropIndex + 1) * stridePx - 2
}

/** Ghost vertical center from pointer + grab anchor (not raw pointer Y). */
export function ghostProbeY(
  clientY: number,
  grabOffsetY: number,
  height: number
): number {
  return clientY - grabOffsetY + height / 2
}

/**
 * Drop index from ghost center vs frozen slot centers.
 * Hysteresis is on the *shared boundary* between current and nearest target.
 */
export function resolveDropIndex(options: {
  centers: number[]
  fromIndex: number
  dropIndex: number
  probeY: number
  hysteresisPx?: number
}): number {
  const {
    centers,
    dropIndex: cur,
    probeY,
    hysteresisPx = TAB_DROP_HYSTERESIS_PX
  } = options
  if (centers.length === 0) return options.fromIndex

  let raw = 0
  let best = Infinity
  for (let i = 0; i < centers.length; i++) {
    const d = Math.abs(probeY - centers[i])
    if (d < best) {
      best = d
      raw = i
    }
  }

  if (raw === cur) return cur

  const hyst = hysteresisPx
  if (raw > cur) {
    const a = centers[Math.max(0, raw - 1)]
    const b = centers[raw]
    const boundary = (a + b) / 2 + hyst
    if (probeY < boundary) {
      if (cur < centers.length - 1) {
        const stepBoundary = (centers[cur] + centers[cur + 1]) / 2 + hyst
        if (probeY >= stepBoundary) return cur + 1
      }
      return cur
    }
    return raw
  }

  const a = centers[raw]
  const b = centers[Math.min(raw + 1, centers.length - 1)]
  const boundary = (a + b) / 2 - hyst
  if (probeY > boundary) {
    if (cur > 0) {
      const stepBoundary = (centers[cur - 1] + centers[cur]) / 2 - hyst
      if (probeY <= stepBoundary) return cur - 1
    }
    return cur
  }
  return raw
}

/** Adjust captured slot centers for list scroll since drag start. */
export function liveSlotCenters(
  slotCenters: number[],
  baseScrollTop: number,
  scrollTop: number
): number[] {
  if (slotCenters.length === 0) return slotCenters
  const delta = scrollTop - baseScrollTop
  if (delta === 0) return slotCenters
  return slotCenters.map((c) => c - delta)
}
