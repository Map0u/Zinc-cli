import { app, type BrowserWindow, type Rectangle } from 'electron'

export interface AodState {
  active: boolean
}

type AodReason = 'startup' | 'settings' | 'keyboard' | 'renderer' | 'second-instance'

interface SavedWindowState {
  bounds: Rectangle
  maximized: boolean
  fullScreen: boolean
  alwaysOnTop: boolean
}

const AOD_RENDER_TRANSITION_MS = 150

export class AodModeController {
  private active = false
  private savedState: SavedWindowState | null = null
  private enterTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly win: BrowserWindow) {}

  getState(): AodState {
    return { active: this.active }
  }

  isActive(): boolean {
    return this.active
  }

  setActive(active: boolean, reason: AodReason): void {
    if (active) this.enterAod(reason)
    else this.exitAod(reason)
  }

  enterAod(_reason: AodReason): void {
    if (this.active || this.win.isDestroyed()) return
    this.savedState = {
      bounds: this.win.getBounds(),
      maximized: this.win.isMaximized(),
      fullScreen: this.win.isFullScreen(),
      alwaysOnTop: this.win.isAlwaysOnTop()
    }
    this.active = true
    this.emitChanged()

    this.clearEnterTimer()
    this.enterTimer = setTimeout(() => {
      this.enterTimer = null
      if (this.win.isDestroyed() || !this.active) return
      if (process.platform === 'win32') this.win.setBackgroundMaterial('none')
      if (process.platform !== 'linux') this.win.setFullScreen(true)
    }, AOD_RENDER_TRANSITION_MS)
  }

  exitAod(_reason: AodReason): void {
    if (!this.active) return
    if (process.platform === 'linux') {
      app.quit()
      return
    }

    this.clearEnterTimer()
    this.active = false
    this.emitChanged()
    if (this.win.isDestroyed()) return

    const restore = (): void => {
      if (this.win.isDestroyed()) return
      if (process.platform === 'win32') this.win.setBackgroundMaterial('acrylic')
      const saved = this.savedState
      this.savedState = null
      if (!saved) return
      this.win.setAlwaysOnTop(saved.alwaysOnTop)
      if (saved.maximized) {
        this.win.setBounds(saved.bounds)
        this.win.maximize()
      } else {
        this.win.setBounds(saved.bounds)
      }
      if (saved.fullScreen) this.win.setFullScreen(true)
    }

    if (this.win.isFullScreen()) {
      this.win.once('leave-full-screen', restore)
      this.win.setFullScreen(false)
    } else {
      restore()
    }
  }

  wake(): void {
    if (this.win.isDestroyed()) return
    this.win.webContents.send('aod:wake')
  }

  private emitChanged(): void {
    if (this.win.isDestroyed() || this.win.webContents.isDestroyed()) return
    this.win.webContents.send('aod:changed', this.getState())
  }

  private clearEnterTimer(): void {
    if (!this.enterTimer) return
    clearTimeout(this.enterTimer)
    this.enterTimer = null
  }
}
