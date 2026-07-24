#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const self = 'scripts/verify-public-tree.mjs'
const maxTextBytes = 2_000_000

const allowedBinaryFiles = new Set([
  'app/resources/icon.ico',
  'app/resources/icon.png',
  'app/src/renderer/public/icon.png',
  'app/src/renderer/src/assets/zinc-icon.png',
  'archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/AppIcon.ico',
  'archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/LockScreenLogo.scale-200.png',
  'archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/SplashScreen.scale-200.png',
  'archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/Square150x150Logo.scale-200.png',
  'archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/Square44x44Logo.scale-200.png',
  'archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/Square44x44Logo.targetsize-24_altform-unplated.png',
  'archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/Square44x44Logo.targetsize-48_altform-lightunplated.png',
  'archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/StoreLogo.png',
  'archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/Wide310x150Logo.scale-200.png'
])

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'])
const archiveExtensions = new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz'])
const diagnosticExtensions = new Set([
  '.dmp', '.dump', '.core', '.crash', '.log', '.trace', '.har', '.pcap', '.pcapng',
  '.sqlite', '.sqlite3', '.db', '.bak', '.backup'
])
const secretMaterialExtensions = new Set(['.key', '.pem', '.p12', '.pfx', '.cer', '.crt'])
const generatedBinaryExtensions = new Set([
  '.exe', '.msi', '.dll', '.node', '.wasm', '.wav', '.mp3', '.mp4', '.mov', '.avi',
  '.webm', '.ogg', '.ttf', '.otf', '.woff', '.woff2'
])

const requiredFiles = [
  'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'CONTRIBUTING.zh-CN.md',
  'CODE_OF_CONDUCT.md', 'SECURITY.md', 'SECURITY.zh-CN.md', 'PRIVACY.md',
  'PRIVACY.zh-CN.md', 'SUPPORT.md', 'SUPPORT.zh-CN.md', 'THIRD_PARTY_NOTICES.md',
  'CHANGELOG.md', 'LICENSE', 'docs/ARCHITECTURE.md', 'docs/INSTALLER.md',
  'docs/RELEASE.md', 'docs/TROUBLESHOOTING.md', 'docs/TROUBLESHOOTING.zh-CN.md'
]

const forbiddenPaths = [
  'docs/ASSISTANT-CLOUD.md',
  'archive/winui-native-legacy/src/',
  'settings/windows-terminal-settings.snapshot.json',
  'app/dev/mock-relay.mjs',
  'app/dev/mock-relay-ui/',
  'app/src/main/services/SecretaryPoller.ts',
  'app/src/shared/secretaryProtocol.ts',
  'app/src/renderer/src/secretary/',
  'docs/acceptance-shots/'
]

const removedAssistantRuntimeRoots = ['app/src/', 'app/dev/']
const legacyAssistantScrubFile = 'app/src/main/services/SettingsService.ts'
const allowedLegacyAssistantScrubLines = [
  /^\/\/ 0\.5\.0 moved the assistant\/secretary feature to its own development branch\.$/,
  /^\/\/ Existing installations can still have relay credentials in settings\.json,$/,
  /^\s*'Secretary(?:Enabled|BaseUrl|Token|SshCommand)',\s*$/,
  /^\s*return Object\.keys\(raw\)\.some\(\(key\) => key\.startsWith\('Secretary'\) \|\| LEGACY_ASSISTANT_SETTING_KEYS\.has\(key\)\)\s*$/,
  /^\s*\/\/ Never echo the removed values: they may include a relay token,\s*$/
]

const currentDocs = new Set([
  'AGENTS.md', 'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md',
  'CONTRIBUTING.zh-CN.md', 'SECURITY.md', 'SECURITY.zh-CN.md', 'SUPPORT.md',
  'SUPPORT.zh-CN.md', 'PRIVACY.md', 'PRIVACY.zh-CN.md', 'CHANGELOG.md',
  'docs/HANDOFF.md', 'docs/ARCHITECTURE.md', 'docs/RELEASE.md',
  'docs/INSTALLER.md', 'docs/DOCS-MAINTENANCE.md', 'docs/TROUBLESHOOTING.md',
  'docs/TROUBLESHOOTING.zh-CN.md'
])

const findings = []
const files = publicFiles()
const fileSet = new Set(files)

for (const required of requiredFiles) {
  if (!fileSet.has(required)) add(required, 1, 'required-file-missing')
}

for (const forbidden of forbiddenPaths) {
  for (const file of files) {
    if (file === forbidden || file.startsWith(forbidden)) add(file, 1, 'release-only-artifact')
  }
}

