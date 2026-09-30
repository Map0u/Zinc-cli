import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
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

for (const encoding of ['utf-16le', 'utf-16be']) {
  for (const withBom of [false, true]) {
    test(`settings load ${encoding} ${withBom ? 'with' : 'without'} BOM`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'zinc-settings-'))
      const filePath = join(dir, 'settings.json')
      try {
        const body = Buffer.from(JSON.stringify({
          version: 1,
          KimiFullscreenWheelPaging: false,
          FontFamily: '中文 Mono',
          FontSize: 14
        }), 'utf16le')
        if (encoding === 'utf-16be') body.swap16()
        const bom = encoding === 'utf-16le' ? [0xff, 0xfe] : [0xfe, 0xff]
        const bytes = withBom ? Buffer.concat([Buffer.from(bom), body]) : body
        writeFileSync(filePath, bytes)

        const settings = new SettingsService(filePath).get()
        assert.equal(settings.KimiFullscreenWheelPaging, false)
        assert.equal(settings.FontFamily, '中文 Mono')
        assert.equal(settings.FontSize, 14)
        assert.deepEqual(readFileSync(filePath), bytes)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
}

test('a recent debounced edit is written by the quit-time flush', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-settings-'))
  const filePath = join(dir, 'settings.json')
  try {
    writeFileSync(filePath, JSON.stringify({ version: 1, FontSize: 14 }))
    const service = new SettingsService(filePath)
    service.updateDebounced({ FontSize: 20 })
    assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).FontSize, 14)

    service.flush() // index.ts already calls this in before-quit.
    assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).FontSize, 20)
    assert.equal(new SettingsService(filePath).get().FontSize, 20)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('malformed settings stay untouched even after immediate and quit-time writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-settings-'))
  const filePath = join(dir, 'settings.json')
  const originalWarn = console.warn
  const warnings = []
  try {
    const original = '{"SecretaryToken":"private-token",broken json'
    writeFileSync(filePath, original)
    console.warn = (...args) => warnings.push(args.join(' '))

    const service = new SettingsService(filePath)
    assert.equal(service.get().FontSize, 16)
    service.updateImmediate({ FontSize: 18 })
    service.updateDebounced({ FontSize: 20 })
    service.flush()
    assert.equal(readFileSync(filePath, 'utf8'), original)
    assert.match(warnings.join(' '), /without overwriting the file/)
    assert.doesNotMatch(warnings.join(' '), /private-token/)
  } finally {
    console.warn = originalWarn
    rmSync(dir, { recursive: true, force: true })
  }
})

test('invalid encodings and non-object JSON roots are never overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-settings-'))
  const originalWarn = console.warn
  try {
    console.warn = () => {}
    for (const [name, bytes] of [
      ['truncated', Buffer.from([0xff, 0xfe, 0x7b])],
      ['invalid-utf8', Buffer.concat([Buffer.from('{"FontFamily":"'), Buffer.from([0xff]), Buffer.from('"}')])],
      ['array', Buffer.from('[]')]
    ]) {
      const filePath = join(dir, `${name}.json`)
      writeFileSync(filePath, bytes)
      const service = new SettingsService(filePath)
      service.updateImmediate({ FontSize: 20 })
      assert.deepEqual(readFileSync(filePath), bytes)
    }
  } finally {
    console.warn = originalWarn
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed quit-time write logs a diagnostic without crashing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-settings-'))
  const blockedParent = join(dir, 'not-a-directory')
  const filePath = join(blockedParent, 'settings.json')
  const originalError = console.error
  const diagnostics = []
  try {
    writeFileSync(blockedParent, 'keep this file')
    console.error = (...args) => diagnostics.push(args)

    const service = new SettingsService(filePath)
    service.updateDebounced({ FontSize: 20 })
    assert.doesNotThrow(() => service.flush())
    assert.equal(diagnostics.length, 1)
    assert.match(diagnostics[0][0], /\[SettingsService\] failed to persist/)
    assert.equal(diagnostics[0][1].code, 'EEXIST')
    assert.equal(readFileSync(blockedParent, 'utf8'), 'keep this file')
  } finally {
    console.error = originalError
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
