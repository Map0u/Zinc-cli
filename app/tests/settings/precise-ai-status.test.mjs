import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-settings-precise-'))
const outFile = join(outDir, 'SettingsService.mjs')

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

function withSettingsFile(contents, body) {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-settings-'))
  const filePath = join(dir, 'settings.json')
  try {
    writeFileSync(filePath, JSON.stringify(contents, null, 2), 'utf8')
    body(filePath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('PreciseAiStatus defaults on when the field is absent from settings.json', () => {
  withSettingsFile({ version: 1, FontSize: 14 }, (filePath) => {
    assert.equal(new SettingsService(filePath).get().PreciseAiStatus, true)
  })
})

test('PreciseAiStatus keeps a stored false, ignores a non-boolean, and round-trips through updateImmediate', () => {
  withSettingsFile({ version: 1, PreciseAiStatus: false }, (filePath) => {
    const service = new SettingsService(filePath)
    assert.equal(service.get().PreciseAiStatus, false)
    assert.equal(service.updateImmediate({ PreciseAiStatus: true }).PreciseAiStatus, true)
  })
  withSettingsFile({ version: 1, PreciseAiStatus: 'yes' }, (filePath) => {
    assert.equal(new SettingsService(filePath).get().PreciseAiStatus, true)
  })
})
