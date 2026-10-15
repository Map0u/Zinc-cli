# Changelog

All notable public changes to Zinc are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and version numbers
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.8.3] - 2026-10-15

### Added

- Group two tabs by dragging one onto the other: rest the dragged tab over the
  middle of a tab that is not in a group and that tab is outlined; let go and the
  two become a new group whose name field opens. Letting go without the pause
  still just moves the tab.

### Changed

- The icons are drawn with a thinner line (1.5 instead of 2 units), so they sit
  closer to the text beside them.

### Fixed

- Automatic project grouping now follows the folder a tab really works in. A tab
  started as `cd project; claude` on one line used to stay in the group of the
  folder it was opened in, because PowerShell only reported its folder at the
  next prompt. PowerShell now reports on every `cd`, and while an AI CLI runs its
  own folder is used.
- The turning ring's track and the colour-filled controls follow the colour
  scheme: the ring track was a grey, the switch knob was always black (nearly
  invisible on a dark accent) and the update button text always white (faint on a
  light accent). The terminal scrollbar follows the light / dark theme too.

## [0.8.2] - 2026-10-15

### Changed

- A new icon set: every icon in the window (tab status, group arrow, buttons,
  settings pages) is drawn in one 2 px rounded stroke instead of the thin
  Windows system glyphs.
- The "working" ring turns smoothly instead of stepping, and turns about its own
  centre, so it no longer wobbles in its slot.
- Colour schemes are replaced by five new ones, each with a light and a dark
  version: Ink (the default, formerly Monochrome), Abyss, Sakura, Matcha and
  Amber. Every text colour reads at 4.5:1 or more on its own background. A
  scheme saved by an earlier version switches to the nearest new one.

### Fixed

- Text an AI CLI draws on its own background colour (for example Claude Code's
  diff rows) is lightened or darkened when it would be too faint to read.
- Automatic project grouping now follows a tab when it changes to a folder that
  is not a project (home, a drive root, Desktop). Before, the tab stayed in the
  group of the folder it was opened in.

## [0.8.1] - 2026-10-14

### Changed

- Settings has a new "Tabs & AI" page holding "Auto-group by project",
  "Precise AI status" and "Image paste", which sat on the Terminal page in
  0.8.0. Terminal keeps font, cursor and performance. "Group tabs by project" is
  now "Auto-group by project" and "Grok full-screen surface tint" is "Grok
  full-screen tint".
- Settings text is shorter: a description stays only where the title and the
  options do not already say it, and the ones that repeated their control
  (appearance mode, cursor style, UI zoom) are gone.
- Corner radii come in two steps: cards, menus, dialogs, toasts and the window
  card are 8 px; fields, buttons and rail rows are 4 px.

### Fixed

- The Image paste dropdown no longer opens past the edge of its card. A long
  description now stays beside the control instead of pushing it onto its own
  row.

## [0.8.0] - 2026-10-14

### Added

- Tab groups. Tabs can be gathered into groups in the rail: a group has a
  header you can collapse and expand (with a short animation), rename or
  dissolve from its menu. A collapsed group shows how many
  tabs it holds and the most urgent status among them. Drag a tab into, out
  of or within a group, or drag a whole group; the rows slide aside while you
  drag and Esc puts everything back. Groups, their names and whether they
  are collapsed are restored after a restart, and so are tab renames.
- Automatic grouping by project. Tabs working in the same project folder (the
  Git root, else the folder itself) are grouped for you, whether it is Claude
  Code launched there or a shell that `cd`s into it, and the group is titled
  after the folder. A tab you move, group or ungroup yourself is never moved
  again; "Group automatically" in its menu hands it back. Setting "Group tabs
  by project" (on by default) turns it off, which stops all automatic moves.
- A status icon on every tab running an AI CLI: working (spinning), waiting for
  you, done, or failed. With the new "Precise AI status" setting (on by
  default, new tabs only) Claude Code reports these exactly, by running the tab
  on the console host bundled with Zinc; with it off, only working and idle are
  guessed from the title.
- A tab whose title is only a spinner or a default AI name now shows its
  project folder instead.

### Changed

- Ctrl+V with an image on the clipboard hands it straight to Claude Code,
  Codex, Kimi or Grok, which read the clipboard themselves (`[Image #1]`), and
  nothing is saved. A plain shell or WSL, or the new "Always save as a file"
  choice of the Image paste setting, still pastes the path of a saved copy.
- The default scrollback for a fresh install is 3000 lines instead of 10000 (a
  full 10000-line buffer costs about 17 MB per tab). A value already stored in
  your settings is kept.
