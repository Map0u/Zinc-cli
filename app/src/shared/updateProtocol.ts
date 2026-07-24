export type UpdateStatus =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  availableVersion: string | null
  downloadedVersion: string | null
  percent: number | null
  bytesPerSecond: number | null
  error: string | null
  lastCheckedAt: string | null
  /** Normalized release notes from the update feed (GitHub release body), if any. */
  releaseNotes: string | null
}

/** Statuses that mean a newer build is known and the rail badge should show. */
export function isUpdateBadgeVisible(status: UpdateStatus): boolean {
  return status === 'available' || status === 'downloading' || status === 'downloaded'
}
