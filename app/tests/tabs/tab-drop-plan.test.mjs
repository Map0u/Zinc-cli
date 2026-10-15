/**
 * Drives the shipped drop planner (src/renderer/src/tabs/tabDropPlan.ts) on
 * frozen layouts with mixed heights: group headers 32px, rows 40px, 2px gaps.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { transformSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const { code } = transformSync(readFileSync(join(root, 'src/renderer/src/tabs/tabDropPlan.ts'), 'utf8'), {
  loader: 'ts',
  format: 'cjs',
  target: 'node22'
})
const require = createRequire(import.meta.url)
const module = { exports: {} }
// eslint-disable-next-line no-new-func
new Function('exports', 'require', 'module', code)(module.exports, require, module)
const { planTabDrag, planGroupDrag, resolveSlot, dropOutcome, dropLayout, ontoRowAt, DROP_HYSTERESIS_PX } = module.exports

/**
 * Frozen entries for a rail spec: a string is a loose row; { g, m: [...], collapsed } is a group
 * (a collapsed group has only its header on screen). `row` / `gap` default to the rail's 40 / 2.
 */
function layout(spec, { row = 40, header = 32, gap = 2, top = 100 } = {}) {
  const entries = []
  let y = top
  const push = (entry, height) => {
    entries.push({ ...entry, top: y, height })
    y += height + gap
  }
  for (const item of spec) {
    if (typeof item === 'string') {
      push({ id: item, kind: 'row' }, row)
      continue
    }
    push({ id: item.g, kind: 'header', groupId: item.g, count: item.n ?? item.m.length, collapsed: item.collapsed === true }, header)
    if (!item.collapsed) for (const id of item.m) push({ id, kind: 'row', groupId: item.g }, row)
  }
  return entries
}
const find = (entries, id) => entries.find((e) => e.id === id)
const centre = (e) => e.top + e.height / 2
const bottom = (e) => e.top + e.height

/** The target a ghost centred at `y` would drop on (no hysteresis: a fresh resolve). */
function dropAt(plan, y) {
  return dropOutcome(plan, resolveSlot(plan, -1, y))
}

// A | G1[m1 m2 m3] | B | G2 collapsed (x y) | G3[n1 n2] | C
const RAIL = ['A', { g: 'G1', m: ['m1', 'm2', 'm3'] }, 'B', { g: 'G2', m: [], n: 2, collapsed: true }, { g: 'G3', m: ['n1', 'n2'] }, 'C']

test('flat rail: a neighbour swaps after about half a row, like the old stride model', () => {
  const entries = layout(['a', 'b', 'c', 'd'])
  const plan = planTabDrag(entries, 'a')
  assert.equal(dropAt(plan, centre(find(entries, 'a'))), null)
  // Ghost centre over b: a lands after b (index 1 of the three others); over c: index 2; below d: the end.
  assert.deepEqual(dropAt(plan, centre(find(entries, 'b'))), { top: 1 })
  assert.deepEqual(dropAt(plan, centre(find(entries, 'c'))), { top: 2 })
  assert.deepEqual(dropAt(plan, centre(find(entries, 'd'))), { top: 3 })
  // The zone of b starts where b's box does.
  assert.deepEqual(dropAt(plan, find(entries, 'b').top + 1), { top: 1 })
  assert.equal(dropAt(plan, find(entries, 'b').top - 3), null)
  // Dragging d up: over c it lands before c.
  const up = planTabDrag(entries, 'd')
  assert.deepEqual(dropAt(up, centre(find(entries, 'c'))), { top: 2 })
  assert.deepEqual(dropAt(up, centre(find(entries, 'a'))), { top: 0 })
})

