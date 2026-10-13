/**
 * Drives the shipped pure group model in `src/renderer/src/tabs/tabGroups.ts`
 * (no reimplementation): the normalizer's five invariants, idempotence and
 * corrupt input, every op, status aggregation and a randomized sweep.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { transformSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)

function load(path) {
  const { code } = transformSync(readFileSync(join(root, path), 'utf8'), { loader: 'ts', format: 'cjs', target: 'node22' })
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', code)(module.exports, require, module)
  return module.exports
}

const G = load('src/renderer/src/tabs/tabGroups.ts')
const {
  MAX_GROUP_NAME_LENGTH,
  normalizeRail,
  buildRailItems,
  visibleTabIds,
  visibleEntries,
  aggregateStatus,
  neighborAfterClose,
  createGroup,
  moveTabs,
  moveGroup,
  ungroupTab,
  dissolveGroup,
  renameGroup,
  toggleCollapsed,
  revealTab,
  moveTabStep,
  moveGroupStep
} = G

const tab = (id, groupId, extra = {}) => (groupId === undefined ? { id, ...extra } : { id, groupId, ...extra })
const grp = (id, extra = {}) => ({ id, collapsed: false, auto: false, ...extra })
const ids = (state) => state.tabs.map((t) => t.id)
/** Compact picture of the rail: loose tabs as ids, groups as `[g: a b]`. */
const shape = (state) =>
  buildRailItems(state.tabs, state.groups)
    .map((item) => (item.kind === 'tab' ? item.tab.id : `[${item.group.id}: ${item.tabs.map((t) => t.id).join(' ')}]`))
    .join(' ')

/** The five invariants, checked on any state a public op returns. */
function assertInvariants(state, label = '') {
  const groupIds = new Set(state.groups.map((g) => g.id))
  assert.equal(groupIds.size, state.groups.length, `${label} duplicate group ids`)
  const seen = new Set()
  let previous
  for (const t of state.tabs) {
    if (t.groupId !== undefined) {
      assert.ok(groupIds.has(t.groupId), `${label} dangling groupId ${t.groupId}`)
      if (t.groupId !== previous) assert.ok(!seen.has(t.groupId), `${label} group ${t.groupId} is not contiguous`)
      seen.add(t.groupId)
    }
    previous = t.groupId
  }
  for (const g of state.groups) {
    const members = state.tabs.filter((t) => t.groupId === g.id)
    assert.ok(members.length >= 1, `${label} empty group ${g.id}`)
    if (members.length === 1) assert.ok(!g.auto || g.name !== undefined, `${label} untouched auto group ${g.id} kept at one tab`)
  }
  const firstOrder = [...seen]
  assert.deepEqual(state.groups.map((g) => g.id), firstOrder, `${label} group order follows first members`)
  assert.equal(new Set(state.tabs.map((t) => t.id)).size, state.tabs.length, `${label} tab ids unique`)
}

// ---------------------------------------------------------------------------
// normalizer

test('a clean state comes back as the very same arrays', () => {
  const tabs = [tab('a'), tab('b', 'g1'), tab('c', 'g1'), tab('d')]
  const groups = [grp('g1')]
  const out = normalizeRail(tabs, groups)
  assert.equal(out.tabs, tabs)
  assert.equal(out.groups, groups)
  const empty = normalizeRail([], [])
  assert.deepEqual(empty, { tabs: [], groups: [] })
})

test('invariant 1: stragglers are pulled to the group, nothing else is reordered', () => {
  const tabs = [tab('a', 'g1'), tab('x'), tab('b', 'g1'), tab('y'), tab('c', 'g1'), tab('z')]
  const out = normalizeRail(tabs, [grp('g1')])
  assert.deepEqual(ids(out), ['a', 'b', 'c', 'x', 'y', 'z'])
  // Members keep their relative order, non-members keep theirs.
  assert.deepEqual(out.tabs.filter((t) => t.groupId).map((t) => t.id), ['a', 'b', 'c'])
  assert.deepEqual(out.tabs.filter((t) => !t.groupId).map((t) => t.id), ['x', 'y', 'z'])
})

