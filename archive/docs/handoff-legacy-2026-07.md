# Sanitized Legacy Handoff (July 2026)

This archive replaces an internal rolling handoff that contained machine paths,
terminal content, local tool locations, and environment-specific diagnostics.
Those details are unnecessary for the public project and have been removed.

## Historical Sequence

1. Zinc began as a small WinUI 3 terminal prototype with a vertical rail,
   Windows material effects, PowerShell sessions, and imported appearance ideas
   from Windows Terminal.
2. The prototype added settings, session restore, localization, status display,
   clipboard image paste, and terminal-host experiments.
3. The project migrated to Electron, React, xterm.js, and `node-pty` to simplify
   terminal rendering and automated verification.
4. All active work moved to `app/`. The retired prototype source was later
   removed during the public-source provenance review; only isolated feasibility
   experiments remain under `archive/winui-native-legacy/`.
5. Later work added packaging, installer integrity checks, release automation,
   updater UI, and public maintenance documentation.

## Current Authority

This file is historical only. Use the root README and current files under
`docs/` for development, architecture, installer, release, and support rules.
