/**
 * Segoe Fluent Icons codepoints for Zinc's chrome. These reference the Windows
 * system font at runtime instead of bundling a web icon set.
 *
 * Written as JS `\uXXXX` escapes (not literal PUA glyphs) so every codepoint
 * is a plain-text, diff/review-verifiable value instead of an invisible
 * private-use character — functionally identical to a literal glyph at
 * runtime.
 */
export const SegoeIcon = {
  /** Settings category: Appearance (E790). */
  Appearance: "",
  /** Settings category: Terminal (E756). */
  Terminal: "",
  /** Settings category: Session (E81C). */
  Session: "",
  /** Settings category: Status bar (E9D9). */
  /** Settings category: Language (E774). */
  Language: "",
  /** New tab button (E710, "Add"). */
  Add: "",
  /** Open-settings button (E713, "Setting"). */
  Settings: "",
  /** Back-from-settings button (E72B, "Back"). */
  Back: "",
  /** Tab close / clear-recording button (E711, "Cancel"). */
  Close: "",
  /** Custom dropdown's own chevron (E70D, ChevronDown) — a new 0.2.0 control, no old-app equivalent to copy from. */
  ChevronDown: "",
  /** Settings category: Shortcuts (E765, KeyboardClassic) — new 0.2.0 category, no old-app equivalent to copy from. */
  Shortcuts: "",
  /** Settings category: About (E946, Info) — new 0.2.0 category, no old-app equivalent to copy from. */
  About: ""
} as const