test('invariant 1: interleaved groups each collect at their first member', () => {
  const tabs = [tab('a1', 'A'), tab('b1', 'B'), tab('a2', 'A'), tab('b2', 'B'), tab('a3', 'A')]
  const out = normalizeRail(tabs, [grp('A'), grp('B')])
  assert.deepEqual(ids(out), ['a1', 'a2', 'a3', 'b1', 'b2'])
  assert.deepEqual(out.groups.map((g) => g.id), ['A', 'B'])
})

test('invariant 2: a groupId without a group is cleared, an empty group is removed', () => {
  const out = normalizeRail([tab('a', 'ghost', { manual: true }), tab('b', 'g1'), tab('c', 'g1')], [grp('g1'), grp('empty')])
  assert.deepEqual(out.tabs[0], { id: 'a', manual: true })
  assert.ok(!('groupId' in out.tabs[0]))
  assert.deepEqual(out.groups.map((g) => g.id), ['g1'])
})

test('invariant 3: an untouched auto group at one tab dissolves; named or manual ones are kept', () => {
  const auto = normalizeRail([tab('a', 'g1'), tab('b')], [grp('g1', { auto: true, key: 'e:\\zinc' })])
  assert.deepEqual(auto, { tabs: [{ id: 'a' }, { id: 'b' }], groups: [] })
  const named = normalizeRail([tab('a', 'g1'), tab('b')], [grp('g1', { auto: true, name: 'Zinc' })])
  assert.deepEqual(named.groups.map((g) => g.id), ['g1'])
  assert.equal(named.tabs[0].groupId, 'g1')
  const manual = normalizeRail([tab('a', 'g1'), tab('b')], [grp('g1')])
  assert.deepEqual(manual.groups.map((g) => g.id), ['g1'])
  // A name that is only whitespace does not count as touched.
  const blank = normalizeRail([tab('a', 'g1')], [grp('g1', { auto: true, name: '   ' })])
  assert.deepEqual(blank, { tabs: [{ id: 'a' }], groups: [] })
})

test('invariant 4: group order is the order of the first member', () => {
  const out = normalizeRail([tab('x'), tab('b1', 'B'), tab('b2', 'B'), tab('a1', 'A'), tab('a2', 'A')], [grp('A'), grp('B')])
  assert.deepEqual(out.groups.map((g) => g.id), ['B', 'A'])
  assert.deepEqual(ids(out), ['x', 'b1', 'b2', 'a1', 'a2'])
})

test('duplicate group ids keep the first, malformed groups and non-boolean flags are cleaned', () => {
  const out = normalizeRail(
    [tab('a', 'g1'), tab('b', 'g1')],
    [grp('g1', { name: 'First' }), grp('g1', { name: 'Second' }), null, { id: '' }, { name: 'no id' }]
  )
  assert.deepEqual(out.groups, [{ id: 'g1', name: 'First', collapsed: false, auto: false }])
  const loose = normalizeRail(
    [tab('a', 'g1'), tab('b', 'g1')],
    [{ id: 'g1', collapsed: 'yes', auto: 1, name: '', key: 5 }]
  )
  assert.deepEqual(loose.groups, [{ id: 'g1', collapsed: false, auto: false }])
})

test('normalizing is idempotent on messy input and keeps tab objects it does not have to touch', () => {
  const keep = tab('keep')
  const tabs = [tab('a', 'g1'), keep, tab('b', 'g2'), tab('c', 'g1'), tab('d', 'nope'), tab('e', 'g2'), tab('f', 'solo')]
  const groups = [grp('g2'), grp('g1', { auto: true }), grp('solo', { auto: true }), grp('unused')]
  const once = normalizeRail(tabs, groups)
  assertInvariants(once, 'once')
  const twice = normalizeRail(once.tabs, once.groups)
  assert.equal(twice.tabs, once.tabs)
  assert.equal(twice.groups, once.groups)
  assert.ok(once.tabs.includes(keep))
  assert.deepEqual(ids(once).sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'keep'])
})

test('the normalizer never mutates its input', () => {
  const tabs = [tab('a', 'g1'), tab('x'), tab('b', 'g1'), tab('c', 'gone')]
  const groups = [grp('g1'), grp('empty'), grp('g1', { name: 'dup' })]
  const before = JSON.stringify([tabs, groups])
  normalizeRail(tabs, groups)
  assert.equal(JSON.stringify([tabs, groups]), before)
})

// ---------------------------------------------------------------------------
// read side

