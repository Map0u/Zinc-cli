/**
 * Drives the shipped `autoGroupRail` in `src/renderer/src/tabs/tabGroups.ts`
 * (no reimplementation): bucketing by folded project key, reuse of existing
 * groups, leaving on a key change, manual wins, user-named groups, titles,
 * idempotence / identity on a no-op, and a randomized sweep.
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

const { autoGroupRail, foldProjectKey, normalizeRail, buildRailItems, renameGroup, createGroup, moveTabs, toggleCollapsed } = load(
  'src/renderer/src/tabs/tabGroups.ts'
)

const tab = (id, groupId, extra = {}) => (groupId === undefined ? { id, ...extra } : { id, groupId, ...extra })
const grp = (id, extra = {}) => ({ id, collapsed: false, auto: false, ...extra })
const auto = (id, key, extra = {}) =>
  grp(id, { auto: true, key: foldProjectKey(key), title: key.split(/[\\/]/).filter(Boolean).pop(), ...extra })
const ids = (state) => state.tabs.map((t) => t.id)
const shape = (state) =>
  buildRailItems(state.tabs, state.groups)
    .map((item) => (item.kind === 'tab' ? item.tab.id : `[${item.group.id}: ${item.tabs.map((t) => t.id).join(' ')}]`))
    .join(' ')

/** contexts from `{ tabId: 'C:\\repo' | null }`; a missing id has no context at all. */
const ctx = (map) =>
  new Map(
    Object.entries(map).map(([id, projectRoot]) => [
      id,
      { projectRoot, projectName: projectRoot === null ? null : projectRoot.split(/[\\/]/).filter(Boolean).pop() }
    ])
  )

function counter(prefix = 'auto-') {
  let n = 1
  const options = { newGroupId: () => `${prefix}${n++}` }
  return options
}

const A = 'C:\\Work\\Alpha'
const B = 'C:\\Work\\Beta'

test('foldProjectKey folds case, slashes and trailing separators like main', () => {
  assert.equal(foldProjectKey('C:\\Work\\Alpha'), 'c:\\work\\alpha')
  assert.equal(foldProjectKey('c:/work/ALPHA/'), 'c:\\work\\alpha')
  assert.equal(foldProjectKey('C:\\Work\\Alpha\\\\'), 'c:\\work\\alpha')
  assert.equal(foldProjectKey('C:\\'), 'c:\\')
  assert.equal(foldProjectKey('\\\\srv\\share\\'), '\\\\srv\\share\\')
  assert.equal(foldProjectKey('\\\\srv\\share\\proj\\'), '\\\\srv\\share\\proj')
})

test('two tabs in one project make exactly one auto group; one tab does not', () => {
  const state = { tabs: [tab('a'), tab('b'), tab('c'), tab('d')], groups: [] }
  const out = autoGroupRail(state, ctx({ a: A, b: B, c: A, d: null }), counter())
  assert.equal(shape(out), '[auto-1: a c] b d')
  assert.deepEqual(out.groups, [{ id: 'auto-1', collapsed: false, auto: true, key: foldProjectKey(A), title: 'Alpha' }])
  // The group sits where its first member was; nothing else moved relative to anything else.
  assert.deepEqual(ids(out), ['a', 'c', 'b', 'd'])
})

test('three projects, loose tabs keep their order', () => {
  const tabs = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'].map((id) => tab(id))
  const contexts = ctx({ t1: A, t2: 'D:\\x', t3: B, t4: A, t5: 'C:\\Solo', t6: B, t7: 'D:\\x', t8: null })
  const out = autoGroupRail({ tabs, groups: [] }, contexts, counter())
  assert.equal(shape(out), '[auto-1: t1 t4] [auto-2: t2 t7] [auto-3: t3 t6] t5 t8')
  assert.deepEqual(out.groups.map((g) => g.title), ['Alpha', 'x', 'Beta'])
  assert.ok(out.tabs.every((t) => t.manual === undefined))
})

test('the key is folded: spelling and slash style do not split a project', () => {
  const out = autoGroupRail(
    { tabs: [tab('a'), tab('b')], groups: [] },
    ctx({ a: 'C:\\Work\\Alpha', b: 'c:/work/alpha/' }),
    counter()
  )
  assert.equal(shape(out), '[auto-1: a b]')
})

