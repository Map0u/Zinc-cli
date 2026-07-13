// Runs inside an Electron `utilityProcess` (spawned by AiStatusPoller / the
// startup WSL-root probe in index.ts) — never on the main thread. Everything
// this file touches is slow-I/O-prone (Toolhelp32 snapshot + per-descendant
// PEB reads via koffi, Codex .jsonl reads over WSL's 9P/UNC path, `wsl.exe`
// enumeration) and was previously run synchronously on the main event loop,
// stalling pty I/O every 5s (codex review of m5-status-bar). Moving it here
// means a slow WSL round trip only ever blocks this disposable child, never
// the terminal.
//
// This file *imports* `./services/aiStatus` and `./services/ToolDetector`
// rather than reimplementing their logic — those modules are unmodified, just
// invoked from a different process.
import { detectActiveTool } from './services/ToolDetector'
import { detectWslCodexRoots, readClaude, readCodex } from './services/aiStatus'
import type { AiStatusPayload } from '../shared/aiStatusProtocol'
import type { StatusBarTool } from '../shared/statusBarFields'

type WorkerRequest =
  | { type: 'detectWslRoots' }
  | {
      type: 'tick'
      requestId: number
      shellPid: number | null
      codexSessionRoots: string[]
      enabledTools: StatusBarTool[]
    }

export type WorkerResponse =
  | { type: 'wslRoots'; roots: string[] }
  | { type: 'payload'; requestId: number; payload: AiStatusPayload }
  | { type: 'error'; requestId?: number; message: string }

/** A tool the user unchecked in settings never reaches `readCodex`/`readClaude` —
 * skips the (potentially slow, WSL 9P) read entirely, not just its display. */
function computePayload(
  shellPid: number | null,
  codexSessionRoots: string[],
  enabledTools: StatusBarTool[]
): AiStatusPayload {
  const tool = detectActiveTool(shellPid)
  if (tool === 'codex') {
    if (!enabledTools.includes('codex')) return { state: 'empty' }
    const snapshot = readCodex(codexSessionRoots)
    return snapshot ? { state: 'usage', snapshot } : { state: 'noData', label: 'Codex' }
  }
  if (tool === 'claude') {
    if (!enabledTools.includes('claude')) return { state: 'empty' }
    const snapshot = readClaude()
    return snapshot ? { state: 'usage', snapshot } : { state: 'noData', label: 'Claude' }
  }
  return { state: 'empty' }
}

process.parentPort.on('message', (event) => {
  const msg = event.data as WorkerRequest
  try {
    if (msg.type === 'detectWslRoots') {
      const roots = detectWslCodexRoots()
      const response: WorkerResponse = { type: 'wslRoots', roots }
      process.parentPort.postMessage(response)
      return
    }
    if (msg.type === 'tick') {
      const payload = computePayload(msg.shellPid, msg.codexSessionRoots, msg.enabledTools)
      const response: WorkerResponse = { type: 'payload', requestId: msg.requestId, payload }
      process.parentPort.postMessage(response)
    }
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      requestId: msg.type === 'tick' ? msg.requestId : undefined,
      message: error instanceof Error ? (error.stack ?? error.message) : String(error)
    }
    process.parentPort.postMessage(response)
  }
})
