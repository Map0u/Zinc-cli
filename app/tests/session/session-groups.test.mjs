/**
 * Tab groups in the session pipeline: the renderer snapshot validator, what
 * SessionStateService writes and reads back, old session files, and unknown
 * extra fields in both directions.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync, transformSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-session-groups-'))

function bundle(entry, name) {
  const outfile = join(outDir, name)
  buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
  return pathToFileURL(outfile).href
}

const { SessionStateService } = await import(
  bundle(join(root, 'src/main/services/SessionStateService.ts'), 'SessionStateService.mjs')
)
const state = await import(bundle(join(root, 'src/shared/sessionState.ts'), 'sessionState.mjs'))
const { SessionTool, isValidRendererSnapshot, MAX_GROUP_NAME_LENGTH, MAX_SESSION_GROUPS, MAX_GROUP_KEY_LENGTH } = state

test.after(() => {
  rmSync(outDir, { recursive: true, force: true })
})

function tempSessionFile() {
  const dir = mkdtempSync(join(tmpdir(), 'zinc-session-groups-file-'))
  return { dir, filePath: join(dir, 'session-state.json') }
}

const group = (id, extra = {}) => ({ id, collapsed: false, auto: false, ...extra })

test('the group-name limit matches the model\'s', () => {
  const { code } = transformSync(readFileSync(join(root, 'src/renderer/src/tabs/tabGroups.ts'), 'utf8'), {
    loader: 'ts',
    format: 'cjs',
    target: 'node22'
  })
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', code)(module.exports, () => ({}), module)
  assert.equal(module.exports.MAX_GROUP_NAME_LENGTH, MAX_GROUP_NAME_LENGTH)
})

// ---------------------------------------------------------------------------
// validator

test('the validator still accepts every pre-group snapshot shape', () => {
  assert.equal(isValidRendererSnapshot({ tabs: [], activeIndex: -1 }), true)
  assert.equal(isValidRendererSnapshot({ tabs: [{ id: 'tab-1' }], activeIndex: 0 }), true)
  assert.equal(isValidRendererSnapshot({ tabs: [{ id: 'tab-1', shellId: 'pwsh', customTitle: 'x' }], activeIndex: 0 }), true)
  assert.equal(isValidRendererSnapshot({ tabs: [{ id: 'tab-1' }], activeIndex: 0, groups: [] }), true)
})

test('the validator accepts groups whose members name them and rejects every dangling or malformed case', () => {
  const ok = (tabs, groups, activeIndex = 0) => isValidRendererSnapshot({ tabs, activeIndex, groups })
  const tabs = [{ id: 'tab-1', groupId: 'grp-1', manual: true }, { id: 'tab-2', groupId: 'grp-1' }, { id: 'tab-3' }]
  assert.equal(ok(tabs, [group('grp-1', { name: 'Zinc', key: 'e:\\save\\zinc', auto: true, collapsed: true })]), true)
  assert.equal(ok(tabs, [group('grp-1'), group('grp-2')]), true, 'a listed group with no member is the normalizer\'s business')
  // Dangling member reference, or groups missing altogether.
  assert.equal(ok(tabs, [group('grp-2')]), false)
  assert.equal(ok(tabs, []), false)
  assert.equal(isValidRendererSnapshot({ tabs, activeIndex: 0 }), false)
  // Ids.
  assert.equal(ok([{ id: 'tab-1', groupId: 'a b' }], [group('a b')]), false)
  assert.equal(ok([{ id: 'tab-1' }], [group('')]), false)
  assert.equal(ok([{ id: 'tab-1' }], [group('x'.repeat(129))]), false)
  assert.equal(ok([{ id: 'tab-1' }], [group('x'.repeat(128))]), true)
  assert.equal(ok([{ id: 'tab-1' }], [group('grp-1'), group('grp-1')]), false, 'duplicate group ids')
  assert.equal(ok([{ id: 'tab-1', groupId: 7 }], [group('grp-1')]), false)
  // Names, flags, keys.
  assert.equal(ok([{ id: 'tab-1' }], [group('g', { name: 'x'.repeat(MAX_GROUP_NAME_LENGTH) })]), true)
  assert.equal(ok([{ id: 'tab-1' }], [group('g', { name: 'x'.repeat(MAX_GROUP_NAME_LENGTH + 1) })]), false)
  assert.equal(ok([{ id: 'tab-1' }], [group('g', { name: 5 })]), false)
  assert.equal(ok([{ id: 'tab-1' }], [group('g', { collapsed: 'no' })]), false)
  assert.equal(ok([{ id: 'tab-1' }], [{ id: 'g' }]), false, 'collapsed is required')
  assert.equal(ok([{ id: 'tab-1' }], [group('g', { auto: 1 })]), false)
  assert.equal(ok([{ id: 'tab-1' }], [{ id: 'g', collapsed: true }]), true, 'auto may be omitted')
  assert.equal(ok([{ id: 'tab-1' }], [group('g', { key: 'k'.repeat(MAX_GROUP_KEY_LENGTH + 1) })]), false)
  assert.equal(ok([{ id: 'tab-1', manual: 'yes' }], []), false)
  assert.equal(ok([{ id: 'tab-1' }], [null]), false)
  assert.equal(ok([{ id: 'tab-1' }], 'nope'), false)
})

test('the validator caps the number of groups', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => group(`grp-${i}`))
  assert.equal(isValidRendererSnapshot({ tabs: [{ id: 'tab-1' }], activeIndex: 0, groups: many(MAX_SESSION_GROUPS) }), true)
  assert.equal(isValidRendererSnapshot({ tabs: [{ id: 'tab-1' }], activeIndex: 0, groups: many(MAX_SESSION_GROUPS + 1) }), false)
})

test('the validator ignores unknown extra fields on the snapshot, tabs and groups', () => {
  const snapshot = {
    tabs: [{ id: 'tab-1', groupId: 'grp-1', pinned: true, future: { a: 1 } }],
    activeIndex: 0,
    groups: [{ id: 'grp-1', collapsed: false, auto: false, color: 'red' }],
    layout: 'tree'
  }
  assert.equal(isValidRendererSnapshot(snapshot), true)
})

// ---------------------------------------------------------------------------
// write

function persistWith(service, tabs, groups, dir) {
  return service.persist(tabs, 0, () => dir, () => { throw new Error('cheap persist must not scan tools') }, () => null, {
    scanTools: false,
    groups
  })
}

test('persist writes GroupId / Pinned / Groups, and leaves them out when nothing is grouped', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const service = new SessionStateService(filePath)
    const tabs = [
      { id: 'a', shellId: 'pwsh' },
      { id: 'b', shellId: 'pwsh', groupId: 'g1', manual: true },
      { id: 'c', shellId: 'pwsh', groupId: 'g1' }
    ]
    assert.equal(persistWith(service, tabs, [group('g1', { name: 'Zinc', collapsed: true, auto: true, key: 'e:\\z' }), group('unused')], dir), true)
    const written = JSON.parse(readFileSync(filePath, 'utf8'))
    assert.deepEqual(written.Groups, [{ Id: 'g1', Name: 'Zinc', Collapsed: true, Auto: true, Key: 'e:\\z' }])
    assert.equal('GroupId' in written.Tabs[0], false)
    assert.equal('Pinned' in written.Tabs[0], false)
    assert.deepEqual([written.Tabs[1].GroupId, written.Tabs[1].Pinned], ['g1', true])
    assert.deepEqual([written.Tabs[2].GroupId, 'Pinned' in written.Tabs[2]], ['g1', false])

    // No groups: the file has the shape it always had.
    const plain = tempSessionFile()
    const plainService = new SessionStateService(plain.filePath)
    assert.equal(persistWith(plainService, [{ id: 'a', shellId: 'pwsh' }], undefined, plain.dir), true)
    const old = JSON.parse(readFileSync(plain.filePath, 'utf8'))
    assert.deepEqual(Object.keys(old).sort(), ['ActiveIndex', 'Tabs'])
    assert.deepEqual(Object.keys(old.Tabs[0]).sort(), ['ShellId', 'Tool', 'WorkingDirectory'])
    rmSync(plain.dir, { recursive: true, force: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a group no tab names is not written; a group name with a bare collapsed flag is minimal', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const service = new SessionStateService(filePath)
    persistWith(service, [{ id: 'a', shellId: 'pwsh', groupId: 'g1' }], [group('g1', { collapsed: true }), group('ghost', { name: 'x' })], dir)
    assert.deepEqual(JSON.parse(readFileSync(filePath, 'utf8')).Groups, [{ Id: 'g1', Collapsed: true }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// round trip, old files, extra fields

test('round trip: persist, then load restores membership, order, names, collapsed state and pins', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const service = new SessionStateService(filePath)
    const tabs = [
      { id: 'a', shellId: 'pwsh' },
      { id: 'b', shellId: 'pwsh', groupId: 'g2', manual: true },
      { id: 'c', shellId: 'cmd', groupId: 'g2', customTitle: 'build' },
      { id: 'd', shellId: 'pwsh', groupId: 'g7' },
      { id: 'e', shellId: 'pwsh', groupId: 'g7' }
    ]
    const groups = [group('g2', { name: 'Back end', collapsed: true }), group('g7', { auto: true, key: 'e:\\zinc' })]
    assert.equal(persistWith(service, tabs, groups, dir), true)
    const payload = new SessionStateService(filePath).loadRestorePayload(true, false)
    assert.deepEqual(payload.tabs.map((t) => t.groupId), [undefined, 'g2', 'g2', 'g7', 'g7'])
    assert.deepEqual(payload.tabs.map((t) => t.manual), [undefined, true, undefined, undefined, undefined])
    assert.deepEqual(payload.tabs.map((t) => t.customTitle), [undefined, undefined, 'build', undefined, undefined])
    assert.deepEqual(payload.groups, [
      { id: 'g2', name: 'Back end', collapsed: true, auto: false },
      { id: 'g7', collapsed: false, auto: true, key: 'e:\\zinc' }
    ])
    assert.equal(payload.activeIndex, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a session file from before tab groups restores ungrouped and without a groups key', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const cwd = mkdtempSync(join(dir, 'old-'))
    writeFileSync(
      filePath,
      JSON.stringify({ Tabs: [{ WorkingDirectory: cwd, Tool: SessionTool.None, ShellId: 'pwsh' }, { WorkingDirectory: cwd, Tool: SessionTool.None }], ActiveIndex: 1 })
    )
    const payload = new SessionStateService(filePath).loadRestorePayload(true, true)
    assert.equal(payload.tabs.length, 2)
    assert.equal('groups' in payload, false)
    assert.ok(payload.tabs.every((t) => !('groupId' in t) && !('manual' in t)))
    assert.equal(payload.activeIndex, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unknown fields, dangling and malformed groups never block the restore', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const cwd = mkdtempSync(join(dir, 'x-'))
    const tab = (extra) => ({ WorkingDirectory: cwd, Tool: SessionTool.None, ...extra })
    writeFileSync(
      filePath,
      JSON.stringify({
        Tabs: [
          tab({ GroupId: 'g1', Pinned: true, Mood: 'calm' }),
          tab({ GroupId: 'ghost' }),
          tab({ GroupId: 5, Pinned: 'yes' }),
          tab({ GroupId: 'g1' })
        ],
        ActiveIndex: 0,
        Theme: 'future',
        Groups: [
          { Id: 'g1', Name: '  Zinc  ', Collapsed: 'maybe', Auto: true, Baz: 1 },
          { Id: 'g1', Name: 'dup' },
          { Id: 'bad id' },
          { Name: 'no id' },
          null,
          'junk',
          { Id: 'g2', Name: 'x'.repeat(MAX_GROUP_NAME_LENGTH + 50), Key: 'k'.repeat(MAX_GROUP_KEY_LENGTH + 1) }
        ]
      })
    )
    const payload = new SessionStateService(filePath).loadRestorePayload(true, true)
    assert.deepEqual(payload.tabs.map((t) => t.groupId), ['g1', undefined, undefined, 'g1'])
    assert.deepEqual(payload.tabs.map((t) => t.manual), [true, undefined, undefined, undefined])
    assert.equal(payload.groups.length, 2)
    assert.deepEqual(payload.groups[0], { id: 'g1', name: 'Zinc', collapsed: false, auto: true })
    assert.equal(payload.groups[1].id, 'g2')
    assert.equal(payload.groups[1].name.length, MAX_GROUP_NAME_LENGTH)
    assert.equal('key' in payload.groups[1], false, 'an oversized key is dropped')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Groups that is not an array, or too long, is tamed instead of failing', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const cwd = mkdtempSync(join(dir, 'x-'))
    const body = (Groups) => JSON.stringify({ Tabs: [{ WorkingDirectory: cwd, Tool: 0, GroupId: 'g0' }], ActiveIndex: 0, Groups })
    writeFileSync(filePath, body({ Id: 'g0' }))
    let payload = new SessionStateService(filePath).loadRestorePayload(true, false)
    assert.equal(payload.tabs.length, 1)
    assert.equal('groups' in payload, false)
    assert.equal(payload.tabs[0].groupId, undefined)
    writeFileSync(filePath, body(Array.from({ length: MAX_SESSION_GROUPS + 40 }, (_, i) => ({ Id: `g${i}` }))))
    payload = new SessionStateService(filePath).loadRestorePayload(true, false)
    assert.equal(payload.groups.length, MAX_SESSION_GROUPS)
    assert.equal(payload.tabs[0].groupId, 'g0')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('bound restored tabs keep their identities while groups ride along (indexes unchanged)', () => {
  const { dir, filePath } = tempSessionFile()
  try {
    const cwd = mkdtempSync(join(dir, 'x-'))
    writeFileSync(
      filePath,
      JSON.stringify({
        Tabs: [
          { WorkingDirectory: cwd, Tool: SessionTool.Claude, ShellId: 'pwsh', SessionId: 'aaaaaaaa-1111-4111-8111-111111111111', GroupId: 'g1' },
          { WorkingDirectory: cwd, Tool: SessionTool.None, ShellId: 'pwsh', GroupId: 'g1' }
        ],
        ActiveIndex: 0,
        Groups: [{ Id: 'g1', Name: 'Zinc' }]
      })
    )
    const service = new SessionStateService(filePath)
    const payload = service.loadRestorePayload(true, true)
    const fresh = [{ id: 'fresh-1', shellId: 'pwsh', groupId: 'n1' }, { id: 'fresh-2', shellId: 'pwsh', groupId: 'n1' }]
    service.bindRestoredTabs(fresh)
    assert.equal(persistWith(service, fresh, [group('n1', { name: 'Zinc' })], dir), true)
    const written = JSON.parse(readFileSync(filePath, 'utf8'))
    assert.equal(written.Tabs[0].SessionId, 'aaaaaaaa-1111-4111-8111-111111111111')
    assert.deepEqual(written.Groups, [{ Id: 'n1', Name: 'Zinc' }])
    assert.equal(payload.groups[0].id, 'g1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// an older Zinc reading a newer file

test('the release before tab groups reads a grouped session file and restores every tab', async (t) => {
  // Real old code: SessionStateService and its imports exactly as of the commit before groups.
  const before = '25ff462'
  const files = [
    'app/src/main/services/SessionStateService.ts',
    'app/src/main/services/atomicWrite.ts',
    'app/src/shared/sessionState.ts',
    'app/src/shared/sessionPersist.ts',
    'app/src/shared/aiCliTools.ts'
  ]
  const oldRoot = join(outDir, 'old-zinc')
  try {
    for (const file of files) {
      const text = execFileSync('git', ['show', `${before}:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      mkdirSync(dirname(join(oldRoot, file)), { recursive: true })
      writeFileSync(join(oldRoot, file), text)
    }
  } catch {
    t.skip(`commit ${before} is not available in this checkout`)
    return
  }
  const { SessionStateService: OldService } = await import(
    bundle(join(oldRoot, 'app/src/main/services/SessionStateService.ts'), 'OldSessionStateService.mjs')
  )
  const { dir, filePath } = tempSessionFile()
  try {
    const cwd = mkdtempSync(join(dir, 'x-'))
    const service = new SessionStateService(filePath)
    const tabs = [
      { id: 'a', shellId: 'pwsh' },
      { id: 'b', shellId: 'pwsh', groupId: 'g1', manual: true, customTitle: 'named' },
      { id: 'c', shellId: 'pwsh', groupId: 'g1' }
    ]
    persistWith(service, tabs, [group('g1', { name: 'Zinc', collapsed: true })], cwd)
    assert.ok(JSON.parse(readFileSync(filePath, 'utf8')).Groups, 'the new file does carry groups')
    const payload = new OldService(filePath).loadRestorePayload(true, false)
    assert.equal(payload.tabs.length, 3)
    assert.deepEqual(payload.tabs.map((x) => x.customTitle), [undefined, 'named', undefined])
    assert.deepEqual(payload.tabs.map((x) => x.cwd), [cwd, cwd, cwd])
    assert.equal(payload.activeIndex, 0)
    assert.equal('groups' in payload, false, 'the old reader simply never sees them')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
