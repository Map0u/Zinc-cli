/**
 * Pure id-based tab navigation. Everything works on the tab ids in visible
 * order, never on a DOM index into `tabs[]` — a collapsed group or a group
 * header would make those two disagree.
 */

import type { RailEntry } from './tabGroups'

export type RailNavKey = 'ArrowDown' | 'ArrowRight' | 'ArrowUp' | 'ArrowLeft' | 'Home' | 'End'

/** Id that rail keyboard navigation moves to from `currentId` (arrows wrap). */
export function railNavTarget(ids: readonly string[], currentId: string, key: RailNavKey): string | null {
  const current = ids.indexOf(currentId)
  if (current < 0 || ids.length === 0) return null
  if (key === 'Home') return ids[0]
  if (key === 'End') return ids[ids.length - 1]
  const step = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1
  return ids[(current + step + ids.length) % ids.length]
}

/**
 * `railNavTarget` over what is on screen: tab rows and group headers (see
 * `visibleEntries`). Arrows wrap; a collapsed group contributes only its header.
 */
export function railEntryTarget(
  entries: readonly RailEntry[],
  current: RailEntry,
  key: RailNavKey
): RailEntry | null {
  const index = entries.findIndex((entry) => entry.kind === current.kind && entry.id === current.id)
  if (index < 0 || entries.length === 0) return null
  if (key === 'Home') return entries[0]
  if (key === 'End') return entries[entries.length - 1]
  const step = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1
  return entries[(index + step + entries.length) % entries.length]
}

/**
 * Which tab becomes active when `closedId` goes away. Closing a background tab
 * keeps the active one; closing the active tab picks its neighbour — the next
 * tab, or the previous one when it was last — not the end of the list.
 */
export function activeAfterClose(ids: readonly string[], closedId: string, activeId: string | null): string | null {
  const index = ids.indexOf(closedId)
  if (index < 0) return activeId
  if (activeId !== closedId) return activeId
  const remaining = ids.filter((id) => id !== closedId)
  if (remaining.length === 0) return null
  return remaining[Math.min(index, remaining.length - 1)]
}
