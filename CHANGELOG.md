# Changelog

All notable public changes to Zinc are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and version numbers
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
