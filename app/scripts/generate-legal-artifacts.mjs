import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repositoryRoot = dirname(appRoot)
const writeMode = process.argv.includes('--write')
const appPackage = readJson(join(appRoot, 'package.json'))
const installerPackage = readJson(join(appRoot, 'installer', 'package.json'))
const lock = readJson(join(appRoot, 'package-lock.json'))

assert(appPackage.version === installerPackage.version, 'app and installer versions differ')

const components = collectComponents()
components.push(collectElectron())
components.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))

const notice = renderNotice()
const bom = `${JSON.stringify(renderBom(), null, 2)}\n`
const outputs = new Map([
  [join(repositoryRoot, 'THIRD_PARTY_NOTICES.md'), notice],
  [join(appRoot, 'resources', 'legal', 'LICENSE'), normalizeLineEndings(readFileSync(join(repositoryRoot, 'LICENSE'), 'utf8'))],
  [join(appRoot, 'resources', 'legal', 'THIRD_PARTY_NOTICES.md'), notice],
  [join(appRoot, 'resources', 'legal', `THIRD_PARTY_NOTICES-${appPackage.version}.md`), notice],
  [join(appRoot, 'resources', 'legal', 'ASSET_PROVENANCE.md'), normalizeLineEndings(readFileSync(join(repositoryRoot, 'ASSET_PROVENANCE.md'), 'utf8'))],
  [join(appRoot, 'resources', 'legal', `zinc-${appPackage.version}.cdx.json`), bom]
])

mkdirSync(join(appRoot, 'resources', 'legal'), { recursive: true })
for (const [path, content] of outputs) {
  if (writeMode) writeFileSync(path, content, 'utf8')
  assert(existsSync(path), `missing generated legal artifact: ${path}`)
  assert(readFileSync(path, 'utf8') === content, `stale generated legal artifact: ${path}; run npm run legal:generate`)
}

console.log(`${writeMode ? 'Generated' : 'Verified'} Zinc ${appPackage.version} legal artifacts for ${components.length} runtime components.`)

function collectComponents() {
  const result = []
  for (const [lockPath, entry] of Object.entries(lock.packages)) {
    if (!lockPath || entry.dev) continue
    const directory = join(appRoot, lockPath)
    const pkg = readJson(join(directory, 'package.json'))
    assert(pkg.version === entry.version, `${pkg.name} installed version differs from lock`)
    assert(pkg.license && pkg.license === entry.license, `${pkg.name}@${entry.version} license metadata differs from lock`)
    const licenseFile = readdirSync(directory).filter((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name)).sort()[0]
    const lazyValException = pkg.name === 'lazy-val' && entry.version === '1.0.5'
    assert(licenseFile || lazyValException, `${pkg.name}@${entry.version} has no installed license file`)
    result.push({
      name: pkg.name,
      version: entry.version,
      license: entry.license,
      lockPath,
      integrity: entry.integrity,
      repository: normalizeRepository(pkg.repository, pkg.homepage),
      licenseFile: licenseFile ?? null,
      licenseText: licenseFile ? normalizeText(readFileSync(join(directory, licenseFile), 'utf8')) : null,
      dependencies: { ...entry.dependencies, ...entry.optionalDependencies }
    })
  }
  return result
}

function collectElectron() {
  const directory = join(appRoot, 'node_modules', 'electron')
  const pkg = readJson(join(directory, 'package.json'))
  const locked = lock.packages['node_modules/electron']
  assert(pkg.version === locked.version, 'Electron installed version differs from lock')
  return {
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    lockPath: 'node_modules/electron',
    integrity: locked.integrity,
    repository: normalizeRepository(pkg.repository, pkg.homepage),
    licenseFile: 'LICENSE',
    licenseText: normalizeText(readFileSync(join(directory, 'LICENSE'), 'utf8')),
    dependencies: {}
  }
}

function renderNotice() {
  const lines = [
    '# Third-Party Notices', '',
    `This notice is generated for Zinc ${appPackage.version} from \`app/package-lock.json\` and installed package metadata. Zinc itself is licensed under AGPL-3.0-only; see \`LICENSE\`. Third-party components remain under their own terms.`, '',
    '## Runtime component inventory', '',
    '| Component | Resolved version | License | Upstream | License evidence |',
    '| --- | ---: | --- | --- | --- |'
  ]
  for (const item of components) {
    const source = item.repository ? `[source](${item.repository})` : 'not stated'
    const evidence = item.licenseFile ? `\`${item.licenseFile}\`` : 'official metadata only; see review note'
    lines.push(`| \`${item.name}\` | ${item.version} | ${item.license} | ${source} | ${evidence} |`)
  }
  lines.push('', 'The table includes every non-development package entry in the application lockfile plus Electron because Electron is embedded in both distributed executables. The custom installer has no production npm dependencies; its Electron runtime is the same version.', '',
    '## Required upstream review', '',
    '**lazy-val 1.0.5:** The official npm artifact (`https://registry.npmjs.org/lazy-val/-/lazy-val-1.0.5.tgz`) and exact upstream commit (`https://github.com/develar/lazy-val/tree/b69ad4119f1b19bdab13c61ee2fcc88d46b89071`) declare `license: MIT` and identify Vladimir Krivosheev as author. Neither contains a license-text file or copyright notice. Zinc does not invent one. Keep this omission visible to release reviewers; obtain upstream clarification or replace the dependency if a reproduced notice is required.', '',
    '## Source-code provenance review', '',
    'An archived prototype implementation with insufficient durable provenance evidence was removed in full during the 0.5.0 public-source review. It is not included in the publication tree or distributed artifacts. Do not restore archived or local experimental source without recording authorship and license evidence.', '',
    '## License texts supplied by upstream packages', '')

  const groups = new Map()
  for (const item of components.filter((entry) => entry.licenseText)) {
    const hash = sha256(item.licenseText)
    const group = groups.get(hash) ?? { text: item.licenseText, names: [] }
    group.names.push(`${item.name}@${item.version}`)
    groups.set(hash, group)
  }
  for (const [hash, group] of [...groups.entries()].sort()) {
    lines.push(`### ${group.names.sort().join(', ')}`, '', `License text SHA-256: \`${hash}\``, '', '```text', group.text.trimEnd(), '```', '')
  }
  lines.push('## Platform notices', '', 'Electron distributions include `LICENSE` and `LICENSES.chromium.html` beside the executable. Those framework notices are part of the packaged runtime and must not be removed. Product names are trademarks of their respective owners; mention does not imply endorsement.', '')
  return `${lines.join('\n').trimEnd()}\n`
}

