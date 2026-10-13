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

const {
  stripStatusGlyph,
  isGenericShellTitle,
  cwdBasename,
  cwdRelativeToRoot,
  resolveTabLabel,
  tabSecondaryText,
  showsPositionNumber,
  groupOrdinals,
  withOrdinal
} = load('tabLabel.ts')
const { railNavTarget, railEntryTarget, activeAfterClose } = load('tabNav.ts')
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

// --- labels inside a group ---------------------------------------------------

const inGroup = { name: 'Zinc' }
const ROOT = 'C:\\Projects\\Zinc'

test('cwdRelativeToRoot: below the root only, short forward-slash form, case-insensitive on Windows paths', () => {
  assert.equal(cwdRelativeToRoot(ROOT + '\\src', ROOT), 'src')
  assert.equal(cwdRelativeToRoot(ROOT + '\\src\\main', ROOT), 'src/main')
  assert.equal(cwdRelativeToRoot(ROOT + '\\app\\src\\renderer\\src', ROOT), '\u2026/renderer/src')
  assert.equal(cwdRelativeToRoot('e:/save/zinc/APP/', ROOT + '\\'), 'APP')
  assert.equal(cwdRelativeToRoot(ROOT, ROOT), null)
  assert.equal(cwdRelativeToRoot(ROOT + '\\', ROOT), null)
  assert.equal(cwdRelativeToRoot('C:\\Projects\\ZincOther\\src', ROOT), null, 'a sibling that shares a prefix is not below the root')
  assert.equal(cwdRelativeToRoot('D:\\elsewhere', ROOT), null)
  assert.equal(cwdRelativeToRoot(ROOT + '\\src', ''), null)
})

