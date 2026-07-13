const assert = require('node:assert/strict')
const test = require('node:test')
const { closeZincWithPolicy } = require('../lib/zinc-close')

test('does nothing when Zinc is not running', async () => {
  const calls = []
  const result = await closeZincWithPolicy({}, {}, dependencies({ running: [false], calls }))
  assert.deepEqual(result, { closed: true, method: 'not-running' })
  assert.deepEqual(calls, ['isRunning'])
})

test('uses the normal second-instance quit path when it succeeds', async () => {
  const calls = []
  const result = await closeZincWithPolicy(
    { exePath: 'Zinc.exe' },
    { interactive: true },
    dependencies({ running: [true], graceful: true, calls })
  )
  assert.deepEqual(result, { closed: true, method: 'graceful' })
  assert.deepEqual(calls, ['isRunning', 'requestGracefulExit', 'waitForExit'])
})

test('asks the interactive UI before a timed-out force close', async () => {
  const calls = []
  const result = await closeZincWithPolicy(
    {},
    { interactive: true },
    dependencies({ running: [true], graceful: false, calls })
  )
  assert.deepEqual(result, { requiresForceCloseConfirmation: true })
  assert.equal(calls.includes('forceCloseProcess'), false)
})

test('honors explicit force-close confirmation and verifies termination', async () => {
  const calls = []
  const result = await closeZincWithPolicy(
    {},
    { interactive: true, forceClose: true },
    dependencies({ running: [true, false], calls })
  )
  assert.deepEqual(result, { closed: true, method: 'forced' })
  assert.deepEqual(calls, ['isRunning', 'forceCloseProcess', 'isRunning'])
})

test('headless upgrade falls back for an older app that cannot quit gracefully', async () => {
  const calls = []
  const result = await closeZincWithPolicy(
    {},
    { interactive: false },
    dependencies({ running: [true, false], graceful: false, calls })
  )
  assert.deepEqual(result, { closed: true, method: 'forced-fallback' })
  assert.deepEqual(calls, ['isRunning', 'requestGracefulExit', 'waitForExit', 'forceCloseProcess', 'isRunning'])
})

test('fails rather than installing over a process that survived force-close', async () => {
  await assert.rejects(
    closeZincWithPolicy({}, { forceClose: true }, dependencies({ running: [true, true], calls: [] })),
    /still running/
  )
})

function dependencies({ running, graceful = false, calls }) {
  return {
    async isRunning() {
      calls.push('isRunning')
      return running.length > 1 ? running.shift() : running[0]
    },
    async requestGracefulExit() {
      calls.push('requestGracefulExit')
    },
    async waitForExit() {
      calls.push('waitForExit')
      return graceful
    },
    async forceCloseProcess() {
      calls.push('forceCloseProcess')
    }
  }
}
