import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repositoryRoot = dirname(appRoot)
const releaseRef = argument('--release-ref') ?? 'refs/remotes/origin/main'
const headRef = argument('--head-ref') ?? 'HEAD'
const packagePath = resolve(argument('--package') ?? join(appRoot, 'package.json'))
const tagName = process.env.GITHUB_REF_NAME
const refType = process.env.GITHUB_REF_TYPE

assert(refType === 'tag', `Release workflow must run from a tag, received GITHUB_REF_TYPE=${refType ?? '<unset>'}`)
assert(/^v\d+\.\d+\.\d+$/.test(tagName ?? ''), `Release tag is not strict semver: ${tagName ?? '<unset>'}`)

const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
assert(tagName === `v${pkg.version}`, `Tag ${tagName} does not match package version v${pkg.version}`)

const tagRef = `refs/tags/${tagName}`
assert(git(['cat-file', '-t', tagRef]) === 'tag', `Release tag ${tagName} must be annotated, not lightweight`)
const tagMessage = git(['for-each-ref', '--format=%(contents)', tagRef])
const expectedTagMessage = `chore(release): ${tagName}`
assert(tagMessage === expectedTagMessage, `Release tag message must be exactly: ${expectedTagMessage}`)
const taggedCommit = git(['rev-parse', `${tagRef}^{commit}`])
const checkoutCommit = git(['rev-parse', `${headRef}^{commit}`])
const approvedCommit = git(['rev-parse', `${releaseRef}^{commit}`])

assert(taggedCommit === checkoutCommit, `Checkout ${checkoutCommit} differs from tagged commit ${taggedCommit}`)
assert(taggedCommit === approvedCommit, `Tagged commit ${taggedCommit} is not the approved ${releaseRef} tip ${approvedCommit}`)

console.log(`Verified annotated ${tagName} at approved ${releaseRef} tip ${taggedCommit}.`)

function argument(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  assert(process.argv[index + 1], `${name} requires a value`)
  return process.argv[index + 1]
}

function git(args) {
  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  return result.stdout.trim()
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
