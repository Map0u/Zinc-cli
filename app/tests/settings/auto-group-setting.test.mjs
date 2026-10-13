import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-settings-autogroup-'))
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

test('AutoGroupTabs defaults on when the field is absent from settings.json (every file written before it)', () => {
  withSettingsFile({ version: 1, FontSize: 14 }, (filePath) => {
    assert.equal(new SettingsService(filePath).get().AutoGroupTabs, true)
  })
})

test('AutoGroupTabs keeps a stored false, ignores a non-boolean, and round-trips through updateImmediate', () => {
  withSettingsFile({ version: 1, AutoGroupTabs: false }, (filePath) => {
    const service = new SettingsService(filePath)
    assert.equal(service.get().AutoGroupTabs, false)
    assert.equal(service.updateImmediate({ AutoGroupTabs: true }).AutoGroupTabs, true)
    assert.equal(new SettingsService(filePath).get().AutoGroupTabs, true)
  })
  withSettingsFile({ version: 1, AutoGroupTabs: 'no' }, (filePath) => {
    assert.equal(new SettingsService(filePath).get().AutoGroupTabs, true)
  })
})

test('the settings page and both locales carry the toggle', () => {
  const page = readFileSync(join(root, 'src/renderer/src/settings/SettingsPage.tsx'), 'utf8')
  assert.match(page, /settings\.AutoGroupTabs/)
  assert.match(page, /updateImmediate\(\{ AutoGroupTabs: v \}\)/)
  for (const locale of ['en-US', 'zh-CN']) {
    const strings = JSON.parse(readFileSync(join(root, `src/renderer/src/i18n/locales/${locale}.json`), 'utf8'))
    for (const key of ['CardAutoGroupTitle', 'CardAutoGroupDesc', 'GroupAutomatically']) {
      assert.equal(typeof strings[key], 'string', `${locale} ${key}`)
      assert.ok(strings[key].length > 0)
    }
  }
})
