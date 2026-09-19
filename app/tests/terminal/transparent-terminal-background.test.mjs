import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-transparent-bg-'))
const outFile = join(outDir, 'transparentTerminalBackground.mjs')

buildSync({
  entryPoints: [join(root, 'src/renderer/src/terminal/transparentTerminalBackground.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: outFile,
  logLevel: 'silent'
})

const {
  rewriteSgrParamsForTransparentBg,
  formatSgrParams,
  isNearBlackRgb,
  isNearBlackIndexed,
  shouldTransparentizeTerminalBackgrounds,
  terminalThemeBackground
} = await import(pathToFileURL(outFile).href)

test.after(() => {
  rmSync(outDir, { recursive: true, force: true })
})

test('only TerminalOpacity 0 enables transparent TUI backgrounds', () => {
  assert.equal(shouldTransparentizeTerminalBackgrounds(0), true)
  assert.equal(shouldTransparentizeTerminalBackgrounds(-0.1), true)
  assert.equal(shouldTransparentizeTerminalBackgrounds(0.01), false)
  assert.equal(shouldTransparentizeTerminalBackgrounds(1), false)
})

test('near-black helpers cover pure black and the dark greyscale ramp', () => {
  assert.equal(isNearBlackRgb(0, 0, 0), true)
  assert.equal(isNearBlackRgb(20, 10, 5), true)
  assert.equal(isNearBlackRgb(50, 0, 0), false)
  assert.equal(isNearBlackIndexed(0), true)
  assert.equal(isNearBlackIndexed(16), true)
  assert.equal(isNearBlackIndexed(232), true)
  assert.equal(isNearBlackIndexed(1), false)
})

test('SGR 40 (black background) becomes default background 49', () => {
  assert.deepEqual(rewriteSgrParamsForTransparentBg([40]), [49])
  assert.deepEqual(rewriteSgrParamsForTransparentBg([1, 40, 37]), [1, 49, 37])
})

test('SGR 48;5;0 / 48;5;16 become default background; other indices keep', () => {
  assert.deepEqual(rewriteSgrParamsForTransparentBg([48, 5, 0]), [49])
  assert.deepEqual(rewriteSgrParamsForTransparentBg([48, 5, 16]), [49])
  assert.equal(rewriteSgrParamsForTransparentBg([48, 5, 1]), null)
})

test('SGR 48;2 near-black truecolor becomes default; bright truecolor keeps', () => {
  assert.deepEqual(rewriteSgrParamsForTransparentBg([48, 2, 0, 0, 0]), [49])
  assert.deepEqual(rewriteSgrParamsForTransparentBg([48, 2, 12, 12, 18]), [49])
  assert.equal(rewriteSgrParamsForTransparentBg([48, 2, 80, 80, 80]), null)
})

test('colon-style subparams are rewritten the same way', () => {
  assert.deepEqual(rewriteSgrParamsForTransparentBg([48, [2, 0, 0, 0]]), [49])
  assert.deepEqual(rewriteSgrParamsForTransparentBg([48, [5, 0]]), [49])
  // Non-black indexed bg: unchanged → null (caller leaves the original CSI alone).
  assert.equal(rewriteSgrParamsForTransparentBg([48, [5, 42]]), null)
})

test('foreground colors and non-bg attributes are never rewritten', () => {
  assert.equal(rewriteSgrParamsForTransparentBg([30]), null)
  assert.equal(rewriteSgrParamsForTransparentBg([1, 37]), null)
  assert.equal(rewriteSgrParamsForTransparentBg([38, 2, 0, 0, 0]), null)
  assert.equal(rewriteSgrParamsForTransparentBg([0]), null)
})

test('formatSgrParams flattens to semicolon form for re-injection', () => {
  assert.equal(formatSgrParams([1, 49, 37]), '1;49;37')
  assert.equal(formatSgrParams([48, [2, 80, 80, 80]]), '48;2;80;80;80')
  assert.equal(formatSgrParams([49]), '49')
})

// Regression: an opaque terminal card must never hand xterm a transparent
// theme background. xterm turns it into the color of inverse (SGR 7) text via
// opaque(background) — which composites onto black — so inverse runs render
// pure-black glyphs on a theme.foreground cell: the invisible "solid bar".
test('opaque card gets the scheme surface color, not a transparent background', () => {
  // Vesper light surfaceBase — the scheme the bug was reported on.
  assert.equal(terminalThemeBackground(1, [250, 246, 236]), 'rgb(250, 246, 236)')
  assert.equal(terminalThemeBackground(0.5, [250, 246, 236]), 'rgb(250, 246, 236)')
  assert.equal(terminalThemeBackground(0.01, [12, 11, 10]), 'rgb(12, 11, 10)')
})

test('a fully see-through card keeps the transparent background', () => {
  assert.equal(terminalThemeBackground(0, [250, 246, 236]), 'rgba(0, 0, 0, 0)')
  assert.equal(terminalThemeBackground(-1, [250, 246, 236]), 'rgba(0, 0, 0, 0)')
})

test('surface channels are rounded and clamped into a valid rgb()', () => {
  assert.equal(terminalThemeBackground(1, [249.6, 245.4, 236]), 'rgb(250, 245, 236)')
  assert.equal(terminalThemeBackground(1, [-5, 300, Number.NaN]), 'rgb(0, 255, 0)')
})