test('tabs without a context or with a null root are never touched', () => {
  const state = {
    tabs: [tab('a', 'g', { manual: false }), tab('b', 'g'), tab('c'), tab('d')],
    groups: [auto('g', A)]
  }
  // b has no context at all; c and d have null roots.
  const out = autoGroupRail(state, ctx({ a: A, c: null, d: null }), counter())
  assert.equal(out, state)
})

test('an existing auto group is reused: id, collapsed state and name survive; a newcomer joins it', () => {
  const state = {
    tabs: [tab('a', 'g1'), tab('b', 'g1'), tab('x'), tab('c')],
    groups: [auto('g1', A, { collapsed: true, title: 'Alpha' })]
  }
  const out = autoGroupRail(state, ctx({ a: A, b: A, x: B, c: A }), counter())
  assert.equal(shape(out), '[g1: a b c] x')
  assert.equal(out.groups.length, 1)
  assert.equal(out.groups[0].id, 'g1')
  assert.equal(out.groups[0].collapsed, true)
  assert.equal(out.groups[0].title, 'Alpha')
})

test('a lone newcomer joins the group that already carries its key (no duplicate group)', () => {
  const state = { tabs: [tab('a', 'g1'), tab('b', 'g1'), tab('c')], groups: [auto('g1', A)] }
  const out = autoGroupRail(state, ctx({ a: A, b: A, c: A }), counter())
  assert.equal(shape(out), '[g1: a b c]')
  assert.equal(out.groups.length, 1)
})

test('duplicate auto groups of one key are healed into the first', () => {
  const state = {
    tabs: [tab('a', 'g1'), tab('b', 'g1'), tab('c', 'g2'), tab('d', 'g2')],
    groups: [auto('g1', A), auto('g2', A)]
  }
  const out = autoGroupRail(state, ctx({ a: A, b: A, c: A, d: A }), counter())
  assert.equal(shape(out), '[g1: a b c d]')
  assert.deepEqual(out.groups.map((g) => g.id), ['g1'])
})

test('a tab whose key changed leaves its group and joins the group of its new key', () => {
  const state = {
    tabs: [tab('a', 'gA'), tab('b', 'gA'), tab('c', 'gB'), tab('d', 'gB')],
    groups: [auto('gA', A), auto('gB', B)]
  }
  const out = autoGroupRail(state, ctx({ a: A, b: B, c: B, d: B }), counter())
  // gA falls to one tab and the normalizer dissolves it; b joins gB.
  assert.equal(shape(out), 'a [gB: b c d]')
  assert.deepEqual(out.groups.map((g) => g.id), ['gB'])
})

test('a tab whose key changed to a project with no group creates one only with a partner', () => {
  const state = {
    tabs: [tab('a', 'gA'), tab('b', 'gA'), tab('c', 'gA'), tab('z')],
    groups: [auto('gA', A)]
  }
  const alone = autoGroupRail(state, ctx({ a: A, b: A, c: B, z: null }), counter())
  assert.equal(shape(alone), '[gA: a b] c z')
  const paired = autoGroupRail(state, ctx({ a: A, b: A, c: B, z: B }), counter())
  assert.equal(shape(paired), '[gA: a b] [auto-1: c z]')
  assert.deepEqual(paired.groups.map((g) => g.title), ['Alpha', 'Beta'])
})

test('a group that falls to one tab dissolves; the survivor is not marked manual', () => {
  const state = { tabs: [tab('a', 'g'), tab('b', 'g')], groups: [auto('g', A)] }
  const out = autoGroupRail(state, ctx({ a: A, b: B }), counter())
  assert.equal(shape(out), 'a b')
  assert.deepEqual(out.groups, [])
  assert.ok(out.tabs.every((t) => t.manual === undefined && t.groupId === undefined))
})

test('manual wins: a manual tab is never moved, never counted, never pulled out', () => {
  const state = { tabs: [tab('a'), tab('b', undefined, { manual: true }), tab('c')], groups: [] }
  const out = autoGroupRail(state, ctx({ a: A, b: A, c: A }), counter())
  // Only a and c are eligible; b stays between them in tabs order but is outside the group, which sits at a.
  assert.equal(shape(out), '[auto-1: a c] b')
  const inGroup = {
    tabs: [tab('a', 'g'), tab('b', 'g', { manual: true }), tab('c', 'g')],
    groups: [auto('g', A)]
  }
  const stays = autoGroupRail(inGroup, ctx({ a: A, b: B, c: A }), counter())
  assert.equal(stays, inGroup)
})

