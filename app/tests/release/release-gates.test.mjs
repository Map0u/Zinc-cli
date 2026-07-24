import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const publicTreeVerifier = join(repositoryRoot, 'scripts/verify-public-tree.mjs')
const releaseSourceVerifier = join(repositoryRoot, 'app/scripts/verify-release-source.mjs')

const requiredPublicFiles = [
  'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'CONTRIBUTING.zh-CN.md',
  'CODE_OF_CONDUCT.md', 'SECURITY.md', 'SECURITY.zh-CN.md', 'PRIVACY.md',
  'PRIVACY.zh-CN.md', 'SUPPORT.md', 'SUPPORT.zh-CN.md', 'THIRD_PARTY_NOTICES.md',
  'CHANGELOG.md', 'LICENSE', 'docs/ARCHITECTURE.md', 'docs/INSTALLER.md',
  'docs/RELEASE.md', 'docs/TROUBLESHOOTING.md', 'docs/TROUBLESHOOTING.zh-CN.md'
]

test('release governance gates enforce the reviewed publication boundary', async (t) => {
  const ciWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8')
  const releaseWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/release.yml'), 'utf8')
  assert.match(ciWorkflow, /npm run legal:check/)
  assert.doesNotMatch(releaseWorkflow, /--clobber|gh release upload/)
  assert.equal(releaseWorkflow.match(/contents:\s*write/g)?.length, 1)
  assert.match(releaseWorkflow, /gh release create[\s\S]+--draft[\s\S]+gh release edit[\s\S]+--draft=false/)
  assert.doesNotMatch(releaseWorkflow, /installer:prepare|custom-installer|Installer\.exe/)
  assert.match(releaseWorkflow, /verify-installer-matrix\.ps1/)
  assert.match(releaseWorkflow, /-SetupPath/)

  const scrubFixture = createPublicTreeFixture(t)
  write(scrubFixture, 'app/src/main/services/SettingsService.ts', `// 0.5.0 moved the assistant/secretary feature to its own development branch.
// Existing installations can still have relay credentials in settings.json,
const LEGACY_ASSISTANT_SETTING_KEYS = new Set([
  'SecretaryEnabled',
  'SecretaryBaseUrl',
  'SecretaryToken',
  'SecretarySshCommand',
])
function containsLegacyAssistantSettings(raw) {
  return Object.keys(raw).some((key) => key.startsWith('Secretary') || LEGACY_ASSISTANT_SETTING_KEYS.has(key))
}
// Never echo the removed values: they may include a relay token,
`)

  const acceptedScrub = await runPublicTreeVerifier(scrubFixture)
  assert.equal(acceptedScrub.status, 0, commandOutput(acceptedScrub))

  const retiredSourceFixture = createPublicTreeFixture(t)
  write(retiredSourceFixture, 'archive/winui-native-legacy/src/Legacy.pubxml', '<Project />\n')

  const rejectedRetiredSource = await runPublicTreeVerifier(retiredSourceFixture)
  assert.notEqual(rejectedRetiredSource.status, 0)
  assert.match(commandOutput(rejectedRetiredSource), /archive\/winui-native-legacy\/src\/Legacy\.pubxml:1 release-only-artifact/)

  const runtimePathFixture = createPublicTreeFixture(t)
  write(runtimePathFixture, 'app/src/main/RelayClient.ts', 'export const enabled = true\n')

  const rejectedRuntimePath = await runPublicTreeVerifier(runtimePathFixture)
  assert.notEqual(rejectedRuntimePath.status, 0)
  assert.match(commandOutput(rejectedRuntimePath), /app\/src\/main\/RelayClient\.ts:1 removed-assistant-runtime/)

  const activeScrubFixture = createPublicTreeFixture(t)
  write(activeScrubFixture, 'app/src/main/services/SettingsService.ts', `// Existing installations can still have relay credentials in settings.json,
export const relayClientEnabled = true
`)

  const rejectedActiveScrub = await runPublicTreeVerifier(activeScrubFixture)
  assert.notEqual(rejectedActiveScrub.status, 0)
  assert.match(commandOutput(rejectedActiveScrub), /app\/src\/main\/services\/SettingsService\.ts:2 removed-assistant-runtime/)

  const releaseFixture = createReleaseFixture(t)
  git(releaseFixture, ['tag', '-a', 'v0.5.0', '-m', 'chore(release): v0.5.0'])

  const accepted = await runReleaseSourceVerifier(releaseFixture)
  assert.equal(accepted.status, 0, accepted.stderr)

  git(releaseFixture, ['tag', '--delete', 'v0.5.0'])
  git(releaseFixture, ['tag', '-a', 'v0.5.0', '-m', 'Release v0.5.0'])

  const rejected = await runReleaseSourceVerifier(releaseFixture)
  assert.notEqual(rejected.status, 0)
  assert.match(commandOutput(rejected), /Release tag message must be exactly: chore\(release\): v0\.5\.0/)
})

