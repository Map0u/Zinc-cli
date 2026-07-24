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
const {
  moveItem,
  tabDragShiftY,
  tabDropLineTop,
  ghostProbeY,
  resolveDropIndex,
  liveSlotCenters,
  TAB_ROW_STRIDE_PX,
  TAB_DROP_HYSTERESIS_PX
} = module.exports

/** Four rows centered at 100, 142, 184, 226 (42px stride). */
const CENTERS = [100, 142, 184, 226]

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

test('resolveDropIndex accepts insert when ghost sits between rows (down)', () => {
  // Dragging from index 0; ghost center halfway into the 0→1 gap (121).
  // Nearest is still 0 until past mid+hyst; one step past 0|1 mid+hyst must yield 1.
  const mid01 = (CENTERS[0] + CENTERS[1]) / 2 // 121
  const atBoundary = mid01 + TAB_DROP_HYSTERESIS_PX // 127
  assert.equal(
    resolveDropIndex({
      centers: CENTERS,
      fromIndex: 0,
      dropIndex: 0,
      probeY: atBoundary
    }),
    1
  )
  // Further down, nearest is 2; past 1|2 boundary → raw 2
  const mid12 = (CENTERS[1] + CENTERS[2]) / 2 + TAB_DROP_HYSTERESIS_PX
  assert.equal(
    resolveDropIndex({
      centers: CENTERS,
      fromIndex: 0,
      dropIndex: 1,
      probeY: mid12
    }),
    2
  )
})

test('resolveDropIndex accepts insert when ghost sits between rows (up)', () => {
  const mid23 = (CENTERS[2] + CENTERS[3]) / 2 // 205
  const atBoundary = mid23 - TAB_DROP_HYSTERESIS_PX // 199
  assert.equal(
    resolveDropIndex({
      centers: CENTERS,
      fromIndex: 3,
      dropIndex: 3,
      probeY: atBoundary
    }),
    2
  )
})

test('resolveDropIndex holds within hysteresis band (no chatter)', () => {
  // Just shy of the down boundary from 0: stay at 0
  const mid01 = (CENTERS[0] + CENTERS[1]) / 2
  assert.equal(
    resolveDropIndex({
      centers: CENTERS,
      fromIndex: 0,
      dropIndex: 0,
      probeY: mid01 + TAB_DROP_HYSTERESIS_PX - 0.5
    }),
    0
  )
})

test('tabDragShiftY opens a visual gap at dropIndex', () => {
  // from 0 → drop 2: indices 1 and 2 shift up
  assert.equal(tabDragShiftY(1, 0, 2), -TAB_ROW_STRIDE_PX)
  assert.equal(tabDragShiftY(2, 0, 2), -TAB_ROW_STRIDE_PX)
  assert.equal(tabDragShiftY(3, 0, 2), 0)
  // from 3 → drop 1: indices 1 and 2 shift down
  assert.equal(tabDragShiftY(1, 3, 1), TAB_ROW_STRIDE_PX)
  assert.equal(tabDragShiftY(2, 3, 1), TAB_ROW_STRIDE_PX)
  assert.equal(tabDragShiftY(0, 3, 1), 0)
})

test('tabDropLineTop marks the opened gap', () => {
  assert.equal(tabDropLineTop(0, 0, 4), null)
  assert.equal(tabDropLineTop(0, 2, 4), (2 + 1) * TAB_ROW_STRIDE_PX - 2)
  assert.equal(tabDropLineTop(3, 1, 4), 1 * TAB_ROW_STRIDE_PX)
})

test('liveSlotCenters compensates list scroll only', () => {
  const base = [100, 142]
  assert.equal(liveSlotCenters(base, 0, 0), base)
  assert.deepEqual(liveSlotCenters(base, 0, 20), [80, 122])
})
