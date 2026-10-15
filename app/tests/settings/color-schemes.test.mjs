import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-color-schemes-'))
for (const [entry, name] of [
  ['src/main/services/SettingsService.ts', 'SettingsService.mjs'],
  ['src/renderer/src/colorSchemes.ts', 'colorSchemes.mjs']
]) {
  buildSync({ entryPoints: [join(root, entry)], bundle: true, format: 'esm', platform: 'node', outfile: join(outDir, name), logLevel: 'silent' })
}
const { SettingsService } = await import(pathToFileURL(join(outDir, 'SettingsService.mjs')).href)
const { COLOR_SCHEMES, getColorScheme } = await import(pathToFileURL(join(outDir, 'colorSchemes.mjs')).href)

test.after(() => rmSync(outDir, { recursive: true, force: true }))

function loadScheme(stored) {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-settings-'))
  try {
    const filePath = join(dir, 'settings.json')
    writeFileSync(filePath, JSON.stringify({ version: 1, ColorScheme: stored }), 'utf8')
    return new SettingsService(filePath).get().ColorScheme
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the selectable schemes are the five 0.8.2 palettes, and main accepts exactly those ids', () => {
  assert.deepEqual(COLOR_SCHEMES.map((s) => s.id), ['monochrome', 'abyss', 'sakura', 'matcha', 'amber'])
  for (const s of COLOR_SCHEMES) assert.equal(loadScheme(s.id), s.id)
})

test('a pre-0.8.2 scheme id moves to its nearest new scheme; an unknown id falls back to the default', () => {
  assert.equal(loadScheme('rosePine'), 'sakura')
  assert.equal(loadScheme('tokyoNight'), 'abyss')
  assert.equal(loadScheme('vesper'), 'amber')
  assert.equal(loadScheme('everforest'), 'matcha')
  assert.equal(loadScheme('campbell'), 'monochrome')
  assert.equal(loadScheme('grok'), 'monochrome')
  assert.equal(loadScheme('toString'), 'monochrome')
  assert.equal(loadScheme('nope'), 'monochrome')
})

test('Grok stays resolvable for the full-screen tint without being selectable', () => {
  assert.equal(getColorScheme('grok').id, 'grok')
  assert.ok(!COLOR_SCHEMES.some((s) => s.id === 'grok'))
})

// WCAG contrast of every text colour against its own scheme's surface.
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = ([r, g, b]) => 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255)
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
const TEXT = ['foreground', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan']

test('every text colour of every selectable scheme reads at 4.5:1 on its own surface, light and dark', () => {
  for (const s of COLOR_SCHEMES) {
    for (const mode of ['dark', 'light']) {
      const v = s[mode]
      for (const key of TEXT) {
        const r = ratio(rgb(v.ansi[key]), v.surfaceBase)
        assert.ok(r >= 4.5, `${s.id} ${mode} ${key} ${v.ansi[key]} is ${r.toFixed(2)}:1`)
      }
    }
  }
})

test('the terminal asks xterm for a 4.5:1 minimum contrast', () => {
  const src = readFileSync(join(root, 'src/renderer/src/terminal/TerminalHostRegistry.ts'), 'utf8')
  assert.match(src, /minimumContrastRatio: 4\.5/)
})
