// Dependency-free decision for a clipboard image paste, shared by main and the
// unit tests (no electron/node imports).

import type { AiCliTool } from './aiCliTools'
import type { ImagePasteMode } from './settingsTypes'

/** Pasted into the pty as an image: Alt+V, the key every native AI CLI binds on Windows. */
export const IMAGE_PASTE_KEY = '\x1bv'

export type ImagePasteAction =
  /** Text wins, or there is no image: xterm pastes as usual. */
  | 'passthrough'
  /** Type ESC v and let the CLI read the clipboard itself. */
  | 'send-key'
  /** Save a file and type its path wrapped in bracketed paste (an AI CLI only attaches a pasted path). */
  | 'file-bracketed'
  /** Save a file and type its bare path (a plain shell). */
  | 'file-bare'

export interface ImagePasteInput {
  /** The clipboard has non-empty text/plain. */
  hasText: boolean
  hasImage: boolean
  mode: ImagePasteMode
  /** Foreground AI CLI of the tab, null for a plain shell or when the lookup failed. */
  tool: AiCliTool | null
  runtime: 'native' | 'wsl' | null
}

export function decideImagePaste({ hasText, hasImage, mode, tool, runtime }: ImagePasteInput): ImagePasteAction {
  if (hasText || !hasImage) return 'passthrough'
  // Only a native AI CLI is known to read the clipboard on ESC v; WSL keys differ and are unverified.
  if (mode === 'cli' && tool !== null && runtime === 'native') return 'send-key'
  return tool !== null ? 'file-bracketed' : 'file-bare'
}