- All terminals now share one output-reading worker instead of one each: about
  81 MB less memory with 12 tabs open and about 135 MB less with 20
  (development-build measurement).
- The spinning working icon turns in steps rather than continuously, so a
  window full of working sessions no longer keeps the GPU busy (14 working tabs,
  idle window: frames over 33 ms went from about 14% to none).

### Removed

- Wheel paging for Kimi's fullscreen mode. With Kimi's `tui_mode = "fullscreen"`
  the mouse wheel now recalls Kimi's input history instead of scrolling.

### Notes

- The first launch after updating groups the tabs you reopen by project. If you
  would rather arrange them yourself, turn "Group tabs by project" off in
  Settings.

## [0.7.4] - 2026-10-12

### Changed

- Terminals draw with the DOM renderer again by default. 0.7.3 switched the
  visible tab to the xterm.js WebGL renderer, whose glyph atlas comes out
  roughly a fifth lighter than DOM text. GPU rendering is now an opt-in
  setting ("GPU rendering"), and when it is on the glyph weight is nudged to
  Medium, which brings its ink coverage within 2% of the DOM renderer's
  (measured with JetBrains Mono 17 px at 150% scaling, light and dark).
  Hidden tabs still stop painting, which is where most of 0.7.3's
  responsiveness gain comes from.

## [0.7.3] - 2026-10-12

### Changed

- Hidden tabs stop painting their output; it is still read and shown up to
  date on return. With several busy tabs the visible one no longer stutters
  (development-build benchmark, nine simulated redrawing background tabs:
  interface thread 88% → 15% busy, p95 keystroke latency 80 ms → 32 ms).
- The visible tab renders with the xterm.js WebGL addon, falling back to the
  DOM renderer if WebGL is unavailable or its context is lost.
- Animated tab titles are applied in batches, and the hidden Settings page no
  longer re-renders on every title change.
- Pasted images are saved without blocking the main process, and periodic
  session saving reads the Claude session files once per round.

### Fixed

- A background tab that finished starting late no longer takes keyboard focus.
- Transparent-background color rewriting no longer mistakes extended-color
  operands (e.g. `38;2;40;40;40`) for a black background, recognises the
  colon form with a color-space id, and applies in place instead of
  re-queuing, so colors no longer depend on how output is split.
- Scrolling up during output holds its position.
- The "process exited" notice follows the program's final output; exited
  tabs still re-fit on resize.
- OSC 11 background-color queries are answered again.

## [0.7.2] - 2026-10-02

### Fixed

- Claude tabs whose conversation was moved to the background (the agents
  view, `←`) come back to that live conversation on the next start. Claude
  forks such a conversation into a background job under a new session ID, so
  Zinc's saved ID went stale: restore either reopened an outdated copy next to
  the still-running job, or failed with "is running in the background … stop
  it there first to resume it here". Restore now follows Claude's hand-off
  record and runs `claude attach` for a live job, or resumes the newest copy
  when the job has ended. Background jobs are never started, stopped or
  changed by Zinc; if `claude agents` is unavailable, restore falls back to
  the previous behavior.

## [0.7.1] - 2026-10-01

### Fixed

- Tabs whose Claude conversation had already been quit still resume that
  conversation on the next start. A conversation lives on disk, so the absence
  of a live Claude process no longer discards the tab's saved session ID — only
  a live process that reports an unusable ID drops the old one. Previously
  only the tabs whose Claude was still running came back, and tabs left idle
  for hours reopened as plain shells.

## [0.7.0] - 2026-09-29

### Fixed

- Claude conversations in separate tabs under the same directory resume by
  their own session IDs, rather than all opening the newest conversation.
  Zinc's per-process `--settings` SessionStart hook captures identities for
  restored sessions and interactive, directly typed `claude` commands in
  supported shells. Full-path launches, scripts, and manually started WSL
  Claude sessions are not covered; unknown identities reopen conservatively
  instead of attaching to another tab's conversation.
- Shutdown persistence, process detection, shell discovery, update errors,
  clipboard-image paths, and external-link errors are handled more reliably.

## [0.6.11] - 2026-09-19

### Added