test('into a group from above: header joins at the end, first member splits, last member takes the whole box', () => {
  const entries = layout(RAIL)
  const plan = planTabDrag(entries, 'A')
  const h = find(entries, 'G1')
  // On the header: the upper quarter is "before the group" (top level; for A that is where it already is), the rest joins at the end.
  assert.equal(dropAt(plan, h.top + 2), null)
  assert.deepEqual(dropAt(planTabDrag(entries, 'C'), h.top + 2), { top: 1 })
  assert.deepEqual(dropAt(plan, h.top + h.height / 2), { into: 'G1', index: 3 })
  // m1: upper half = first position, lower half = after m1; then after m2; m3's whole box = the end.
  const m1 = find(entries, 'm1')
  assert.deepEqual(dropAt(plan, m1.top + 5), { into: 'G1', index: 0 })
  assert.deepEqual(dropAt(plan, m1.top + 30), { into: 'G1', index: 1 })
  assert.deepEqual(dropAt(plan, centre(find(entries, 'm2'))), { into: 'G1', index: 2 })
  const m3 = find(entries, 'm3')
  assert.deepEqual(dropAt(plan, m3.top + 5), { into: 'G1', index: 3 })
  assert.deepEqual(dropAt(plan, m3.top + 35), { into: 'G1', index: 3 })
})

test('after the last member: the lower half stays inside, the upper half of the next entry is outside', () => {
  const entries = layout(RAIL)
  const plan = planTabDrag(entries, 'A')
  const B = find(entries, 'B')
  // B follows G1: its upper half is "outside, right after the group" (top level 1 = before B), its lower half after B.
  assert.deepEqual(dropAt(plan, B.top + 5), { top: 1 })
  assert.deepEqual(dropAt(plan, B.top + 30), { top: 2 })

  // From below: dragging B up over G1's last member - lower half = end of G1, upper half = before m3.
  const up = planTabDrag(entries, 'B')
  const m3 = find(entries, 'm3')
  assert.deepEqual(dropAt(up, m3.top + 35), { into: 'G1', index: 3 })
  assert.deepEqual(dropAt(up, m3.top + 5), { into: 'G1', index: 2 })
  assert.deepEqual(dropAt(up, centre(find(entries, 'm1'))), { into: 'G1', index: 0 })
  assert.deepEqual(dropAt(up, centre(find(entries, 'm2'))), { into: 'G1', index: 1 })
})

test('out of a group and within it', () => {
  const entries = layout(RAIL)
  const plan = planTabDrag(entries, 'm3')
  const B = find(entries, 'B')
  const h = find(entries, 'G1')
  assert.equal(dropAt(plan, centre(find(entries, 'm3'))), null)
  // Past the group's end: outside right after it (before B), then after B.
  assert.deepEqual(dropAt(plan, B.top + 5), { top: 2 })
  assert.deepEqual(dropAt(plan, B.top + 30), { top: 3 })
  // Up over the own header: the upper quarter leaves above the group, the rest is the first position.
  assert.deepEqual(dropAt(plan, h.top + 2), { top: 1 })
  assert.deepEqual(dropAt(plan, h.top + 20), { into: 'G1', index: 0 })
  // Within the group.
  assert.deepEqual(dropAt(plan, centre(find(entries, 'm2'))), { into: 'G1', index: 1 })
  assert.deepEqual(dropAt(plan, centre(find(entries, 'm1'))), { into: 'G1', index: 0 })
  // Dragging m1 down: over m2 it lands after m2 (index 1 of the others), over m3 at the end.
  const down = planTabDrag(entries, 'm1')
  assert.deepEqual(dropAt(down, centre(find(entries, 'm2'))), { into: 'G1', index: 1 })
  assert.deepEqual(dropAt(down, centre(find(entries, 'm3'))), { into: 'G1', index: 2 })
  assert.equal(dropAt(down, centre(find(entries, 'm1'))), null)
})

test('a collapsed group is joined at its end without a gap opening, and shows the accent', () => {
  const entries = layout(RAIL)
  const plan = planTabDrag(entries, 'A')
  const h = find(entries, 'G2')
  assert.deepEqual(dropAt(plan, h.top + 2), { top: 2 })
  const slot = resolveSlot(plan, -1, h.top + 20)
  assert.deepEqual(dropOutcome(plan, slot), { into: 'G2', index: null })
  const layoutOut = dropLayout(plan, slot, undefined)
  assert.equal(layoutOut.lineTop, null)
  assert.equal(layoutOut.accent, 'G2')
  // Nothing opens: everything after A just closes A's slot.
  const stride = 42
  assert.equal(layoutOut.shifts[0], 0)
  assert.deepEqual(layoutOut.shifts.slice(1), Array(entries.length - 1).fill(-stride))
  // B (loose, below the collapsed group in another layout) lands after the collapsed header too.
  const below = planTabDrag(layout(['x', { g: 'G', m: [], n: 3, collapsed: true }, 'y']), 'y')
  assert.deepEqual(dropAt(below, 100 + 42 + 20), { into: 'G', index: null })
})

