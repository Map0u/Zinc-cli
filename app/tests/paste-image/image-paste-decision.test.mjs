import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outFile = join(mkdtempSync(join(tmpdir(), 'zinc-image-paste-')), 'imagePaste.mjs')
buildSync({
  entryPoints: [join(root, 'src/shared/imagePaste.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: outFile,
  logLevel: 'silent'
})
const { decideImagePaste, IMAGE_PASTE_KEY } = await import(pathToFileURL(outFile).href)

const image = { hasText: false, hasImage: true }

test('the image-paste key is ESC v', () => {
  assert.equal(IMAGE_PASTE_KEY, '\x1bv')
})

test('text on the clipboard always wins over an image', () => {
  for (const mode of ['cli', 'file']) {
    assert.equal(decideImagePaste({ hasText: true, hasImage: true, mode, tool: 'claude', runtime: 'native' }), 'passthrough')
  }
})

test('no image is left to xterm', () => {
  assert.equal(decideImagePaste({ hasText: false, hasImage: false, mode: 'cli', tool: 'claude', runtime: 'native' }), 'passthrough')
})

test('cli mode sends the key to a native AI CLI', () => {
  for (const tool of ['claude', 'codex', 'kimi', 'grok']) {
    assert.equal(decideImagePaste({ ...image, mode: 'cli', tool, runtime: 'native' }), 'send-key')
  }
})

test('cli mode falls back to a bracketed path for WSL or an unknown runtime', () => {
  assert.equal(decideImagePaste({ ...image, mode: 'cli', tool: 'claude', runtime: 'wsl' }), 'file-bracketed')
  assert.equal(decideImagePaste({ ...image, mode: 'cli', tool: 'codex', runtime: null }), 'file-bracketed')
})

test('a plain shell or a failed lookup gets the bare path', () => {
  assert.equal(decideImagePaste({ ...image, mode: 'cli', tool: null, runtime: null }), 'file-bare')
  assert.equal(decideImagePaste({ ...image, mode: 'file', tool: null, runtime: 'native' }), 'file-bare')
})

test('file mode never sends the key; an AI CLI still gets a bracketed path', () => {
  assert.equal(decideImagePaste({ ...image, mode: 'file', tool: 'claude', runtime: 'native' }), 'file-bracketed')
  assert.equal(decideImagePaste({ ...image, mode: 'file', tool: 'kimi', runtime: 'wsl' }), 'file-bracketed')
})
