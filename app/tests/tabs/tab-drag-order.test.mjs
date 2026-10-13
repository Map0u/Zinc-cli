/**
 * Drives the shipped tab-rail reorder helpers in
 * `src/renderer/src/tabs/tabDragOrder.ts` (no reimplementation).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { transformSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const sourcePath = join(root, 'src/renderer/src/tabs/tabDragOrder.ts')

const { code } = transformSync(readFileSync(sourcePath, 'utf8'), {
  loader: 'ts',
  format: 'cjs',
  target: 'node22'
})

const require = createRequire(import.meta.url)
const module = { exports: {} }
// eslint-disable-next-line no-new-func
new Function('exports', 'require', 'module', code)(module.exports, require, module)
const { moveItem, tabDragDistance, ghostProbeY, TAB_DRAG_THRESHOLD_PX } = module.exports

test('moveItem reorders and rejects out-of-range', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd'])
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b'])
  const same = ['a', 'b']
  assert.equal(moveItem(same, 0, 0), same)
  assert.equal(moveItem(same, -1, 1), same)
  assert.equal(moveItem(same, 0, 9), same)
})

test('ghostProbeY uses card center, not pointer tip', () => {
  // Grab near top of a 40px row: pointer at 120, offset 4 → center at 120 - 4 + 20 = 136
  assert.equal(ghostProbeY(120, 4, 40), 136)
  // Mid-row grab: pointer equals center
  assert.equal(ghostProbeY(150, 20, 40), 150)
})

test('the drag threshold is 3px in any direction', () => {
  assert.equal(TAB_DRAG_THRESHOLD_PX, 3)
  assert.equal(tabDragDistance(3, 4), 5)
  assert.ok(tabDragDistance(2, 2) < TAB_DRAG_THRESHOLD_PX)
})
