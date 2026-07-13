import { app, BrowserWindow, ipcMain, IpcMainEvent } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import * as pty from 'node-pty'

const isDev = !app.isPackaged
const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Track which backdrop strategy actually got applied, for the spike report.
export const backdropLog: string[] = []

function log(line: string): void {
  console.log(`[backdrop] ${line}`)
  backdropLog.push(line)
}

async function tryDwmDirect(win: BrowserWindow): Promise<boolean> {
  // Last-resort fallback: call DwmSetWindowAttribute(DWMWA_SYSTEMBACKDROP_TYPE)
  // directly via koffi if the high-level Electron API failed outright.
  try {
    const koffiModule = await import('koffi')
    const koffi = (koffiModule as any).default ?? koffiModule
    if (process.platform !== 'win32') return false

    // getNativeWindowHandle() returns a Buffer holding the raw HWND pointer
    // value (native endianness); decode it into a koffi pointer.
    const hwndBuffer = win.getNativeWindowHandle()
    const hwndPtr = koffi.decode(hwndBuffer, 'void *')

    const dwmapi = koffi.load('dwmapi.dll')
    const DwmSetWindowAttribute = dwmapi.func(
      'long __stdcall DwmSetWindowAttribute(void* hwnd, uint32 attr, void* value, uint32 size)'
    )
    const DWMWA_SYSTEMBACKDROP_TYPE = 38
    const DWMSBT_MAINWINDOW = 2 // Mica
    const value = new Int32Array([DWMSBT_MAINWINDOW])
    const hr = DwmSetWindowAttribute(hwndPtr, DWMWA_SYSTEMBACKDROP_TYPE, value, 4)
    log(`DWM direct call DwmSetWindowAttribute returned HRESULT=${hr}`)
    return hr === 0
  } catch (err) {
    log(`DWM direct call failed: ${(err as Error).message}`)
    return false
  }
}

// ZINC_EXPERIMENT selects which combination from the material-workaround
// matrix to build the window with. See MATERIAL-RESULT.md for the full log.
//   1 = frame:true + titleBarStyle:'hidden' + backgroundMaterial:'mica' at construction time
//   2 = same as 1 but 'acrylic'
//   3 = transparent:true, no backgroundMaterial (CSS-only glass fallback)
//   4 = frame:false + backgroundMaterial:'mica' at construction time (vs. setBackgroundMaterial() after)
//   5 = frame:false + backgroundMaterial:'acrylic' at construction time (isolates whether frame:true is required for acrylic)
//   (unset) = original spike behavior: frame:false + setBackgroundMaterial() post-construction + DWM-direct fallback
const EXPERIMENT = process.env.ZINC_EXPERIMENT