test('buildRailItems lists ungrouped tabs and whole groups in order', () => {
  const state = { tabs: [tab('a'), tab('b', 'g1'), tab('c', 'g1'), tab('d'), tab('e', 'g2'), tab('f', 'g2')], groups: [grp('g1'), grp('g2')] }
  assert.equal(shape(state), 'a [g1: b c] d [g2: e f]')
  const items = buildRailItems(state.tabs, state.groups)
  assert.equal(items[1].group, state.groups[0])
  // A groupId that names nothing renders as a plain tab instead of vanishing.
  assert.equal(shape({ tabs: [tab('a', 'ghost')], groups: [] }), 'a')
})

test('visible ids and entries skip the members of collapsed groups but keep their header', () => {
  const state = {
    tabs: [tab('a'), tab('b', 'g1'), tab('c', 'g1'), tab('d', 'g2'), tab('e', 'g2')],
    groups: [grp('g1', { collapsed: true }), grp('g2')]
  }
  assert.deepEqual(visibleTabIds(state.tabs, state.groups), ['a', 'd', 'e'])
  assert.deepEqual(
    visibleEntries(buildRailItems(state.tabs, state.groups)).map((e) => `${e.kind}:${e.id}`),
    ['tab:a', 'group:g1', 'group:g2', 'tab:d', 'tab:e']
  )
})

test('aggregateStatus: waiting > error > working > done > idle, quiet states count as idle', () => {
  assert.equal(aggregateStatus([]), 'idle')
  assert.equal(aggregateStatus(['shell', 'idle', 'exited', undefined]), 'idle')
  assert.equal(aggregateStatus(['idle', 'done']), 'done')
  assert.equal(aggregateStatus(['done', 'working', 'idle']), 'working')
  assert.equal(aggregateStatus(['working', 'error', 'done']), 'error')
  assert.equal(aggregateStatus(['working', 'error', 'waiting', 'done']), 'waiting')
  assert.equal(aggregateStatus(new Set(['exited', 'working'])), 'working')
  // Unknown strings from a future state do not crash or outrank anything.
  assert.equal(aggregateStatus(['mystery', 'done']), 'done')
})

test('neighborAfterClose follows visible order and never lands inside a collapsed group', () => {
  const tabs = [tab('a'), tab('b', 'g1'), tab('c', 'g1'), tab('d'), tab('e')]
  const open = [grp('g1')]
  assert.equal(neighborAfterClose(tabs, open, 'a', 'x'), 'x', 'a background close keeps the active tab')
  assert.equal(neighborAfterClose(tabs, open, 'a', 'a'), 'b')
  assert.equal(neighborAfterClose(tabs, open, 'e', 'e'), 'd', 'the last tab falls back to the previous one')
  assert.equal(neighborAfterClose(tabs, open, 'c', 'c'), 'd')
  const folded = [grp('g1', { collapsed: true })]
  assert.equal(neighborAfterClose(tabs, folded, 'a', 'a'), 'd', 'b and c are hidden')
  assert.equal(neighborAfterClose(tabs, folded, 'd', 'd'), 'e')
  // The active tab itself sits in the collapsed group: its visible neighbour wins over its hidden sibling.
  assert.equal(neighborAfterClose(tabs, folded, 'b', 'b'), 'd')
  assert.equal(neighborAfterClose([tab('a')], [], 'a', 'a'), null)
  // Only hidden tabs remain: the tab next to the closed one (its group will expand when it is activated).
  assert.equal(neighborAfterClose([tab('b', 'g1'), tab('c', 'g1')], folded, 'b', 'b'), 'c')
})

// ---------------------------------------------------------------------------
// ops

test('createGroup wraps the tabs at the first one and marks them manual', () => {
  const state = { tabs: [tab('a'), tab('b'), tab('c'), tab('d')], groups: [] }
  const out = createGroup(state.tabs, state.groups, ['c', 'a'], 'g1', '  My   group ')
  assert.equal(shape(out), '[g1: a c] b d')
  assert.deepEqual(out.groups, [{ id: 'g1', collapsed: false, auto: false, name: 'My group' }])
  assert.ok(out.tabs.filter((t) => t.groupId).every((t) => t.manual === true))
  assert.ok(!('manual' in out.tabs[2]))
  assertInvariants(out)
})

