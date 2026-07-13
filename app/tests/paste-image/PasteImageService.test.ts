import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  MAX_PASTED_IMAGE_BYTES,
  PASTED_IMAGE_RETENTION_MS,
  PasteImageService
} from '../../src/main/services/PasteImageService.ts'

function withUserData(callback: (userData: string) => void): void {
  const userData = mkdtempSync(join(tmpdir(), 'zinc-paste-image-test-'))
  try {
    callback(userData)
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
}

test('service enforces byte bounds, supported MIME types, and image signatures', () => withUserData((userData) => {
  const service = new PasteImageService(userData)
  const png = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2mT0AAAAASUVORK5CYII=',
    'base64'
  ))
  assert.equal(service.save(new Uint8Array(), 'image/png'), null)
  assert.equal(service.save(new Uint8Array(MAX_PASTED_IMAGE_BYTES + 1), 'image/png'), null)
  assert.equal(service.save(Uint8Array.from([1, 2, 3]), 'image/png'), null)
  assert.equal(service.save(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'), null)
  assert.equal(service.save(png, 'text/plain'), null)

  const saved = service.save(png, 'image/png')
  assert.ok(saved)
  assert.equal(existsSync(saved), true)
}))

test('startup cleanup removes only expired regular files inside PastedImages', () => withUserData((userData) => {
  const imageDir = join(userData, 'PastedImages')
  const sibling = join(userData, 'outside.txt')
  const expired = join(imageDir, 'expired.png')
  const fresh = join(imageDir, 'fresh.png')
  const nestedDir = join(imageDir, 'nested')
  mkdirSync(nestedDir, { recursive: true })
  writeFileSync(expired, 'expired')
  writeFileSync(fresh, 'fresh')
  writeFileSync(sibling, 'private user data')

  const now = Date.now()
  const oldSeconds = (now - PASTED_IMAGE_RETENTION_MS - 60_000) / 1000
  utimesSync(expired, oldSeconds, oldSeconds)
  utimesSync(sibling, oldSeconds, oldSeconds)

  new PasteImageService(userData)
  assert.equal(existsSync(expired), false)
  assert.equal(existsSync(fresh), true)
  assert.equal(existsSync(nestedDir), true)
  assert.equal(existsSync(sibling), true)
}))