function renderBom() {
  const rootRef = purl(appPackage.name, appPackage.version)
  const componentByLockPath = new Map(components.filter((item) => item.name !== 'electron').map((item) => [item.lockPath, item]))
  const dependencies = [{ ref: rootRef, dependsOn: resolveDependencies(lock.packages[''].dependencies, '', componentByLockPath) }]
  for (const item of components.filter((entry) => entry.name !== 'electron')) {
    dependencies.push({ ref: purl(item.name, item.version), dependsOn: resolveDependencies(item.dependencies, item.lockPath, componentByLockPath) })
  }
  dependencies.push({ ref: purl('electron', components.find((item) => item.name === 'electron').version), dependsOn: [] })
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${uuidFromHash(sha256(`${appPackage.name}@${appPackage.version}:${components.map((item) => `${item.name}@${item.version}`).join(',')}`))}`,
    version: 1,
    metadata: {
      component: { type: 'application', 'bom-ref': rootRef, name: appPackage.name, version: appPackage.version, licenses: [{ license: { id: appPackage.license } }], purl: rootRef },
      properties: [{ name: 'zinc:generated-from', value: 'app/package-lock.json' }]
    },
    components: components.map((item) => {
      const component = {
        type: item.name === 'electron' ? 'framework' : 'library',
        'bom-ref': purl(item.name, item.version),
        name: item.name,
        version: item.version,
        licenses: [{ license: { id: item.license } }],
        purl: purl(item.name, item.version),
        properties: [
          { name: 'zinc:lock-path', value: item.lockPath },
          { name: 'zinc:license-evidence', value: item.licenseFile ?? 'official package metadata; upstream text absent' }
        ]
      }
      const hash = sri(item.integrity)
      if (hash) component.hashes = [hash]
      if (item.repository) component.externalReferences = [{ type: 'vcs', url: item.repository }]
      return component
    }),
    dependencies: dependencies.sort((a, b) => a.ref.localeCompare(b.ref))
  }
}

function resolveDependencies(requirements = {}, from, byPath) {
  const refs = []
  for (const name of Object.keys(requirements)) {
    let current = from
    while (true) {
      const candidate = current ? `${current}/node_modules/${name}` : `node_modules/${name}`
      const found = byPath.get(candidate)
      if (found) { refs.push(purl(found.name, found.version)); break }
      if (!current) break
      current = current.includes('/node_modules/') ? current.slice(0, current.lastIndexOf('/node_modules/')) : ''
    }
  }
  return [...new Set(refs)].sort()
}

function normalizeRepository(repository, homepage) {
  let value = typeof repository === 'string' ? repository : repository?.url
  if (!value) value = homepage
  if (!value) return null
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) value = `https://github.com/${value}`
  return value.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/').replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git(?:#.*)?$/, '')
}

function purl(name, version) {
  const encoded = name.startsWith('@') ? `%40${encodeURIComponent(name.slice(1).split('/')[0])}/${encodeURIComponent(name.split('/')[1])}` : encodeURIComponent(name)
  return `pkg:npm/${encoded}@${encodeURIComponent(version)}`
}

function sri(integrity) {
  if (!integrity) return null
  const [algorithm, base64] = integrity.split('-', 2)
  return algorithm && base64 ? { alg: algorithm.toUpperCase().replace('SHA', 'SHA-'), content: Buffer.from(base64, 'base64').toString('hex') } : null
}

function uuidFromHash(hash) {
  const chars = hash.slice(0, 32).split(''); chars[12] = '5'; chars[16] = ['8', '9', 'a', 'b'][parseInt(chars[16], 16) % 4]
  const value = chars.join(''); return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

function normalizeText(value) { return `${value.replace(/\r\n/g, '\n').trimEnd()}\n` }
function normalizeLineEndings(value) { return value.replace(/\r\n?/g, '\n') }
function sha256(value) { return createHash('sha256').update(value).digest('hex') }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }
function assert(condition, message) { if (!condition) throw new Error(message) }
