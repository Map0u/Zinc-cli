/**
 * FLIP for rows that automation moves (First-Last-Invert-Play), so they glide
 * to their new place instead of jumping. Capture the rows' tops, let React
 * commit the change, then play each moved row from its old offset back to
 * zero with a Web Animation: transform only, nothing is written to `style`,
 * so there is nothing to clean up afterwards. It is used for automation-made
 * changes only (a user's drag has its own animation) and never while a drag is
 * up, and it is skipped under `prefers-reduced-motion`.
 *
 * Same duration and curve as the rail's sibling shift and the collapse
 * animation; a new group header fades in over the tab-enter 220 ms.
 */

export const FLIP_MS = 160
export const FLIP_ENTER_MS = 220
export const FLIP_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)'

/** Top of every visible row and group header, by `t:<tabId>` / `g:<groupId>`. */
export type RailPositions = Map<string, number>

const ENTRIES = '[data-tabid], [data-groupheader]'

function keyOf(el: HTMLElement): string | null {
  const tab = el.dataset.tabid
  if (tab !== undefined) return `t:${tab}`
  const group = el.dataset.groupheader
  return group === undefined ? null : `g:${group}`
}

/** Rows inside a collapsed group are not on screen; they take no part. */
function visible(el: HTMLElement): boolean {
  return el.closest('.tab-rail-group-body[data-collapsed="true"]') === null
}

export function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** First: where every visible entry is now. One layout read per entry, once. */
export function captureRailPositions(list: HTMLElement | null): RailPositions {
  const positions: RailPositions = new Map()
  if (!list) return positions
  for (const el of list.querySelectorAll<HTMLElement>(ENTRIES)) {
    const key = keyOf(el)
    if (key !== null && visible(el)) positions.set(key, el.getBoundingClientRect().top)
  }
  return positions
}

/**
 * Last / Invert / Play, right after the commit. Returns how many entries
 * glided (0 when nothing moved, motion is reduced, or a drag is up).
 */
export function playRailFlip(list: HTMLElement | null, first: RailPositions): number {
  if (!list || first.size === 0 || reducedMotion() || list.dataset.dragging === 'true') return 0
  const moves: Array<{ el: HTMLElement; dy: number }> = []
  const entered: HTMLElement[] = []
  for (const el of list.querySelectorAll<HTMLElement>(ENTRIES)) {
    const key = keyOf(el)
    if (key === null || !visible(el)) continue
    const before = first.get(key)
    if (before === undefined) {
      // A header that was not there a moment ago: a group automation just made.
      if (key.startsWith('g:')) entered.push(el)
      continue
    }
    const dy = before - el.getBoundingClientRect().top
    if (Math.abs(dy) >= 1) moves.push({ el, dy })
  }
  if (moves.length === 0 && entered.length === 0) return 0
  if (moves.length > 0) {
    // A member glides across its group's clip box on the way: let it, until it lands.
    list.dataset.flipping = 'true'
    window.setTimeout(() => {
      delete list.dataset.flipping
    }, FLIP_MS + 60)
  }
  for (const { el, dy } of moves) {
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
      duration: FLIP_MS,
      easing: FLIP_EASING
    })
  }
  for (const el of entered) {
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FLIP_ENTER_MS, easing: FLIP_EASING })
  }
  return moves.length + entered.length
}