test('a manual tab inside an auto group stays when its key differs', () => {
  const state = { tabs: [tab('a', 'g'), tab('b', 'g', { manual: true }), tab('c', 'g')], groups: [auto('g', A)] }
  const out = autoGroupRail(state, ctx({ a: B, b: B, c: A }), counter())
  assert.equal(shape(out), 'a [g: b c]')
})

test('user-named groups: members are never touched, the group is never dissolved or renamed', () => {
  const state = {
    tabs: [tab('a', 'u'), tab('b', 'u'), tab('c'), tab('d')],
    groups: [grp('u', { name: 'Mine' })]
  }
  const out = autoGroupRail(state, ctx({ a: A, b: B, c: A, d: A }), counter())
  assert.equal(shape(out), '[u: a b] [auto-1: c d]')
  assert.equal(out.groups[0], state.groups[0])
  const single = { tabs: [tab('a', 'u'), tab('b')], groups: [grp('u', { name: 'Mine' })] }
  assert.equal(autoGroupRail(single, ctx({ a: A, b: B }), counter()), single)
})

test('a user-named group without a key never attracts tabs; with a key it does, while it has a free member', () => {
  const plain = { tabs: [tab('a', 'u'), tab('b', 'u'), tab('c')], groups: [grp('u', { name: 'Mine' })] }
  assert.equal(autoGroupRail(plain, ctx({ a: A, b: A, c: A }), counter()), plain)

  const keyed = { tabs: [tab('a', 'u'), tab('b', 'u'), tab('c')], groups: [grp('u', { name: 'Mine', key: foldProjectKey(A) })] }
  const out = autoGroupRail(keyed, ctx({ a: A, b: A, c: A }), counter())
  assert.equal(shape(out), '[u: a b c]')
  assert.deepEqual(out.groups.map((g) => [g.id, g.name, g.auto]), [['u', 'Mine', false]])

  // Every member placed by the user: the arrangement is the user's, nothing joins.
  const placed = {
    tabs: [tab('a', 'u', { manual: true }), tab('b', 'u', { manual: true }), tab('c'), tab('d')],
    groups: [grp('u', { name: 'Mine', key: foldProjectKey(A) })]
  }
  const same = autoGroupRail(placed, ctx({ a: A, b: A, c: A, d: A }), counter())
  assert.equal(shape(same), '[u: a b] [auto-1: c d]')
})

test('a renamed auto group keeps its identity: it takes same-key tabs and survives at one tab', () => {
  const base = { tabs: [tab('a', 'g'), tab('b', 'g'), tab('c')], groups: [auto('g', A, { title: 'Alpha' })] }
  const renamed = renameGroup(base.tabs, base.groups, 'g', 'My Alpha')
  assert.equal(renamed.groups[0].auto, false)
  assert.equal(renamed.groups[0].key, foldProjectKey(A))
  assert.equal(renamed.groups[0].title, 'Alpha')
  const joined = autoGroupRail(renamed, ctx({ a: A, b: A, c: A }), counter())
  assert.equal(shape(joined), '[g: a b c]')
  // Both members cd away: the user's group stays (touched), now with the tabs it still has.
  const left = autoGroupRail(renamed, ctx({ a: B, b: B, c: null }), counter())
  assert.equal(shape(left), '[g: a b] c')
  const one = { tabs: [tab('a', 'g'), tab('c')], groups: renamed.groups }
  assert.equal(autoGroupRail(one, ctx({ a: B, c: null }), counter()), one)
})

test('manual groups made with createGroup are left alone', () => {
  const made = createGroup([tab('a'), tab('b'), tab('c')], [], ['a'], 'grp-1')
  assert.equal(autoGroupRail(made, ctx({ a: A, b: A, c: A }), counter()).groups.length, 2)
  const out = autoGroupRail(made, ctx({ a: A, b: A, c: A }), counter())
  assert.equal(shape(out), '[grp-1: a] [auto-1: b c]')
})

test('a tab dragged into an auto group is manual and stays after a cd; the others still follow the key', () => {
  const state = { tabs: [tab('a', 'g'), tab('b', 'g'), tab('c')], groups: [auto('g', A)] }
  const dragged = moveTabs(state.tabs, state.groups, 'c', { intoGroup: 'g' })
  assert.equal(dragged.tabs.find((t) => t.id === 'c').manual, true)
  const out = autoGroupRail(dragged, ctx({ a: A, b: A, c: B }), counter())
  assert.equal(out, dragged)
})