test('the entry after a collapsed group splits like one after an expanded group', () => {
  const entries = layout(['A', { g: 'G', m: [], n: 3, collapsed: true }, 'R', 'S'])
  const plan = planTabDrag(entries, 'A')
  const R = find(entries, 'R')
  assert.deepEqual(dropAt(plan, R.top + 5), { top: 1 })
  assert.deepEqual(dropAt(plan, R.top + 30), { top: 2 })
})

test('the very start and very end of the rail', () => {
  const entries = layout(RAIL)
  const down = planTabDrag(entries, 'A')
  const last = entries[entries.length - 1]
  assert.deepEqual(dropAt(down, bottom(last) + 30), { top: 5 })
  const up = planTabDrag(entries, 'C')
  assert.deepEqual(dropAt(up, 50), { top: 0 })
  // Below the last group's last member (the list ends there): outside, at the end.
  const tail = layout(['a', { g: 'G', m: ['p', 'q'] }])
  const fromTop = planTabDrag(tail, 'a')
  const q = find(tail, 'q')
  assert.deepEqual(dropAt(fromTop, q.top + 20), { into: 'G', index: 2 })
  assert.deepEqual(dropAt(fromTop, bottom(q) + 10), { top: 1 })
  // The last member dragged down past the end of the rail leaves its group.
  const out = planTabDrag(tail, 'q')
  assert.equal(dropAt(out, centre(q)), null)
  assert.deepEqual(dropAt(out, bottom(q) + 10), { top: 2 })
})

test('single-member groups: joining, leaving, and the group that the drag empties is not counted', () => {
  // x | S[only] | y | z
  const entries = layout(['x', { g: 'S', m: ['only'] }, 'y', 'z'])
  const join = planTabDrag(entries, 'z')
  const only = find(entries, 'only')
  // From below: the single member's lower half is the end of the group, its upper half before it.
  assert.deepEqual(dropAt(join, only.top + 35), { into: 'S', index: 1 })
  assert.deepEqual(dropAt(join, only.top + 5), { into: 'S', index: 0 })
  const fromTop = planTabDrag(entries, 'x')
  assert.deepEqual(dropAt(fromTop, only.top + 5), { into: 'S', index: 0 })
  assert.deepEqual(dropAt(fromTop, only.top + 35), { into: 'S', index: 1 })

  // The only member itself: grazing its own header changes nothing; the header's upper quarter ungroups in place.
  const own = planTabDrag(entries, 'only')
  const header = find(entries, 'S')
  assert.equal(dropAt(own, centre(only)), null)
  assert.equal(dropAt(own, header.top + 20), null)
  assert.deepEqual(dropAt(own, header.top + 2), { top: 1 })
  // Over y (below): after y; the emptied group does not count: x, y, z are the others -> index 2.
  assert.deepEqual(dropAt(own, centre(find(entries, 'y'))), { top: 2 })
  assert.deepEqual(dropAt(own, centre(find(entries, 'x'))), { top: 0 })
})

