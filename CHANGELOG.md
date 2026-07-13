# Changelog

All notable public changes to Zinc are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and version numbers
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

No public changes yet.

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

[Unreleased]: https://github.com/Map0u/Zinc/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/Map0u/Zinc/releases/tag/v0.5.0
