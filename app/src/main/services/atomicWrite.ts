import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
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
