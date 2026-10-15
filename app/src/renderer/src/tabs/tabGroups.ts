/**
 * Tab groups: the pure model behind the vertical rail. No React, no DOM.
 *
 * `tabs` stays the single flat array that holds the visual order; a tab joins a
 * group through `groupId`, and `groups` only carries what a header needs. Every
 * mutation goes through `normalizeRail`, which is the one place the invariants
 * are enforced:
 *   1. tabs with the same `groupId` are contiguous;
 *   2. every `groupId` names an existing group, and a group without tabs is gone;
 *   3. a group with one tab survives only if the user touched it (`name` set or
 *      `!auto`); an untouched auto group that falls to one tab dissolves;
 *   4. group order is the order of each group's first member; ungrouped tabs sit
 *      between groups in `tabs` order, and there is no nesting;
 *   5. normalizing is idempotent, and repairing contiguity pulls stragglers to the
 *      group's first member without reordering anything else.
 *
 * Every function takes and returns `{ tabs, groups }`-shaped data, never mutates
 * its input, and hands back the very same arrays/objects when nothing changed, so
 * a React state update with the result bails out. This file must stay free of
 * runtime imports: the unit tests load it on its own.
 */

import type { TabActivityState } from '../../../shared/tabActivity'

/** What the model needs from a tab; App's own `Tab` carries more and passes through untouched. */
export interface RailTabBase {
  id: string
  /** The group this tab belongs to, if any. */
  groupId?: string
  /** The user placed this tab; auto-grouping never moves it. */
  manual?: boolean
}

export interface TabGroup {
  id: string
  /** Name the user gave the group. */
  name?: string
  /** Display name automation filled in (the project folder); never counts as the user touching the group. */
  title?: string
  collapsed: boolean
  /** Created by auto-grouping and never touched by the user. */
  auto: boolean
  /** Auto-group project key (folded project root); lets a restored auto group keep its identity. */
  key?: string
}

export interface RailState<T extends RailTabBase = RailTabBase> {
  tabs: T[]
  groups: TabGroup[]
}

export type RailItem<T extends RailTabBase = RailTabBase> =
  | { kind: 'tab'; tab: T }
  | { kind: 'group'; group: TabGroup; tabs: T[] }

/** One keyboard stop in the rail: a tab row, or a group header. */
export interface RailEntry {
  kind: 'tab' | 'group'
  id: string
}

/** Keep in step with `MAX_GROUP_NAME_LENGTH` in shared/sessionState.ts (a test asserts it). */
export const MAX_GROUP_NAME_LENGTH = 256

/** Where `moveTabs` puts a tab. `before` / `after` take the slot next to a tab and join that tab's group (or none). */
export type MoveTarget =
  | { before: string }
  | { after: string }
  /** `index` counts the group's members without the moved tab; omitted = the end. */
  | { intoGroup: string; index?: number }
  /** `at` indexes the top-level items (ungrouped tabs and whole groups) without the moved tab; past the end = the end. */
  | { ungrouped: true; at: number }

// ---------------------------------------------------------------------------
// normalizer

function cleanGroup(group: TabGroup): TabGroup {
  const name = typeof group.name === 'string' && group.name.trim() !== '' ? group.name : undefined
  const title = typeof group.title === 'string' && group.title.trim() !== '' ? group.title : undefined
  const key = typeof group.key === 'string' && group.key !== '' ? group.key : undefined
  const collapsed = group.collapsed === true
  const auto = group.auto === true
  if (
    group.name === name &&
    group.title === title &&
    group.key === key &&
    group.collapsed === collapsed &&
    group.auto === auto
  )
    return group
  const clean: TabGroup = { id: group.id, collapsed, auto }
  if (name !== undefined) clean.name = name
  if (title !== undefined) clean.title = title
  if (key !== undefined) clean.key = key
  return clean
}

function withoutGroup<T extends RailTabBase>(tab: T): T {
  const { groupId: _dropped, ...rest } = tab
  return rest as T
}

