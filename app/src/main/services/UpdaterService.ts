import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateInfo } from 'builder-util-runtime'
import type { UpdateState } from '../../shared/updateProtocol'

type PushState = (state: UpdateState) => void

export class UpdaterService {
  private backgroundCheckStarted = false
  private checkInFlight = false

  private readonly state: UpdateState = {
    status: app.isPackaged ? 'idle' : 'disabled',
    currentVersion: app.getVersion(),
    availableVersion: null,
    downloadedVersion: null,
    percent: null,
    bytesPerSecond: null,
    error: app.isPackaged ? null : 'Updates are only available in packaged builds.',
    lastCheckedAt: null,
    releaseNotes: null
  }

  constructor(private readonly pushState: PushState) {
    // Discover + download automatically; install only on explicit user action.
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('checking-for-update', () => this.patch({ status: 'checking', error: null }))
    autoUpdater.on('update-available', (info) => {
      this.patch({
        status: 'available',
        availableVersion: versionFrom(info),
        releaseNotes: releaseNotesFrom(info),
        error: null,
        lastCheckedAt: new Date().toISOString()
      })
    })
    autoUpdater.on('update-not-available', () => {
      this.patch({
        status: 'not-available',
        availableVersion: null,
        releaseNotes: null,
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
        availableVersion: versionFrom(info),
        releaseNotes: releaseNotesFrom(info) ?? this.state.releaseNotes,
        percent: 100,
        bytesPerSecond: null,
        error: null
      })
    })
    autoUpdater.on('error', (err) => this.setError(err))
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  /**
   * One silent packaged-build check after the window is ready so the rail
   * badge can appear without visiting About. Failures stay in state only —
   * no modal. Skipped when unpackaged or already started / mid-flight /
   * already holding a download.
   */
  startBackgroundCheck(): void {
    if (!app.isPackaged) return
    if (this.backgroundCheckStarted) return
    if (this.checkInFlight) return
    if (
      this.state.status === 'available' ||
      this.state.status === 'downloading' ||
      this.state.status === 'downloaded'
    ) {
      return
    }
    this.backgroundCheckStarted = true
    void this.check().catch(() => {
      // check() records updater failures; never leave a background rejection unhandled.
    })
  }

  async check(): Promise<UpdateState> {
    if (!this.ensureEnabled()) return this.getState()
    if (this.checkInFlight) return this.getState()
    this.checkInFlight = true
    this.patch({ status: 'checking', error: null })
    try {
      const result = await autoUpdater.checkForUpdates()
      // autoDownload starts a separate promise; the check itself can succeed while it rejects.
      if (result?.downloadPromise) {
        void result.downloadPromise.catch((error) => {
          try {
            this.setError(error)
          } catch {
            // State was patched even if notifying the renderer failed.
          }
        })
      }
    } catch (error) {
      this.setError(error)
    } finally {
      this.checkInFlight = false
    }
    return this.getState()
  }

  /** Manual download / retry when autoDownload did not complete. */
  async download(): Promise<UpdateState> {
    if (!this.ensureEnabled()) return this.getState()
    if (this.state.status !== 'available' && this.state.status !== 'error') return this.getState()
    this.patch({ status: 'downloading', percent: 0, bytesPerSecond: null, error: null })
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.setError(error)
    }
    return this.getState()
  }

  install(win: BrowserWindow | null): UpdateState {
    if (!this.ensureEnabled()) return this.getState()
    if (this.state.status !== 'downloaded') return this.getState()
    try {
      if (win && !win.isDestroyed()) {
        win.webContents.send('update:state', this.getState())
      }
      autoUpdater.quitAndInstall(false, true)
    } catch (error) {
      this.setError(error)
    }
    return this.getState()
  }

  private setError(error: unknown): void {
    this.patch({
      status: 'error',
      error: errorMessage(error),
      percent: null,
      bytesPerSecond: null
    })
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || String(error)
  if (error !== null && typeof error === 'object' && 'message' in error) {
    const message = error.message
    if (typeof message === 'string' && message) return message
  }
  return String(error)
}

function versionFrom(info: UpdateInfo): string {
  return info.version || app.getVersion()
}

function releaseNotesFrom(info: UpdateInfo): string | null {
  const notes: unknown = info.releaseNotes
  if (notes == null) return null
  if (typeof notes === 'string') {
    const trimmed = notes.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (Array.isArray(notes)) {
    const parts: string[] = []
    for (const entry of notes as unknown[]) {
      if (typeof entry === 'string') {
        const trimmed = entry.trim()
        if (trimmed) parts.push(trimmed)
        continue
      }
      if (entry && typeof entry === 'object' && 'note' in entry) {
        const note = (entry as { note: unknown }).note
        if (typeof note === 'string') {
          const trimmed = note.trim()
          if (trimmed) parts.push(trimmed)
        }
      }
    }
    return parts.length > 0 ? parts.join('\n\n') : null
  }
  return null
}