- Optional "Grok full-screen surface tint" appearance setting: while Grok's
  full-screen TUI is on screen, the terminal card (and xterm's own background)
  takes Grok's surface colour instead of the selected scheme's, so Grok's
  self-painted canvas no longer sits inside a differently coloured frame. The
  rail, the ANSI palette and every other tab keep the selected scheme, and the
  colour fades rather than snapping. No effect at terminal opacity 0, where
  Grok's background is already rewritten to the transparent default.

## [0.6.10] - 2026-09-19

### Fixed

- Inverse (reverse-video) terminal text is readable again on light colour
  schemes. Blocks that a TUI draws that way — Claude Code styles whole
  messages like this — rendered as a solid dark bar with the text invisible
  inside it.

## [0.6.9] - 2026-09-19

### Fixed

- A long IME composition (for example continuous Pinyin typing) no longer
  pushes the terminal off to the left with no way to scroll back.
- Restoring a session no longer collapses several tabs onto one conversation:
  `--continue` resumes the newest session for a working directory, so only one
  tab per tool and directory now uses it and the rest reopen as a plain shell
  in the right place.
- Kimi Code is detected and restored like the other CLIs instead of being saved
  as "no tool".
- Full-screen wheel paging applies to Kimi only. vim, less, htop and the Codex
  and Grok TUIs keep xterm's native line scrolling.

## [0.6.8] - 2026-08-25

### Fixed

- Kimi full-screen wheel paging now owns the wheel exclusively: one Windows
  notch is one page, and xterm no longer also line-scrolls the conversation.

## [0.6.7] - 2026-08-25

### Added

- Optional "Kimi full-screen wheel paging" terminal setting: when on, the mouse
  wheel sends PageUp/PageDown to Kimi's full-screen TUI (alternate buffer with
  SGR mouse tracking) instead of line-scrolling, paging through the conversation.

### Fixed

- Settings files that start with a UTF-8 BOM (Windows PowerShell
  `Set-Content -Encoding utf8`) load again instead of being treated as
  corrupt and replaced by defaults.

## [0.6.6] - 2026-08-23

### Fixed

- Update and changelog dialogs use an opaque popup surface so About text no
  longer shows through the modal.
- Remote GitHub Release asset dumps (installer names, checksums, download
  instructions) are no longer shown in the update dialog when local notes are
  missing.

### Changed

- About page keeps the product mark, version, update action, and quiet legal
  links. The Electron/Chromium/Node/V8 grid and warranty paragraphs are gone.

## [0.6.5] - 2026-08-23

### Fixed

- Session restore now writes `session-state.json` on a running-app interval and
  after tab changes, keeps last-known working directories / AI tools when a
  scan misses, and no longer types `codex resume --last` into every Codex tab.

## [0.6.4] - 2026-08-02

### Fixed

- Update dialog release notes: prefer local bilingual `changelogEntries` bullets
  over the GitHub Release body, and strip HTML when falling back to remote notes
  so GitHub-rendered tags no longer appear as plain text.

### Changed

- Release process documents that each ship must add a matching
  `changelogEntries.ts` entry for the in-app update dialog.

## [0.6.3] - 2026-08-01

### Changed

- Settings and update UI copy (zh-CN / en-US): shorter, factual strings; About
  tagline matches product positioning (lightweight Windows terminal, vertical
  tabs); AI resume descriptions clarify local continue/resume only (no agent
  proxy, no upload).
- Website (zincli.org) marketing copy and layout rework is tracked in the Zinc
  Web repository; download links follow the published GitHub Release tag.

## [0.6.2] - 2026-07-25

### Added

- Quiet packaged startup update check against GitHub Releases so an update badge
  can appear beside Settings without opening About.
- Rail update badge and a centered update dialog with version, progress, and
  release notes.
- Shared local changelog entries for About and the update dialog fallback.

### Changed

- Updater enables `autoDownload` while keeping install explicit (`autoInstallOnAppQuit` off).
- Settings → About collapses update actions to a single check / restart control.
- Privacy and architecture docs document the startup check and auto-download path.
- Version source is `app/package.json` at 0.6.2.
- Release workflow pins the previous public setup to reviewed `v0.6.1` for the
  installer upgrade acceptance path.

### Fixed

- OSC 8 / CLI hyperlinks open in the system browser immediately instead of
  xterm's confirm + blocked `window.open` path.

## [0.6.1] - 2026-07-24

### Added

- Vertical tab-rail drag reorder: free X/Y follow-hand ghost, frozen list order
  during drag, sibling shift gap, insertion line, and dock accent when the drop
  slot differs from the origin.
- Unit coverage for the shipped drop-index helpers (ghost-center probe, boundary
  hysteresis, `moveItem`, shift/line geometry).

### Fixed

- Drop targeting now uses the ghost card’s vertical center (not raw pointer Y)
  and hysteresis on shared slot boundaries, so an insert that already looks
  between rows actually commits.
- Display tab numbers stay positional `1…n` through drag, close, and reorder.
- Tab rail labels are non-selectable so pointer drag is not stolen by text selection.

### Changed