/**
 * Brings any `tabs` / `groups` pair back to a state that satisfies the five
 * invariants (see the file comment). Idempotent; returns the inputs themselves
 * when they were already fine. Tabs are never dropped, reordered beyond pulling
 * stragglers into their group, or renamed.
 */
export function normalizeRail<T extends RailTabBase>(tabs: T[], groups: TabGroup[]): RailState<T> {
  // Groups: drop malformed entries and repeated ids (first wins), sanitise the fields.
  const known = new Map<string, TabGroup>()
  for (const group of groups) {
    if (!group || typeof group.id !== 'string' || group.id === '' || known.has(group.id)) continue
    known.set(group.id, cleanGroup(group))
  }

  // Tabs: a groupId that names no group is cleared.
  const counts = new Map<string, number>()
  let current = tabs
  tabs.forEach((tab, index) => {
    if (tab.groupId === undefined) return
    if (known.has(tab.groupId)) {
      counts.set(tab.groupId, (counts.get(tab.groupId) ?? 0) + 1)
      return
    }
    if (current === tabs) current = tabs.slice()
    current[index] = withoutGroup(tab)
  })

  // Groups: no members, or one member and untouched -> gone; that member becomes ungrouped.
  const dissolved = new Set<string>()
  for (const [id, group] of known) {
    const count = counts.get(id) ?? 0
    if (count === 0 || (count === 1 && group.auto && group.name === undefined)) dissolved.add(id)
  }
  if (dissolved.size > 0) {
    current = current === tabs ? tabs.slice() : current
    current.forEach((tab, index) => {
      if (tab.groupId !== undefined && dissolved.has(tab.groupId)) current[index] = withoutGroup(tab)
    })
  }

  // Contiguity: lay every group out as one block at its first member's slot.
  const ordered: T[] = []
  const placed = new Set<string>()
  for (const tab of current) {
    const groupId = tab.groupId
    if (groupId === undefined) {
      ordered.push(tab)
    } else if (!placed.has(groupId)) {
      placed.add(groupId)
      for (const member of current) if (member.groupId === groupId) ordered.push(member)
    }
  }
  const sameOrder = ordered.every((tab, index) => tab === current[index])
  const outTabs = sameOrder ? current : ordered

  // Group order follows the first member in the final tab order.
  const orderedGroups: TabGroup[] = []
  for (const tab of outTabs) {
    if (tab.groupId === undefined) continue
    const group = known.get(tab.groupId)
    if (group && !orderedGroups.includes(group)) orderedGroups.push(group)
  }
  const outGroups =
    orderedGroups.length === groups.length && orderedGroups.every((group, index) => group === groups[index])
      ? groups
      : orderedGroups

  // Nothing changed at all: hand back the caller's own arrays.
  if (outTabs.length === tabs.length && outTabs.every((tab, index) => tab === tabs[index])) {
    return { tabs, groups: outGroups }
  }
  return { tabs: outTabs, groups: outGroups }
}

// ---------------------------------------------------------------------------
// read side

/** The rail as the renderer draws it: ungrouped tabs and whole groups, in order. */
export function buildRailItems<T extends RailTabBase>(tabs: readonly T[], groups: readonly TabGroup[]): RailItem<T>[] {
  const byId = new Map(groups.map((group) => [group.id, group]))
  const items: RailItem<T>[] = []
  const open = new Map<string, Extract<RailItem<T>, { kind: 'group' }>>()
  for (const tab of tabs) {
    const group = tab.groupId === undefined ? undefined : byId.get(tab.groupId)
    if (!group) {
      items.push({ kind: 'tab', tab })
      continue
    }
    let item = open.get(group.id)
    if (!item) {
      item = { kind: 'group', group, tabs: [] }
      open.set(group.id, item)
      items.push(item)
    }
    item.tabs.push(tab)
  }
  return items
}

