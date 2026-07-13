import { contextBridge, ipcRenderer } from 'electron'

// Typed API surface exposed to the renderer. PTY bytes travel as raw
// Uint8Array over ipcRenderer (Electron's structured-clone IPC), never as
// Base64 text or JSON-wrapped strings.
export interface ZincTerminalApi {
  spawn(cols: number, rows: number): void
  write(data: Uint8Array): void
  resize(cols: number, rows: number): void
  onData(cb: (data: Uint8Array) => void): void
  onExit(cb: (code: number) => void): void
  onSpawned(cb: () => void): void
}

const api: ZincTerminalApi = {
  spawn(cols, rows) {
    ipcRenderer.send('pty:spawn', cols, rows)
  },
  write(data) {
    ipcRenderer.send('pty:input', data)
  },
  resize(cols, rows) {
    ipcRenderer.send('pty:resize', cols, rows)
  },
  onData(cb) {
    ipcRenderer.on('pty:data', (_event, data: Uint8Array) => cb(data))
  },
  onExit(cb) {
    ipcRenderer.on('pty:exit', (_event, code: number) => cb(code))
  },
  onSpawned(cb) {
    ipcRenderer.on('pty:spawned', () => cb())
  }
}

contextBridge.exposeInMainWorld('zinc', api)
