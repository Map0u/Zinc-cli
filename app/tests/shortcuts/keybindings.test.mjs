import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-keybindings-'))
const outFile = join(outDir, 'shared.mjs')

// Bundle the shipped shared modules so the test drives real product code,
// not a reimplemented accelerator table.
buildSync({
  stdin: {
    contents: `
export {
  DEFAULT_KEYBINDINGS,
  SHORTCUT_ACTIONS,
  TERMINAL_RESERVED_ACCELERATORS,
  MAIN_FALLBACK_ACCELERATORS
} from ${JSON.stringify(join(root, 'src/shared/keybindings.ts').replace(/\\/g, '/'))}
export {
  isUnsafeAccelerator,
  acceleratorFromCodeAndModifiers
} from ${JSON.stringify(join(root, 'src/shared/shortcutAccelerator.ts').replace(/\\/g, '/'))}
`,
    resolveDir: root,
    sourcefile: 'keybindings-test-entry.ts',
    loader: 'ts'
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: outFile,
  logLevel: 'silent'
})

const {
  DEFAULT_KEYBINDINGS,
  SHORTCUT_ACTIONS,
  TERMINAL_RESERVED_ACCELERATORS,
  MAIN_FALLBACK_ACCELERATORS,
  isUnsafeAccelerator,
  acceleratorFromCodeAndModifiers
} = await import(pathToFileURL(outFile).href)

/** Daily-use actions that must keep stable default accelerators. */
const DAILY_DEFAULTS = {
  newTab: 'Ctrl+Shift+T',
  closeTab: 'Ctrl+Shift+W',
  nextTab: 'Ctrl+Tab',
  prevTab: 'Ctrl+Shift+Tab',
  openSettings: 'Ctrl+,',
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  resetZoom: 'Ctrl+0'
}

test.after(() => {
  rmSync(outDir, { recursive: true, force: true })
})

test('DEFAULT_KEYBINDINGS covers every ShortcutAction exactly once', () => {
  const actions = [...SHORTCUT_ACTIONS]
  assert.deepEqual(Object.keys(DEFAULT_KEYBINDINGS).sort(), [...actions].sort())
  for (const action of actions) {
    assert.equal(typeof DEFAULT_KEYBINDINGS[action], 'string')
    assert.notEqual(DEFAULT_KEYBINDINGS[action], '')
  }
})

test('daily-use default accelerators match the shipped map', () => {
  for (const [action, accelerator] of Object.entries(DAILY_DEFAULTS)) {
    assert.equal(DEFAULT_KEYBINDINGS[action], accelerator, `${action} default accelerator`)
  }
})

test('default accelerators are unique and not terminal-reserved or unsafe', () => {
  const seen = new Map()
  for (const action of SHORTCUT_ACTIONS) {
    const accelerator = DEFAULT_KEYBINDINGS[action]
    assert.equal(seen.has(accelerator), false, `duplicate default ${accelerator}`)
    seen.set(accelerator, action)
    assert.equal(
      TERMINAL_RESERVED_ACCELERATORS.has(accelerator),
      false,
      `${accelerator} must not be terminal-reserved`
    )
    assert.equal(isUnsafeAccelerator(accelerator), false, `${accelerator} must be bindable`)
  }
})

test('isUnsafeAccelerator enforces the shipped reservation table', () => {
  assert.equal(isUnsafeAccelerator('Ctrl+C'), true)
  assert.equal(isUnsafeAccelerator('Ctrl+Shift+C'), true)
  assert.equal(isUnsafeAccelerator('Ctrl+Shift+V'), true)
  assert.equal(isUnsafeAccelerator('Ctrl+W'), true)
  assert.equal(isUnsafeAccelerator('Alt+F4'), true)
  assert.equal(isUnsafeAccelerator('Meta+X'), true)
  assert.equal(isUnsafeAccelerator('A'), true)
  assert.equal(isUnsafeAccelerator('Shift+A'), true)
  assert.equal(isUnsafeAccelerator('Ctrl+Shift+T'), false)
  assert.equal(isUnsafeAccelerator('Ctrl+Tab'), false)
  assert.equal(isUnsafeAccelerator('Ctrl+,'), false)
})

test('acceleratorFromCodeAndModifiers builds daily-use accelerators from physical codes', () => {
  const mods = { ctrl: true, shift: false, alt: false, meta: false }
  const shiftMods = { ctrl: true, shift: true, alt: false, meta: false }

  assert.equal(acceleratorFromCodeAndModifiers('KeyT', shiftMods), 'Ctrl+Shift+T')
  assert.equal(acceleratorFromCodeAndModifiers('KeyW', shiftMods), 'Ctrl+Shift+W')
  assert.equal(acceleratorFromCodeAndModifiers('Tab', mods), 'Ctrl+Tab')
  assert.equal(acceleratorFromCodeAndModifiers('Tab', shiftMods), 'Ctrl+Shift+Tab')
  assert.equal(acceleratorFromCodeAndModifiers('Comma', mods), 'Ctrl+,')
  assert.equal(acceleratorFromCodeAndModifiers('Equal', mods), 'Ctrl+=')
  assert.equal(acceleratorFromCodeAndModifiers('Minus', mods), 'Ctrl+-')
  assert.equal(acceleratorFromCodeAndModifiers('Digit0', mods), 'Ctrl+0')
})

test('MAIN_FALLBACK_ACCELERATORS includes Chromium-swallowed tab switches', () => {
  assert.equal(MAIN_FALLBACK_ACCELERATORS.has('Ctrl+Tab'), true)
  assert.equal(MAIN_FALLBACK_ACCELERATORS.has('Ctrl+Shift+Tab'), true)
})
