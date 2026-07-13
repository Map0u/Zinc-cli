import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateInfo } from 'builder-util-runtime'
import type { UpdateState } from '../../shared/updateProtocol'

type PushState = (state: UpdateState) => void

export class UpdaterService {
  private readonly state: UpdateState = {
    status: app.isPackaged ? 'idle' : 'disabled',
    currentVersion: app.getVersion(),
    availableVersion: null,
    downloadedVersion: null,
    percent: null,
    bytesPerSecond: null,
    error: app.isPackaged ? null : 'Updates are only available in packaged builds.',
    lastCheckedAt: null
  }

  constructor(private readonly pushState: PushState) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('checking-for-update', () => this.patch({ status: 'checking', error: null }))
    autoUpdater.on('update-available', (info) => {
      this.patch({
        status: 'available',
        availableVersion: versionFrom(info),
        error: null,
        lastCheckedAt: new Date().toISOString()
      })
    })
    autoUpdater.on('update-not-available', () => {
      this.patch({
        status: 'not-available',
        availableVersion: null,
        percent: null,
        bytesPerSecond: null,
        error: null,
        lastCheckedAt: new Date().toISOString()
      })
    })
    autoUpdater.on('download-progress', (progress) => {
      this.patch({
        status: 'downloading',
        percent: Number.isFinite(progress.percent) ? progress.percent : null,
        bytesPerSecond: Number.isFinite(progress.bytesPerSecond) ? progress.bytesPerSecond : null,
        error: null
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.patch({
        status: 'downloaded',
        downloadedVersion: versionFrom(info),
        percent: 100,
        bytesPerSecond: null,
        error: null
      })
    })
    autoUpdater.on('error', (err) => {
      this.patch({ status: 'error', error: err.message || String(err), percent: null, bytesPerSecond: null })
    })
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  async check(): Promise<UpdateState> {
    if (!this.ensureEnabled()) return this.getState()
    this.patch({ status: 'checking', error: null })
    await autoUpdater.checkForUpdates()
    return this.getState()
  }

  async download(): Promise<UpdateState> {
    if (!this.ensureEnabled()) return this.getState()
    if (this.state.status !== 'available' && this.state.status !== 'error') return this.getState()
    this.patch({ status: 'downloading', percent: 0, bytesPerSecond: null, error: null })
    await autoUpdater.downloadUpdate()
    return this.getState()
  }

  install(win: BrowserWindow | null): UpdateState {
    if (!this.ensureEnabled()) return this.getState()
    if (this.state.status !== 'downloaded') return this.getState()
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:state', this.getState())
    }
    autoUpdater.quitAndInstall(false, true)
    return this.getState()
  }

  private ensureEnabled(): boolean {
    if (app.isPackaged) return true
    this.patch({ status: 'disabled', error: 'Updates are only available in packaged builds.' })
    return false
  }

  private patch(patch: Partial<UpdateState>): void {
    Object.assign(this.state, patch)
    this.pushState(this.getState())
  }
}

function versionFrom(info: UpdateInfo): string {
  return info.version || app.getVersion()
}
