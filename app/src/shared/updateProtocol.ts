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
}