test('hysteresis: 6px beyond a boundary to switch, less on a thin slot', () => {
  const entries = layout(['a', 'b', 'c'])
  const plan = planTabDrag(entries, 'a')
  const b = find(entries, 'b')
  const bound = (bottom(find(entries, 'a')) + b.top) / 2
  assert.equal(DROP_HYSTERESIS_PX, 6)
  const origin = plan.origin
  const target = resolveSlot(plan, -1, centre(b))
  assert.notEqual(origin, target)
  // At rest, the origin slot holds the ghost until 6px past its edge...
  assert.equal(resolveSlot(plan, origin, bound + 5), origin)
  assert.equal(resolveSlot(plan, origin, bound + 7), target)
  // ...and the new slot holds it going back until 6px before that edge.
  assert.equal(resolveSlot(plan, target, bound - 5), target)
  assert.equal(resolveSlot(plan, target, bound - 7), origin)

  // A header's upper quarter is 8px tall: it can still be entered and left.
  const grouped = layout(RAIL)
  const down = planTabDrag(grouped, 'C')
  const h = find(grouped, 'G1')
  const quarter = h.top + h.height / 4
  const before = resolveSlot(down, -1, h.top + 1)
  const join = resolveSlot(down, -1, h.top + 20)
  assert.deepEqual(dropOutcome(down, before), { top: 1 })
  assert.equal(resolveSlot(down, before, quarter + 1), before)
  assert.equal(resolveSlot(down, before, quarter + 4), join)
  assert.equal(resolveSlot(down, join, quarter - 1), join)
  assert.equal(resolveSlot(down, join, quarter - 4), before)
})

test('dropLayout opens exactly one gap, as tall as the dragged row plus the gap, wherever it is', () => {
  const entries = layout(RAIL)
  const plan = planTabDrag(entries, 'A')
  const m2 = find(entries, 'm2')
  const slot = resolveSlot(plan, -1, centre(m2))
  assert.deepEqual(dropOutcome(plan, slot), { into: 'G1', index: 2 })
  const out = dropLayout(plan, slot, undefined)
  assert.equal(out.nested, true)
  assert.equal(out.accent, 'G1')
  // Moved positions of the kept entries: spaced 2px everywhere but one hole of 2 + 42 where the row lands.
  const moved = entries.map((e, i) => ({ top: e.top + out.shifts[i], bottom: bottom(e) + out.shifts[i] })).slice(1)
  const spaces = moved.slice(1).map((e, i) => e.top - moved[i].bottom)
  assert.deepEqual(spaces.filter((s) => s !== 2), [44])
  const holeAt = spaces.findIndex((s) => s === 44)
  assert.equal(out.lineTop, moved[holeAt].bottom + 1)
  // The hole is right after m2 (the third member is the next one).
  assert.equal(moved[holeAt + 1].top, find(entries, 'm3').top + out.shifts[entries.indexOf(find(entries, 'm3'))])

  // The origin slot changes nothing.
  const rest = dropLayout(plan, plan.origin, undefined)
  assert.deepEqual(rest.shifts, Array(entries.length).fill(0))
  assert.equal(rest.lineTop, null)
})

test('there is no hard-coded stride: the slide is the dragged height plus the measured gap', () => {
  const entries = layout(['a', 'b', 'c'], { row: 50, gap: 6 })
  const plan = planTabDrag(entries, 'a')
  assert.equal(plan.stride, 56)
  const out = dropLayout(plan, resolveSlot(plan, -1, centre(find(entries, 'c'))), undefined)
  assert.deepEqual(out.shifts, [0, -56, -56])
  const tall = layout([{ g: 'G', m: ['m1', 'm2'] }, 'r'])
  // A header (32px) is not a tab row: dragging the row below the group slides by the row's own 40 + 2.
  assert.equal(planTabDrag(tall, 'r').stride, 42)
  assert.equal(planGroupDrag(tall, 'G').stride, 32 + 2 + 40 + 2 + 40 + 2)
})

