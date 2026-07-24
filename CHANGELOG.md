# Changelog

All notable public changes to Zinc are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and version numbers
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/Map0u/Zinc/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/Map0u/Zinc/releases/tag/v0.6.1
[0.6.0]: https://github.com/Map0u/Zinc/releases/tag/v0.6.0
[0.5.0]: https://github.com/Map0u/Zinc/releases/tag/v0.5.0
