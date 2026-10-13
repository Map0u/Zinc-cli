/**
 * Drives the shipped RailDrag (src/renderer/src/tabs/tabRailDrag.ts) against
 * hand-rolled DOM fakes: a drag must paint through direct style writes only,
 * clear them before the order commits, and clean up when interrupted.
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

function fakeEl(attrs = {}) {
  const el = {
    attrs: { ...attrs },
    dataset: {},
    style: {},
    removeAttribute(name) {
      delete el.attrs[name]
      if (name.startsWith('data-')) delete el.dataset[name.slice(5)]
    },
    setAttribute(name, value) { el.attrs[name] = value },
    getBoundingClientRect: () => ({ left: 10, top: el.top ?? 0, width: 230, height: 40, bottom: (el.top ?? 0) + 40 }),
    setPointerCapture() {},
    releasePointerCapture() {},
    querySelectorAll: () => [],
    remove() { el.removed = true },
    cloneNode() { const c = fakeEl(); c.isGhost = true; return c }
  }
  return el
}

function setup(ids = ['a', 'b', 'c']) {
  const rows = ids.map((id, i) => Object.assign(fakeEl({ 'data-tabid': id }), { top: 100 + i * 42 }))
  const list = Object.assign(fakeEl(), {
    scrollTop: 0,
    querySelectorAll: () => rows,
    querySelector: (sel) => rows.find((r) => sel.includes(`"${r.attrs['data-tabid']}"`)) ?? null,
    getBoundingClientRect: () => ({ top: 80, bottom: 400 })
  })
  const dropLine = fakeEl()
  const log = []
  const host = {
    list: () => list,
    dropLine: () => dropLine,
    ids: () => ids,
    activeId: () => 'a',
    isRenaming: () => false,
    select: (id) => log.push(['select', id]),
    move: (from, to) => {
      // Order commits only after every sibling's inline shift and the list's drag state are gone.
      log.push(['move', from, to, rows.map((r) => r.style.transform ?? ''), list.dataset.dragging])
    }
  }
  const frames = []
  const timers = []
  globalThis.window = {
    matchMedia: () => ({ matches: true }),
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length },
    cancelAnimationFrame() {},
    setTimeout: (fn) => { timers.push(fn); return timers.length }
  }
  globalThis.requestAnimationFrame = window.requestAnimationFrame
  globalThis.getComputedStyle = () => ({ backgroundColor: '#111' })
  globalThis.CSS = { escape: (id) => id }
  const bodyChildren = []
  globalThis.document = { body: { style: {}, appendChild: (el) => bodyChildren.push(el) } }
  const drag = new RailDrag(host)
  const event = (row, clientX, clientY) => ({
    pointerId: 3, button: 0, clientX, clientY, currentTarget: row,
    target: { closest: () => null }, preventDefault() {}
  })
  return { drag, rows, list, dropLine, log, event, bodyChildren, timers }
}

test('a drag paints siblings and the drop line by direct style writes and clears them before the move', () => {
  const { drag, rows, list, dropLine, log, event, bodyChildren } = setup()
  drag.pointerDown(event(rows[0], 20, 120), 'a')
  drag.pointerMove(event(rows[0], 40, 125))
  assert.equal(bodyChildren.length, 1)
  assert.equal(list.dataset.dragging, 'true')
  assert.equal(rows[0].style.opacity, '0')
  assert.equal(rows[0].dataset.dragging, 'true')
  assert.equal(drag.busy, true)
  assert.equal(drag.suppressClick, false)
  assert.deepEqual(rows.slice(1).map((r) => r.style.transform), ['translate3d(0, 0, 0)', 'translate3d(0, 0, 0)'])
  // Drag the ghost past row c's centre: b and c slide up, the line lands below c.
  drag.pointerMove(event(rows[0], 40, 200))
  assert.equal(rows[1].style.transform, 'translate3d(0, -42px, 0)')
  assert.equal(rows[2].style.transform, 'translate3d(0, -42px, 0)')
  assert.equal(dropLine.dataset.active, 'true')
  assert.equal(dropLine.style.top, '124px')
  drag.pointerUp(event(rows[0], 40, 200))
  assert.deepEqual(log.filter((e) => e[0] === 'move'), [['move', 0, 2, ['', '', ''], undefined]])
  assert.equal(dropLine.dataset.active, undefined)
  assert.equal(drag.suppressClick, true)
  assert.equal(drag.busy, false)
  assert.equal(rows[0].style.opacity, '')
  assert.equal(bodyChildren[0].removed, true)
})

test('moving back onto the origin slot commits nothing', () => {
  const { drag, rows, log, event } = setup()
  drag.pointerDown(event(rows[1], 20, 160), 'b')
  drag.pointerMove(event(rows[1], 40, 165))
  drag.pointerUp(event(rows[1], 40, 165))
  assert.deepEqual(log.filter((e) => e[0] === 'move'), [])
  assert.equal(drag.busy, false)
})

test('a press that never moves is a click, not a drag', () => {
  const { drag, rows, list, log, event, bodyChildren } = setup()
  drag.pointerDown(event(rows[0], 20, 120), 'a')
  drag.pointerMove(event(rows[0], 21, 121))
  drag.pointerUp(event(rows[0], 21, 121))
  assert.equal(bodyChildren.length, 0)
  assert.equal(list.dataset.dragging, undefined)
  assert.equal(drag.suppressClick, false)
  assert.deepEqual(log, [])
})

test('dragging a background row selects it once', () => {
  const { drag, rows, log, event } = setup()
  drag.pointerDown(event(rows[2], 20, 190), 'c')
  drag.pointerMove(event(rows[2], 40, 195))
  drag.pointerMove(event(rows[2], 40, 150))
  assert.deepEqual(log.filter((e) => e[0] === 'select'), [['select', 'c']])
})

test('cancel (blur or lost pointer capture) removes the ghost and every drag style without reordering', () => {
  for (const interruption of ['cancel', 'lostpointercapture']) {
    const { drag, rows, list, dropLine, log, event, bodyChildren } = setup()
    drag.pointerDown(event(rows[0], 20, 120), 'a')
    drag.pointerMove(event(rows[0], 40, 125))
    drag.pointerMove(event(rows[0], 40, 200))
    assert.equal(dropLine.dataset.active, 'true')
    if (interruption === 'cancel') drag.cancel()
    else drag.lostPointerCapture(event(rows[0], 40, 200))
    assert.equal(bodyChildren.at(-1).removed, true)
    assert.equal(rows[0].style.opacity, '')
    assert.equal(rows[0].style.pointerEvents, '')
    assert.deepEqual(rows.map((r) => r.style.transform), ['', '', ''])
    assert.equal(list.dataset.dragging, undefined)
    assert.equal(dropLine.dataset.active, undefined)
    assert.equal(document.body.style.cursor, '')
    assert.equal(document.body.style.userSelect, '')
    assert.deepEqual(log.filter((e) => e[0] === 'move'), [])
    assert.equal(drag.busy, false)
  }
})

test('a renaming row is not draggable', () => {
  const { drag, rows, event } = setup()
  const renaming = new RailDrag({
    list: () => null, dropLine: () => null, ids: () => ['a'], activeId: () => 'a',
    isRenaming: () => true, select() {}, move() {}
  })
  renaming.pointerDown(event(rows[0], 20, 120), 'a')
  assert.equal(renaming.busy, false)
  assert.equal(drag.busy, false)
})
