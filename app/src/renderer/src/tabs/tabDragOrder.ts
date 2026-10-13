/**
 * Small pure helpers for vertical tab-rail reorder.
 * Kept outside App.tsx so unit tests can drive them; the drop logic itself is in
 * tabDropPlan.ts.
 */

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

/** Ghost vertical center from pointer + grab anchor (not raw pointer Y); `height` is what is being judged (a row, or a group's whole block). */
export function ghostProbeY(
  clientY: number,
  grabOffsetY: number,
  height: number
): number {
  return clientY - grabOffsetY + height / 2
}
