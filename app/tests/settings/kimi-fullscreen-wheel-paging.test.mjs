import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-settings-wheel-'))
const outFile = join(outDir, 'SettingsService.mjs')

// Bundle the shipped SettingsService so the test exercises real load/normalize.
buildSync({
  entryPoints: [join(root, 'src/main/services/SettingsService.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: outFile,
  logLevel: 'silent'
})

const { SettingsService } = await import(pathToFileURL(outFile).href)

test.after(() => {
  rmSync(outDir, { recursive: true, force: true })
})

test('KimiFullscreenWheelPaging defaults to true when the field is absent from settings.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-settings-'))
  const filePath = join(dir, 'settings.json')
  try {
    writeFileSync(
      filePath,
      JSON.stringify({ version: 1, FontSize: 14 }, null, 2),
      'utf8'
    )

    const settings = new SettingsService(filePath).get()
    assert.equal(settings.KimiFullscreenWheelPaging, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('KimiFullscreenWheelPaging preserves a stored false and round-trips through updateImmediate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-settings-'))
  const filePath = join(dir, 'settings.json')
  try {
    writeFileSync(
      filePath,
      JSON.stringify({ version: 1, KimiFullscreenWheelPaging: false }, null, 2),
      'utf8'
    )

    const service = new SettingsService(filePath)
    assert.equal(service.get().KimiFullscreenWheelPaging, false)

    const updated = service.updateImmediate({ KimiFullscreenWheelPaging: true })
    assert.equal(updated.KimiFullscreenWheelPaging, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('KimiFullscreenWheelPaging preserves a stored false when settings.json starts with a UTF-8 BOM', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-settings-'))
  const filePath = join(dir, 'settings.json')
  try {
    // Node's utf8 encoder would strip a leading \uFEFF string; write the three
    // BOM bytes ourselves so this hits the same on-disk shape Windows produces.
    const body = JSON.stringify({
      version: 1,
      KimiFullscreenWheelPaging: false,
      FontSize: 14
    })
    writeFileSync(filePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body, 'utf8')]))

    const settings = new SettingsService(filePath).get()
    assert.equal(settings.KimiFullscreenWheelPaging, false)
    assert.equal(settings.FontSize, 14)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('KimiFullscreenWheelPaging falls back to true for a non-boolean value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-settings-'))
  const filePath = join(dir, 'settings.json')
  try {
    writeFileSync(
      filePath,
      JSON.stringify({ version: 1, KimiFullscreenWheelPaging: 'yes' }, null, 2),
      'utf8'
    )

    const settings = new SettingsService(filePath).get()
    assert.equal(settings.KimiFullscreenWheelPaging, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
