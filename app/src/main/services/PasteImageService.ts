import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MAX_PASTED_IMAGE_BYTES = 25 * 1024 * 1024
export const PASTED_IMAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Persists a clipboard-pasted image to `userData\PastedImages\` and produces
 * the path string that gets typed into the pty (parity §1.5). Kept as its
 * own service (not inline in main/index.ts) so the main process stays thin.
 */
export class PasteImageService {
  private readonly dir: string

  constructor(userDataPath: string) {
    this.dir = join(userDataPath, 'PastedImages')
    this.cleanupExpired()
  }

  /**
   * Writes `data` to a timestamped file under PastedImages, extension chosen
   * from `mime` (parity §1.5: jpeg→jpg/gif/webp/else png). Returns the
   * absolute Windows path, or `null` on any failure (silent per spec).
   */
  save(data: Uint8Array, mime: string): string | null {
    try {
      if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > MAX_PASTED_IMAGE_BYTES) {
        return null
      }
      const extension = validatedExtension(data, mime)
      if (!extension) return null

      mkdirSync(this.dir, { recursive: true })
      const fileName = `clipboard_${timestamp()}.${extension}`
      const filePath = join(this.dir, fileName)
      writeFileSync(filePath, Buffer.from(data.buffer, data.byteOffset, data.byteLength), { flag: 'wx', mode: 0o600 })
      return filePath
    } catch {
      return null
    }
  }

  /** Remove only regular files in this service's directory after 30 days. */
  cleanupExpired(now = Date.now()): number {
    let removed = 0
    try {
      for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        const filePath = join(this.dir, entry.name)
        try {
          if (statSync(filePath).mtimeMs < now - PASTED_IMAGE_RETENTION_MS) {
            unlinkSync(filePath)
            removed += 1
          }
        } catch {
          // A concurrent delete or inaccessible file must not prevent startup.
        }
      }
    } catch {
      // The directory normally does not exist until the first image is pasted.
    }
    return removed
  }
}

/** `yyyyMMdd_HHmmss_fff` using the real wall clock (this is runtime code, not workflow output). */
function timestamp(): string {
  const now = new Date()
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}` +
    `_${pad(now.getMilliseconds(), 3)}`
  )
}

function validatedExtension(data: Uint8Array, mime: string): string | null {
  if (typeof mime !== 'string') return null
  switch (mime.toLowerCase()) {
    case 'image/png':
      return isPng(data) ? 'png' : null
    case 'image/jpeg':
      return isJpeg(data) ? 'jpg' : null
    case 'image/gif':
      return isGif(data) ? 'gif' : null
    case 'image/webp':
      return isWebp(data) ? 'webp' : null
    default:
      return null
  }
}

function isPng(data: Uint8Array): boolean {
  if (
    data.byteLength < 45 ||
    !startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    !asciiAt(data, 12, 'IHDR') ||
    !asciiAt(data, data.byteLength - 8, 'IEND')
  ) return false
  return readUint32Be(data, 16) > 0 && readUint32Be(data, 20) > 0
}

function isJpeg(data: Uint8Array): boolean {
  return data.byteLength >= 4 && startsWith(data, [0xff, 0xd8, 0xff]) &&
    data[data.byteLength - 2] === 0xff && data[data.byteLength - 1] === 0xd9
}

function isGif(data: Uint8Array): boolean {
  if (data.byteLength < 14 || (!asciiAt(data, 0, 'GIF87a') && !asciiAt(data, 0, 'GIF89a'))) return false
  return (data[6] | (data[7] << 8)) > 0 && (data[8] | (data[9] << 8)) > 0 && data[data.byteLength - 1] === 0x3b
}

function isWebp(data: Uint8Array): boolean {
  if (data.byteLength < 20 || !asciiAt(data, 0, 'RIFF') || !asciiAt(data, 8, 'WEBP')) return false
  const declaredSize = data[4] | (data[5] << 8) | (data[6] << 16) | (data[7] << 24)
  return declaredSize >>> 0 === data.byteLength - 8
}

function readUint32Be(data: Uint8Array, offset: number): number {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0
}

function startsWith(data: Uint8Array, signature: readonly number[]): boolean {
  return data.byteLength >= signature.length && signature.every((byte, index) => data[index] === byte)
}

function asciiAt(data: Uint8Array, offset: number, value: string): boolean {
  if (data.byteLength < offset + value.length) return false
  for (let index = 0; index < value.length; index += 1) {
    if (data[offset + index] !== value.charCodeAt(index)) return false
  }
  return true
}

/**
 * Converts a Windows absolute path to its WSL `/mnt/<drive>` equivalent
 * (parity §1.5/§2.2): lowercase drive letter, forward slashes, no trailing
 * slash normalization needed since `join()` never produces one. Returns the
 * original path unchanged if it doesn't look like `X:\...`.
 */
export function toWslPath(windowsPath: string): string {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(windowsPath)
  if (!match) return windowsPath
  const [, drive, rest] = match
  return `/mnt/${drive.toLowerCase()}/${rest.replace(/\\/g, '/')}`
}