test('createGroup with one tab keeps the group ("New group with this tab")', () => {
  const out = createGroup([tab('a'), tab('b')], [], ['b'], 'g1')
  assert.equal(shape(out), 'a [g1: b]')
  assert.equal(out.groups[0].name, undefined)
  assert.equal(out.groups[0].collapsed, false)
})

test('createGroup ignores unknown ids, an empty selection and an id that is already taken', () => {
  const state = { tabs: [tab('a'), tab('b', 'g1'), tab('c', 'g1')], groups: [grp('g1')] }
  assert.equal(createGroup(state.tabs, state.groups, ['nope'], 'g2').tabs, state.tabs)
  assert.equal(createGroup(state.tabs, state.groups, [], 'g2').groups, state.groups)
  assert.equal(createGroup(state.tabs, state.groups, ['a'], 'g1').tabs, state.tabs)
})

test('createGroup takes tabs out of their old group, which dissolves when untouched', () => {
  const state = { tabs: [tab('a', 'auto1'), tab('b', 'auto1'), tab('c')], groups: [grp('auto1', { auto: true })] }
  const out = createGroup(state.tabs, state.groups, ['a'], 'mine')
  assert.equal(shape(out), '[mine: a] b c')
  assert.deepEqual(out.groups.map((g) => g.id), ['mine'])
  assertInvariants(out)
})

test('moveTabs before / after joins the neighbour\'s group or leaves for the ungrouped', () => {
  const base = { tabs: [tab('a'), tab('b', 'g1'), tab('c', 'g1'), tab('d', 'g1'), tab('e')], groups: [grp('g1')] }
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'a', { after: 'b' })), '[g1: b a c d] e')
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'a', { before: 'b' })), '[g1: a b c d] e')
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'a', { after: 'd' })), '[g1: b c d a] e')
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'c', { after: 'e' })), 'a [g1: b d] e c')
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'c', { before: 'a' })), 'c a [g1: b d] e')
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'e', { before: 'a' })), 'e a [g1: b c d]')
  const moved = moveTabs(base.tabs, base.groups, 'a', { after: 'b' }).tabs.find((t) => t.id === 'a')
  assert.equal(moved.manual, true)
  assert.equal(moved.groupId, 'g1')
})

test('moveTabs inside one group reorders it and keeps the tab in it', () => {
  const base = { tabs: [tab('b', 'g1'), tab('c', 'g1'), tab('d', 'g1')], groups: [grp('g1')] }
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'b', { after: 'd' })), '[g1: c d b]')
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'd', { before: 'b' })), '[g1: d b c]')
})

test('moveTabs intoGroup honours the index and defaults to the end', () => {
  const base = { tabs: [tab('x'), tab('b', 'g1'), tab('c', 'g1'), tab('y')], groups: [grp('g1')] }
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'x', { intoGroup: 'g1' })), '[g1: b c x] y')
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'x', { intoGroup: 'g1', index: 0 })), '[g1: x b c] y')
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'x', { intoGroup: 'g1', index: 1 })), '[g1: b x c] y')
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'y', { intoGroup: 'g1', index: 99 })), 'x [g1: b c y]')
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'y', { intoGroup: 'g1', index: -4 })), 'x [g1: y b c]')
  // Moving a member to another index in its own group.
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'b', { intoGroup: 'g1', index: 1 })), 'x [g1: c b] y')
  // An unknown group is a no-op.
  assert.equal(moveTabs(base.tabs, base.groups, 'x', { intoGroup: 'nope' }).tabs, base.tabs)
})

test('moveTabs ungrouped indexes the top-level items and a whole group counts as one', () => {
  const base = { tabs: [tab('a'), tab('b', 'g1'), tab('c', 'g1'), tab('d'), tab('e', 'g2'), tab('f', 'g2')], groups: [grp('g1'), grp('g2')] }
  // items without the moved tab: [a] [g1] [d] [g2]
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'a', { ungrouped: true, at: 2 })), '[g1: b c] d a [g2: e f]')
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'a', { ungrouped: true, at: 3 })), '[g1: b c] d [g2: e f] a')
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'a', { ungrouped: true, at: 99 })), '[g1: b c] d [g2: e f] a')
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'b', { ungrouped: true, at: 0 })), 'b a [g1: c] d [g2: e f]')
  assert.equal(shape(moveTabs(base.tabs, base.groups, 'c', { ungrouped: true, at: 2 })), 'a [g1: b] c d [g2: e f]')
})

