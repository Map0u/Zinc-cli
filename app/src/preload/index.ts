import { contextBridge, ipcRenderer } from 'electron'
import { PTY_PORT_MESSAGE_TYPE, type PtyCreateOptions, type TerminalOptionsPush } from '../shared/ptyProtocol'
import type { SettingsPatch, ZincSettings } from '../shared/settingsTypes'
import type { UpdateState } from '../shared/updateProtocol'
import type { RendererSessionSnapshot, RestorePayload } from '../shared/sessionState'
import type { ShortcutAction } from '../shared/keybindings'

export interface ShellProfile {
  id: string
  label: string
}

export interface ShellProfilesResponse {
  profiles: ShellProfile[]
  fallbackNotice: { requestedId: string; resolvedId: string } | null
}

export interface ZincWindowState {
  platform: string
  fullScreen: boolean
}

export interface ZincApi {
  version: string
  /** `process.versions` is only reachable here (preload runs in Node) — contextIsolation blocks the renderer from it directly. Read once at startup; these don't change at runtime. */
  versions: {
    electron: string
    chrome: string
    node: string
    v8: string
  }
  pty: {
    /** Requests a new shell for `id`; its binary output port arrives separately via a `window.postMessage`. */
    create: (id: string, options: PtyCreateOptions) => Promise<void>
    write: (id: string, data: Uint8Array) => void
    resize: (id: string, cols: number, rows: number) => void
    kill: (id: string) => void
    /** Returns an unsubscribe function so a remount (HMR/StrictMode) never stacks a second listener. */
    onExit: (callback: (id: string, exitCode: number) => void) => () => void
    /** Best-effort current cwd of `id`'s shell (live PEB read, falling back to its spawn cwd). */
    getCwd: (id: string) => Promise<string | null>
    /** Saves a clipboard-pasted image's raw bytes and types its resolved path into the pty (parity §1.5). */
    pasteImage: (id: string, data: Uint8Array, mime: string) => void
  }
  /** Pushed appearance settings (font/size/cursor/scrollback/opacity) — applies to every open terminal. Returns an unsubscribe function. */
  onTerminalOptions: (callback: (options: TerminalOptionsPush) => void) => () => void
  window: {
    /** `#rrggbb` — the same accent shade the old WinUI3 app rendered (its `AccentFillColorDefaultBrush`, i.e. the OS accent's "Light2" tint). Read once at startup; the app doesn't watch for a live OS accent-color change. */
    getAccentColor: () => Promise<string>
    getPlatform: () => Promise<string>
    getStateSync: () => ZincWindowState
    onStateChange: (callback: (state: ZincWindowState) => void) => () => void
    minimize: () => Promise<void>
    close: () => Promise<void>
  }
  theme: {
    /** Main's `nativeTheme.shouldUseDarkColors` — authoritative over the renderer's own `matchMedia`, which measurably disagreed with the real OS setting on at least one machine (see main/index.ts). */
    get: () => Promise<'dark' | 'light'>
    /** Same read as `get`, but synchronous — used only to seed the initial value before first paint so cold start never flashes the wrong theme. */
    getSync: () => 'dark' | 'light'
    /** Fires whenever the OS light/dark setting changes. Returns an unsubscribe function. */
    onChange: (callback: (mode: 'dark' | 'light') => void) => () => void
  }
  app: {
    /** Routes through the main process's unified `before-quit` flow — never a bare window/renderer-side exit. */
    requestQuit: () => void
  }
  shell: {
    /** Opens a trusted external URL after main-process validation. */
    openExternal: (url: string) => Promise<boolean>
  }
  clipboard: {
    /** Writes text via the main-process clipboard API. Resolves `false` if the write failed. */
    writeText: (text: string) => Promise<boolean>
    /** Reads clipboard text via the main-process clipboard API. Resolves `null` on failure (vs. '' for an empty clipboard). */
    readText: () => Promise<string | null>
  }
  settings: {
    get: () => Promise<ZincSettings>
    /** Discrete controls: apply + save now, cancel any pending debounce. */
    updateImmediate: (patch: SettingsPatch) => void
    /** Continuous controls: merge now, debounce the disk write 250ms. */
    updateDebounced: (patch: SettingsPatch) => void
    /** Fires with the full settings object whenever main applies a change (immediate or debounce-committed). Returns an unsubscribe function. */
    onChange: (callback: (settings: ZincSettings) => void) => () => void
  }
  shells: {
    getProfiles: () => Promise<ShellProfilesResponse>
  }
  session: {
    /** Resolved restore plan from the last-saved session-state.json; `null` = fall back to the default single-tab startup (parity §1.4). */
    getRestorePayload: () => Promise<RestorePayload | null>
    /**
     * Pushes the current tab order + active index so main can keep a live
     * cache of it. `before-quit` reads that cache rather than asking the
     * renderer at quit time — by then, on an OS window-close (X / Alt+F4),
     * `webContents` is already destroyed and a live round trip is impossible.
     */
    pushSnapshot: (snapshot: RendererSessionSnapshot) => void
  }
  shortcuts: {
    /**
     * Fires when main's `before-input-event` fallback (M4 fix) resolves a
     * Chromium-level accelerator — e.g. Ctrl+Tab/Ctrl+Shift+Tab — to a bound
     * action before it ever reached this window's own keydown listener.
     */
    /** Returns an unsubscribe function. */
    onTrigger: (callback: (action: ShortcutAction) => void) => () => void
    /** Tells main whether the settings page's shortcut-recording UI is currently capturing raw keys, so main's before-input-event fallback stands down and lets the combo reach the recording handler instead. */
    setRecordingActive: (active: boolean) => void
    /**
     * Fires when main's before-input-event fallback catches Alt+M/Alt+V on
     * win32 — Chromium's system-accelerator handling swallows these before
     * this window's own keydown listener ever sees them (Windows-only; see
     * main's before-input-event handler). `hostId` is main's last-known
     * active terminal from the last session snapshot; `sequence` is the raw
     * `\x1bm`/`\x1bv` escape to write straight to that host's pty.
     */
    onAltSequence: (callback: (hostId: string, sequence: string) => void) => () => void
  }
  update: {
    getState: () => Promise<UpdateState>
    check: () => Promise<UpdateState>
    download: () => Promise<UpdateState>
    install: () => Promise<UpdateState>
    onState: (callback: (state: UpdateState) => void) => () => void
  }
}