/** The ids of the tabs that are on screen: everything outside a collapsed group. */
export function visibleTabIds(tabs: readonly RailTabBase[], groups: readonly TabGroup[]): string[] {
  const collapsed = new Set(groups.filter((group) => group.collapsed).map((group) => group.id))
  return tabs.filter((tab) => tab.groupId === undefined || !collapsed.has(tab.groupId)).map((tab) => tab.id)
}

/** What arrow-key navigation visits, top to bottom: tabs and group headers, minus members of collapsed groups. */
export function visibleEntries(items: readonly RailItem[]): RailEntry[] {
  const entries: RailEntry[] = []
  for (const item of items) {
    if (item.kind === 'tab') {
      entries.push({ kind: 'tab', id: item.tab.id })
      continue
    }
    entries.push({ kind: 'group', id: item.group.id })
    if (!item.group.collapsed) for (const tab of item.tabs) entries.push({ kind: 'tab', id: tab.id })
  }
  return entries
}

const STATUS_RANK: Partial<Record<TabActivityState, number>> = { waiting: 4, error: 3, working: 2, done: 1 }
const STATUS_BY_RANK = ['idle', 'done', 'working', 'error', 'waiting'] as const

/** What a group header shows for its members; `idle` draws nothing. */
export type GroupStatus = (typeof STATUS_BY_RANK)[number]

/**
 * waiting > error > working > done > idle. `shell`, `idle`, `exited` and tabs
 * that have reported nothing all count as idle. A string on purpose: a header
 * subscribes to this and re-renders only when it changes.
 */
export function aggregateStatus(states: Iterable<TabActivityState | undefined>): GroupStatus {
  let rank = 0
  for (const state of states) {
    const value = (state && STATUS_RANK[state]) || 0
    if (value > rank) rank = value
  }
  return STATUS_BY_RANK[rank]
}

/**
 * Which tab becomes active when `closedId` closes. Closing a background tab keeps
 * the active one; closing the active tab picks its neighbour in *visible* order
 * (the next tab, else the previous), so it never lands inside a collapsed group.
 */
export function neighborAfterClose(
  tabs: readonly RailTabBase[],
  groups: readonly TabGroup[],
  closedId: string,
  activeId: string | null
): string | null {
  if (activeId !== closedId) return activeId
  const collapsed = new Set(groups.filter((group) => group.collapsed).map((group) => group.id))
  // The closing tab itself may sit in a collapsed group (collapsed around the active tab): it still marks the spot.
  const visible = tabs.filter((tab) => tab.id === closedId || tab.groupId === undefined || !collapsed.has(tab.groupId))
  const index = visible.findIndex((tab) => tab.id === closedId)
  if (index < 0) return activeId
  const remaining = visible.filter((tab) => tab.id !== closedId)
  if (remaining.length === 0) {
    // Everything else is hidden in collapsed groups: fall back to the tab next to it, which will expand its group.
    const rest = tabs.filter((tab) => tab.id !== closedId)
    const at = tabs.findIndex((tab) => tab.id === closedId)
    return rest.length === 0 ? null : rest[Math.min(at, rest.length - 1)].id
  }
  return remaining[Math.min(index, remaining.length - 1)].id
}

// ---------------------------------------------------------------------------
// ops

function touched<T extends RailTabBase>(tab: T): T {
  return tab.manual === true ? tab : { ...tab, manual: true }
}

function placeIn<T extends RailTabBase>(tab: T, groupId: string | undefined): T {
  const base = { ...tab, manual: true } as T
  return groupId === undefined ? withoutGroup(base) : { ...base, groupId }
}