test('moving a tab out of a group makes the group single or empty and the normalizer decides its fate', () => {
  const autoPair = { tabs: [tab('a', 'g1'), tab('b', 'g1'), tab('c')], groups: [grp('g1', { auto: true })] }
  const out = moveTabs(autoPair.tabs, autoPair.groups, 'a', { after: 'c' })
  assert.equal(shape(out), 'b c a')
  assert.deepEqual(out.groups, [])
  const manualPair = { tabs: [tab('a', 'g1'), tab('b', 'g1'), tab('c')], groups: [grp('g1')] }
  const kept = moveTabs(manualPair.tabs, manualPair.groups, 'a', { after: 'c' })
  assert.equal(shape(kept), '[g1: b] c a')
  const solo = moveTabs([tab('a', 'g1', { manual: true }), tab('b')], [grp('g1')], 'a', { after: 'b' })
  assert.equal(shape(solo), 'b a', 'the emptied group is gone')
  assert.deepEqual(solo.groups, [])
})

test('moveTabs that changes nothing is a no-op and does not mark the tab manual', () => {
  const base = { tabs: [tab('a'), tab('b', 'g1'), tab('c', 'g1')], groups: [grp('g1')] }
  assert.equal(moveTabs(base.tabs, base.groups, 'a', { before: 'b' }).tabs[0].groupId, 'g1', 'before b is inside the group')
  const same = moveTabs(base.tabs, base.groups, 'b', { intoGroup: 'g1', index: 0 })
  assert.equal(same.tabs, base.tabs)
  assert.equal(moveTabs(base.tabs, base.groups, 'a', { ungrouped: true, at: 0 }).tabs, base.tabs)
  assert.equal(moveTabs(base.tabs, base.groups, 'nope', { before: 'a' }).tabs, base.tabs)
  assert.equal(moveTabs(base.tabs, base.groups, 'a', { before: 'a' }).tabs, base.tabs)
  assert.equal(moveTabs(base.tabs, base.groups, 'a', { before: 'nope' }).tabs, base.tabs)
})

test('moveGroup moves the whole block before an item or to the end', () => {
  const base = { tabs: [tab('a'), tab('b', 'g1'), tab('c', 'g1'), tab('d'), tab('e', 'g2'), tab('f', 'g2')], groups: [grp('g1'), grp('g2')] }
  assert.equal(shape(moveGroup(base.tabs, base.groups, 'g1', null)), 'a d [g2: e f] [g1: b c]')
  assert.equal(shape(moveGroup(base.tabs, base.groups, 'g2', 'a')), '[g2: e f] a [g1: b c] d')
  assert.equal(shape(moveGroup(base.tabs, base.groups, 'g2', 'g1')), 'a [g2: e f] [g1: b c] d')
  assert.equal(shape(moveGroup(base.tabs, base.groups, 'g1', 'd')), 'a [g1: b c] d [g2: e f]')
  const out = moveGroup(base.tabs, base.groups, 'g2', 'a')
  assert.deepEqual(out.groups.map((g) => g.id), ['g2', 'g1'])
  assert.ok(out.tabs.filter((t) => t.groupId === 'g2').every((t) => t.manual))
  // Same place, unknown group, unknown target, itself: untouched.
  assert.equal(moveGroup(base.tabs, base.groups, 'g1', 'd').tabs, base.tabs)
  assert.equal(moveGroup(base.tabs, base.groups, 'g2', null).tabs, base.tabs)
  assert.equal(moveGroup(base.tabs, base.groups, 'nope', null).tabs, base.tabs)
  assert.equal(moveGroup(base.tabs, base.groups, 'g1', 'zzz').tabs, base.tabs)
  assert.equal(moveGroup(base.tabs, base.groups, 'g1', 'g1').tabs, base.tabs)
})