const api: ZincApi = {
  // Reads package.json via the main process's app.getVersion() — dev-only
  // env vars like npm_package_version aren't present in packaged builds.
  version: ipcRenderer.sendSync('app:get-version-sync') as string,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8
  },
  pty: {
    create: (id, options) => ipcRenderer.invoke('pty:create', id, options),
    write: (id, data) => ipcRenderer.send('pty:input', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onExit: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, id: string, exitCode: number): void => callback(id, exitCode)
      ipcRenderer.on('pty:exit', listener)
      return () => ipcRenderer.removeListener('pty:exit', listener)
    },
    getCwd: (id) => ipcRenderer.invoke('pty:getCwd', id),
    pasteImage: (id, data, mime) => ipcRenderer.send('pty:pasteImage', id, data, mime)
  },
  onTerminalOptions: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, options: TerminalOptionsPush): void => callback(options)
    ipcRenderer.on('terminal:options', listener)
    return () => ipcRenderer.removeListener('terminal:options', listener)
  },
  window: {
    getAccentColor: () => ipcRenderer.invoke('window:getAccentColor'),
    getPlatform: () => ipcRenderer.invoke('window:getPlatform'),
    getStateSync: () => ipcRenderer.sendSync('window:get-state-sync') as ZincWindowState,
    onStateChange: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: ZincWindowState): void => callback(state)
      ipcRenderer.on('window:stateChanged', listener)
      return () => ipcRenderer.removeListener('window:stateChanged', listener)
    },
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close')
  },
  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    getSync: () => ipcRenderer.sendSync('theme:get-sync'),
    onChange: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, mode: 'dark' | 'light'): void => callback(mode)
      ipcRenderer.on('theme:changed', listener)
      return () => ipcRenderer.removeListener('theme:changed', listener)
    }
  },
  app: {
    requestQuit: () => ipcRenderer.send('app:requestQuit')
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:writeText', text),
    readText: () => ipcRenderer.invoke('clipboard:readText')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    updateImmediate: (patch) => ipcRenderer.send('settings:updateImmediate', patch),
    updateDebounced: (patch) => ipcRenderer.send('settings:updateDebounced', patch),
    onChange: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, settings: ZincSettings): void => callback(settings)
      ipcRenderer.on('settings:changed', listener)
      return () => ipcRenderer.removeListener('settings:changed', listener)
    }
  },
  shells: {
    getProfiles: () => ipcRenderer.invoke('shells:getProfiles')
  },
  session: {
    getRestorePayload: () => ipcRenderer.invoke('session:getRestorePayload'),
    pushSnapshot: (snapshot) => ipcRenderer.send('session:tabsChanged', snapshot)
  },
  shortcuts: {
    onTrigger: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, action: ShortcutAction): void => callback(action)
      ipcRenderer.on('shortcuts:trigger', listener)
      return () => ipcRenderer.removeListener('shortcuts:trigger', listener)
    },
    setRecordingActive: (active) => ipcRenderer.send('shortcuts:setRecordingActive', active),
    onAltSequence: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, hostId: string, sequence: string): void =>
        callback(hostId, sequence)
      ipcRenderer.on('terminal:altSequence', listener)
      return () => ipcRenderer.removeListener('terminal:altSequence', listener)
    }
  },
  update: {
    getState: () => ipcRenderer.invoke('update:get-state'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: UpdateState): void => callback(state)
      ipcRenderer.on('update:state', listener)
      return () => ipcRenderer.removeListener('update:state', listener)
    }
  }
}

contextBridge.exposeInMainWorld('zinc', api)

// See PTY_PORT_MESSAGE_TYPE's doc comment for why this bypasses contextBridge.
// Registered unconditionally at preload load time, not gated behind any
// renderer-side subscription call.
ipcRenderer.on('pty:port', (event, id: string) => {
  const port = event.ports[0]
  if (port) {
    window.postMessage({ type: PTY_PORT_MESSAGE_TYPE, id }, '*', [port])
  }
})
