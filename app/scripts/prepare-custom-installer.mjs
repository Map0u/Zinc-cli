import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const installerPackagePath = join(root, 'installer', 'package.json')
const installerLockPath = join(root, 'installer', 'package-lock.json')

const setupName = `Zinc-${pkg.version}-Setup.exe`
const setupSource = join(root, 'dist', setupName)
const payloadDir = join(root, 'installer', 'payload')
const assetsDir = join(root, 'installer', 'assets')
const payloadTarget = join(payloadDir, 'Zinc-Setup.exe')

statSync(setupSource)
mkdirSync(payloadDir, { recursive: true })
mkdirSync(assetsDir, { recursive: true })

copyFileSync(setupSource, payloadTarget)
copyFileSync(join(root, 'resources', 'icon.png'), join(assetsDir, 'icon.png'))

const payloadBytes = readFileSync(payloadTarget)
const manifest = {
  version: pkg.version,
  filename: 'Zinc-Setup.exe',
  size: payloadBytes.byteLength,
  sha256: createHash('sha256').update(payloadBytes).digest('hex')
}
writeFileSync(join(payloadDir, 'payload-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

syncPackageVersion(installerPackagePath, pkg.version)
syncPackageVersion(installerLockPath, pkg.version, true)

console.log(`Prepared custom installer payload from dist/${setupName}`)
console.log(`Wrote payload manifest for ${manifest.filename} (${manifest.size} bytes, sha256 ${manifest.sha256})`)

function syncPackageVersion(filePath, version, lock = false) {
  const json = JSON.parse(readFileSync(filePath, 'utf8'))
  json.version = version
  if (lock && json.packages?.['']) json.packages[''].version = version
  writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
}
