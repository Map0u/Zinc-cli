import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-settings-bundle-'))
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

test('SettingsService strips legacy status-bar and AOD keys and never exposes them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-settings-'))
  const filePath = join(dir, 'settings.json')
  try {
    writeFileSync(
      filePath,
      JSON.stringify(
        {
          version: 1,
          ShowStatusBar: true,
          StatusBarEnabledTools: ['claude', 'codex'],
          StatusBarFields: [{ id: 'model', on: true }],
          StatusBarFontSize: 18,
          codexSessionRoots: ['\\\\wsl.localhost\\Ubuntu\\home\\user\\.codex'],
          AodEnabled: true,
          BurnInProtectionEnabled: true,
          ScreenBrightness: 80,
          FontSize: 14,
          ResumeAiConversations: false
        },
        null,
        2
      ),
      'utf8'
    )

    const service = new SettingsService(filePath)
    const settings = service.get()

    assert.equal(settings.FontSize, 14)
    assert.equal(settings.ResumeAiConversations, false)
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'ShowStatusBar'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'StatusBarFontSize'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'StatusBarFields'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'StatusBarEnabledTools'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'codexSessionRoots'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'AodEnabled'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'BurnInProtectionEnabled'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(settings, 'ScreenBrightness'), false)

    const onDisk = JSON.parse(readFileSync(filePath, 'utf8'))
    assert.equal(Object.prototype.hasOwnProperty.call(onDisk, 'ShowStatusBar'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(onDisk, 'codexSessionRoots'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(onDisk, 'AodEnabled'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(onDisk, 'BurnInProtectionEnabled'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(onDisk, 'ScreenBrightness'), false)
    assert.equal(onDisk.FontSize, 14)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('settingsTypes source no longer declares status-bar or AOD fields', () => {
  const source = readFileSync(join(root, 'src/shared/settingsTypes.ts'), 'utf8')
  assert.equal(source.includes('ShowStatusBar'), false)
  assert.equal(source.includes('StatusBarFields'), false)
  assert.equal(source.includes('StatusBarFontSize'), false)
  assert.equal(source.includes('codexSessionRoots'), false)
  assert.equal(source.includes('AodEnabled'), false)
  assert.equal(source.includes('BurnInProtectionEnabled'), false)
  assert.equal(source.includes('ScreenBrightness'), false)
  assert.match(source, /ResumeAiConversations/)
})