async function createWindow(): Promise<BrowserWindow> {
  const baseOptions = {
    width: 1100,
    height: 720,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  } as const

  let win: BrowserWindow
  let applied = false

  if (EXPERIMENT === '1' || EXPERIMENT === '2') {
    const material = EXPERIMENT === '1' ? 'mica' : 'acrylic'
    win = new BrowserWindow({
      ...baseOptions,
      frame: true,
      titleBarStyle: 'hidden',
      backgroundMaterial: material
    } as ConstructorParameters<typeof BrowserWindow>[0])
    log(`EXPERIMENT ${EXPERIMENT}: constructed with frame:true, titleBarStyle:'hidden', backgroundMaterial:'${material}' at construction time`)
    applied = true
  } else if (EXPERIMENT === '3') {
    win = new BrowserWindow({
      ...baseOptions,
      frame: false,
      transparent: true
    })
    log('EXPERIMENT 3: constructed with frame:false, transparent:true, no backgroundMaterial')
    applied = true
  } else if (EXPERIMENT === '4') {
    win = new BrowserWindow({
      ...baseOptions,
      frame: false,
      backgroundMaterial: 'mica'
    } as ConstructorParameters<typeof BrowserWindow>[0])
    log("EXPERIMENT 4: constructed with frame:false, backgroundMaterial:'mica' at construction time")
    applied = true
  } else if (EXPERIMENT === '5') {
    win = new BrowserWindow({
      ...baseOptions,
      frame: false,
      backgroundMaterial: 'acrylic'
    } as ConstructorParameters<typeof BrowserWindow>[0])
    log("EXPERIMENT 5: constructed with frame:false, backgroundMaterial:'acrylic' at construction time")
    applied = true
  } else {
    win = new BrowserWindow({
      ...baseOptions,
      frame: false,
      transparent: false
    })

    // Attempt Mica first, then acrylic, then raw DWM call, and record what actually happened.
    try {
      win.setBackgroundMaterial('mica')
      log("win.setBackgroundMaterial('mica') call succeeded (no throw)")
      applied = true
    } catch (err) {
      log(`win.setBackgroundMaterial('mica') threw: ${(err as Error).message}`)
    }

    if (!applied) {
      try {
        win.setBackgroundMaterial('acrylic')
        log("win.setBackgroundMaterial('acrylic') call succeeded (no throw)")
        applied = true
      } catch (err) {
        log(`win.setBackgroundMaterial('acrylic') threw: ${(err as Error).message}`)
      }
    }

    // ZINC_FORCE_DWM_DIRECT=1 also runs the raw DWM call even when the
    // high-level Electron API already reported success, so the two strategies
    // can be visually compared in the same run (used during the spike to rule
    // out a wrong-parameter theory for why Mica wasn't visibly rendering).
    if (!applied || process.env.ZINC_FORCE_DWM_DIRECT === '1') {
      applied = await tryDwmDirect(win)
    }

    if (!applied) {
      log('All backdrop strategies failed to even apply — window will be flat/opaque.')
    }
  }

  try {
    await writeFile(join(process.cwd(), 'backdrop-log.txt'), backdropLog.join('\n'), 'utf8')
  } catch {
    /* best-effort diagnostics only */
  }

  win.once('ready-to-show', () => win.show())

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// ---- PTY wiring -----------------------------------------------------------
// Binary channel: pty output goes to the renderer as raw bytes (Uint8Array
// over a MessageChannel port), never Base64/JSON text. Input from renderer
// arrives the same way.

const ptyMap = new Map<number, pty.IPty>()

ipcMain.on('pty:spawn', (event: IpcMainEvent, cols: number, rows: number) => {
  const shell = 'pwsh.exe'
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: process.env.USERPROFILE || process.cwd(),
    env: process.env as { [key: string]: string }
  })

  const webContentsId = event.sender.id
  ptyMap.set(webContentsId, ptyProcess)

  ptyProcess.onData((data: string) => {
    if (event.sender.isDestroyed()) return
    // Send as raw bytes, not a JSON/base64 string.
    const bytes = Buffer.from(data, 'utf8')
    event.sender.send('pty:data', bytes)
  })

  ptyProcess.onExit(({ exitCode }) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('pty:exit', exitCode)
    }
    ptyMap.delete(webContentsId)
  })

  event.sender.send('pty:spawned')
})

ipcMain.on('pty:input', (event: IpcMainEvent, data: Uint8Array) => {
  const ptyProcess = ptyMap.get(event.sender.id)
  if (!ptyProcess) return
  ptyProcess.write(Buffer.from(data).toString('utf8'))
})

ipcMain.on('pty:resize', (event: IpcMainEvent, cols: number, rows: number) => {
  const ptyProcess = ptyMap.get(event.sender.id)
  if (!ptyProcess) return
  try {
    ptyProcess.resize(cols, rows)
  } catch {
    /* ignore resize races */
  }
})

app.whenReady().then(() => {
  void createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  for (const p of ptyMap.values()) p.kill()
  if (process.platform !== 'darwin') app.quit()
})
