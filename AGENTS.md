# Zinc Agent Notes

## Scope

Build Zinc as a small Electron-based Windows terminal with a vertical tab rail.
The active codebase is `app/` (Electron, electron-vite, React, xterm.js, and
`node-pty`). The archive contains isolated historical feasibility experiments,
not an alternative product implementation.

## Product Boundaries

1. Support PowerShell 7 first.
2. Preserve the vertical tab rail, Acrylic-style window, terminal behavior,
   settings, status bar, and session restore unless a task changes them.
3. Keep the implementation small. Do not add accounts, sync, a plugin system,
   built-in SSH/WSL profile management, pane splitting, or broad automation
   without an explicit product decision.
4. Never commit real terminal history, local settings snapshots, screenshots,
   user paths, hostnames, IP addresses, tokens, private keys, or signing material.

## Development Rules

- Confirm paths before creating or moving files.
- Run active app commands from `app/` and use PowerShell 7 syntax for Windows scripts.
- Write text files as UTF-8 without BOM.
- Prefer command-line checks. For UI work, use the Electron dev CDP endpoint
  documented in `docs/TROUBLESHOOTING.md` before coordinate-based automation.
- Read `docs/ARCHITECTURE.md`, `docs/RELEASE.md`, and `docs/INSTALLER.md` before
  changing their corresponding systems.
- Keep current guidance in the main documentation path and historical evidence
  under `archive/`.

## Version and Release Policy

- `app/package.json` is the Electron application version source.
- Keep app and custom-installer package/lock versions aligned for a release.
- Do not bump versions, create tags, publish artifacts, or change repository
  settings without explicit approval.
- Release tags use `v<semver>` and the annotated tag message
  `chore(release): v<semver>`.

## Git Workflow

- `main` is the formal release branch; larger work belongs on a focused branch.
- Preserve unrelated work in a dirty worktree.
- Prefer one Conventional Commit per accepted logical unit.
- Do not rewrite published history or force-push unless explicitly authorized.

## Verification

Minimum source checks:

```powershell
cd app
npm run typecheck
npm run build
node ../scripts/verify-public-tree.mjs
```

Run packaging and Windows installation checks through the Windows environment as
described in `docs/RELEASE.md` and `docs/INSTALLER.md`.