/** A new, user-made group around `ids` (those that exist), placed where its first member was. Members become `manual`. */
export function createGroup<T extends RailTabBase>(
  tabs: T[],
  groups: TabGroup[],
  ids: readonly string[],
  groupId: string,
  name?: string
): RailState<T> {
  const state = normalizeRail(tabs, groups)
  const wanted = new Set(ids)
  const members = state.tabs.filter((tab) => wanted.has(tab.id))
  if (members.length === 0 || state.groups.some((group) => group.id === groupId)) return state
  const joined = new Set(members)
  const next: T[] = []
  for (const tab of state.tabs) {
    if (!joined.has(tab)) next.push(tab)
    else if (tab === members[0]) for (const member of members) next.push(placeIn(member, groupId))
  }
  const group: TabGroup = { id: groupId, collapsed: false, auto: false }
  const clean = cleanName(name)
  if (clean !== undefined) group.name = clean
  return normalizeRail(next, [...state.groups, group])
}

/**
 * Moves one tab and normalizes. The tab becomes `manual`. A move that changes
 * neither position nor group is a no-op (it does not mark the tab manual).
 */
export function moveTabs<T extends RailTabBase>(
  tabs: T[],
  groups: TabGroup[],
  id: string,
  target: MoveTarget
): RailState<T> {
  const state = normalizeRail(tabs, groups)
  const from = state.tabs.findIndex((tab) => tab.id === id)
  if (from < 0) return state
  const moved = state.tabs[from]
  const rest = state.tabs.filter((tab) => tab.id !== id)

  let at: number
  let groupId: string | undefined
  if ('before' in target || 'after' in target) {
    const anchorId = 'before' in target ? target.before : target.after
    const anchor = rest.findIndex((tab) => tab.id === anchorId)
    if (anchor < 0) return state
    at = 'before' in target ? anchor : anchor + 1
    groupId = rest[anchor].groupId
  } else if ('intoGroup' in target) {
    if (!state.groups.some((group) => group.id === target.intoGroup)) return state
    groupId = target.intoGroup
    const slots: number[] = []
    rest.forEach((tab, index) => {
      if (tab.groupId === groupId) slots.push(index)
    })
    if (slots.length === 0) {
      at = Math.min(from, rest.length)
    } else {
      const index = Math.max(0, Math.min(target.index ?? slots.length, slots.length))
      at = index < slots.length ? slots[index] : slots[slots.length - 1] + 1
    }
  } else {
    groupId = undefined
    const items = buildRailItems(rest, state.groups)
    const index = Math.max(0, Math.min(Math.trunc(target.at) || 0, items.length))
    const item = items[index]
    at = item === undefined ? rest.length : rest.indexOf(item.kind === 'tab' ? item.tab : item.tabs[0])
  }

  if (at === from && groupId === moved.groupId) return state
  const next = rest.slice()
  next.splice(at, 0, placeIn(moved, groupId))
  return normalizeRail(next, state.groups)
}

/**
 * Moves a whole group before the top-level item `beforeItemId` (an ungrouped
 * tab's id or another group's id), or to the end when that is `null`. Members
 * become `manual`.
 */
export function moveGroup<T extends RailTabBase>(
  tabs: T[],
  groups: TabGroup[],
  groupId: string,
  beforeItemId: string | null
): RailState<T> {
  const state = normalizeRail(tabs, groups)
  const members = state.tabs.filter((tab) => tab.groupId === groupId)
  if (members.length === 0 || beforeItemId === groupId) return state
  const rest = state.tabs.filter((tab) => tab.groupId !== groupId)
  let at = rest.length
  if (beforeItemId !== null) {
    const item = buildRailItems(rest, state.groups).find((candidate) =>
      candidate.kind === 'group' ? candidate.group.id === beforeItemId : candidate.tab.id === beforeItemId
    )
    if (!item) return state
    at = rest.indexOf(item.kind === 'tab' ? item.tab : item.tabs[0])
  }
  const first = state.tabs.indexOf(members[0])
  if (at === first) return state
  const next = rest.slice()
  next.splice(at, 0, ...members.map(touched))
  return normalizeRail(next, state.groups)
}

/**
 * Takes a tab out of its group (`manual`). It lands just before the group when it
 * was the first member, otherwise just after the group's last member.
 */