test('release branding stays on the original Zinc 3D Z artwork', () => {
  const expectedHashes = new Map([
    ['app/resources/icon.ico', '8003c79e421413d642090bdc7506a871bcfb75730cbd52739b4956a66ed87a48'],
    ['app/resources/icon.png', 'c7b77c8f49163d2d8c54eb1fbd461196b47d6994d8d2616b38f7a82e4ab77b14'],
    ['app/src/renderer/public/icon.png', '2047276c66d93177f464df18dd27299f3295359902a4585a299c64eeac6e7456'],
    ['app/src/renderer/src/assets/zinc-icon.png', 'ff7a794dfb2837cba7d0ee5f6a31adca67620455195b27156c1118b4544d3dee']
  ])
  for (const [path, expectedHash] of expectedHashes) {
    const bytes = readFileSync(join(repositoryRoot, path))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash, `${path} is not the approved original Zinc icon`)
  }

  assert.equal(existsSync(join(repositoryRoot, 'app/resources/icon-source.svg')), false)
  assert.equal(existsSync(join(repositoryRoot, 'app/installer')), false)
  assert.equal(existsSync(join(repositoryRoot, 'app/scripts/prepare-custom-installer.mjs')), false)

  const iconGenerator = readFileSync(join(repositoryRoot, 'app/scripts/generate-icons.mjs'), 'utf8')
  assert.doesNotMatch(iconGenerator, /outputs\.set\(['"]app\/(?:resources|src\/renderer)\//)

  const artworkGenerator = readFileSync(join(repositoryRoot, 'app/scripts/generate-installer-artwork.ps1'), 'utf8')
  assert.match(artworkGenerator, /'resources\/icon\.png'/)
  assert.doesNotMatch(artworkGenerator, /markPen|markPoints|DrawLines/)

  const appPackage = JSON.parse(readFileSync(join(repositoryRoot, 'app/package.json'), 'utf8'))
  assert.equal(appPackage.build.win.icon, 'resources/icon.ico')
  assert.equal(appPackage.build.nsis.installerIcon, 'resources/icon.ico')
  assert.doesNotMatch(JSON.stringify(appPackage.scripts), /installer:(?:prepare|dist)/)
})

function createPublicTreeFixture(t) {
  const root = temporaryDirectory(t, 'zinc-public-gate-')
  git(root, ['init', '--quiet'])
  write(root, 'scripts/verify-public-tree.mjs', readFileSync(publicTreeVerifier, 'utf8'))

  for (const file of requiredPublicFiles) write(root, file, '# Fixture\n')

  const pkg = { name: 'zinc-fixture', version: '0.5.0', private: true }
  const lock = {
    name: 'zinc-fixture',
    version: '0.5.0',
    lockfileVersion: 3,
    packages: { '': { name: 'zinc-fixture', version: '0.5.0' } }
  }
  write(root, 'app/package.json', `${JSON.stringify(pkg, null, 2)}\n`)
  write(root, 'app/package-lock.json', `${JSON.stringify(lock, null, 2)}\n`)
  return root
}

function createReleaseFixture(t) {
  const root = temporaryDirectory(t, 'zinc-release-source-')
  git(root, ['init', '--quiet'])
  git(root, ['config', 'user.name', 'Release Test'])
  git(root, ['config', 'user.email', 'release-test@example.com'])
  mkdirSync(join(root, 'app/scripts'), { recursive: true })
  cpSync(releaseSourceVerifier, join(root, 'app/scripts/verify-release-source.mjs'))
  write(root, 'app/package.json', '{"name":"zinc-fixture","version":"0.5.0"}\n')
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', 'test: release fixture'])
  return root
}

function runPublicTreeVerifier(root) {
  return runModule(join(root, 'scripts/verify-public-tree.mjs'))
}

function runReleaseSourceVerifier(root) {
  return runModule(join(root, 'app/scripts/verify-release-source.mjs'), {
    argv: ['--release-ref', 'HEAD', '--head-ref', 'HEAD'],
    env: { ...process.env, GITHUB_REF_NAME: 'v0.5.0', GITHUB_REF_TYPE: 'tag' }
  })
}

function temporaryDirectory(t, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function write(root, file, contents) {
  const absolute = join(root, file)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, contents, 'utf8')
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function commandOutput(result) {
  return [result.stdout, result.stderr, result.error?.stack].filter(Boolean).join('\n')
}

function runModule(file, options = {}) {
  return new Promise((resolveResult) => {
    const worker = new Worker(pathToFileURL(file), {
      argv: options.argv ?? [],
      env: options.env ?? process.env,
      stdout: true,
      stderr: true
    })
    let stdout = ''
    let stderr = ''
    let error
    worker.stdout.setEncoding('utf8')
    worker.stderr.setEncoding('utf8')
    worker.stdout.on('data', (chunk) => { stdout += chunk })
    worker.stderr.on('data', (chunk) => { stderr += chunk })
    worker.on('error', (workerError) => { error = workerError })
    worker.on('exit', (status) => resolveResult({ status, stdout, stderr, error }))
  })
}
