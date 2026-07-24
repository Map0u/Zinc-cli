import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repositoryRoot = dirname(appRoot)
const packageResources = argumentValues('--package-resources')
const releaseMode = process.argv.includes('--release')

runNode(join(appRoot, 'scripts', 'generate-legal-artifacts.mjs'), ['--check'])

const appPackage = readJson(join(appRoot, 'package.json'))

verifyPackagerConfiguration(appPackage)
verifyBom(appPackage)
verifyAssetProvenance()
verifySourceProvenance()
for (const resourcesPath of packageResources) verifyPackagedResources(resolve(resourcesPath), appPackage.version)

console.log(`Verified legal inventory, SBOM, asset provenance, vendored licenses${packageResources.length ? `, and ${packageResources.length} packaged resource tree(s)` : ''}.`)

function verifyPackagerConfiguration(main) {
  const mainLegal = main.build?.extraResources?.find((item) => item.from === 'resources/legal' && item.to === 'legal')
  assert(mainLegal, 'main package does not export resources/legal as an unpacked legal directory')
  assert(
    Array.isArray(mainLegal.filter) &&
      mainLegal.filter.includes('LICENSE') &&
      mainLegal.filter.includes('THIRD_PARTY_NOTICES.md') &&
      mainLegal.filter.includes('THIRD_PARTY_NOTICES-*.md') &&
      mainLegal.filter.includes('ASSET_PROVENANCE.md') &&
      mainLegal.filter.includes('*.cdx.json'),
    'legal extraResources filter is incomplete'
  )
}

function verifyBom(pkg) {
  const bomPath = join(appRoot, 'resources', 'legal', `zinc-${pkg.version}.cdx.json`)
  const bom = readJson(bomPath)
  assert(bom.bomFormat === 'CycloneDX' && bom.specVersion === '1.5', 'SBOM is not CycloneDX 1.5')
  assert(bom.metadata?.component?.version === pkg.version, 'SBOM root version differs')
  const lock = readJson(join(appRoot, 'package-lock.json'))
  const expected = Object.entries(lock.packages).filter(([path, entry]) => path && !entry.dev).map(([, entry]) => entry.version)
  assert(bom.components.length === expected.length + 1, `SBOM component count mismatch: expected ${expected.length + 1}, received ${bom.components.length}`)
  assert(bom.components.some((component) => component.name === 'electron' && component.version === '43.0.0'), 'SBOM does not identify the distributed Electron runtime')
  assert(bom.components.every((component) => component.licenses?.[0]?.license?.id), 'SBOM component lacks a license identifier')
  assert(bom.components.some((component) => component.name === 'lazy-val' && component.version === '1.0.5' && component.licenses[0].license.id === 'MIT'), 'SBOM lacks the pinned lazy-val license declaration')
}

function verifyAssetProvenance() {
  const inventoryPath = join(repositoryRoot, 'ASSET_PROVENANCE.md')
  const inventory = readFileSync(inventoryPath, 'utf8')
  const rows = new Map()
  for (const match of inventory.matchAll(/^\| (?:source|active|archived) \| `([^`]+)` \| `([a-f0-9]{64})` \| ([^|]+) \|$/gm)) {
    rows.set(match[1], { hash: match[2], status: match[3].trim() })
  }

  const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'app', 'archive'], { cwd: repositoryRoot, encoding: 'utf8' })
  if (git.status !== 0) throw new Error(git.stderr || 'git ls-files failed')
  const assets = git.stdout.split('\0').filter((path) => /\.(?:png|ico|svg|bmp|jpe?g|webp|gif|woff2?|ttf|otf)$/i.test(path))
  assert(assets.length > 0, 'no committed assets found')
  for (const path of assets) {
    const row = rows.get(path)
    assert(row, `asset missing from ASSET_PROVENANCE.md: ${path}`)
    const actual = sha256(readFileSync(join(repositoryRoot, path)))
    assert(row.hash === actual, `asset hash is stale for ${path}`)
    assert(/^(?:APPROVED|BLOCKED):/.test(row.status), `asset status is not an explicit APPROVED/BLOCKED decision for ${path}`)
    if (releaseMode) assert(row.status.startsWith('APPROVED:'), `release is blocked by unapproved asset: ${path}`)
  }
  for (const path of rows.keys()) assert(assets.includes(path), `provenance row does not map to a committed asset: ${path}`)
}

function verifySourceProvenance() {
  const notice = readFileSync(join(repositoryRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  if (releaseMode) {
    assert(!notice.includes('**Source provenance status: BLOCKED**'), 'release is blocked by unresolved source-code provenance in THIRD_PARTY_NOTICES.md')
  }
}

function verifyPackagedResources(resourcesPath, version) {
  const legal = join(resourcesPath, 'legal')
  for (const filename of ['LICENSE', 'THIRD_PARTY_NOTICES.md', `THIRD_PARTY_NOTICES-${version}.md`, 'ASSET_PROVENANCE.md', `zinc-${version}.cdx.json`]) {
    const packaged = join(legal, filename)
    const source = join(appRoot, 'resources', 'legal', filename)
    assert(existsSync(packaged), `packaged legal artifact is missing: ${packaged}`)
    assert(sha256(readFileSync(packaged)) === sha256(readFileSync(source)), `packaged legal artifact differs from source: ${packaged}`)
  }
  const applicationRoot = dirname(resourcesPath)
  assert(existsSync(join(applicationRoot, 'LICENSE.electron.txt')) || existsSync(join(applicationRoot, 'LICENSE')), `packaged Electron license is missing beside ${applicationRoot}`)
  assert(existsSync(join(applicationRoot, 'LICENSES.chromium.html')), `packaged Chromium notices are missing beside ${applicationRoot}`)
}

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: repositoryRoot, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${script} failed`)
}

function argumentValues(name) {
  const values = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) {
      assert(process.argv[index + 1], `${name} requires a path`)
      values.push(process.argv[index + 1])
      index += 1
    }
  }
  return values
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
