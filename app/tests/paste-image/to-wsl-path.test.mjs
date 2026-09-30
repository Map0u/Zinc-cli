import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-paste-path-'))
const outfile = join(outDir, 'PasteImageService.mjs')
await build({
  entryPoints: [join(root, 'src/main/services/PasteImageService.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent'
})
const { toWslPath } = await import(pathToFileURL(outfile).href)
test.after(() => rmSync(outDir, { recursive: true, force: true }))

test('toWslPath converts drive-rooted paths and rejects paths without a safe mapping', () => {
  assert.equal(toWslPath('Y:\\Users\\Example\\PastedImages\\image.png'), '/mnt/y/Users/Example/PastedImages/image.png')
  assert.equal(toWslPath('z:/images/pasted.png'), '/mnt/z/images/pasted.png')
  assert.equal(toWslPath('E:\\'), '/mnt/e/')

  for (const path of [
    '\\\\server\\share\\image.png', // UNC
    '//server/share/image.png',
    '\\\\?\\C:\\images\\image.png', // extended drive path
    '\\\\?\\UNC\\server\\share\\image.png', // extended UNC path
    '\\\\.\\C:\\images\\image.png', // device path
    'C:images\\image.png', // drive-relative path
    'images\\image.png',
    '/mnt/x/images/image.png',
    ''
  ]) {
    assert.equal(toWslPath(path), null, path)
  }
})
