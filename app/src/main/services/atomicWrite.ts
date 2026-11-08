import { mkdirSync, renameSync, unlinkSync, writeFileSync, promises as fs } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Writes `contents` to `filePath` via the standard temp-file + rename
 * pattern: write to a sibling `<name>.tmp-<pid>` file first, then
 * `renameSync` it over the real path. `rename` on the same volume is atomic
 * (NTFS included), so a crash or concurrent second-instance write mid-way
 * through can never leave `filePath` truncated/partially-written the way a
 * direct `writeFileSync` to the final path could. Used by both
 * SettingsService and SessionStateService (the two user-profile-scoped
 * persisted-state files).
 */
/** Serializes asynchronous file creation and invalidates stale work on synchronous quit/clear. */
export class AtomicWriteQueue {
  private generation = 0
  private tail: Promise<void> = Promise.resolve()
  constructor(private readonly filePath: string) {}

  write(contents: string): void {
    const generation = this.generation
    this.tail = this.tail.then(async () => {
      if (generation !== this.generation) return
      const tmpPath = `${this.filePath}.tmp-async-${process.pid}`
      try {
        await fs.mkdir(dirname(this.filePath), { recursive: true })
        if (generation !== this.generation) return
        await fs.writeFile(tmpPath, contents, 'utf8')
        if (generation !== this.generation) {
          await fs.unlink(tmpPath).catch(() => {})
          return
        }
        // No await between the generation check and rename: a before-quit
        // synchronous snapshot cannot be overtaken by a stale in-flight rename.
        renameSync(tmpPath, this.filePath)
      } catch (err) {
        await fs.unlink(tmpPath).catch(() => {})
        console.error(`[AtomicWriteQueue] failed to persist ${this.filePath}`, err)
      }
    })
  }

  invalidate(): void { this.generation += 1 }
  async flush(): Promise<void> { await this.tail }
}

export function atomicWriteFileSync(filePath: string, contents: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp-${process.pid}`
  writeFileSync(tmpPath, contents, 'utf8')
  try {
    renameSync(tmpPath, filePath)
  } catch (err) {
    try {
      unlinkSync(tmpPath)
    } catch {
      // best-effort cleanup of the temp file — the rename failure itself is what matters
    }
    throw err
  }
}
