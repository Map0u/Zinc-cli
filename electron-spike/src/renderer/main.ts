import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'

const container = document.getElementById('terminal')!

const term = new Terminal({
  cursorBlink: true,
  fontFamily: 'Cascadia Code, Consolas, monospace',
  fontSize: 14,
  theme: {
    // Single alpha layer: this rgba fill is what should visibly blend with
    // the Mica/acrylic material painted behind the (opaque=false-material)
    // window by the OS compositor.
    background: 'rgba(12, 12, 12, 0.6)',
    foreground: '#e6e6e6',
    cursor: '#e6e6e6'
  }
})

const fitAddon = new FitAddon()
term.loadAddon(fitAddon)

let webglOk = true
try {
  term.loadAddon(new WebglAddon())
} catch (err) {
  webglOk = false
  console.warn('[renderer] WebGL addon failed to load, falling back to canvas renderer:', err)
}

term.open(container)
fitAddon.fit()

// Spike-only debug hook so the CDP verification script can read the
// terminal's scrollback buffer without depending on which renderer
// (WebGL/canvas/DOM) is currently active.
;(window as unknown as { __zincTerm: Terminal }).__zincTerm = term
console.log(`[renderer] xterm WebGL renderer: ${webglOk ? 'active' : 'FAILED, using default renderer'}`)

window.addEventListener('resize', () => fitAddon.fit())

// ---- node-pty wiring over a binary channel --------------------------------
// pty output arrives as a raw Uint8Array (structured-clone IPC), decoded
// with TextDecoder — no Base64/JSON string hop.
const decoder = new TextDecoder()
const encoder = new TextEncoder()

window.zinc.onSpawned(() => {
  console.log('[renderer] pty spawned')
})

window.zinc.onData((data: Uint8Array) => {
  term.write(decoder.decode(data))
})

window.zinc.onExit((code: number) => {
  term.write(`\r\n\x1b[31m[process exited with code ${code}]\x1b[0m\r\n`)
})

term.onData((data: string) => {
  window.zinc.write(encoder.encode(data))
})

term.onResize(({ cols, rows }) => {
  window.zinc.resize(cols, rows)
})

window.zinc.spawn(term.cols, term.rows)
