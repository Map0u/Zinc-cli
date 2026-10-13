/**
 * Drives the shipped pure rail helpers (label rules, id-based navigation, the
 * per-key store) - no reimplementation. Each module is transpiled on its own.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { transformSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)

function load(file) {
  const { code } = transformSync(readFileSync(join(root, 'src/renderer/src/tabs', file), 'utf8'), {
    loader: 'ts',
    format: 'cjs',
    target: 'node22'
  })
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', code)(module.exports, require, module)
  return module.exports
}

const { stripStatusGlyph, isGenericShellTitle, cwdBasename, resolveTabLabel, tabSecondaryText, showsPositionNumber } = load('tabLabel.ts')
const { railNavTarget, activeAfterClose } = load('tabNav.ts')
const { createKeyedStore } = load('keyedStore.ts')

test('status glyphs and spinners are stripped from Claude-style titles, other titles are kept', () => {
  assert.equal(stripStatusGlyph('\u2733 Claude Code'), 'Claude Code')
  assert.equal(stripStatusGlyph('\u25d0 Fix the rail'), 'Fix the rail')
  assert.equal(stripStatusGlyph('\u280b Thinking'), 'Thinking')
  assert.equal(stripStatusGlyph('\u273b\ufe0e Done'), 'Done')
  assert.equal(stripStatusGlyph('\u00b7 idle'), 'idle')
  // No glyph, glyph without a following space, or an emoji: untouched.
  assert.equal(stripStatusGlyph('Claude Code'), 'Claude Code')
  assert.equal(stripStatusGlyph('\u2733Claude'), '\u2733Claude')
  assert.equal(stripStatusGlyph('\ud83d\ude80 deploy'), '\ud83d\ude80 deploy')
  assert.equal(stripStatusGlyph('\u2733'), '\u2733')
})

test('exe paths and default shell names are generic, real titles are not', () => {
  assert.equal(isGenericShellTitle('C:\\Program Files\\PowerShell\\7\\pwsh.exe'), true)
  assert.equal(isGenericShellTitle('C:\\WINDOWS\\system32\\cmd.exe'), true)
  assert.equal(isGenericShellTitle('Administrator: C:\\Windows\\System32\\cmd.exe'), true)
  assert.equal(isGenericShellTitle('"C:\\Program Files\\Git\\bin\\bash.exe" --login'), true)
  assert.equal(isGenericShellTitle('pwsh.exe'), true)
  assert.equal(isGenericShellTitle('Windows PowerShell'), true)
  assert.equal(isGenericShellTitle('Git Bash', 'Git Bash'), true)
  assert.equal(isGenericShellTitle('   '), true)
  assert.equal(isGenericShellTitle('\u2733 Claude Code'), false)
  assert.equal(isGenericShellTitle('Fix bug in foo.exe parser'), false)
  assert.equal(isGenericShellTitle('user@host: ~/proj'), false)
})

test('cwdBasename handles both slash styles, trailing separators, drive and UNC roots', () => {
  assert.equal(cwdBasename('C:\\Projects\\Zinc'), 'Zinc')
  assert.equal(cwdBasename('C:\\Projects\\Zinc\\'), 'Zinc')
  assert.equal(cwdBasename('/work/repo/proj/'), 'proj')
  assert.equal(cwdBasename('C:\\'), 'C:')
  assert.equal(cwdBasename('\\\\server\\share'), 'share')
})

test('label order: rename, cleaned title, cwd folder, shell name', () => {
  const exe = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
  assert.deepEqual(resolveTabLabel({ customTitle: 'build', title: 'x', cwd: 'E:\\a' }), { label: 'build', source: 'custom' })
  assert.deepEqual(resolveTabLabel({ title: '\u2733 Fix the rail', cwd: 'E:\\a' }), { label: 'Fix the rail', source: 'title' })
  // An AI CLI's default title says nothing the folder does not say better.
  assert.deepEqual(resolveTabLabel({ title: '\u2733 Claude Code', cwd: 'E:\\a' }), { label: 'a', source: 'cwd' })
  assert.deepEqual(resolveTabLabel({ title: '\u2733 Claude Code' }), { label: 'Claude Code', source: 'title' })
  assert.deepEqual(resolveTabLabel({ title: exe, cwd: 'C:\\Projects\\Zinc' }), { label: 'Zinc', source: 'cwd' })
  assert.deepEqual(resolveTabLabel({ title: exe, shellLabel: 'PowerShell 7' }), { label: 'PowerShell 7', source: 'shell' })
  assert.deepEqual(resolveTabLabel({ shellLabel: 'cmd' }), { label: 'cmd', source: 'shell' })
  assert.deepEqual(resolveTabLabel({}), { label: 'PowerShell', source: 'shell' })
  // A title that is only a status glyph (Claude's working title is a bare ◐ / ◑) never becomes the label.
  assert.deepEqual(resolveTabLabel({ title: '\u25d0', cwd: 'E:\\a' }), { label: 'a', source: 'cwd' })
  assert.deepEqual(resolveTabLabel({ title: '\u25d1', shellLabel: 'cmd' }), { label: 'cmd', source: 'shell' })
})

test('secondary text only says what the label does not', () => {
  const base = { projectName: 'zinc', tool: 'claude' }
  assert.equal(tabSecondaryText({ label: 'PowerShell', source: 'shell', ...base }), undefined)
  // Folder label: project when it differs, then the tool.
  assert.equal(tabSecondaryText({ label: 'zinc', source: 'cwd', ...base }), 'Claude')
  assert.equal(tabSecondaryText({ label: 'src', source: 'cwd', ...base }), 'zinc \u00b7 Claude')
  assert.equal(tabSecondaryText({ label: 'src', source: 'cwd', projectName: 'zinc', tool: null }), 'zinc')
  assert.equal(tabSecondaryText({ label: 'zinc', source: 'cwd', projectName: 'zinc', tool: null }), undefined)
  // Renamed / AI-titled: the project, else the tool, and never a tool the label already names.
  assert.equal(tabSecondaryText({ label: 'Fix the rail', source: 'title', ...base }), 'zinc')
  assert.equal(tabSecondaryText({ label: 'Fix the rail', source: 'title', projectName: null, tool: 'claude' }), 'Claude')
  assert.equal(tabSecondaryText({ label: 'Claude Code', source: 'title', projectName: null, tool: 'claude' }), undefined)
})

test('the position number fills the slot only for a plain, unnamed row without a status icon', () => {
  assert.equal(showsPositionNumber('shell', 'shell'), true)
  assert.equal(showsPositionNumber('shell', 'idle'), true)
  for (const state of ['working', 'waiting', 'done', 'error', 'exited']) assert.equal(showsPositionNumber('shell', state), false)
  for (const source of ['custom', 'title', 'cwd']) assert.equal(showsPositionNumber(source, 'shell'), false)
})

test('rail navigation works on ids in visible order and wraps', () => {
  const ids = ['a', 'b', 'c']
  assert.equal(railNavTarget(ids, 'a', 'ArrowDown'), 'b')
  assert.equal(railNavTarget(ids, 'c', 'ArrowDown'), 'a')
  assert.equal(railNavTarget(ids, 'a', 'ArrowUp'), 'c')
  assert.equal(railNavTarget(ids, 'b', 'ArrowRight'), 'c')
  assert.equal(railNavTarget(ids, 'b', 'ArrowLeft'), 'a')
  assert.equal(railNavTarget(ids, 'b', 'Home'), 'a')
  assert.equal(railNavTarget(ids, 'b', 'End'), 'c')
  assert.equal(railNavTarget(ids, 'zzz', 'ArrowDown'), null)
  assert.equal(railNavTarget([], 'a', 'Home'), null)
})

test('closing the active tab picks the next tab, else the previous; background closes keep the active tab', () => {
  const ids = ['a', 'b', 'c', 'd']
  assert.equal(activeAfterClose(ids, 'b', 'b'), 'c')
  assert.equal(activeAfterClose(ids, 'a', 'a'), 'b')
  assert.equal(activeAfterClose(ids, 'd', 'd'), 'c')
  assert.equal(activeAfterClose(ids, 'a', 'c'), 'c')
  assert.equal(activeAfterClose(['a'], 'a', 'a'), null)
  assert.equal(activeAfterClose(ids, 'gone', 'b'), 'b')
})

test('keyed store notifies only the key that changed and skips equal writes', () => {
  const store = createKeyedStore((a, b) => a.state === b.state)
  const seen = { a: 0, b: 0 }
  const offA = store.subscribe('a', () => seen.a++)
  store.subscribe('b', () => seen.b++)
  store.set('a', { state: 'working' })
  store.set('a', { state: 'working' })
  assert.deepEqual(seen, { a: 1, b: 0 })
  assert.equal(store.get('a').state, 'working')
  assert.equal(store.get('missing'), undefined)
  store.set('a', { state: 'done' })
  assert.deepEqual(seen, { a: 2, b: 0 })
  store.delete('a')
  assert.equal(store.get('a'), undefined)
  assert.deepEqual(seen, { a: 3, b: 0 })
  store.delete('a')
  assert.equal(seen.a, 3)
  offA()
  store.set('a', { state: 'idle' })
  assert.equal(seen.a, 3)
})
