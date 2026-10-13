/**
 * The shipped scheduler in `src/renderer/src/tabs/autoGroupSchedule.ts`, on a
 * fake clock: a 1.5 s trailing debounce, a 4 s cap under continuous changes,
 * and retries while the user is busy with the rail.
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
const { code } = transformSync(readFileSync(join(root, 'src/renderer/src/tabs/autoGroupSchedule.ts'), 'utf8'), {
  loader: 'ts',
  format: 'cjs',
  target: 'node22'
})
const module = { exports: {} }
// eslint-disable-next-line no-new-func
new Function('exports', 'require', 'module', code)(module.exports, require, module)
const { createAutoGroupScheduler, AUTO_GROUP_QUIET_MS, AUTO_GROUP_MAX_WAIT_MS, AUTO_GROUP_RETRY_MS } = module.exports

/** A manual clock: timers fire in time order when `advance` passes them. */
function fakeClock() {
  let time = 0
  let nextId = 1
  const timers = new Map()
  return {
    now: () => time,
    set(callback, ms) {
      const id = nextId++
      timers.set(id, { at: time + ms, callback })
      return id
    },
    clear: (id) => timers.delete(id),
    advance(ms) {
      const end = time + ms
      for (;;) {
        let due = null
        for (const [id, timer] of timers) if (timer.at <= end && (due === null || timer.at < timers.get(due).at)) due = id
        if (due === null) break
        const timer = timers.get(due)
        timers.delete(due)
        time = Math.max(time, timer.at)
        timer.callback()
      }
      time = end
    },
    get open() {
      return timers.size
    }
  }
}

test('the documented numbers', () => {
  assert.equal(AUTO_GROUP_QUIET_MS, 1500)
  assert.ok(AUTO_GROUP_MAX_WAIT_MS >= 3500 && AUTO_GROUP_MAX_WAIT_MS <= 4500)
})

test('runs once, 1.5 s after the last change', () => {
  const clock = fakeClock()
  const runs = []
  const scheduler = createAutoGroupScheduler(() => (runs.push(clock.now()), 'done'), clock)
  scheduler.poke()
  clock.advance(1000)
  scheduler.poke()
  clock.advance(1499)
  assert.deepEqual(runs, [])
  assert.equal(scheduler.pending, true)
  clock.advance(1)
  assert.deepEqual(runs, [2500])
  assert.equal(scheduler.pending, false)
  clock.advance(10_000)
  assert.deepEqual(runs, [2500], 'nothing more without another change')
})

test('a stream of changes cannot hold it back beyond the cap', () => {
  const clock = fakeClock()
  const runs = []
  const scheduler = createAutoGroupScheduler(() => (runs.push(clock.now()), 'done'), clock)
  for (let t = 0; t <= 6000; t += 500) {
    scheduler.poke()
    clock.advance(500)
  }
  assert.ok(runs.length >= 1)
  assert.equal(runs[0], AUTO_GROUP_MAX_WAIT_MS, 'first run at the cap, not after the stream ends')
  // The wait that follows starts counting from the next change.
  scheduler.cancel()
})

test('a blocked run is retried until it goes through, and is not forgotten', () => {
  const clock = fakeClock()
  let blocked = 3
  const runs = []
  const scheduler = createAutoGroupScheduler(
    () => {
      runs.push(clock.now())
      return blocked-- > 0 ? 'blocked' : 'done'
    },
    clock
  )
  scheduler.poke()
  clock.advance(AUTO_GROUP_QUIET_MS)
  assert.equal(runs.length, 1)
  assert.equal(scheduler.pending, true)
  clock.advance(AUTO_GROUP_RETRY_MS * 3)
  assert.equal(runs.length, 4)
  assert.equal(scheduler.pending, false)
  clock.advance(60_000)
  assert.equal(runs.length, 4)
})

test('a change while blocked runs again straight away (the cap has long passed) and stays blocked-safe', () => {
  const clock = fakeClock()
  let blocked = true
  let runs = 0
  const scheduler = createAutoGroupScheduler(() => (runs++, blocked ? 'blocked' : 'done'), clock)
  scheduler.poke()
  clock.advance(AUTO_GROUP_MAX_WAIT_MS + 1000)
  const before = runs
  scheduler.poke()
  clock.advance(0)
  assert.equal(runs, before + 1)
  blocked = false
  clock.advance(AUTO_GROUP_RETRY_MS)
  assert.equal(scheduler.pending, false)
})

test('cancel forgets a pending run and the next change starts a fresh quiet period', () => {
  const clock = fakeClock()
  const runs = []
  const scheduler = createAutoGroupScheduler(() => (runs.push(clock.now()), 'done'), clock)
  scheduler.poke()
  clock.advance(1000)
  scheduler.cancel()
  assert.equal(clock.open, 0)
  clock.advance(5000)
  assert.deepEqual(runs, [])
  scheduler.poke()
  clock.advance(AUTO_GROUP_QUIET_MS)
  assert.deepEqual(runs, [6000 + AUTO_GROUP_QUIET_MS])
})
