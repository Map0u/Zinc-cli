/**
 * Drives the shipped RailDrag (src/renderer/src/tabs/tabRailDrag.ts) against
 * hand-rolled DOM fakes: a drag must measure the layout once, paint through
 * direct style writes only, clear them before the order commits, and clean up
 * when interrupted - for tab rows and for whole groups.
 */
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

const { outputFiles } = await build({
  entryPoints: [join(root, 'src/renderer/src/tabs/tabRailDrag.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs'
})
const module = { exports: {} }
// eslint-disable-next-line no-new-func
new Function('module', 'exports', outputFiles[0].text)(module, module.exports)
const { RailDrag } = module.exports

function fakeEl(attrs = {}, box = { top: 0, height: 40 }) {
  const classes = new Set()
  const el = {
    attrs: { ...attrs },
    dataset: {},
    style: {},
    reads: 0,
    classes,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    removeAttribute(name) {
      delete el.attrs[name]
      if (name.startsWith('data-')) delete el.dataset[name.slice(5)]
    },
    setAttribute(name, value) { el.attrs[name] = value },
    getAttribute: (name) => el.attrs[name] ?? null,
    hasAttribute: (name) => name in el.attrs,
    // [data-collapsed="true"] -> the hidden members of a collapsed group; [data-groupid] -> the owning wrapper.
    closest: (sel) => (sel.includes('data-collapsed') ? (el.hidden ? {} : null) : sel.includes('data-groupid') ? (el.wrapper ?? null) : null),
    getBoundingClientRect() {
      el.reads++
      return { left: 10, top: box.top, width: 230, height: box.height, bottom: box.top + box.height }
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    remove() { el.removed = true },
    addEventListener() {},
    removeEventListener() {},
    cloneNode() {
      const clone = fakeEl()
      clone.isGhost = true
      clone.count = el.countEl
      clone.querySelector = (sel) => (sel === '[data-groupcount]' ? (el.countEl ?? null) : null)
      return clone
    }
  }
  return el
}

/**
 * A rail from a spec: a string is a loose row; { g, m, collapsed } is a group (its members
 * stay in the DOM when collapsed, but hidden). Rows 40px, headers 32px, 2px gaps from y=100.
 */
function setup(spec, { reduced = true } = {}) {
  const nodes = []
  const byId = {}
  const wrappers = {}
  let y = 100
  const make = (attrs, height, extra = {}) => {
    const box = { top: y, height }
    const el = Object.assign(fakeEl(attrs, box), extra)
    y += height + 2
    nodes.push(el)
    return el
  }
  for (const item of spec) {
    if (typeof item === 'string') {
      byId[item] = make({ 'data-tabid': item }, 40)
      continue
    }
    const wrapper = fakeEl({ 'data-groupid': item.g })
    wrappers[item.g] = wrapper
    const header = make({ 'data-groupheader': item.g, 'data-count': String(item.m.length), 'aria-expanded': String(!item.collapsed) }, 32, { wrapper })
    const countClasses = []
    header.countEl = {}
    header.countEl.classList = { add: (c) => countClasses.push('+' + c), remove: (c) => countClasses.push('-' + c) }
    header.countClasses = countClasses
    byId[item.g] = header
    for (const id of item.m) {
      const hidden = item.collapsed === true
      const row = hidden
        ? Object.assign(fakeEl({ 'data-tabid': id }, { top: 0, height: 0 }), { wrapper, hidden: true })
        : make({ 'data-tabid': id }, 40, { wrapper })
      if (hidden) nodes.push(row)
      byId[id] = row
    }
  }
  const list = Object.assign(fakeEl(), {
    scrollTop: 0,
    querySelectorAll: () => nodes,
    querySelector: (sel) => nodes.find((n) => sel.includes(`"${n.attrs['data-tabid'] ?? n.attrs['data-groupheader']}"`)) ?? null,
    getBoundingClientRect: () => ({ top: 80, bottom: 700 })
  })
  const dropLine = fakeEl()
  const log = []
  const host = {
    list: () => list,
    dropLine: () => dropLine,
    activeId: () => 'a',
    isRenaming: () => false,
    select: (id) => log.push(['select', id]),
    dropTab: (id, target) => {
      // Order commits only after every slide, the accent and the list's drag state are gone.
      log.push(['tab', id, target, nodes.map((r) => r.style.transform ?? ''), list.dataset.dragging, Object.values(wrappers).map((w) => w.attrs['data-droptarget'])])
    },
    dropOnto: (id, targetId) => log.push(['onto', id, targetId, nodes.map((r) => r.style.transform ?? ''), Object.values(byId).map((r) => r.attrs['data-droptarget'])]),
    dropGroup: (id, before) => log.push(['group', id, before, nodes.map((r) => r.style.transform ?? ''), Object.values(wrappers).map((w) => w.style.transform ?? '')])
  }
  const frames = []
  const timers = []
  globalThis.window = {
    matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length },
    cancelAnimationFrame() {},
    setTimeout: (fn) => { timers.push(fn); return timers.length },
    clearTimeout: (id) => { timers[id - 1] = () => {} }
  }
  globalThis.requestAnimationFrame = window.requestAnimationFrame
  globalThis.getComputedStyle = () => ({ backgroundColor: '#111' })
  globalThis.CSS = { escape: (id) => id }
  const bodyChildren = []
  globalThis.document = { body: { style: {}, appendChild: (el) => bodyChildren.push(el) } }
  const drag = new RailDrag(host)
  const event = (el, clientX, clientY) => ({
    pointerId: 3, button: 0, clientX, clientY, currentTarget: el,
    target: { closest: () => null }, preventDefault() {}
  })
  const reads = () => [...nodes, list].reduce((n, el) => n + el.reads, 0)
  return { drag, byId, nodes, wrappers, list, dropLine, log, event, bodyChildren, timers, frames, reads }
}

const moves = (log, kind) => log.filter((e) => e[0] === kind)

test('a tab drag paints slides and the drop line by direct style writes and clears them before the commit', () => {
  const { drag, byId, nodes, list, dropLine, log, event, bodyChildren } = setup(['a', 'b', 'c'])
  const a = byId.a
  drag.pointerDown(event(a, 20, 120), 'a')
  drag.pointerMove(event(a, 40, 125))
  assert.equal(bodyChildren.length, 1)
  assert.equal(list.dataset.dragging, 'true')
  assert.equal(a.style.opacity, '0')
  assert.equal(a.dataset.dragging, 'true')
  assert.equal(drag.busy, true)
  assert.equal(drag.suppressClick, false)
  assert.deepEqual(nodes.slice(1).map((r) => r.style.transform), ['translate3d(0, 0, 0)', 'translate3d(0, 0, 0)'])
  // Ghost past c's centre: b and c slide up by the row's own 40 + 2; the line sits where the slot opened.
  drag.pointerMove(event(a, 40, 200))
  assert.equal(byId.b.style.transform, 'translate3d(0, -42px, 0)')
  assert.equal(byId.c.style.transform, 'translate3d(0, -42px, 0)')
  assert.equal(dropLine.dataset.active, 'true')
  // The slot opened right under c (which slid up to 142..182): the line sits in the 2px gap above it, in the stack's own coordinates.
  assert.equal(dropLine.style.top, `${183 - 100}px`)
  drag.pointerUp(event(a, 40, 200))
  assert.deepEqual(moves(log, 'tab'), [['tab', 'a', { top: 2 }, ['', '', ''], undefined, []]])
  assert.equal(dropLine.dataset.active, undefined)
  assert.equal(drag.suppressClick, true)
  assert.equal(drag.busy, false)
  assert.equal(a.style.opacity, '')
  assert.equal(bodyChildren[0].removed, true)
})

test('moving back onto the origin slot commits nothing', () => {
  const { drag, byId, log, event } = setup(['a', 'b', 'c'])
  drag.pointerDown(event(byId.b, 20, 160), 'b')
  drag.pointerMove(event(byId.b, 40, 165))
  drag.pointerUp(event(byId.b, 40, 165))
  assert.deepEqual(moves(log, 'tab'), [])
  assert.equal(drag.busy, false)
})

test('a press that never moves is a click, not a drag', () => {
  const { drag, byId, list, log, event, bodyChildren } = setup(['a', 'b', 'c'])
  drag.pointerDown(event(byId.a, 20, 120), 'a')
  drag.pointerMove(event(byId.a, 21, 121))
  drag.pointerUp(event(byId.a, 21, 121))
  assert.equal(bodyChildren.length, 0)
  assert.equal(list.dataset.dragging, undefined)
  assert.equal(drag.suppressClick, false)
  assert.deepEqual(log, [])
})

test('dragging a background row selects it once', () => {
  const { drag, byId, log, event } = setup(['a', 'b', 'c'])
  drag.pointerDown(event(byId.c, 20, 190), 'c')
  drag.pointerMove(event(byId.c, 40, 195))
  drag.pointerMove(event(byId.c, 40, 150))
  assert.deepEqual(moves(log, 'select'), [['select', 'c']])
})

test('cancel (blur or lost pointer capture) removes the ghost and every drag style without reordering', () => {
  for (const interruption of ['cancel', 'lostpointercapture']) {
    const { drag, byId, nodes, list, dropLine, log, event, bodyChildren } = setup(['a', 'b', 'c'])
    drag.pointerDown(event(byId.a, 20, 120), 'a')
    drag.pointerMove(event(byId.a, 40, 125))
    drag.pointerMove(event(byId.a, 40, 200))
    assert.equal(dropLine.dataset.active, 'true')
    if (interruption === 'cancel') drag.cancel()
    else drag.lostPointerCapture(event(byId.a, 40, 200))
    assert.equal(bodyChildren.at(-1).removed, true)
    assert.equal(byId.a.style.opacity, '')
    assert.equal(byId.a.style.pointerEvents, '')
    assert.deepEqual(nodes.map((r) => r.style.transform ?? ''), ['', '', ''])
    assert.equal(list.dataset.dragging, undefined)
    assert.equal(dropLine.dataset.active, undefined)
    assert.equal(document.body.style.cursor, '')
    assert.equal(document.body.style.userSelect, '')
    assert.deepEqual(moves(log, 'tab'), [])
    assert.equal(drag.busy, false)
  }
})

test('Esc cancels a lifted drag, and the pointerup that ends the press is not a click', () => {
  const { drag, byId, nodes, list, dropLine, log, event, bodyChildren } = setup(['a', 'b', 'c'])
  assert.equal(drag.escape(), false) // nothing lifted
  drag.pointerDown(event(byId.a, 20, 120), 'a')
  assert.equal(drag.escape(), false) // pressed, not dragging yet
  drag.pointerMove(event(byId.a, 40, 125))
  drag.pointerMove(event(byId.a, 40, 200))
  assert.equal(drag.escape(), true)
  assert.equal(bodyChildren.at(-1).removed, true)
  assert.deepEqual(nodes.map((r) => r.style.transform ?? ''), ['', '', ''])
  assert.equal(list.dataset.dragging, undefined)
  assert.equal(dropLine.dataset.active, undefined)
  assert.equal(drag.busy, false)
  // The button is still down: further moves do nothing, the release is swallowed as a click.
  drag.pointerMove(event(byId.a, 40, 260))
  assert.equal(bodyChildren.length, 1)
  drag.pointerUp(event(byId.a, 40, 260))
  assert.equal(drag.suppressClick, true)
  assert.deepEqual(moves(log, 'tab'), [])
  assert.equal(drag.escape(), false)
})

test('a renaming row or header is not draggable', () => {
  const { byId, event } = setup(['a', 'b'])
  const host = {
    list: () => null, dropLine: () => null, activeId: () => 'a',
    isRenaming: (kind, id) => kind === 'group' ? id === 'g' : id === 'a',
    select() {}, dropTab() {}, dropGroup() {}
  }
  const renaming = new RailDrag(host)
  renaming.pointerDown(event(byId.a, 20, 120), 'a')
  renaming.pointerDown(event(byId.a, 20, 120), 'g', 'group')
  assert.equal(renaming.busy, false)
  renaming.pointerDown(event(byId.b, 20, 160), 'b')
  assert.equal(renaming.busy, true)
})

test('after the one measurement at drag start, nothing is read from layout while moving', () => {
  const { drag, byId, reads, event } = setup(['a', { g: 'G', m: ['m1', 'm2'] }, 'b', 'c'])
  drag.pointerDown(event(byId.a, 20, 120), 'a')
  drag.pointerMove(event(byId.a, 40, 125))
  const afterStart = reads()
  assert.ok(afterStart > 0)
  for (let y = 130; y < 420; y += 9) drag.pointerMove(event(byId.a, 40, y))
  assert.equal(reads(), afterStart)
})

test('tab into a group: the header and rows below slide, the group gets the accent, the drop is an index', () => {
  const { drag, byId, nodes, wrappers, dropLine, log, event } = setup(['a', { g: 'G', m: ['m1', 'm2'] }, 'b'])
  const a = byId.a
  drag.pointerDown(event(a, 20, 120), 'a')
  drag.pointerMove(event(a, 40, 125))
  // Ghost centre (clientY - grab 20 + 20) on m1's upper half: first position in the group.
  drag.pointerMove(event(a, 40, 100 + 42 + 34 + 5 + 4))
  assert.equal(byId.G.style.transform, 'translate3d(0, -42px, 0)') // the header takes a's slot
  assert.equal(byId.m1.style.transform, 'translate3d(0, 0, 0)') // closed a's slot, opened one right above itself: net zero
  assert.equal(byId.m2.style.transform, 'translate3d(0, 0, 0)')
  assert.equal(wrappers.G.attrs['data-droptarget'], 'true')
  assert.equal(dropLine.dataset.nested, 'true')
  assert.equal(dropLine.dataset.active, 'true')
  drag.pointerUp(event(a, 40, 100 + 42 + 34 + 5 + 4)) // where the last move left it
  const [drop] = moves(log, 'tab')
  assert.equal(drop[1], 'a')
  assert.deepEqual(drop[2], { into: 'G', index: 0 })
  assert.deepEqual(drop[3], Array(nodes.length).fill(''))
  assert.deepEqual(drop[5], [undefined]) // the accent is gone before the order commits
  assert.equal(dropLine.dataset.nested, undefined)
})

test('a collapsed group is joined without opening a gap, and its hidden members take no part', () => {
  const { drag, byId, nodes, wrappers, dropLine, log, event } = setup(['a', { g: 'K', m: ['x', 'y'], collapsed: true }, 'b'])
  const a = byId.a
  drag.pointerDown(event(a, 20, 120), 'a')
  drag.pointerMove(event(a, 40, 125))
  assert.equal(byId.x.style.transform, undefined)
  // Ghost centre (clientY - the 25px grabbed at activation + 20) in the lower part of K's header.
  drag.pointerMove(event(a, 40, 142 + 18 + 5))
  assert.equal(wrappers.K.attrs['data-droptarget'], 'true')
  assert.equal(dropLine.dataset.active, undefined)
  assert.equal(byId.K.style.transform, 'translate3d(0, -42px, 0)')
  assert.equal(byId.b.style.transform, 'translate3d(0, -42px, 0)')
  assert.equal(byId.x.style.transform, undefined)
  drag.pointerUp(event(a, 40, 160))
  const [drop] = moves(log, 'tab')
  assert.deepEqual(drop[2], { into: 'K', index: null })
  assert.equal(byId.x.style.transform, undefined)
  assert.equal(nodes.length, 5)
})

test('dragging a group header slides the whole group as one block and drops it among top-level units', () => {
  const { drag, byId, wrappers, nodes, dropLine, log, event, bodyChildren } = setup(['a', { g: 'G', m: ['m1', 'm2'] }, 'b', 'c'])
  const header = byId.G
  drag.pointerDown(event(header, 20, 150), 'G', 'group')
  drag.pointerMove(event(header, 40, 155))
  // The whole block is the source (its slot stays, invisible); the ghost is the header with the count shown.
  assert.equal(wrappers.G.style.opacity, '0')
  assert.equal(wrappers.G.dataset.dragging, 'true')
  assert.equal(bodyChildren.length, 1)
  assert.deepEqual(byId.G.countClasses, ['-hidden', '+flex'])
  // Members and header do not slide on their own; loose rows do.
  assert.equal(byId.m1.style.transform, undefined)
  assert.equal(byId.a.style.transform, 'translate3d(0, 0, 0)')
  // Drag far down: b and c slide up by the block's height (32 + 3 * 42) + gap.
  drag.pointerMove(event(header, 40, 600))
  const block = 32 + 2 + 40 + 2 + 40
  assert.equal(byId.b.style.transform, `translate3d(0, ${-(block + 2)}px, 0)`)
  assert.equal(byId.c.style.transform, `translate3d(0, ${-(block + 2)}px, 0)`)
  assert.equal(byId.a.style.transform, 'translate3d(0, 0, 0)')
  assert.equal(dropLine.dataset.active, 'true')
  assert.equal(dropLine.dataset.nested, undefined)
  drag.pointerUp(event(header, 40, 600))
  const [drop] = moves(log, 'group')
  assert.deepEqual(drop.slice(0, 3), ['group', 'G', null])
  assert.deepEqual(drop[3], Array(nodes.length).fill(''))
  assert.equal(wrappers.G.style.opacity, '')
  assert.equal(moves(log, 'select').length, 0)
  assert.equal(drag.suppressClick, true)
})

test('a group header press that never moves is a click (it toggles), a drag is not', () => {
  const { drag, byId, event } = setup(['a', { g: 'G', m: ['m1', 'm2'] }, 'b'])
  drag.pointerDown(event(byId.G, 20, 150), 'G', 'group')
  drag.pointerMove(event(byId.G, 21, 151))
  drag.pointerUp(event(byId.G, 21, 151))
  assert.equal(drag.suppressClick, false)
  drag.pointerDown(event(byId.G, 20, 150), 'G', 'group')
  drag.pointerMove(event(byId.G, 40, 155))
  drag.pointerMove(event(byId.G, 40, 400))
  drag.pointerUp(event(byId.G, 40, 400))
  assert.equal(drag.suppressClick, true)
})

test('with animation: the order commits at release, the ghost glides to where the tab now is, and the re-parented row stays hidden until it lands', () => {
  const { drag, byId, list, nodes, log, event, frames, timers, bodyChildren } = setup(['a', { g: 'G', m: ['m1', 'm2'] }, 'b'], { reduced: false })
  const a = byId.a
  drag.pointerDown(event(a, 20, 120), 'a')
  drag.pointerMove(event(a, 40, 125))
  drag.pointerMove(event(a, 40, 100 + 42 + 34 + 5 + 4))
  // The commit re-parents the tab: its row becomes a new element at the new slot.
  const landed = Object.assign(fakeEl({ 'data-tabid': 'a' }, { top: 176, height: 40 }), {})
  const original = list.querySelector
  list.querySelector = (sel) => (sel.includes('"a"') && log.length > 0 ? landed : original(sel))
  drag.pointerUp(event(a, 40, 160))
  assert.equal(moves(log, 'tab').length, 1)
  assert.equal(drag.busy, true) // settling: the ghost is still up
  assert.equal(drag.suppressClick, true) // the click that follows the release is swallowed while the ghost is still settling
  const ghost = bodyChildren[0]
  assert.equal(ghost.removed, undefined)
  frames.at(-1)()
  assert.match(ghost.style.transition, /transform 160ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/)
  assert.equal(ghost.style.transform, 'translate3d(10px, 176px, 0) scale(1)')
  assert.equal(landed.style.opacity, '0')
  assert.equal(nodes.every((n) => !n.style.transform), true)
  timers.at(-1)() // the settle timeout
  assert.equal(ghost.removed, true)
  assert.equal(landed.style.opacity, '')
  assert.equal(drag.busy, false)
})

test('a wheel scroll under a still pointer moves the slot, and the drop uses it', () => {
  const { drag, byId, list, log, event } = setup(['a', 'b', 'c'])
  const scrolls = []
  list.addEventListener = (type, handler) => type === 'scroll' && scrolls.push(handler)
  list.removeEventListener = (type, handler) => { const i = scrolls.indexOf(handler); if (type === 'scroll' && i >= 0) scrolls.splice(i, 1) }
  drag.pointerDown(event(byId.a, 20, 120), 'a')
  drag.pointerMove(event(byId.a, 40, 125))
  assert.equal(scrolls.length, 1)
  // No pointer move: the list scrolls by two rows and the listener re-resolves the slot (the ghost is now over c).
  list.scrollTop = 84
  scrolls[0]()
  assert.equal(byId.c.style.transform, 'translate3d(0, -42px, 0)')
  // The same without the listener having run: the release itself syncs first.
  list.scrollTop = 0
  scrolls[0]()
  list.scrollTop = 84
  drag.pointerUp(event(byId.a, 40, 125))
  assert.deepEqual(moves(log, 'tab').map((e) => e[2]), [{ top: 2 }])
  assert.equal(scrolls.length, 0) // the listener goes with the drag
})

test('a structure change under a lifted drag puts it back; one under a settling drag does not', () => {
  const lifted = setup(['a', 'b', 'c'])
  lifted.drag.structureChanged() // nothing lifted: nothing to do
  lifted.drag.pointerDown(lifted.event(lifted.byId.a, 20, 120), 'a')
  lifted.drag.structureChanged() // pressed, not yet a drag
  assert.equal(lifted.drag.busy, true)
  lifted.drag.pointerMove(lifted.event(lifted.byId.a, 40, 125))
  lifted.drag.pointerMove(lifted.event(lifted.byId.a, 40, 200))
  lifted.drag.structureChanged()
  assert.equal(lifted.drag.busy, false)
  assert.equal(lifted.bodyChildren.at(-1).removed, true)
  assert.equal(lifted.byId.a.style.opacity, '')
  assert.equal(lifted.list.dataset.dragging, undefined)
  assert.deepEqual(moves(lifted.log, 'tab'), [])
  // The press may still be down: its release is not a click, and nothing is dropped.
  lifted.drag.pointerUp(lifted.event(lifted.byId.a, 40, 200))
  assert.deepEqual(moves(lifted.log, 'tab'), [])
  assert.equal(lifted.drag.suppressClick, true)

  // The commit's own change arrives while the ghost settles: the settle goes on.
  const settling = setup(['a', 'b', 'c'], { reduced: false })
  settling.drag.pointerDown(settling.event(settling.byId.a, 20, 120), 'a')
  settling.drag.pointerMove(settling.event(settling.byId.a, 40, 125))
  settling.drag.pointerMove(settling.event(settling.byId.a, 40, 200))
  settling.drag.pointerUp(settling.event(settling.byId.a, 40, 200))
  assert.equal(moves(settling.log, 'tab').length, 1)
  settling.drag.structureChanged()
  assert.equal(settling.drag.busy, true)
  assert.equal(settling.bodyChildren.at(-1).removed, undefined)
})

// The pause over a loose row's middle (a row is 40px; the middle is 10px either side of its centre).
test('resting over the middle of a loose row marks it, opens no gap, and the drop groups the two', () => {
  const { drag, byId, nodes, log, event, timers } = setup(['a', 'b', 'c'])
  drag.pointerDown(event(byId.a, 20, 120), 'a')
  drag.pointerMove(event(byId.a, 40, 125))
  drag.pointerMove(event(byId.a, 40, 204)) // c's centre: an ordinary reorder would put a after c
  assert.equal(byId.c.attrs['data-droptarget'], undefined, 'not yet: the pause has not run')
  assert.equal(byId.c.style.transform, 'translate3d(0, -42px, 0)')
  timers.at(-1)()
  assert.equal(byId.c.attrs['data-droptarget'], 'true')
  assert.deepEqual(nodes.map((r) => r.style.transform).slice(1), ['translate3d(0, 0px, 0)', 'translate3d(0, 0px, 0)'], 'every row is back where it was')
  drag.pointerUp(event(byId.a, 40, 204))
  assert.deepEqual(moves(log, 'tab'), [])
  const [onto] = moves(log, 'onto')
  assert.deepEqual(onto.slice(0, 3), ['onto', 'a', 'c'])
  assert.deepEqual(onto[3], ['', '', ''], 'the slides are gone before the order commits')
  assert.equal(byId.c.attrs['data-droptarget'], undefined)
})

test('releasing before the pause is an ordinary reorder, and leaving the middle drops the mark', () => {
  const { drag, byId, log, event, timers } = setup(['a', 'b', 'c'])
  drag.pointerDown(event(byId.a, 20, 120), 'a')
  drag.pointerMove(event(byId.a, 40, 125))
  drag.pointerMove(event(byId.a, 40, 204))
  drag.pointerUp(event(byId.a, 40, 204))
  assert.deepEqual(moves(log, 'tab').map((e) => e[2]), [{ top: 2 }])
  assert.deepEqual(moves(log, 'onto'), [])

  const second = setup(['a', 'b', 'c'])
  second.drag.pointerDown(second.event(second.byId.a, 20, 120), 'a')
  second.drag.pointerMove(second.event(second.byId.a, 40, 125))
  second.drag.pointerMove(second.event(second.byId.a, 40, 204))
  second.timers.at(-1)()
  assert.equal(second.byId.c.attrs['data-droptarget'], 'true')
  second.drag.pointerMove(second.event(second.byId.a, 40, 224)) // below c's middle band
  assert.equal(second.byId.c.attrs['data-droptarget'], undefined)
  second.drag.pointerUp(second.event(second.byId.a, 40, 224))
  assert.deepEqual(moves(second.log, 'tab').map((e) => e[2]), [{ top: 2 }])
  assert.deepEqual(moves(second.log, 'onto'), [])
  void timers
})

test('drifting while resting restarts the pause; a member of a group and a group drag never group', () => {
  const { drag, byId, event, timers } = setup(['a', 'b', 'c'])
  drag.pointerDown(event(byId.a, 20, 120), 'a')
  drag.pointerMove(event(byId.a, 40, 125))
  drag.pointerMove(event(byId.a, 40, 203))
  const first = timers.length
  drag.pointerMove(event(byId.a, 40, 206)) // a 3px drift: same pause
  assert.equal(timers.length, first)
  drag.pointerMove(event(byId.a, 120, 205)) // 80px sideways: the pause starts over
  assert.equal(timers.length, first + 1)
  timers.at(-1)()
  assert.equal(byId.c.attrs['data-droptarget'], 'true')

  const grouped = setup(['a', { g: 'G', m: ['m1', 'm2'] }])
  grouped.drag.pointerDown(grouped.event(grouped.byId.a, 20, 120), 'a')
  grouped.drag.pointerMove(grouped.event(grouped.byId.a, 40, 125))
  const before = grouped.timers.length
  grouped.drag.pointerMove(grouped.event(grouped.byId.a, 40, 142 + 16 + 20)) // over m1's middle: a member, not a loose row
  assert.equal(grouped.timers.length, before)

  const groupDrag = setup([{ g: 'G', m: ['m1'] }, 'x', 'y'])
  groupDrag.drag.pointerDown(groupDrag.event(groupDrag.byId.G, 20, 116), 'G', 'group')
  groupDrag.drag.pointerMove(groupDrag.event(groupDrag.byId.G, 40, 121))
  const beforeGroup = groupDrag.timers.length
  groupDrag.drag.pointerMove(groupDrag.event(groupDrag.byId.G, 40, 200))
  assert.equal(groupDrag.timers.length, beforeGroup)
})

test('a release past the last move drops where the button came up: a marked row is not grouped from outside it', () => {
  const { drag, byId, log, event, timers } = setup(['a', 'b', 'c'])
  drag.pointerDown(event(byId.a, 20, 120), 'a')
  drag.pointerMove(event(byId.a, 40, 125))
  drag.pointerMove(event(byId.a, 40, 204))
  timers.at(-1)()
  assert.equal(byId.c.attrs['data-droptarget'], 'true')
  drag.pointerUp(event(byId.a, 40, 245)) // no move event in between: the pointer is already below c
  assert.deepEqual(moves(log, 'onto'), [])
  assert.deepEqual(moves(log, 'tab').map((e) => e[2]), [{ top: 2 }])
})
