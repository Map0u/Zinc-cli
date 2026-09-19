import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-grok-surface-'))
const outFile = join(outDir, 'grokFullscreenSurface.mjs')

buildSync({
  entryPoints: [join(root, 'src/renderer/src/terminal/grokFullscreenSurface.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: outFile,
  logLevel: 'silent'
})

const { shouldTintSurfaceForGrok, surfaceBaseFor } = await import(pathToFileURL(outFile).href)

process.on('exit', () => rmSync(outDir, { recursive: true, force: true }))

/** Every condition satisfied; individual tests turn one off at a time. */
const ACTIVE = {
  enabled: true,
  hostReady: true,
  bufferType: 'alternate',
  tool: 'grok',
  terminalOpacity: 1
}

test('tints when the setting is on and Grok owns the alternate buffer', () => {
  assert.equal(shouldTintSurfaceForGrok(ACTIVE), true)
})

test('does not tint while the setting is off', () => {
  assert.equal(shouldTintSurfaceForGrok({ ...ACTIVE, enabled: false }), false)
})

test('does not tint before the host is ready', () => {
  assert.equal(shouldTintSurfaceForGrok({ ...ACTIVE, hostReady: false }), false)
})

test('does not tint in the normal buffer', () => {
  assert.equal(shouldTintSurfaceForGrok({ ...ACTIVE, bufferType: 'normal' }), false)
})

test('does not tint for other tools, including none detected yet', () => {
  for (const tool of ['kimi', 'claude', 'codex', null]) {
    assert.equal(shouldTintSurfaceForGrok({ ...ACTIVE, tool }), false, `tool=${tool}`)
  }
})

test('is a no-op while the card is see-through', () => {
  // At TerminalOpacity 0 Grok's own background is already rewritten to the
  // transparent default, so canvas and frame match without any tint.
  assert.equal(shouldTintSurfaceForGrok({ ...ACTIVE, terminalOpacity: 0 }), false)
})

test('a partly transparent card still tints', () => {
  assert.equal(shouldTintSurfaceForGrok({ ...ACTIVE, terminalOpacity: 0.5 }), true)
})

test('surfaceBaseFor returns the scheme base when untinted and Grok when tinted', () => {
  // Rosé Pine dark / Grok dark, from colorSchemes.ts.
  assert.deepEqual([...surfaceBaseFor(false, 'rosePine', 'dark')], [30, 26, 36])
  assert.deepEqual([...surfaceBaseFor(true, 'rosePine', 'dark')], [20, 20, 20])
})

test('surfaceBaseFor follows the app light/dark mode when tinted', () => {
  assert.deepEqual([...surfaceBaseFor(true, 'rosePine', 'light')], [238, 238, 238])
})

test('surfaceBaseFor falls back to the default scheme for an unknown id', () => {
  assert.deepEqual(
    [...surfaceBaseFor(false, 'not-a-scheme', 'dark')],
    [...surfaceBaseFor(false, undefined, 'dark')]
  )
})