test('ungroupTab puts the first member before the group and the others right after it', () => {
  const base = { tabs: [tab('x'), tab('a', 'g1'), tab('b', 'g1'), tab('c', 'g1'), tab('y')], groups: [grp('g1')] }
  assert.equal(shape(ungroupTab(base.tabs, base.groups, 'a')), 'x a [g1: b c] y')
  assert.equal(shape(ungroupTab(base.tabs, base.groups, 'b')), 'x [g1: a c] b y')
  assert.equal(shape(ungroupTab(base.tabs, base.groups, 'c')), 'x [g1: a b] c y')
  const out = ungroupTab(base.tabs, base.groups, 'b')
  const b = out.tabs.find((t) => t.id === 'b')
  assert.equal(b.manual, true)
  assert.ok(!('groupId' in b))
  // The only member: the group disappears, the tab stays put.
  const solo = ungroupTab([tab('x'), tab('a', 'g1')], [grp('g1')], 'a')
  assert.equal(shape(solo), 'x a')
  assert.deepEqual(solo.groups, [])
  // Not grouped / unknown: no-op.
  assert.equal(ungroupTab(base.tabs, base.groups, 'x').tabs, base.tabs)
  assert.equal(ungroupTab(base.tabs, base.groups, 'nope').tabs, base.tabs)
})

test('dissolveGroup keeps the tabs in place, ungrouped and manual', () => {
  const base = { tabs: [tab('x'), tab('a', 'g1'), tab('b', 'g1'), tab('y', 'g2'), tab('z', 'g2')], groups: [grp('g1', { name: 'N' }), grp('g2')] }
  const out = dissolveGroup(base.tabs, base.groups, 'g1')
  assert.equal(shape(out), 'x a b [g2: y z]')
  assert.deepEqual(out.groups.map((g) => g.id), ['g2'])
  assert.ok(out.tabs.slice(1, 3).every((t) => t.manual === true && !('groupId' in t)))
  assert.equal(dissolveGroup(base.tabs, base.groups, 'nope').tabs, base.tabs)
})

test('renameGroup cleans the name, makes an auto group permanent and treats empty as clearing', () => {
  const base = { tabs: [tab('a', 'g1'), tab('b', 'g1')], groups: [grp('g1', { auto: true, key: 'k' })] }
  const named = renameGroup(base.tabs, base.groups, 'g1', '  Back\tend \n work  ')
  assert.deepEqual(named.groups[0], { id: 'g1', collapsed: false, auto: false, name: 'Back end work', key: 'k' })
  assert.equal(named.tabs, base.tabs)
  assert.equal(renameGroup(named.tabs, named.groups, 'g1', 'Back end work').groups, named.groups, 'same name: nothing changes')
  const cleared = renameGroup(named.tabs, named.groups, 'g1', '   ')
  assert.deepEqual(cleared.groups[0], { id: 'g1', collapsed: false, auto: false, key: 'k' }, 'an empty name clears the name and leaves the rest')
  assert.equal(renameGroup(base.tabs, base.groups, 'g1', '').groups, base.groups, 'empty on an unnamed group is a no-op')
  assert.equal(renameGroup(base.tabs, base.groups, 'nope', 'x').groups, base.groups)
  const long = renameGroup(base.tabs, base.groups, 'g1', 'x'.repeat(MAX_GROUP_NAME_LENGTH + 40))
  assert.equal(long.groups[0].name.length, MAX_GROUP_NAME_LENGTH)
  assert.equal(MAX_GROUP_NAME_LENGTH, 256, 'the persisted-name limit in shared/sessionState.ts')
})

test('toggleCollapsed flips, sets explicitly and is a no-op when already there', () => {
  const base = { tabs: [tab('a', 'g1'), tab('b', 'g1')], groups: [grp('g1')] }
  const folded = toggleCollapsed(base.tabs, base.groups, 'g1')
  assert.equal(folded.groups[0].collapsed, true)
  assert.equal(folded.tabs, base.tabs)
  assert.equal(toggleCollapsed(folded.tabs, folded.groups, 'g1').groups[0].collapsed, false)
  assert.equal(toggleCollapsed(folded.tabs, folded.groups, 'g1', true).groups, folded.groups)
  assert.equal(toggleCollapsed(base.tabs, base.groups, 'g1', false).groups, base.groups)
  assert.equal(toggleCollapsed(base.tabs, base.groups, 'nope').groups, base.groups)
})

