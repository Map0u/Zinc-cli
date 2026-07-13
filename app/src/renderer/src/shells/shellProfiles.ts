/** A detected shell that the renderer may present to the user. The stable id
 * is the only value sent back to main; executable paths and arguments remain
 * entirely main-process concerns. */
export interface ShellProfile {
  id: string
  label: string
}

export interface ShellFallbackNotice {
  requestedId: string
  resolvedId: string
}

interface ShellProfilesResponse {
  profiles: ShellProfile[]
  fallbackNotice?: ShellFallbackNotice | null
}

interface ShellProfilesApi {
  getProfiles: () => Promise<ShellProfilesResponse>
}

let profilesRequest: Promise<ShellProfilesResponse> | null = null
let pendingFallbackNotice: ShellFallbackNotice | null = null
let fallbackNoticeConsumed = false

/**
 * Shares the main-process probe result between App and Settings. This both
 * avoids duplicate IPC and preserves the one-time fallback notice until App
 * has a chance to display it.
 */
export async function loadShellProfiles(): Promise<ShellProfile[]> {
  if (!profilesRequest) {
    const api = (window.zinc as unknown as { shells?: ShellProfilesApi }).shells
    profilesRequest = api?.getProfiles
      ? api.getProfiles()
      : Promise.resolve({ profiles: [] })
  }
  try {
    const result = await profilesRequest
    if (result.fallbackNotice && !pendingFallbackNotice && !fallbackNoticeConsumed) {
      pendingFallbackNotice = result.fallbackNotice
    }
    return result.profiles
  } catch {
    // IPC is best-effort UI data. A late main-process failure must leave the
    // default New tab button usable rather than creating an unhandled reject.
    return []
  }
}

/** Returns the main-process fallback event at most once for the app lifetime. */
export function consumeShellFallbackNotice(): ShellFallbackNotice | null {
  const notice = pendingFallbackNotice
  pendingFallbackNotice = null
  if (notice) fallbackNoticeConsumed = true
  return notice
}