export function ungroupTab<T extends RailTabBase>(tabs: T[], groups: TabGroup[], id: string): RailState<T> {
  const state = normalizeRail(tabs, groups)
  const from = state.tabs.findIndex((tab) => tab.id === id)
  const moved = state.tabs[from]
  if (!moved || moved.groupId === undefined) return state
  const groupId = moved.groupId
  const rest = state.tabs.filter((tab) => tab.id !== id)
  const slots: number[] = []
  rest.forEach((tab, index) => {
    if (tab.groupId === groupId) slots.push(index)
  })
  const first = state.tabs.findIndex((tab) => tab.groupId === groupId)
  const at = slots.length === 0 ? from : first === from ? slots[0] : slots[slots.length - 1] + 1
  const next = rest.slice()
  next.splice(at, 0, placeIn(moved, undefined))
  return normalizeRail(next, state.groups)
}

/** Removes the group and keeps its tabs where they are, ungrouped and `manual`. */
export function dissolveGroup<T extends RailTabBase>(tabs: T[], groups: TabGroup[], groupId: string): RailState<T> {
  const state = normalizeRail(tabs, groups)
  if (!state.groups.some((group) => group.id === groupId)) return state
  return normalizeRail(
    state.tabs.map((tab) => (tab.groupId === groupId ? placeIn(tab, undefined) : tab)),
    state.groups.filter((group) => group.id !== groupId)
  )
}

function cleanName(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_GROUP_NAME_LENGTH).trim()
  return clean === '' ? undefined : clean
}

/**
 * Names a group. A real name makes it the user's (`auto: false`); an empty one
 * clears the name and changes nothing else.
 */
export function renameGroup<T extends RailTabBase>(
  tabs: T[],
  groups: TabGroup[],
  groupId: string,
  name: string
): RailState<T> {
  const state = normalizeRail(tabs, groups)
  const index = state.groups.findIndex((group) => group.id === groupId)
  if (index < 0) return state
  const group = state.groups[index]
  const clean = cleanName(name)
  const next: TabGroup = { id: group.id, collapsed: group.collapsed, auto: clean === undefined ? group.auto : false }
  if (clean !== undefined) next.name = clean
  if (group.title !== undefined) next.title = group.title
  if (group.key !== undefined) next.key = group.key
  if (next.name === group.name && next.auto === group.auto) return state
  return { tabs: state.tabs, groups: state.groups.map((candidate, i) => (i === index ? next : candidate)) }
}

/** Collapses or expands a group; `collapsed` omitted = flip. */
export function toggleCollapsed<T extends RailTabBase>(
  tabs: T[],
  groups: TabGroup[],
  groupId: string,
  collapsed?: boolean
): RailState<T> {
  const state = normalizeRail(tabs, groups)
  const index = state.groups.findIndex((group) => group.id === groupId)
  if (index < 0) return state
  const group = state.groups[index]
  const value = collapsed ?? !group.collapsed
  if (value === group.collapsed) return state
  return {
    tabs: state.tabs,
    groups: state.groups.map((candidate, i) => (i === index ? { ...candidate, collapsed: value } : candidate))
  }
}

/** Expands the group holding `id` if it is collapsed: switching to a tab must never leave it hidden. */
export function revealTab<T extends RailTabBase>(tabs: T[], groups: TabGroup[], id: string): RailState<T> {
  const groupId = tabs.find((tab) => tab.id === id)?.groupId
  if (groupId === undefined) return normalizeRail(tabs, groups)
  return toggleCollapsed(tabs, groups, groupId, false)
}

/**
 * Alt+Up / Alt+Down on a tab: one visible position. An ungrouped tab swaps with
 * the neighbouring tab, or jumps over a whole neighbouring group (dragging is how
 * a tab joins one). A member swaps inside its group and, at the group's edge,
 * leaves it to sit just outside. The only member of a group takes the group along.
 */
