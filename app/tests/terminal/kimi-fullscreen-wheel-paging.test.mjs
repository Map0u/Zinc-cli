import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-kimi-wheel-'))
const outFile = join(outDir, 'kimiFullscreenWheelPaging.mjs')

buildSync({
  entryPoints: [join(root, 'src/renderer/src/terminal/kimiFullscreenWheelPaging.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: outFile,
  logLevel: 'silent'
})

const {
  PAGE_UP,
  PAGE_DOWN,
  PIXEL_NOTCH,
  createWheelPagerState,
  decideKimiFullscreenWheel,
  shouldInterceptKimiFullscreenWheel
} = await import(pathToFileURL(outFile).href)

test.after(() => {
  rmSync(outDir, { recursive: true, force: true })
})

function decide(overrides, state, deltaY, deltaMode = 0) {
  return decideKimiFullscreenWheel(
    {
      enabled: true,
      hostReady: true,
      bufferType: 'alternate',
      ...overrides
    },
    state,
    deltaY,
    deltaMode
  )
}

test('intercepts alternate-buffer wheel without mouse tracking', () => {
  assert.equal(
    shouldInterceptKimiFullscreenWheel({
      enabled: true,
      hostReady: true,
      bufferType: 'alternate'
    }),
    true
  )
})

test('does not intercept primary buffer, idle host, or a disabled setting', () => {
  assert.equal(
    shouldInterceptKimiFullscreenWheel({ enabled: true, hostReady: true, bufferType: 'normal' }),
    false
  )
  assert.equal(
    shouldInterceptKimiFullscreenWheel({ enabled: true, hostReady: false, bufferType: 'alternate' }),
    false
  )
  assert.equal(
    shouldInterceptKimiFullscreenWheel({ enabled: false, hostReady: true, bufferType: 'alternate' }),
    false
  )
})

test('setting off never consumes and clears leftover accumulation', () => {
  const state = createWheelPagerState()
  state.acc = 90
  const decision = decide({ enabled: false }, state, -PIXEL_NOTCH)
  assert.equal(decision.consume, false)
  assert.equal(decision.sequence, null)
  assert.equal(state.acc, 0)
})

test('a Windows notch pages once and consumes', () => {
  const state = createWheelPagerState()
  const up = decide({}, state, -PIXEL_NOTCH)
  assert.deepEqual(up, { consume: true, sequence: PAGE_UP })
  const down = decide({}, state, PIXEL_NOTCH)
  assert.deepEqual(down, { consume: true, sequence: PAGE_DOWN })
})

test('sub-notch movement is consumed but does not page until a notch accumulates', () => {
  const state = createWheelPagerState()
  const first = decide({}, state, -40)
  assert.deepEqual(first, { consume: true, sequence: null })
  const second = decide({}, state, -40)
  assert.deepEqual(second, { consume: true, sequence: null })
  const third = decide({}, state, -40)
  assert.deepEqual(third, { consume: true, sequence: PAGE_UP })
})

test('deltaY 0 never pages', () => {
  const state = createWheelPagerState()
  const decision = decide({}, state, 0)
  assert.deepEqual(decision, { consume: true, sequence: null })
  assert.equal(state.acc, 0)
})

test('a 1200-pixel burst still emits only one page', () => {
  const state = createWheelPagerState()
  const decision = decide({}, state, -1200)
  assert.deepEqual(decision, { consume: true, sequence: PAGE_UP })
})

test('direction change discards leftover accumulation', () => {
  const state = createWheelPagerState()
  decide({}, state, -80)
  const decision = decide({}, state, 80)
  assert.deepEqual(decision, { consume: true, sequence: null })
})

test('line-mode wheel takes three lines to page (Windows default)', () => {
  const state = createWheelPagerState()
  assert.equal(decide({}, state, -1, 1).sequence, null)
  assert.equal(decide({}, state, -1, 1).sequence, null)
  assert.equal(decide({}, state, -1, 1).sequence, PAGE_UP)
})

test('page-mode wheel pages immediately', () => {
  const state = createWheelPagerState()
  assert.equal(decide({}, state, -1, 2).sequence, PAGE_UP)
})

test('the same gesture cannot emit both a page and a non-consume', () => {
  const state = createWheelPagerState()
  const ticks = [-40, -40, -40, -120, 0, -15]
  const ledger = ticks.map((deltaY) => decide({}, state, deltaY))
  assert.ok(ledger.every((row) => row.consume === true))
  assert.equal(ledger.filter((row) => row.sequence === PAGE_UP).length, 2)
  assert.equal(ledger.some((row) => row.sequence === PAGE_DOWN), false)
})