- Version source is `app/package.json` at 0.6.1.
- Release workflow pins the previous public setup to reviewed `v0.6.0` for the
  installer upgrade acceptance path.

## [0.6.0] - 2026-07-24

### Added

- Session restore can resume Grok Build CLI sessions via `grok --continue` when
  a tab was running `grok` and **Resume AI conversations** is enabled (alongside
  existing Claude / Codex resume commands).
- Automated coverage for default daily keyboard shortcuts (new/close/next/prev
  tab, open settings, zoom in/out/reset) via unit tests on the shipped
  accelerator modules and a CDP verify journey.

### Changed

- Repositioned Zinc as a lightweight multi-shell Windows terminal launcher
  with a modern UI, low background overhead, and PowerShell-first multi-shell
  discovery.
- Version source is `app/package.json` at 0.6.0.
- Windows distribution is **NSIS-only** (`Zinc-<version>-Setup.exe`). The nested
  Electron custom installer wrapper and `app/installer/` were removed.

### Removed

- Removed the AI usage status bar UI, its settings controls, IPC, utility-process
  worker, and Claude/Codex usage polling. Obsolete status-bar keys are stripped
  from existing `settings.json` files on load.
- Removed AOD (always-on display), OLED burn-in protection, and the Linux-only
  screen brightness control. Legacy keys are stripped on load.
- Optional AI conversation resume (`ResumeAiConversations`) is unchanged.

### Fixed

- CDP / isolated test shells no longer append markers to the developer's global
  PSReadLine or bash history (`ZINC_TEST_ISOLATED` / `ZINC_TEST_USER_DATA`).
- With **Terminal opacity** at 0, black/near-black full-screen TUI backgrounds
  (Grok, Claude, Codex, …) are rewritten to the transparent default over Acrylic.

## [0.5.0] - 2026-07-12

### Added

- Public project documentation in English and Simplified Chinese, including
  contribution, conduct, security, privacy, support, troubleshooting, release,
  installer, and third-party notice pages.
- Repeatable public-tree privacy and secret checks integrated with CI.
- Dependabot configuration and structured GitHub issue/PR templates.
- Custom installer payload verification and a repeatable Windows installation
  matrix runner for release acceptance.
- GitHub Releases updater controls and deterministic release asset checksums.
- Automatic discovery of PowerShell 7, Windows PowerShell, Command Prompt,
  Git Bash, and installed WSL distributions, with per-tab shell selection and
  a configurable default shell.
- CDP release smoke coverage for terminal layout, settings, tab behavior, and
  detected-shell flows.
- Release tests for updater state transitions, installer shutdown policy, and
  packaged PowerShell terminal startup after every install transition.

### Changed

- Prepared the Electron application and custom installer metadata for version
  0.5.0 under AGPL-3.0-only.
- Reduced the formal release to Zinc's focused terminal feature set.
- Replaced tracked local Windows Terminal settings with a synthetic example and
  ignored real developer snapshots.
- Sanitized historical documentation and archived defaults that contained local
  machine information.
- Changed the custom installer to request a graceful application shutdown
  before replacement, require confirmation before a forced close, and make
  downgrade, uninstall, and wizard transitions explicit.

### Removed

- Removed the former remote companion panel, its network client, embedded
  canvas, notifications, and mock server from the public runtime.
- Upgrades now remove that feature's legacy connection settings without
  logging their contents.

### Fixed

- Prevented terminal input near the left edge from being clipped during resize
  and layout changes.
- Strengthened terminal sizing and scroll-position handling across tab and
  window transitions.
- Restored tab renaming with an inline editor that can be confirmed or
  cancelled without losing the existing title.
- Corrected CDP assertions so the release gate observes the rendered terminal
  and current settings state rather than stale test assumptions.
- Restored the original 3D Z artwork across the app, Windows executables,
  shortcuts, installer windows, and installer wizard artwork.

### Security

- Added a least-privilege CI privacy gate for secrets, private paths, local
  configuration, and unsafe publication artifacts.
- Documented private vulnerability reporting and release-history review before
  changing repository visibility.

## Earlier Development Snapshots

Versions before 0.5.0 were private development snapshots used during the WinUI
prototype, Electron migration, and packaging work. They are not supported public
release lines. Sanitized migration context remains in `docs/` and `archive/`.

[Unreleased]: https://github.com/Map0u/Zinc-cli/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/Map0u/Zinc-cli/releases/tag/v0.6.1
[0.6.0]: https://github.com/Map0u/Zinc-cli/releases/tag/v0.6.0
[0.5.0]: https://github.com/Map0u/Zinc-cli/releases/tag/v0.5.0
