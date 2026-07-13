const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { verifyPayload } = require('../lib/payload-verifier')

function withFixture(callback) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zinc-payload-test-'))
  const payloadPath = path.join(dir, 'Zinc-Setup.exe')
  const manifestPath = path.join(dir, 'payload-manifest.json')
  try {
    callback({ payloadPath, manifestPath })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function writeValidFixture(paths, bytes = Buffer.from('synthetic installer fixture')) {
  writeFileSync(paths.payloadPath, bytes)
  writeFileSync(paths.manifestPath, JSON.stringify({
    version: '0.5.0',
    filename: 'Zinc-Setup.exe',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }))
}

test('rejects missing payload and missing manifest without exposing fixture paths', () => withFixture((paths) => {
  let result = verifyPayload(paths)
  assert.deepEqual(result, { ok: false, error: 'Installer payload is missing.' })
  writeFileSync(paths.payloadPath, 'x')
  result = verifyPayload(paths)
  assert.deepEqual(result, { ok: false, error: 'Payload manifest is missing.' })
  assert.equal(result.error.includes(paths.payloadPath), false)
}))

test('rejects wrong filename, size, and hash', () => withFixture((paths) => {
  writeValidFixture(paths)
  const valid = JSON.parse(require('node:fs').readFileSync(paths.manifestPath, 'utf8'))

  writeFileSync(paths.manifestPath, JSON.stringify({ ...valid, filename: 'renamed.exe' }))
  assert.match(verifyPayload(paths).error, /filename/i)

  writeFileSync(paths.manifestPath, JSON.stringify({ ...valid, size: valid.size + 1 }))
  assert.match(verifyPayload(paths).error, /size/i)

  writeFileSync(paths.manifestPath, JSON.stringify({ ...valid, sha256: '0'.repeat(64) }))
  assert.match(verifyPayload(paths).error, /SHA-256/i)
}))

test('accepts a valid manifest and payload', () => withFixture((paths) => {
  writeValidFixture(paths)
  assert.deepEqual(verifyPayload(paths), {
    ok: true,
    version: '0.5.0',
    filename: 'Zinc-Setup.exe',
    size: Buffer.byteLength('synthetic installer fixture'),
    sha256: createHash('sha256').update('synthetic installer fixture').digest('hex')
  })
}))