test('group label chain: rename, informative title, relative cwd, tool, shell name', () => {
  const base = { cwd: ROOT, projectRoot: ROOT, tool: 'claude', shellLabel: 'PowerShell' }
  // 1. custom rename wins
  assert.deepEqual(resolveTabLabel({ ...base, customTitle: 'build', title: 'Fix the rail' }, inGroup), { label: 'build', source: 'custom' })
  // 2. a real topic from the terminal title
  assert.deepEqual(resolveTabLabel({ ...base, title: '\u2733 Fix the rail' }, inGroup), { label: 'Fix the rail', source: 'title' })
  // 3. cwd deeper than the project root
  assert.deepEqual(resolveTabLabel({ ...base, cwd: ROOT + '\\src\\main', title: '\u2733 Claude Code' }, inGroup), { label: 'src/main', source: 'cwd' })
  // 4. at the root with an AI tool: the tool name (a default AI title is no topic)
  assert.deepEqual(resolveTabLabel({ ...base, title: '\u2733 Claude Code' }, inGroup), { label: 'Claude', source: 'tool' })
  assert.deepEqual(resolveTabLabel({ ...base, title: '\u25d0' }, inGroup), { label: 'Claude', source: 'tool' })
  assert.deepEqual(resolveTabLabel({ ...base, tool: 'codex', title: undefined }, inGroup), { label: 'Codex', source: 'tool' })
  assert.deepEqual(resolveTabLabel({ ...base, tool: 'kimi' }, inGroup), { label: 'Kimi', source: 'tool' })
  // 5. at the root without a tool: the shell's own name
  assert.deepEqual(resolveTabLabel({ ...base, tool: null, title: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' }, inGroup), { label: 'PowerShell', source: 'shell' })
  assert.deepEqual(resolveTabLabel({ cwd: ROOT, projectRoot: ROOT, shellLabel: 'Git Bash' }, inGroup), { label: 'Git Bash', source: 'shell' })
})

test('group label: a cwd outside the root (or with no root) still tells the tab apart by its folder', () => {
  assert.deepEqual(resolveTabLabel({ cwd: 'D:\\other\\web', projectRoot: ROOT, tool: 'claude' }, inGroup), { label: 'web', source: 'cwd' })
  assert.deepEqual(resolveTabLabel({ cwd: 'C:\\Users\\me', projectRoot: null, shellLabel: 'PowerShell' }, inGroup), { label: 'me', source: 'cwd' })
  // Before any context arrives: nothing but the shell name (or the title).
  assert.deepEqual(resolveTabLabel({ shellLabel: 'PowerShell' }, inGroup), { label: 'PowerShell', source: 'shell' })
  assert.deepEqual(resolveTabLabel({ title: '\u2733 Claude Code', shellLabel: 'PowerShell' }, inGroup), { label: 'Claude Code', source: 'title' })
})

test('ungrouped rows ignore projectRoot / tool: the label chain is unchanged', () => {
  assert.deepEqual(resolveTabLabel({ cwd: ROOT, projectRoot: ROOT, tool: 'claude', title: '\u2733 Claude Code' }), { label: 'Zinc', source: 'cwd' })
  assert.deepEqual(resolveTabLabel({ cwd: ROOT + '\\src\\main', projectRoot: ROOT }), { label: 'main', source: 'cwd' })
  assert.deepEqual(resolveTabLabel({ tool: 'claude', shellLabel: 'PowerShell' }), { label: 'PowerShell', source: 'shell' })
})

test('group secondary text never repeats the group name', () => {
  const claudeAtRoot = { label: 'Claude', source: 'tool', projectName: 'Zinc', tool: 'claude' }
  assert.equal(tabSecondaryText(claudeAtRoot, inGroup), undefined, 'the label is the tool, the project is the group')
  assert.equal(tabSecondaryText(claudeAtRoot, { name: 'Work' }), 'Zinc', 'a differently named group keeps the project')
  assert.equal(tabSecondaryText({ label: 'src/main', source: 'cwd', projectName: 'Zinc', tool: 'claude' }, inGroup), 'Claude')
  assert.equal(tabSecondaryText({ label: 'src/main', source: 'cwd', projectName: 'Zinc', tool: 'claude' }, { name: 'zinc' }), 'Claude', 'case-insensitive')
  assert.equal(tabSecondaryText({ label: 'Fix the rail', source: 'title', projectName: 'Zinc', tool: 'claude' }, inGroup), 'Claude')
  assert.equal(tabSecondaryText({ label: 'Fix the rail', source: 'title', projectName: 'api', tool: 'claude' }, inGroup), 'api')
  assert.equal(tabSecondaryText({ label: 'build', source: 'custom', projectName: 'Zinc', tool: null }, inGroup), undefined)
  assert.equal(tabSecondaryText({ label: 'PowerShell', source: 'shell', projectName: 'Zinc', tool: null }, inGroup), undefined)
  // Ungrouped behaviour is untouched.
  assert.equal(tabSecondaryText({ label: 'Zinc', source: 'cwd', projectName: 'Zinc', tool: 'claude' }), 'Claude')
  assert.equal(tabSecondaryText({ label: 'Fix', source: 'title', projectName: 'Zinc', tool: 'claude' }), 'Zinc')
})

test('groupOrdinals numbers identical labels in tab order; the first stays plain', () => {
  assert.deepEqual(groupOrdinals([]), [])
  assert.deepEqual(groupOrdinals(['Claude', 'Claude', 'src', 'Claude']), [1, 2, 1, 3])
  assert.deepEqual(groupOrdinals(['a', 'b', 'c']), [1, 1, 1])
  assert.deepEqual(groupOrdinals(['x', 'X']), [1, 1], 'labels are compared as written')
  assert.equal(withOrdinal('Claude', 1), 'Claude')
  assert.equal(withOrdinal('Claude', 2), 'Claude 2')
  assert.equal(withOrdinal('Claude', 3), 'Claude 3')
})

test('a group of look-alike Claude tabs reads Claude, Claude 2, Claude 3 and keeps real topics', () => {
  const members = [
    { cwd: ROOT, projectRoot: ROOT, tool: 'claude', title: '\u2733 Claude Code' },
    { cwd: ROOT, projectRoot: ROOT, tool: 'claude', title: '\u25d0' },
    { cwd: ROOT + '\\app', projectRoot: ROOT, tool: 'claude', title: '\u2733 Claude Code' },
    { cwd: ROOT, projectRoot: ROOT, tool: 'claude', title: '\u2733 Fix the rail' },
    { cwd: ROOT, projectRoot: ROOT, tool: 'claude', title: '\u2733 Claude Code' }
  ]
  const labels = members.map((m) => resolveTabLabel(m, inGroup).label)
  assert.deepEqual(labels, ['Claude', 'Claude', 'app', 'Fix the rail', 'Claude'])
  assert.deepEqual(groupOrdinals(labels).map((n, i) => withOrdinal(labels[i], n)), ['Claude', 'Claude 2', 'app', 'Fix the rail', 'Claude 3'])
})

test('railEntryTarget walks tabs and group headers and wraps', () => {
  const entries = [
    { kind: 'tab', id: 'a' },
    { kind: 'group', id: 'g1' },
    { kind: 'group', id: 'g2' },
    { kind: 'tab', id: 'd' }
  ]
  const at = (current, key) => railEntryTarget(entries, current, key)
  assert.deepEqual(at({ kind: 'tab', id: 'a' }, 'ArrowDown'), { kind: 'group', id: 'g1' })
  assert.deepEqual(at({ kind: 'group', id: 'g1' }, 'ArrowDown'), { kind: 'group', id: 'g2' })
  assert.deepEqual(at({ kind: 'group', id: 'g2' }, 'ArrowUp'), { kind: 'group', id: 'g1' })
  assert.deepEqual(at({ kind: 'tab', id: 'd' }, 'ArrowDown'), { kind: 'tab', id: 'a' })
  assert.deepEqual(at({ kind: 'tab', id: 'a' }, 'ArrowUp'), { kind: 'tab', id: 'd' })
  assert.deepEqual(at({ kind: 'group', id: 'g2' }, 'Home'), { kind: 'tab', id: 'a' })
  assert.deepEqual(at({ kind: 'group', id: 'g1' }, 'End'), { kind: 'tab', id: 'd' })
  // A tab and a group that share an id are different stops; an unknown stop has no target.
  assert.equal(at({ kind: 'tab', id: 'g1' }, 'ArrowDown'), null)
  assert.equal(railEntryTarget([], { kind: 'tab', id: 'a' }, 'Home'), null)
})
