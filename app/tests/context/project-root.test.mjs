import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-project-root-'))
const outfile = join(outDir, 'ProjectRoot.mjs')
buildSync({ entryPoints: [join(root, 'src/main/services/ProjectRoot.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
const { createProjectRootResolver, projectNameOf } = await import(pathToFileURL(outfile).href)
test.after(() => rmSync(outDir, { recursive: true, force: true }))

// Everything lives under a fake home inside the OS temp dir, so a stray .git
// further up the real disk is only ever an ancestor of home - a boundary.
const home = join(outDir, 'home')
const dir = (...parts) => {
  const path = join(home, ...parts)
  mkdirSync(path, { recursive: true })
  return path
}
const make = (extra = {}) => createProjectRootResolver({ home, folders: [join(home, 'Desktop'), join(home, 'Downloads'), join(home, 'Documents')], ...extra })

test('a cwd inside a git repo resolves to the repo root, from any depth', () => {
  const repo = dir('code', 'alpha')
  mkdirSync(join(repo, '.git'))
  const deep = dir('code', 'alpha', 'src', 'ui', 'parts')
  const resolver = make()
  assert.equal(resolver.resolve(repo), repo)
  assert.equal(resolver.resolve(deep), repo)
  assert.equal(projectNameOf(resolver.resolve(deep)), 'alpha')
})

test('a .git file (worktree or submodule) marks a root as well', () => {
  const repo = dir('code', 'wt')
  writeFileSync(join(repo, '.git'), 'gitdir: ../elsewhere\n')
  assert.equal(make().resolve(dir('code', 'wt', 'pkg')), repo)
})

test('without a repo the project is the cwd itself', () => {
  const plain = dir('scratch', 'plain', 'x')
  assert.equal(make().resolve(plain), plain)
})

test('drive roots, home, its ancestors and the user folders are never projects', () => {
  const resolver = make()
  assert.equal(resolver.resolve(parse(home).root), null)
  assert.equal(resolver.resolve(dirname(home)), null)
  assert.equal(resolver.resolve(home), null)
  for (const name of ['Desktop', 'Downloads', 'Documents']) assert.equal(resolver.resolve(dir(name)), null)
  assert.equal(resolver.resolve(null), null)
  assert.equal(resolver.resolve(''), null)
})

test('a subfolder of a user folder is still a project', () => {
  const sub = dir('Desktop', 'sketch')
  assert.equal(make().resolve(sub), sub)
})

test('a dotfiles repo rooted at home does not swallow what is below it', () => {
  mkdirSync(join(home, '.git'), { recursive: true })
  const below = dir('notes', 'daily')
  const resolver = make()
  assert.equal(resolver.resolve(home), null)
  assert.equal(resolver.resolve(below), below)
  rmSync(join(home, '.git'), { recursive: true })
})

test('a real repo below home still wins over a dotfiles repo at home', () => {
  mkdirSync(join(home, '.git'), { recursive: true })
  const repo = dir('code', 'beta')
  mkdirSync(join(repo, '.git'))
  assert.equal(make().resolve(dir('code', 'beta', 'src')), repo)
  rmSync(join(home, '.git'), { recursive: true })
})

test('a repo rooted at an ancestor of home is ignored too', () => {
  const resolver = make({ home: dir('deep', 'user') })
  const parent = join(home, 'deep')
  mkdirSync(join(parent, '.git'), { recursive: true })
  const project = dir('deep', 'user', 'proj')
  assert.equal(resolver.resolve(project), project)
  assert.equal(resolver.resolve(parent), null)
})

test('repo lookups are cached briefly, then notice a new repo', () => {
  let clock = 1000
  const resolver = make({ now: () => clock })
  const folder = dir('code', 'late', 'src')
  const outer = join(home, 'code', 'late')
  assert.equal(resolver.resolve(folder), folder)
  mkdirSync(join(outer, '.git'))
  assert.equal(resolver.resolve(folder), folder, 'served from cache')
  clock += 11_000
  assert.equal(resolver.resolve(folder), outer)
})

test('paths differing only by case share one spelling on Windows', { skip: process.platform !== 'win32' }, () => {
  const repo = dir('code', 'Gamma')
  mkdirSync(join(repo, '.git'))
  const resolver = make()
  const first = resolver.resolve(join(repo, 'src'))
  const second = resolver.resolve(join(repo, 'src').toUpperCase())
  assert.equal(first, repo)
  assert.equal(second, first)
})
