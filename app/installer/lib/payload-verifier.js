const { createHash } = require('node:crypto')
const { existsSync, readFileSync, statSync } = require('node:fs')
const path = require('node:path')

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function verifyPayload({ payloadPath, manifestPath, expectedFilename = 'Zinc-Setup.exe' }) {
  if (!existsSync(payloadPath)) return failure('Installer payload is missing.')
  if (!existsSync(manifestPath)) return failure('Payload manifest is missing.')

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return failure('Payload manifest could not be read.')
  }

  const filename = typeof manifest?.filename === 'string' ? manifest.filename : ''
  const size = typeof manifest?.size === 'number' ? manifest.size : -1
  const sha256 = typeof manifest?.sha256 === 'string' ? manifest.sha256.toLowerCase() : ''
  const version = typeof manifest?.version === 'string' ? manifest.version.trim() : ''

  if (filename !== expectedFilename || path.win32.basename(filename) !== filename) {
    return failure('Payload manifest filename is invalid.')
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    return failure('Payload manifest size is invalid.')
  }
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    return failure('Payload manifest SHA-256 is invalid.')
  }
  if (!SEMVER.test(version)) {
    return failure('Payload manifest version is invalid.')
  }

  try {
    if (statSync(payloadPath).size !== size) {
      return failure('Installer payload size does not match the manifest.')
    }
    const actualSha256 = createHash('sha256').update(readFileSync(payloadPath)).digest('hex')
    if (actualSha256 !== sha256) {
      return failure('Installer payload SHA-256 does not match the manifest.')
    }
  } catch {
    return failure('Installer payload could not be read.')
  }

  return { ok: true, version, filename, size, sha256 }
}

function failure(error) {
  return { ok: false, error }
}

module.exports = { verifyPayload }