test('revealTab expands only the group that holds the tab', () => {
  const state = {
    tabs: [tab('a'), tab('b', 'g1'), tab('c', 'g1'), tab('d', 'g2'), tab('e', 'g2')],
    groups: [grp('g1', { collapsed: true }), grp('g2', { collapsed: true })]
  }
  const out = revealTab(state.tabs, state.groups, 'c')
  assert.deepEqual(out.groups.map((g) => g.collapsed), [false, true])
  assert.equal(revealTab(state.tabs, state.groups, 'a').groups, state.groups)
  assert.equal(revealTab(out.tabs, out.groups, 'b').groups, out.groups)
  assert.equal(revealTab(state.tabs, state.groups, 'nope').groups, state.groups)
})

// ---------------------------------------------------------------------------
// keyboard moves

test('Alt+Up/Down on an ungrouped tab swaps with a tab and jumps over a whole group', () => {
  const base = { tabs: [tab('a'), tab('b'), tab('g1a', 'g1'), tab('g1b', 'g1'), tab('c')], groups: [grp('g1')] }
  assert.equal(shape(moveTabStep(base.tabs, base.groups, 'a', 1)), 'b a [g1: g1a g1b] c')
  assert.equal(shape(moveTabStep(base.tabs, base.groups, 'b', 1)), 'a [g1: g1a g1b] b c', 'jumps over the group')
  assert.equal(shape(moveTabStep(base.tabs, base.groups, 'c', -1)), 'a b c [g1: g1a g1b]')
  assert.equal(moveTabStep(base.tabs, base.groups, 'a', -1).tabs, base.tabs, 'top edge')
  assert.equal(moveTabStep(base.tabs, base.groups, 'c', 1).tabs, base.tabs, 'bottom edge')
  assert.equal(moveTabStep(base.tabs, base.groups, 'nope', 1).tabs, base.tabs)
})

test('Alt+Up/Down inside a group swaps members and leaves the group at its edge', () => {
  const base = { tabs: [tab('x'), tab('a', 'g1'), tab('b', 'g1'), tab('c', 'g1'), tab('y')], groups: [grp('g1')] }
  assert.equal(shape(moveTabStep(base.tabs, base.groups, 'b', 1)), 'x [g1: a c b] y')
  assert.equal(shape(moveTabStep(base.tabs, base.groups, 'b', -1)), 'x [g1: b a c] y')
  const up = moveTabStep(base.tabs, base.groups, 'a', -1)
  assert.equal(shape(up), 'x a [g1: b c] y')
  assert.equal(up.tabs[1].manual, true)
  assert.equal(shape(moveTabStep(base.tabs, base.groups, 'c', 1)), 'x [g1: a b] c y')
  assert.equal(shape(moveTabStep(base.tabs, base.groups, 'a', -1)), 'x a [g1: b c] y')
})

test('Alt+Up/Down on the only member moves the whole group instead of dissolving it', () => {
  const base = { tabs: [tab('x'), tab('a', 'g1', { manual: true }), tab('y')], groups: [grp('g1', { name: 'Mine' })] }
  const down = moveTabStep(base.tabs, base.groups, 'a', 1)
  assert.equal(shape(down), 'x y [g1: a]')
  assert.equal(down.groups[0].name, 'Mine')
  assert.equal(shape(moveTabStep(base.tabs, base.groups, 'a', -1)), '[g1: a] x y')
})

test('Alt+Up/Down on a group header swaps the group with the neighbouring item', () => {
  const base = { tabs: [tab('x'), tab('a', 'g1'), tab('b', 'g1'), tab('c', 'g2'), tab('d', 'g2'), tab('y')], groups: [grp('g1'), grp('g2')] }
  assert.equal(shape(moveGroupStep(base.tabs, base.groups, 'g1', 1)), 'x [g2: c d] [g1: a b] y')
  assert.equal(shape(moveGroupStep(base.tabs, base.groups, 'g2', 1)), 'x [g1: a b] y [g2: c d]')
  assert.equal(shape(moveGroupStep(base.tabs, base.groups, 'g1', -1)), '[g1: a b] x [g2: c d] y')
  assert.equal(shape(moveGroupStep(base.tabs, base.groups, 'g2', -1)), 'x [g2: c d] [g1: a b] y')
  const lastDown = { tabs: [tab('x'), tab('a', 'g1'), tab('b', 'g1')], groups: [grp('g1')] }
  assert.equal(moveGroupStep(lastDown.tabs, lastDown.groups, 'g1', 1).tabs, lastDown.tabs)
  assert.equal(moveGroupStep(base.tabs, base.groups, 'nope', 1).tabs, base.tabs)
})