export function moveTabStep<T extends RailTabBase>(
  tabs: T[],
  groups: TabGroup[],
  id: string,
  direction: -1 | 1
): RailState<T> {
  const state = normalizeRail(tabs, groups)
  const items = buildRailItems(state.tabs, state.groups)
  const itemIndex = items.findIndex((item) => (item.kind === 'tab' ? item.tab.id === id : item.tabs.some((tab) => tab.id === id)))
  if (itemIndex < 0) return state
  const item = items[itemIndex]
  if (item.kind === 'tab') {
    const at = itemIndex + direction
    if (at < 0 || at >= items.length) return state
    return moveTabs(state.tabs, state.groups, id, { ungrouped: true, at })
  }
  if (item.tabs.length === 1) return moveGroupStep(state.tabs, state.groups, item.group.id, direction)
  const position = item.tabs.findIndex((tab) => tab.id === id)
  const target = position + direction
  if (target >= 0 && target < item.tabs.length) {
    return moveTabs(state.tabs, state.groups, id, { intoGroup: item.group.id, index: target })
  }
  return moveTabs(state.tabs, state.groups, id, { ungrouped: true, at: direction < 0 ? itemIndex : itemIndex + 1 })
}

/** Alt+Up / Alt+Down on a group header: the whole group swaps places with the neighbouring item. */
export function moveGroupStep<T extends RailTabBase>(
  tabs: T[],
  groups: TabGroup[],
  groupId: string,
  direction: -1 | 1
): RailState<T> {
  const state = normalizeRail(tabs, groups)
  const items = buildRailItems(state.tabs, state.groups)
  const index = items.findIndex((item) => item.kind === 'group' && item.group.id === groupId)
  if (index < 0) return state
  // Up: land before the previous item. Down: land before the item after the next one (or at the end).
  if (direction < 0 ? index === 0 : index === items.length - 1) return state
  const before = items[direction < 0 ? index - 1 : index + 2]
  const beforeId = before === undefined ? null : before.kind === 'tab' ? before.tab.id : before.group.id
  return moveGroup(state.tabs, state.groups, groupId, beforeId)
}

// ---------------------------------------------------------------------------
// auto-grouping

/** What automation reads from a tab's context (a subset of `TabContext`). */
export interface AutoGroupContext {
  projectRoot: string | null
  projectName: string | null
  /** Where the shell is now; a tab whose cwd is known but has no project root has left its project. */
  cwd?: string | null
}

export interface AutoGroupOptions {
  /** Mints the id of a group automation has to create; called only when one is needed. */
  newGroupId(): string
}

/**
 * The project key of a root: separators unified, case folded, trailing separators
 * dropped (a drive root keeps its own). The same folding as main's ProjectRoot, so
 * a key derived here agrees with the project root main computed.
 */
export function foldProjectKey(path: string): string {
  const unified = path.replace(/\//g, '\\').toLowerCase()
  return /^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+\\?)$/.test(unified) ? unified : unified.replace(/\\+$/, '')
}

/**
 * Sessions in one project folder belong together, without anyone doing anything -
 * but never rigidly. Pure; assigns and clears `groupId`s and lets `normalizeRail`
 * do the placement (a group appears at its first member, the others are pulled
 * next to it, nothing else moves) and the dissolving of a group left with one tab.
 *
 * - Eligible: a tab that is not `manual` and is ungrouped or in an `auto` group.
 *   Eligible tabs whose context names a project root are bucketed by the folded
 *   root. A tab with no context yet, or whose cwd is not known, is never touched.
 *   A tab whose cwd is known but is no project (home, a drive root) has left its
 *   project: it leaves its `auto` group and stays ungrouped.
 * - A bucket joins the group that already carries its key (an `auto` group, or a
 *   user-named one - see below) and so keeps that group's id, collapsed state and
 *   name. With no such group, two or more tabs make exactly one new `auto` group.
 *   A lone tab with nowhere to go ends up ungrouped (it leaves its old auto group).
 * - A user-named group is never renamed, dissolved or emptied by automation. One
 *   that carries a `key` (a renamed auto group does) takes same-key eligible tabs
 *   while it still holds a tab the user did not place; with only `manual` members
 *   it is the user's arrangement and stays exactly as it is.
 * - An auto group's `title` follows `projectName`. `manual` is never set.
 *
 * Idempotent; returns `state` itself when nothing changes.
 */
