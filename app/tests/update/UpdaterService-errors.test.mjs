import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'

class FakeUpdater extends EventEmitter {
  reset() {
    this.removeAllListeners()
    this.checkCalls = 0
    this.downloadCalls = 0
    this.installCalls = 0
    this.checkFailure = null
    this.autoDownloadFailure = null
    this.downloadFailure = null
    this.installFailure = null
  }

  async checkForUpdates() {
    this.checkCalls += 1
    if (this.checkFailure !== null) throw this.checkFailure
    if (this.autoDownloadFailure !== null) {
      return { downloadPromise: Promise.reject(this.autoDownloadFailure) }
    }
  }

  async downloadUpdate() {
    this.downloadCalls += 1
    if (this.downloadFailure !== null) throw this.downloadFailure
  }

  quitAndInstall() {
    this.installCalls += 1
    if (this.installFailure !== null) throw this.installFailure
  }
}

const fakeApp = { isPackaged: true, getVersion: () => '0.5.0' }
const fakeUpdater = new FakeUpdater()
globalThis.__zincUpdaterTestApp = fakeApp
globalThis.__zincUpdaterTestInstance = fakeUpdater

const result = await build({
  entryPoints: [fileURLToPath(new URL('../../src/main/services/UpdaterService.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [{
    name: 'updater-error-test-doubles',
    setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test-double' }))
      builder.onResolve({ filter: /^electron-updater$/ }, () => ({ path: 'electron-updater', namespace: 'test-double' }))
      builder.onLoad({ filter: /^electron$/, namespace: 'test-double' }, () => ({
        contents: 'export const app = globalThis.__zincUpdaterTestApp; export class BrowserWindow {}',
        loader: 'js'
      }))
      builder.onLoad({ filter: /^electron-updater$/, namespace: 'test-double' }, () => ({
        contents: 'export const autoUpdater = globalThis.__zincUpdaterTestInstance;',
        loader: 'js'
      }))
    }
  }]
})
const { UpdaterService } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)

test.beforeEach(() => {
  fakeApp.isPackaged = true
  fakeUpdater.reset()
})

test('check returns a diagnostic error state on rejection without an error event and can retry', async () => {
  const pushed = []
  const service = new UpdaterService((state) => pushed.push(state))
  fakeUpdater.checkFailure = new Error('check failed offline')

  const failed = await service.check()
  assert.equal(failed.status, 'error')
  assert.equal(failed.error, 'check failed offline')
  assert.equal(service.getState().error, 'check failed offline')
  assert.equal(pushed.at(-1).status, 'error')

  fakeUpdater.checkFailure = null
  await service.check()
  assert.equal(fakeUpdater.checkCalls, 2)
  assert.equal(service.getState().error, null)
})

test('auto-download rejection is observed after a successful check without an error event', async () => {
  const unhandled = []
  const onUnhandled = (error) => unhandled.push(error)
  process.on('unhandledRejection', onUnhandled)
  try {
    const service = new UpdaterService(() => {})
    fakeUpdater.autoDownloadFailure = new Error('auto-download failed')
    await service.check()
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(service.getState().status, 'error')
    assert.equal(service.getState().error, 'auto-download failed')
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('download returns an error state and clears stale progress on eventless rejection', async () => {
  const service = new UpdaterService(() => {})
  fakeUpdater.emit('update-available', { version: '0.5.1' })
  fakeUpdater.downloadFailure = 'download unavailable'

  const failed = await service.download()
  assert.equal(fakeUpdater.downloadCalls, 1)
  assert.equal(failed.status, 'error')
  assert.equal(failed.error, 'download unavailable')
  assert.equal(failed.percent, null)
  assert.equal(failed.bytesPerSecond, null)
})

test('install returns a diagnostic error state if quitAndInstall throws', () => {
  const pushed = []
  const service = new UpdaterService((state) => pushed.push(state))
  fakeUpdater.emit('update-downloaded', { version: '0.5.1' })
  fakeUpdater.installFailure = new Error('installer unavailable')

  const failed = service.install(null)
  assert.equal(fakeUpdater.installCalls, 1)
  assert.equal(failed.status, 'error')
  assert.equal(failed.error, 'installer unavailable')
  assert.equal(pushed.at(-1).status, 'error')
})

test('background check rejects silently into state without an unhandled rejection', async () => {
  const unhandled = []
  const onUnhandled = (error) => unhandled.push(error)
  process.on('unhandledRejection', onUnhandled)
  try {
    const service = new UpdaterService(() => {})
    fakeUpdater.checkFailure = new Error('background offline')
    service.startBackgroundCheck()
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(fakeUpdater.checkCalls, 1)
    assert.equal(service.getState().status, 'error')
    assert.equal(service.getState().error, 'background offline')
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('error event and rejected operation use the same state semantics', async () => {
  const service = new UpdaterService(() => {})
  fakeUpdater.emit('error', new Error('feed failed'))
  assert.equal(service.getState().error, 'feed failed')
  fakeUpdater.checkFailure = { message: 'check failed' }
  const failed = await service.check()
  assert.equal(failed.status, 'error')
  assert.equal(failed.error, 'check failed')
})