// ---------------------------------------------------------------------------
// randomized sweep

function mulberry32(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('random corrupt input always normalizes to a valid, idempotent state that loses no tab', () => {
  const rand = mulberry32(0x2a51)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  for (let round = 0; round < 400; round++) {
    const groupNames = ['g1', 'g2', 'g3', 'g4']
    const groups = []
    for (const id of groupNames) {
      if (rand() < 0.8) groups.push(grp(id, { auto: rand() < 0.5, collapsed: rand() < 0.3, ...(rand() < 0.3 ? { name: 'n' + id } : {}) }))
      if (rand() < 0.1) groups.push(grp(id, { name: 'dup' }))
    }
    const tabs = []
    const count = Math.floor(rand() * 14)
    for (let i = 0; i < count; i++) {
      const r = rand()
      tabs.push(tab('t' + i, r < 0.55 ? pick([...groupNames, 'ghost']) : undefined, rand() < 0.3 ? { manual: true } : {}))
    }
    const out = normalizeRail(tabs, groups)
    assertInvariants(out, `round ${round}`)
    assert.deepEqual(ids(out).sort(), tabs.map((t) => t.id).sort(), `round ${round} lost or invented a tab`)
    const again = normalizeRail(out.tabs, out.groups)
    assert.equal(again.tabs, out.tabs, `round ${round} not idempotent (tabs)`)
    assert.equal(again.groups, out.groups, `round ${round} not idempotent (groups)`)
    // Non-members keep their relative order.
    const looseBefore = tabs.filter((t) => out.tabs.find((o) => o.id === t.id).groupId === undefined).map((t) => t.id)
    assert.deepEqual(out.tabs.filter((t) => t.groupId === undefined).map((t) => t.id), looseBefore, `round ${round} reordered loose tabs`)
  }
})

test('random op sequences keep every invariant and never lose a tab', () => {
  const rand = mulberry32(0x9e37)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  for (let run = 0; run < 60; run++) {
    let state = normalizeRail(Array.from({ length: 10 }, (_, i) => tab('t' + i)), [])
    let nextGroup = 1
    for (let step = 0; step < 60; step++) {
      const tabIds = ids(state)
      const groupIds = state.groups.map((g) => g.id)
      const roll = rand()
      if (roll < 0.15) {
        const sel = tabIds.filter(() => rand() < 0.3)
        state = createGroup(state.tabs, state.groups, sel, 'n' + nextGroup++, rand() < 0.5 ? 'x' : undefined)
      } else if (roll < 0.4) {
        const target = pick([
          () => ({ before: pick(tabIds) }),
          () => ({ after: pick(tabIds) }),
          () => ({ intoGroup: pick([...groupIds, 'nope']), index: Math.floor(rand() * 6) - 1 }),
          () => ({ ungrouped: true, at: Math.floor(rand() * 8) - 1 })
        ])()
        state = moveTabs(state.tabs, state.groups, pick(tabIds), target)
      } else if (roll < 0.5 && groupIds.length) {
        state = moveGroup(state.tabs, state.groups, pick(groupIds), rand() < 0.2 ? null : pick([...tabIds, ...groupIds]))
      } else if (roll < 0.6) {
        state = ungroupTab(state.tabs, state.groups, pick(tabIds))
      } else if (roll < 0.66 && groupIds.length) {
        state = dissolveGroup(state.tabs, state.groups, pick(groupIds))
      } else if (roll < 0.72 && groupIds.length) {
        state = renameGroup(state.tabs, state.groups, pick(groupIds), rand() < 0.5 ? 'name' : '')
      } else if (roll < 0.8 && groupIds.length) {
        state = toggleCollapsed(state.tabs, state.groups, pick(groupIds))
      } else if (roll < 0.9) {
        state = moveTabStep(state.tabs, state.groups, pick(tabIds), pick([-1, 1]))
      } else if (groupIds.length) {
        state = moveGroupStep(state.tabs, state.groups, pick(groupIds), pick([-1, 1]))
      }
      assertInvariants(state, `run ${run} step ${step}`)
      assert.equal(state.tabs.length, 10)
    }
  }
})