export function autoGroupRail<T extends RailTabBase>(
  state: RailState<T>,
  contexts: ReadonlyMap<string, AutoGroupContext>,
  options: AutoGroupOptions
): RailState<T> {
  const { tabs, groups } = normalizeRail(state.tabs, state.groups)
  const done = (): RailState<T> => (tabs === state.tabs && groups === state.groups ? state : { tabs, groups })
  const byId = new Map(groups.map((group) => [group.id, group]))

  // Who can take a bucket: the first group per key, a user-named one with a free member before an auto one.
  const freeMembers = new Map<string, number>()
  for (const tab of tabs) {
    if (tab.groupId !== undefined && !tab.manual) freeMembers.set(tab.groupId, (freeMembers.get(tab.groupId) ?? 0) + 1)
  }
  const namedByKey = new Map<string, TabGroup>()
  const autoByKey = new Map<string, TabGroup>()
  for (const group of groups) {
    if (group.key === undefined) continue
    const key = foldProjectKey(group.key)
    if (group.auto) {
      if (!autoByKey.has(key)) autoByKey.set(key, group)
    } else if ((freeMembers.get(group.id) ?? 0) > 0 && !namedByKey.has(key)) {
      namedByKey.set(key, group)
    }
  }

  const buckets = new Map<string, { members: T[]; name: string | null }>()
  const leaving: T[] = []
  for (const tab of tabs) {
    if (tab.manual) continue
    const own = tab.groupId === undefined ? undefined : byId.get(tab.groupId)
    if (own && !own.auto) continue
    const context = contexts.get(tab.id)
    if (!context) continue
    if (!context.projectRoot) {
      if (context.cwd && own) leaving.push(tab)
      continue
    }
    const key = foldProjectKey(context.projectRoot)
    let bucket = buckets.get(key)
    if (!bucket) buckets.set(key, (bucket = { members: [], name: null }))
    bucket.members.push(tab)
    if (bucket.name === null && context.projectName) bucket.name = context.projectName
  }
  if (buckets.size === 0 && leaving.length === 0) return done()

  const assigned = new Map<T, string | undefined>()
  const titles = new Map<string, string>()
  const created: TabGroup[] = []
  for (const [key, bucket] of buckets) {
    let target = namedByKey.get(key) ?? autoByKey.get(key)
    const title = bucket.name === null ? undefined : cleanName(bucket.name)
    if (!target && bucket.members.length >= 2) {
      let id = options.newGroupId()
      while (byId.has(id)) id = options.newGroupId()
      target = { id, collapsed: false, auto: true, key, ...(title !== undefined ? { title } : {}) }
      byId.set(id, target)
      created.push(target)
    } else if (target && target.auto && title !== undefined && target.title !== title) {
      titles.set(target.id, title)
    }
    for (const tab of bucket.members) assigned.set(tab, target?.id)
  }

  for (const tab of leaving) assigned.set(tab, undefined)

  let nextTabs = tabs
  assigned.forEach((groupId, tab) => {
    if (tab.groupId === groupId) return
    if (nextTabs === tabs) nextTabs = tabs.slice()
    nextTabs[tabs.indexOf(tab)] = groupId === undefined ? withoutGroup(tab) : { ...tab, groupId }
  })
  const retitled = titles.size === 0 ? groups : groups.map((group) => (titles.has(group.id) ? { ...group, title: titles.get(group.id) } : group))
  if (nextTabs === tabs && retitled === groups && created.length === 0) return done()
  return normalizeRail(nextTabs, created.length === 0 ? retitled : [...retitled, ...created])
}