test('dragging a group moves the whole block among top-level units only', () => {
  const entries = layout(RAIL)
  const plan = planGroupDrag(entries, 'G1')
  const g1 = find(entries, 'G1')
  const height = bottom(find(entries, 'm3')) - g1.top
  assert.equal(plan.last - plan.first, 3)
  // At rest nothing happens.
  assert.equal(dropAt(plan, g1.top + height / 2), null)
  // Far above: before A. Far below: the end.
  assert.deepEqual(dropAt(plan, 0), { top: 0, before: 'A' })
  assert.deepEqual(dropAt(plan, 10000), { top: 5, before: null })
  // The block lands between B and the collapsed G2 when its centre is where that landing puts it.
  const B = find(entries, 'B')
  const g2 = find(entries, 'G2')
  const landing = (B.top + B.height + g2.top) / 2 - height / 2
  assert.deepEqual(dropAt(plan, landing), { top: 2, before: 'G2' })
  // Every outcome is top level: never "into" a group.
  for (let y = 0; y < 700; y += 7) {
    const out = dropAt(plan, y)
    assert.ok(out === null || 'top' in out)
  }
  // Layout: B and everything between slide up by the block's height + gap, the block's own entries stay put.
  const slot = resolveSlot(plan, -1, landing)
  const out = dropLayout(plan, slot, 'G1')
  const stride = height + 2
  assert.equal(out.accent, null)
  assert.equal(out.nested, false)
  assert.deepEqual(
    entries.map((e, i) => [e.id, out.shifts[i]]).filter(([, s]) => s !== 0),
    [['B', -stride]]
  )
  // Mixed heights: the hole is exactly the block high.
  const moved = entries.map((e, i) => ({ id: e.id, top: e.top + out.shifts[i], bottom: bottom(e) + out.shifts[i] }))
  const keptMoved = moved.filter((e) => !['G1', 'm1', 'm2', 'm3'].includes(e.id))
  const spaces = keptMoved.slice(1).map((e, i) => e.top - keptMoved[i].bottom)
  assert.deepEqual(spaces.filter((s) => s !== 2), [height + 4])
  assert.equal(out.lineTop, keptMoved[spaces.findIndex((s) => s !== 2)].bottom + 1)
})

test('a group that is the only unit has nothing to move past; a group drag of an unknown id plans nothing', () => {
  assert.equal(planGroupDrag(layout([{ g: 'G', m: ['a', 'b'] }]), 'G'), null)
  assert.equal(planGroupDrag(layout(['a', 'b']), 'G'), null)
  assert.equal(planTabDrag(layout(['a']), 'a'), null)
  assert.equal(planTabDrag(layout(['a', 'b']), 'zz'), null)
})

test('a collapsed group drags as its header alone', () => {
  const entries = layout(['a', { g: 'K', m: [], n: 4, collapsed: true }, 'b'])
  const plan = planGroupDrag(entries, 'K')
  assert.equal(plan.first, plan.last)
  assert.equal(plan.stride, 32 + 2)
  assert.deepEqual(dropAt(plan, 0), { top: 0, before: 'a' })
  assert.deepEqual(dropAt(plan, 1000), { top: 2, before: null })
})

test('ontoRowAt: only the middle of a loose row that is not the dragged one; a pause there outranks the slot', () => {
  const entries = layout(['A', { g: 'G', m: ['m1', 'm2'] }, 'B', 'C'])
  const plan = planTabDrag(entries, 'A')
  const b = find(entries, 'B')
  assert.equal(ontoRowAt(plan, centre(b)), 'B')
  assert.equal(ontoRowAt(plan, centre(b) + 9), 'B')
  assert.equal(ontoRowAt(plan, centre(b) + 11), null, 'outside the middle band')
  assert.equal(ontoRowAt(plan, centre(find(entries, 'A'))), null, 'the dragged row itself')
  assert.equal(ontoRowAt(plan, centre(find(entries, 'm1'))), null, 'a group member')
  assert.equal(ontoRowAt(plan, centre(find(entries, 'G'))), null, 'a header')
  // The same y, resolved as a slot, is the ordinary "after B": grouping is the rail's timed addition.
  assert.deepEqual(dropOutcome(plan, resolveSlot(plan, -1, centre(b))), { top: 2 })
  assert.deepEqual(dropOutcome(plan, 0, 'B'), { onto: 'B' })
})

test('dropLayout onto: nothing slides, no line, no accent, only the row is named', () => {
  const entries = layout(['A', 'B', 'C'])
  const plan = planTabDrag(entries, 'A')
  const layoutOnto = dropLayout(plan, resolveSlot(plan, -1, centre(find(entries, 'C'))), undefined, 'C')
  assert.deepEqual(layoutOnto.shifts, [0, 0, 0])
  assert.equal(layoutOnto.lineTop, null)
  assert.equal(layoutOnto.accent, null)
  assert.equal(layoutOnto.onto, 'C')
  assert.equal(dropLayout(plan, 0).onto, null)
})
