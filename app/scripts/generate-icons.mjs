#!/usr/bin/env node

import { constants as zlibConstants, deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(appRoot, '..')
const checkOnly = process.argv.includes('--check')

// Clean-room compatibility artwork for the archived WinUI feasibility shell.
// Zinc's active icon.ico/icon.png assets are the project-owned 3D Z artwork;
// they are intentionally not outputs of this generator and must never be
// replaced by the geometric terminal prompt below.
const palette = {
  shell: [20, 25, 34, 255],
  border: [50, 66, 84, 255],
  prompt: [112, 183, 238, 255],
  cursor: [235, 241, 247, 255]
}

const archiveRoots = [
  'archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets'
]

const archiveTargets = [
  ['LockScreenLogo.scale-200.png', 48, 48, 38],
  ['Square150x150Logo.scale-200.png', 300, 300, 300],
  ['Square44x44Logo.scale-200.png', 88, 88, 88],
  ['Square44x44Logo.targetsize-24_altform-unplated.png', 24, 24, 24],
  ['Square44x44Logo.targetsize-48_altform-lightunplated.png', 48, 48, 48],
  ['StoreLogo.png', 50, 50, 50],
  ['Wide310x150Logo.scale-200.png', 620, 300, 240],
  ['SplashScreen.scale-200.png', 1240, 600, 320]
]

const outputs = new Map()

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoImages = icoSizes.map((size) => ({
  size,
  bytes: encodePng(size, size, renderCanvas(size, size, size))
}))

for (const root of archiveRoots) {
  outputs.set(`${root}/AppIcon.ico`, encodeIco(icoImages))
  for (const [name, width, height, iconSize] of archiveTargets) {
    outputs.set(`${root}/${name}`, encodePng(width, height, renderCanvas(width, height, iconSize)))
  }
}

let failed = false
for (const [relativePath, bytes] of outputs) {
  const absolutePath = join(repoRoot, relativePath)
  if (checkOnly) {
    if (!existsSync(absolutePath) || !readFileSync(absolutePath).equals(bytes)) {
      console.error(`Icon artifact is missing or stale: ${relativePath}`)
      failed = true
    }
    continue
  }

  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, bytes)
  console.log(`${sha256(bytes)}  ${relativePath}`)
}

if (failed) process.exit(1)
if (checkOnly) console.log(`Archived compatibility icon artifacts are reproducible (${outputs.size} files checked).`)

function renderCanvas(width, height, iconSize) {
  const pixels = Buffer.alloc(width * height * 4)
  const left = (width - iconSize) / 2
  const top = (height - iconSize) / 2
  const samples = iconSize <= 32 ? 4 : 2
  const sampleCount = samples * samples

  for (let y = Math.max(0, Math.floor(top)); y < Math.min(height, Math.ceil(top + iconSize)); y++) {
    for (let x = Math.max(0, Math.floor(left)); x < Math.min(width, Math.ceil(left + iconSize)); x++) {
      const totals = [0, 0, 0, 0]
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const nx = (x + (sx + 0.5) / samples - left) / iconSize
          const ny = (y + (sy + 0.5) / samples - top) / iconSize
          const color = sampleIcon(nx, ny)
          for (let channel = 0; channel < 4; channel++) totals[channel] += color[channel]
        }
      }
      const offset = (y * width + x) * 4
      for (let channel = 0; channel < 4; channel++) {
        pixels[offset + channel] = Math.round(totals[channel] / sampleCount)
      }
    }
  }
  return pixels
}

function sampleIcon(x, y) {
  if (!insideRoundedRect(x, y, 0.06, 0.06, 0.94, 0.94, 0.22)) return [0, 0, 0, 0]

  let color = palette.border
  if (insideRoundedRect(x, y, 0.074, 0.074, 0.926, 0.926, 0.206)) color = palette.shell

  const promptWidth = 0.075
  if (
    distanceToSegment(x, y, 0.28, 0.32, 0.48, 0.5) <= promptWidth / 2 ||
    distanceToSegment(x, y, 0.48, 0.5, 0.28, 0.68) <= promptWidth / 2
  ) color = palette.prompt

  if (insideRoundedRect(x, y, 0.52, 0.64, 0.75, 0.72, 0.04)) color = palette.cursor
  return color
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  const closestX = Math.max(left + radius, Math.min(x, right - radius))
  const closestY = Math.max(top + radius, Math.min(y, bottom - radius))
  const dx = x - closestX
  const dy = y - closestY
  return x >= left && x <= right && y >= top && y <= bottom && dx * dx + dy * dy <= radius * radius
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1)
    rows[rowOffset] = 0
    rgba.copy(rows, rowOffset + 1, y * width * 4, (y + 1) * width * 4)
  }

  const idat = deflateSync(rows, {
    level: 9,
    strategy: zlibConstants.Z_RLE
  })
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  name.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length)
  return chunk
}

function encodeIco(images) {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length

  images.forEach(({ size, bytes }, index) => {
    const entry = 6 + index * 16
    header[entry] = size === 256 ? 0 : size
    header[entry + 1] = size === 256 ? 0 : size
    header[entry + 2] = 0
    header[entry + 3] = 0
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(bytes.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += bytes.length
  })

  return Buffer.concat([header, ...images.map(({ bytes }) => bytes)])
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}
