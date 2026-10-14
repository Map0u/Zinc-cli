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
  /** Settings category: Tabs & AI (E7C4, TaskView). */
  Tabs: "\uE7C4",
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
  About: "",
  /** Group header chevron (E76C, ChevronRight); turned 90 degrees by CSS when the group is open. */
  ChevronRight: "\uE76C",
  /** Update available badge (E895, Download) — rail indicator when a newer release is known. */
  Update: "\uE895",
  /** Tab activity: working (E72C, Refresh), spun by CSS in the rail. */
  TabWorking: "\uE72C",
  /** Tab activity: waiting on the user (E7BA, Warning). */
  TabWaiting: "\uE7BA",
  /** Tab activity: a turn finished and has not been seen (E73E, CheckMark). */
  TabDone: "\uE73E",
  /** Tab activity: failed (EA39, ErrorBadge). */
  TabError: "\uEA39"
} as const
