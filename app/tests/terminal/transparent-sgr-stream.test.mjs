import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-sgr-stream-'))
const outFile = join(outDir, 'transparentSgrStream.mjs')

buildSync({
  entryPoints: [join(root, 'src/renderer/src/terminal/transparentSgrStream.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: outFile,
  logLevel: 'silent'
})

const { TransparentSgrStream, parseSgrParams, formatSgrParamsPreservingSubparams } = await import(
  pathToFileURL(outFile).href
)

process.on('exit', () => rmSync(outDir, { recursive: true, force: true }))

const enc = new TextEncoder()
const dec = new TextDecoder()

function run(chunks) {
  const stream = new TransparentSgrStream()
  return chunks.map((c) => dec.decode(stream.push(enc.encode(c)))).join('')
}

test('plain text passes through unchanged', () => {
  assert.equal(run(['hello world 你好']), 'hello world 你好')
})

test('black backgrounds become the default background in place', () => {
  assert.equal(run(['a\x1b[40mb\x1b[0m']), 'a\x1b[49mb\x1b[0m')
  assert.equal(run(['\x1b[1;48;2;0;0;0;38;2;255;255;255mX']), '\x1b[1;49;38;2;255;255;255mX')
  assert.equal(run(['\x1b[48;5;234mX']), '\x1b[49mX')
  assert.equal(run(['\x1b[48:2:0:0:0mX']), '\x1b[49mX')
})

test('non-black backgrounds and other SGRs are untouched', () => {
  for (const s of ['\x1b[41mX', '\x1b[48;2;200;0;0mX', '\x1b[48;5;196mX', '\x1b[mX', '\x1b[0mX']) {
    assert.equal(run([s]), s)
  }
})

test('subparameters survive a rewrite of the same sequence', () => {
  assert.equal(run(['\x1b[4:3;40mX']), '\x1b[4:3;49mX')
  assert.equal(formatSgrParamsPreservingSubparams(parseSgrParams('4:3;48:2::1:2:3')), '4:3;48:2::1:2:3')
})

test('output is identical no matter where the stream is split', () => {
  const input =
    'pre\x1b]0;✳ Working\x07mid\x1b[40mA\x1b[48;2;10;10;10mB\x1b]8;;https://x.y/\x1b\\link\x1b]8;;\x1b\\' +
    '\x1b[?1049h\x1b[2J\x1b[1;48;5;0;31m中文\x1b[0m\x1bPq#0\x1b\\\x1b[40mend' +
    '\x1b]0;aborted\x1b[40mC\x1bPq\x1b[48;2;0;0;0mD'
  const whole = run([input])
  const bytes = enc.encode(input)
  for (let cut = 1; cut < bytes.length; cut++) {
    const stream = new TransparentSgrStream()
    const a = stream.push(bytes.subarray(0, cut))
    const b = stream.push(bytes.subarray(cut))
    const joined = new Uint8Array(a.length + b.length)
    joined.set(a)
    joined.set(b, a.length)
    assert.equal(dec.decode(joined), whole, `split at byte ${cut}`)
  }
  assert.ok(whole.includes('\x1b[49mA') && whole.includes('\x1b[49mB') && whole.includes('\x1b[49mend'))
  // An ESC that aborts a string starts a new sequence, wherever the split falls.
  assert.ok(whole.includes('\x1b[49mC') && whole.endsWith('\x1b[49mD'))
})

test('strings are skipped and private / intermediate CSIs are never rewritten', () => {
  for (const s of ['\x1b[?40m', '\x1b[>4;40m', '\x1b[40 q', '\x1b[?1049h']) {
    assert.equal(run([s]), s)
  }
  // An SGR after a BEL- or ST-terminated OSC is still rewritten.
  assert.equal(run(['\x1b]0;t\x07\x1b[40m']), '\x1b]0;t\x07\x1b[49m')
  assert.equal(run(['\x1b]0;t\x1b\\\x1b[40m']), '\x1b]0;t\x1b\\\x1b[49m')
})

test('control bytes inside a CSI fall back to passing the original bytes', () => {
  assert.equal(run(['\x1b[4\r0m']), '\x1b[4\r0m')
})

test('a trailing partial CSI is held, and reset() hands it back', () => {
  const stream = new TransparentSgrStream()
  assert.equal(dec.decode(stream.push(enc.encode('x\x1b[4'))), 'x')
  assert.equal(dec.decode(stream.reset()), '\x1b[4')
  assert.equal(dec.decode(stream.push(enc.encode('0m'))), '0m')
})
