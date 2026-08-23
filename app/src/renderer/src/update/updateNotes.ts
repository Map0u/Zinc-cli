import { findChangelogEntry } from './changelogEntries'

export const RELEASE_NOTES_MAX_CHARS = 2000

export type UpdateNotes =
  | { kind: 'text'; text: string }
  | { kind: 'bullets'; items: string[] }

/**
 * Collapse GitHub / electron-updater HTML release bodies into plain text for
 * the update dialog. Not a general HTML sanitizer — only the shapes we see in
 * GitHub Release bodies (paragraphs, lists, code, highlight spans).
 */
export function stripReleaseNotesHtml(input: string | null | undefined): string {
  if (input == null) return ''
  let text = String(input)

  // Block closers and breaks → newlines before stripping remaining tags.
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/(?:p|div|li|h[1-6]|tr|pre|blockquote)\s*>/gi, '\n')
  text = text.replace(/<\/?(?:ul|ol|table|thead|tbody|hr)\b[^>]*>/gi, '\n')
  // Drop every remaining tag (including opening counterparts and spans).
  text = text.replace(/<[^>]+>/g, '')

  text = decodeBasicEntities(text)

  // Collapse whitespace while keeping intentional paragraph breaks.
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  if (text.length > RELEASE_NOTES_MAX_CHARS) {
    return `${text.slice(0, RELEASE_NOTES_MAX_CHARS).trimEnd()}…`
  }
  return text
}

function decodeBasicEntities(value: string): string {
  // Decode &amp; first so subsequent named entities resolve correctly.
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    })
    .replace(/&#(\d+);/g, (match, dec: string) => {
      const code = Number.parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    })
}

/**
 * GitHub Release bodies often include installer filenames, hashes, and the
 * product pitch. Those belong on the release page, not in the in-app dialog.
 */
export function looksLikeReleaseAssetDump(text: string): boolean {
  if (!text) return false
  if (text.length > 600) return true
  if (text.split('\n').filter((line) => line.trim()).length > 10) return true
  return /SHA-?256|Get-FileHash|Which file do I download|checksum|Zinc-[\d.]+-Setup\.exe/i.test(
    text
  )
}

/**
 * Prefer local bilingual bullets; keep short remote notes; drop installer
 * dumps. Empty text lets the UI show the i18n fallback.
 */
export function resolveUpdateNotes(
  version: string | null | undefined,
  releaseNotes: string | null | undefined,
  language: 'en' | 'zh'
): UpdateNotes {
  const entry = findChangelogEntry(version)
  if (entry) {
    return { kind: 'bullets', items: language === 'zh' ? entry.zh : entry.en }
  }

  const stripped = stripReleaseNotesHtml(releaseNotes)
  if (stripped && !looksLikeReleaseAssetDump(stripped)) {
    return { kind: 'text', text: stripped }
  }

  return { kind: 'text', text: '' }
}