for (const file of files) {
  if (isRemovedAssistantRuntimePath(file)) add(file, 1, 'removed-assistant-runtime')
}

for (const file of files) {
  if (file === self) continue
  const absolute = join(root, file)
  const stats = statSync(absolute)
  const allowedBinary = allowedBinaryFiles.has(file)
  const blockedCategory = publicArtifactCategory(file)

  if (blockedCategory && !allowedBinary) {
    add(file, 1, blockedCategory)
    continue
  }

  if (stats.size > maxTextBytes) {
    if (!allowedBinary) add(file, 1, 'oversized-unreviewed-file')
    continue
  }

  const buffer = readFileSync(absolute)
  if (buffer.includes(0)) {
    if (!allowedBinary) add(file, 1, 'unreviewed-binary-file')
    continue
  }
  const text = buffer.toString('utf8')
  const lines = text.split(/\r?\n/)

  lines.forEach((line, index) => {
    const lineNumber = index + 1
    if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(line)) add(file, lineNumber, 'private-key')
    if (/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,})\b/.test(line)) add(file, lineNumber, 'credential-token')
    if (/\b(?:token|password|passwd|secret|api[_-]?key|private[_-]?key)\b\s*[:=]\s*["'][^"']{8,}["']/i.test(line) && !/example|placeholder|redacted|<[^>]+>/i.test(line)) add(file, lineNumber, 'credential-assignment')
    const genericPathExample = /<user>|<distro>|\$\{|Users[\\/]Example\b/i.test(line)
    if (!genericPathExample && /[A-Za-z]:[\\/]Users[\\/](?!Example\b|Public\b|Default\b|USERNAME\b|<user>\b)[^\\/\s"']+/i.test(line)) add(file, lineNumber, 'personal-home-path')
    if (!genericPathExample && /\/(?:home|Users)\/(?!example\b|runner\b|root\b|<user>\b)[A-Za-z0-9._-]+/.test(line)) add(file, lineNumber, 'personal-home-path')
    if (!genericPathExample && /\\\\wsl(?:\.localhost|\$)\\[^\\\s]+\\home\\[^\\\s"']+/i.test(line)) add(file, lineNumber, 'personal-home-path')
    if (/(?:[A-Za-z]:[\\/]Save[\\/]|\/(?:mnt\/(?:win-[cde]|[cde])|media)\/[^\s"']+)/i.test(line)) add(file, lineNumber, 'local-project-path')
    if (/\.(?:ssh)[\\/](?:id_[A-Za-z0-9_-]+|config)\b/i.test(line)) add(file, lineNumber, 'ssh-local-path')
    if (/\b(?:openclaw)\b/i.test(line)) add(file, lineNumber, 'known-local-identifier')

    if (
      isActiveRuntimeFile(file) &&
      /(?:secretary|relay)/i.test(line) &&
      !isAllowedLegacyAssistantScrubLine(file, line)
    ) {
      add(file, lineNumber, 'removed-assistant-runtime')
    }

    for (const match of line.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
      if (!isAllowedIp(match[0]) && !isVersionTuple(line, match.index ?? 0)) {
        add(file, lineNumber, 'ip-address')
      }
    }
    for (const match of line.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi)) {
      if (!file.endsWith('package-lock.json') && !isThirdPartyNotice(file) && !isAllowedEmailDomain(match[1])) add(file, lineNumber, 'email-address')
    }

    if (currentDocs.has(file) && /\b(?:assistant|secretary|relay)\b|助理|秘书/i.test(line)) {
      add(file, lineNumber, 'removed-feature-in-current-docs')
    }
  })
}

verifyVersions()
verifyJson()
verifyMarkdownLinks()

const unique = [...new Map(findings.map((item) => [`${item.file}:${item.line}:${item.category}`, item])).values()]
  .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.category.localeCompare(b.category))

if (unique.length > 0) {
  for (const item of unique) console.error(`${item.file}:${item.line} ${item.category}`)
  console.error(`Public-tree verification failed with ${unique.length} finding(s). Values are intentionally redacted.`)
  process.exit(1)
}

console.log(`Public-tree verification passed (${files.length} files checked; sensitive values never printed).`)

function publicFiles() {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    console.error('Public-tree verification could not enumerate Git publication candidates.')
    process.exit(1)
  }
  return [...new Set(result.stdout.split('\0').filter(Boolean))]
    .filter((file) => existsSync(join(root, file)))
    .sort()
}

function publicArtifactCategory(file) {
  const basename = file.split('/').at(-1)?.toLowerCase() ?? ''
  const extension = extname(basename)
  if (basename === '.env' || basename.startsWith('.env.')) return 'environment-file'
  if (imageExtensions.has(extension)) return 'unapproved-public-image'
  if (archiveExtensions.has(extension)) return 'unapproved-public-archive'
  if (diagnosticExtensions.has(extension)) return 'unapproved-diagnostic-artifact'
  if (secretMaterialExtensions.has(extension)) return 'secret-material-file'
  if (extension === '.map') return 'unapproved-source-map'
  if (generatedBinaryExtensions.has(extension)) return 'unapproved-public-binary'
  return null
}

function isActiveRuntimeFile(file) {
  return removedAssistantRuntimeRoots.some((prefix) => file.startsWith(prefix))
}

function isRemovedAssistantRuntimePath(file) {
  if (!isActiveRuntimeFile(file)) return false
  const relativeRuntimePath = file.slice(file.indexOf('/') + 1)
  return /(?:secretary|relay)/i.test(relativeRuntimePath)
}

function isAllowedLegacyAssistantScrubLine(file, line) {
  return file === legacyAssistantScrubFile &&
    allowedLegacyAssistantScrubLines.some((pattern) => pattern.test(line))
}

function isAllowedIp(value) {
  const octets = value.split('.').map(Number)
  if (octets.some((part) => part > 255)) return true
  return octets[0] === 127 || value === '0.0.0.0' ||
    (octets[0] === 192 && octets[1] === 0 && octets[2] === 2) ||
    (octets[0] === 198 && octets[1] === 51 && octets[2] === 100) ||
    (octets[0] === 203 && octets[1] === 0 && octets[2] === 113)
}

function isVersionTuple(line, index) {
  return /\bversion\s*=\s*["']?$/i.test(line.slice(Math.max(0, index - 48), index))
}

function isAllowedEmailDomain(domain) {
  const normalized = domain.toLowerCase()
  return normalized.endsWith('.example') || ['example.com', 'example.org', 'example.net', 'example.invalid', 'fsf.org', 'users.noreply.github.com'].includes(normalized)
}

function isThirdPartyNotice(file) {
  return file === 'THIRD_PARTY_NOTICES.md' ||
    file === 'app/resources/legal/THIRD_PARTY_NOTICES.md' ||
    /^app\/resources\/legal\/THIRD_PARTY_NOTICES-\d+\.\d+\.\d+\.md$/.test(file)
}

function verifyVersions() {
  const packageFiles = ['app/package.json', 'app/package-lock.json']
  let expectedVersion

  try {
    const authority = JSON.parse(readFileSync(join(root, 'app/package.json'), 'utf8'))
    expectedVersion = authority.version
    if (typeof expectedVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(expectedVersion)) {
      add('app/package.json', 1, 'release-version-invalid')
      return
    }
  } catch {
    add('app/package.json', 1, 'json-parse-error')
    return
  }

  for (const file of packageFiles) {
    try {
      const value = JSON.parse(readFileSync(join(root, file), 'utf8'))
      if (value.version !== expectedVersion) add(file, 1, 'release-version-mismatch')
      if (file.endsWith('package-lock.json') && value.packages?.['']?.version !== expectedVersion) {
        add(file, 1, 'lock-root-version-mismatch')
      }
    } catch {
      add(file, 1, 'json-parse-error')
    }
  }
}

function verifyJson() {
  for (const file of files.filter((item) => item.endsWith('.json'))) {
    try {
      JSON.parse(readFileSync(join(root, file), 'utf8'))
    } catch {
      add(file, 1, 'json-parse-error')
    }
  }
}

function verifyMarkdownLinks() {
  for (const file of files.filter((item) => (item.endsWith('.md') && !item.startsWith('archive/')) || item === 'settings/README.md')) {
    const text = readFileSync(join(root, file), 'utf8')
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].trim().replace(/^<|>$/g, '')
      if (!target || target.startsWith('#') || /^(?:https?:|mailto:)/i.test(target)) continue
      target = target.split('#')[0]
      const line = text.slice(0, match.index).split(/\r?\n/).length
      try {
        const resolved = relative(root, resolve(dirname(join(root, file)), decodeURIComponent(target))).replaceAll('\\', '/')
        if (!existsSync(join(root, resolved))) add(file, line, 'broken-relative-link')
      } catch {
        add(file, line, 'broken-relative-link')
      }
    }
  }
}

function add(file, line, category) {
  findings.push({ file, line, category })
}
