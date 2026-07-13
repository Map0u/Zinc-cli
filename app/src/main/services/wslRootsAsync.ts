import { utilityProcess } from 'electron'
import type { WorkerResponse } from '../statusWorkerEntry'

/**
 * One-shot, async replacement for calling `detectWslCodexRoots()` directly on
 * the main thread at startup (codex review of m5-status-bar: the old
 * `execFileSync('wsl.exe', ...)` + per-user UNC `existsSync` probes blocked
 * `app.whenReady` for up to the full 10s timeout). Spawns the same
 * utility-process worker AiStatusPoller uses, asks it to run the probe, and
 * kills the child once it answers (or on any failure) — this is a single
 * fire-and-forget call at launch, not a long-lived process.
 */
export function detectWslCodexRootsAsync(workerPath: string): Promise<string[]> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (roots: string[]): void => {
      if (settled) return
      settled = true
      child.kill()
      resolve(roots)
    }

    const child = utilityProcess.fork(workerPath)
    child.on('message', (message: WorkerResponse) => {
      if (message.type === 'wslRoots') finish(message.roots)
    })
    child.on('exit', () => finish([]))
    try {
      child.postMessage({ type: 'detectWslRoots' })
    } catch {
      finish([])
    }
  })
}
