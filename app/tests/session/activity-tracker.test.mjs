import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-activity-'))
const outfile = join(outDir, 'activityTracker.mjs')
buildSync({ entryPoints: [join(root, 'src/main/pty/activityTracker.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
const { createActivityScanner, createActivityTracker, createCoalescedEmitter, PROBE_REPLY, STALE_AFTER_MS } = await import(pathToFileURL(outfile).href)
test.after(() => rmSync(outDir, { recursive: true, force: true }))

const ESC = '\u001b'
const BEL = '\u0007'
const report = (fields, end = BEL) => `${ESC}]7501;${fields}${end}`
const title = (text, end = BEL) => `${ESC}]0;${text}${end}`

function scan(chunks) {
  const events = []
  const feed = createActivityScanner((e) => events.push(e))
  for (const chunk of chunks) feed(chunk)
  return events
}

function tracker(precise = true) {
  const changes = []
  const writes = []
  const t = createActivityTracker({ precise, reply: (d) => writes.push(d), onChange: (a) => changes.push(a) })
  return { t, changes, writes }
}

test('scanner reads reports with BEL and ST terminators and ignores unknown fields', () => {
  const events = scan([
    report('state=working:app=claude-code:title=SGk=:msg=V3JpdGluZw==:progress=3:future=1'),
    report('state=blocked:app=claude-code:kind=permission', `${ESC}\\`)
  ])
  assert.deepEqual(events, [
    { type: 'report', state: 'working' },
    { type: 'report', state: 'blocked', kind: 'permission' }
  ])
})

test('scanner reassembles a sequence split at every possible byte', () => {
  const whole = `plain ${report('state=done:app=claude-code', `${ESC}\\`)} tail`
  for (let cut = 1; cut < whole.length; cut++) {
    assert.deepEqual(scan([whole.slice(0, cut), whole.slice(cut)]), [{ type: 'report', state: 'done' }], `cut at ${cut}`)
  }
})

test('scanner drops invalid states, id-carrying sub-agent records and unknown kinds', () => {
  const events = scan([
    report('state=exploding:app=claude-code'),
    report('app=claude-code'),
    report('state=working:app=claude-code:id=agent-1'),
    report('state=blocked:app=claude-code:kind=bogus')
  ])
  assert.deepEqual(events, [{ type: 'report', state: 'blocked' }])
})

test('scanner drops an over-long sequence without losing the next one', () => {
  const huge = `${ESC}]7501;state=working:msg=${'A'.repeat(5000)}${BEL}`
  assert.deepEqual(scan([huge + report('state=idle:app=claude-code')]), [{ type: 'report', state: 'idle' }])
  // Same when the long sequence arrives in pieces and never completes within the cap.
  const events = scan([`${ESC}]7501;state=working:msg=${'A'.repeat(3000)}`, 'B'.repeat(3000), BEL + report('state=done')])
  assert.deepEqual(events, [{ type: 'report', state: 'done' }])
})

test('scanner skips chunks without an OSC introducer and keeps a trailing ESC', () => {
  assert.deepEqual(scan(['hello\r\n', 'world \u001b[31mred\u001b[0m']), [])
  assert.deepEqual(scan([`x${ESC}`, `]7501;?${BEL}`]), [{ type: 'probe' }])
})

test('scanner aborts an OSC that is interrupted by another escape sequence', () => {
  assert.deepEqual(scan([`${ESC}]0;half${ESC}[31m ${report('state=idle')}`]), [{ type: 'report', state: 'idle' }])
})

test('probe is answered with the fixed capability string only in precise mode', () => {
  const on = tracker(true)
  on.t.feed(`${ESC}]7501;?${BEL}`)
  assert.deepEqual(on.writes, [PROBE_REPLY])
  const off = tracker(false)
  off.t.feed(`${ESC}]7501;?${BEL}`)
  assert.deepEqual(off.writes, [])
})

test('probe reply never echoes program-supplied text', () => {
  const { t, writes } = tracker(true)
  t.feed(`${ESC}]7501;?:app=EVIL-PAYLOAD:id=EVIL-PAYLOAD${BEL}`)
  assert.equal(writes.length, 1)
  assert.ok(!writes[0].includes('EVIL'))
})

test('7501 reports drive idle -> working -> waiting(kind) -> working -> done -> shell', () => {
  const { t, changes } = tracker()
  t.feed(report('state=idle:app=claude-code'))
  t.feed(report('state=working:app=claude-code'))
  t.feed(report('state=blocked:app=claude-code:kind=question'))
  t.feed(report('state=working:app=claude-code'))
  t.feed(report('state=done:app=claude-code'))
  t.feed(report('state=clear:app=claude-code'))
  assert.deepEqual(changes, [
    { state: 'idle' }, { state: 'working' }, { state: 'waiting', kind: 'question' },
    { state: 'working' }, { state: 'done' }, { state: 'shell' }
  ])
})

test('blocked without a kind is still waiting; repeated identical reports do not re-notify', () => {
  const { t, changes } = tracker()
  t.feed(report('state=blocked:app=claude-code'))
  t.feed(report('state=blocked:app=claude-code'))
  assert.deepEqual(changes, [{ state: 'waiting' }])
})

test('done stays until the tab is seen, then becomes idle; seen is a no-op otherwise', () => {
  const { t, changes } = tracker()
  t.markSeen()
  t.feed(report('state=working'))
  t.markSeen()
  t.feed(report('state=done'))
  assert.equal(t.current().state, 'done')
  t.markSeen()
  assert.deepEqual(changes, [{ state: 'working' }, { state: 'done' }, { state: 'idle' }])
})

test('title fallback: star is idle, spinner glyphs are working, the star after a spinner is done', () => {
  const { t, changes } = tracker(false)
  t.feed(title('✳ Claude Code'))
  t.feed(title('◐ Fix the build'))
  t.feed(title('◑ Fix the build'))
  t.feed(title('⠋ Thinking'))
  t.feed(title('✳ Claude Code'))
  t.feed(title('✳ Fix the build')) // repeated star titles do not downgrade done
  assert.deepEqual(changes, [{ state: 'idle' }, { state: 'working' }, { state: 'done' }])
  t.markSeen()
  t.feed(title('✳ Claude Code'))
  assert.equal(t.current().state, 'idle')
})

test('title fallback: a non-Claude title after the tool exits clears the status', () => {
  const { t, changes } = tracker(false)
  t.feed(title('✳ Claude Code'))
  t.feed(title('pwsh'))
  t.feed(title('pwsh'))
  assert.deepEqual(changes, [{ state: 'idle' }, { state: 'shell' }])
})

test('title fallback never overrides a tab that has produced a 7501 report', () => {
  const { t, changes } = tracker(true)
  t.feed(report('state=idle'))
  t.feed(title('◐ spinning'))
  t.feed(title('plain'))
  assert.deepEqual(changes, [{ state: 'idle' }])
})

test('a plain-shell title does not disturb a state that did not come from a title', () => {
  const { t, changes } = tracker()
  t.feed(report('state=working'))
  t.feed(title('some title'))
  assert.deepEqual(changes, [{ state: 'working' }])
})

test('exit: code 0 is exited, non-zero is error, and nothing changes afterwards', () => {
  const ok = tracker()
  ok.t.feed(report('state=working'))
  ok.t.exited(0)
  ok.t.feed(report('state=idle'))
  assert.deepEqual(ok.changes, [{ state: 'working' }, { state: 'exited' }])
  const bad = tracker()
  bad.t.exited(3)
  assert.deepEqual(bad.changes, [{ state: 'error' }])
})

test('staleness: working/waiting with no AI tool for more than 5s resets to shell', () => {
  const { t, changes } = tracker()
  t.feed(report('state=working'))
  assert.equal(t.needsStaleCheck(), true)
  t.checkStale(true, 0)
  t.checkStale(false, 1000)
  t.checkStale(false, 1000 + STALE_AFTER_MS) // exactly 5s gone: not yet
  assert.equal(t.current().state, 'working')
  t.checkStale(false, 1001 + STALE_AFTER_MS)
  assert.equal(t.current().state, 'shell')
  assert.equal(t.needsStaleCheck(), false)
  assert.deepEqual(changes, [{ state: 'working' }, { state: 'shell' }])
})

test('staleness: the tool coming back restarts the clock; idle and done are never reset by it', () => {
  const { t } = tracker()
  t.feed(report('state=blocked:kind=auth'))
  t.checkStale(false, 0)
  t.checkStale(true, 4000)
  t.checkStale(false, 8000)
  t.checkStale(false, 8000 + STALE_AFTER_MS)
  assert.equal(t.current().state, 'waiting')
  t.feed(report('state=done'))
  t.checkStale(false, 100000)
  t.checkStale(false, 200000)
  assert.equal(t.current().state, 'done')
})

test('coalesced emitter sends only the latest value, skips round trips and flushes on demand', async () => {
  const sent = []
  const emit = createCoalescedEmitter((a) => sent.push(a), 20)
  emit.push({ state: 'working' })
  emit.push({ state: 'done' })
  assert.deepEqual(sent, [])
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual(sent, [{ state: 'done' }])
  emit.push({ state: 'working' })
  emit.push({ state: 'done' }) // back to what was already delivered
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual(sent, [{ state: 'done' }])
  emit.push({ state: 'exited' })
  emit.flush()
  assert.deepEqual(sent, [{ state: 'done' }, { state: 'exited' }])
  emit.push({ state: 'error' })
  emit.dispose()
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(sent.length, 2)
})
