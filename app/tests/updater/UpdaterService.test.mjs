import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'

class FakeUpdater extends EventEmitter {
  reset() {
    this.removeAllListeners()
    this.autoDownload = true
    this.autoInstallOnAppQuit = true
    this.checkCalls = 0
    this.downloadCalls = 0
    this.installCalls = 0
  }

  async checkForUpdates() {
    this.checkCalls += 1
  }

  async downloadUpdate() {
    this.downloadCalls += 1
  }

  quitAndInstall() {
    this.installCalls += 1
  }
}

const fakeApp = { isPackaged: true, getVersion: () => '0.5.0' }
const fakeUpdater = new FakeUpdater()
globalThis.__zincUpdaterTestApp = fakeApp
globalThis.__zincUpdaterTestInstance = fakeUpdater

const serviceModule = await bundleService()
const { UpdaterService } = await import(`data:text/javascript;base64,${Buffer.from(serviceModule).toString('base64')}`)

test.beforeEach(() => {
  fakeApp.isPackaged = true
  fakeUpdater.reset()
})

test('tracks the complete available, download, and install lifecycle', async () => {
  const pushed = []
  const service = new UpdaterService((state) => pushed.push(state))

  assert.equal(fakeUpdater.autoDownload, false)
  assert.equal(fakeUpdater.autoInstallOnAppQuit, false)
  assert.equal(service.getState().status, 'idle')

  await service.check()
  assert.equal(fakeUpdater.checkCalls, 1)
  fakeUpdater.emit('update-available', { version: '0.5.1' })
  assert.equal(service.getState().status, 'available')
  assert.equal(service.getState().availableVersion, '0.5.1')

  await service.download()
  assert.equal(fakeUpdater.downloadCalls, 1)
  fakeUpdater.emit('download-progress', { percent: 48.5, bytesPerSecond: 2048 })
  assert.deepEqual(
    { status: service.getState().status, percent: service.getState().percent, bytesPerSecond: service.getState().bytesPerSecond },
    { status: 'downloading', percent: 48.5, bytesPerSecond: 2048 }
  )
  fakeUpdater.emit('update-downloaded', { version: '0.5.1' })
  assert.equal(service.getState().downloadedVersion, '0.5.1')

  const sent = []
  service.install({ isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } })
  assert.equal(fakeUpdater.installCalls, 1)
  assert.equal(sent[0][0], 'update:state')
  assert.ok(pushed.length >= 4)
})

test('reports no-update and error states without stale progress', () => {
  const service = new UpdaterService(() => {})
  fakeUpdater.emit('download-progress', { percent: 12, bytesPerSecond: 128 })
  fakeUpdater.emit('update-not-available', { version: '0.5.0' })
  assert.deepEqual(
    { status: service.getState().status, percent: service.getState().percent, bytesPerSecond: service.getState().bytesPerSecond },
    { status: 'not-available', percent: null, bytesPerSecond: null }
  )

  fakeUpdater.emit('error', new Error('network unavailable'))
  assert.equal(service.getState().status, 'error')
  assert.equal(service.getState().error, 'network unavailable')
})

test('keeps every updater action disabled in unpackaged builds', async () => {
  fakeApp.isPackaged = false
  const service = new UpdaterService(() => {})
  assert.equal(service.getState().status, 'disabled')

  await service.check()
  await service.download()
  service.install(null)
  assert.equal(fakeUpdater.checkCalls, 0)
  assert.equal(fakeUpdater.downloadCalls, 0)
  assert.equal(fakeUpdater.installCalls, 0)
})

async function bundleService() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../src/main/services/UpdaterService.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [
      {
        name: 'updater-test-doubles',
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
      }
    ]
  })
  return result.outputFiles[0].text
}