test('the title follows projectName and is written only when it differs', () => {
  const state = { tabs: [tab('a', 'g'), tab('b', 'g')], groups: [auto('g', A)] }
  const named = autoGroupRail(state, ctx({ a: A, b: A }), counter())
  assert.equal(named.groups[0].title, 'Alpha')
  assert.equal(named.groups[0].name, undefined)
  const again = autoGroupRail(named, ctx({ a: A, b: A }), counter())
  assert.equal(again, named)
  const renamedFolder = autoGroupRail(named, ctx({ a: 'C:\\Work\\ALPHA', b: 'C:\\Work\\ALPHA' }), counter())
  assert.equal(renamedFolder.groups[0].title, 'ALPHA')
  assert.equal(renamedFolder.groups[0].id, 'g')
  // A title is not the user touching the group: it does not keep a one-tab group alive.
  const lone = normalizeRail([tab('a', 'g')], [grp('g', { auto: true, title: 'Alpha', key: 'x' })])
  assert.deepEqual(lone.groups, [])
})

test('renameGroup keeps the title, and clearing a name falls back to it', () => {
  const state = { tabs: [tab('a', 'g'), tab('b', 'g')], groups: [auto('g', A, { title: 'Alpha' })] }
  const named = renameGroup(state.tabs, state.groups, 'g', 'Mine')
  assert.equal(named.groups[0].title, 'Alpha')
  const cleared = renameGroup(named.tabs, named.groups, 'g', '')
  assert.equal(cleared.groups[0].name, undefined)
  assert.equal(cleared.groups[0].title, 'Alpha')
  assert.equal(cleared.groups[0].auto, false)
})

test('normalizeRail cleans a malformed title', () => {
  const out = normalizeRail([tab('a', 'g'), tab('b', 'g')], [grp('g', { title: '   ' })])
  assert.equal('title' in out.groups[0], false)
  const keep = normalizeRail([tab('a', 'g'), tab('b', 'g')], [grp('g', { title: 'T' })])
  assert.equal(keep.groups[0].title, 'T')
})

test('a no-op returns the very same state object, and the result is idempotent', () => {
  const state = { tabs: [tab('a'), tab('b'), tab('c')], groups: [] }
  const contexts = ctx({ a: A, b: A, c: B })
  const once = autoGroupRail(state, contexts, counter())
  const twice = autoGroupRail(once, contexts, counter())
  assert.equal(twice, once)
  const nothing = { tabs: [tab('a'), tab('b')], groups: [] }
  assert.equal(autoGroupRail(nothing, ctx({ a: A, b: B }), counter()), nothing)
  assert.equal(autoGroupRail(nothing, new Map(), counter()), nothing)
  const empty = { tabs: [], groups: [] }
  assert.equal(autoGroupRail(empty, new Map(), counter()), empty)
})

test('group ids already in use are skipped; the id factory is only called when a group is created', () => {
  let calls = 0
  const options = { newGroupId: () => (++calls === 1 ? 'taken' : 'fresh') }
  const state = { tabs: [tab('a'), tab('b'), tab('c', 'taken'), tab('d', 'taken')], groups: [grp('taken', { name: 'Mine' })] }
  const out = autoGroupRail(state, ctx({ a: A, b: A }), options)
  assert.deepEqual(out.groups.map((g) => g.id), ['fresh', 'taken'])
  calls = 0
  autoGroupRail({ tabs: [tab('a'), tab('b')], groups: [] }, ctx({ a: A, b: B }), options)
  assert.equal(calls, 0)
})

test('collapsed state of a joined group is kept, and moving a tab in does not expand it', () => {
  const state = { tabs: [tab('a', 'g'), tab('b', 'g'), tab('c')], groups: [auto('g', A, { collapsed: true })] }
  const out = autoGroupRail(state, ctx({ a: A, b: A, c: A }), counter())
  assert.equal(out.groups[0].collapsed, true)
})

test('only the tabs that have to move move: pulled stragglers land next to the group, the rest keep their order', () => {
  const tabs = ['p', 'a', 'q', 'r', 'b', 's', 'c', 't'].map((id) => tab(id))
  const out = autoGroupRail({ tabs, groups: [] }, ctx({ a: A, b: A, c: A }), counter())
  assert.deepEqual(ids(out), ['p', 'a', 'b', 'c', 'q', 'r', 's', 't'])
})

test('an auto group with no key (hand-edited) hands its tabs to the group of their project', () => {
  const state = { tabs: [tab('a', 'g'), tab('b', 'g')], groups: [grp('g', { auto: true })] }
  const out = autoGroupRail(state, ctx({ a: A, b: A }), counter())
  assert.equal(shape(out), '[auto-1: a b]')
  assert.equal(out.groups.length, 1)
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

test('random states: invariants hold, tabs are never lost, manual and named groups are untouched, result is idempotent', () => {
  const rand = mulberry32(0x5eed)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const roots = [A, B, 'C:\\Work\\Gamma', 'c:\\work\\alpha', null, undefined]
  for (let run = 0; run < 300; run++) {
    const count = 2 + Math.floor(rand() * 12)
    const tabs = Array.from({ length: count }, (_, i) => tab('t' + i, undefined, rand() < 0.2 ? { manual: true } : {}))
    // Scatter some tabs into hand-built groups, then normalize.
    const groups = [auto('ga', A), auto('gb', B), grp('gu', { name: 'Mine', key: foldProjectKey('C:\\Work\\Gamma') }), grp('gn', { name: 'No key' })]
    const withGroups = tabs.map((t) => (rand() < 0.5 ? { ...t, groupId: pick(['ga', 'gb', 'gu', 'gn']) } : t))
    const start = normalizeRail(withGroups, groups)
    const contexts = new Map()
    for (const t of start.tabs) {
      const root = pick(roots)
      if (root !== undefined) contexts.set(t.id, { projectRoot: root, projectName: root === null ? null : root.split('\\').pop() })
    }
    const out = autoGroupRail(start, contexts, counter('n-'))

    // Structure.
    assert.equal(out.tabs.length, start.tabs.length)
    assert.deepEqual([...ids(out)].sort(), [...ids(start)].sort())
    const seen = new Set()
    let previous
    for (const t of out.tabs) {
      if (t.groupId !== undefined) {
        assert.ok(out.groups.some((g) => g.id === t.groupId), `run ${run} dangling group`)
        if (t.groupId !== previous) assert.ok(!seen.has(t.groupId), `run ${run} group not contiguous`)
        seen.add(t.groupId)
      }
      previous = t.groupId
    }
    for (const g of out.groups) {
      const members = out.tabs.filter((t) => t.groupId === g.id)
      assert.ok(members.length >= 1, `run ${run} empty group`)
      if (members.length === 1) assert.ok(!g.auto || g.name !== undefined, `run ${run} untouched auto group at one tab`)
    }

    // Manual tabs and members of unkeyed user groups are exactly where they were.
    for (const before of start.tabs) {
      const after = out.tabs.find((t) => t.id === before.id)
      assert.equal(after.manual, before.manual, `run ${run} manual flag changed`)
      const owner = start.groups.find((g) => g.id === before.groupId)
      if (owner && !owner.auto) assert.equal(after.groupId, before.groupId, `run ${run} moved ${before.id} out of a user group`)
      // A manual tab keeps its group unless that untouched auto group dissolved around it (rule 3 of the normalizer).
      if (before.manual && after.groupId !== before.groupId) {
        assert.equal(after.groupId, undefined, `run ${run} moved manual ${before.id} to another group`)
        assert.ok(!out.groups.some((g) => g.id === before.groupId), `run ${run} pulled manual ${before.id} out of a live group`)
      }
    }
    // User-named groups survive with their names.
    for (const g of start.groups.filter((candidate) => !candidate.auto)) {
      assert.equal(out.groups.find((candidate) => candidate.id === g.id)?.name, g.name, `run ${run} user group changed`)
    }
    // One auto group per key.
    const keys = out.groups.filter((g) => g.auto).map((g) => g.key)
    assert.equal(new Set(keys).size, keys.length, `run ${run} duplicate auto groups`)

    // Settled: nothing more to do, and the very same object comes back.
    assert.equal(autoGroupRail(out, contexts, counter('m-')), out, `run ${run} not idempotent`)
  }
})

test('toggleCollapsed on an auto group does not make it permanent or lose its title', () => {
  const state = { tabs: [tab('a', 'g'), tab('b', 'g')], groups: [auto('g', A, { title: 'Alpha' })] }
  const out = toggleCollapsed(state.tabs, state.groups, 'g')
  assert.equal(out.groups[0].auto, true)
  assert.equal(out.groups[0].title, 'Alpha')
})
