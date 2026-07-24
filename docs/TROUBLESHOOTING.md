# Troubleshooting

[简体中文](TROUBLESHOOTING.zh-CN.md) | English

## Zinc Does Not Start

- Confirm Windows is x64 and PowerShell 7 is installed.
- Start Zinc from a PowerShell window to observe an immediate error.
- If a development build fails, run `npm ci`, `npm run typecheck`, and
  `npm run build` from `app/`.
- Do not post a full environment dump publicly; redact it first.

## Terminal Text Is Clipped or Misaligned

Reset UI zoom and terminal font size, maximize/restore the window once, and open
a new tab. Record the display scale, Zinc zoom, font name/size, and exact resize
sequence. A sanitized screenshot can help, but terminal contents and title-bar
paths must be hidden.

## Shell Cannot Be Created

Verify the configured shell executable exists and can be launched directly in
Windows. PowerShell 7 is normally installed at its standard system location.
Custom shells are supported at the user's own compatibility risk.

## Session Restore Is Unexpected

Disable session restore in Settings, close Zinc normally, and reopen it. Zinc
stores working directories locally; remove the session-state file from Zinc's
per-user data directory if a corrupt state persists.

## Installer or Update Fails

- Check that the installer filename and version match the release page.
- Compare its SHA-256 with `SHA256SUMS.txt`.
- Close all Zinc windows before retrying.
- For update problems, download the full setup from the same release and run an
  overwrite install.
- Do not bypass a payload-integrity error.

## Development UI Inspection

Development builds expose Electron CDP on `http://127.0.0.1:9336` only while the
dev renderer URL is active (`npm run dev` in `app/`). Packaged installs of Zinc
never open this port — that is intentional.

Project MCP `playwright-zinc` (see `.mcp.json` → `scripts/playwright-zinc-mcp.ps1`):

1. If `http://127.0.0.1:9336/json/version` responds, attach to Zinc Electron.
2. Otherwise start an **isolated headless Chromium** so file:// / docs / marketing
   mocks still work. It does **not** use the shared fatality Chrome on `9335`.

To drive the real app UI: run `cd app; npm run dev`, then re-invoke the MCP tools
(or restart the MCP server so it re-probes CDP). Prefer silent / isolated test
profiles (`ZINC_TEST_ISOLATED=1`) so automation does not steal focus.

Automated smoke (`ZINC_TEST_ISOLATED=1` and/or `ZINC_TEST_USER_DATA`) also
isolates shell history: PowerShell sessions force PSReadLine `SaveNothing` into
a path under the test profile, and bash-like shells get a private `HISTFILE`.
That keeps CDP/terminal markers out of the developer's global PSReadLine history
(`%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`).

For help after these checks, follow [`../SUPPORT.md`](../SUPPORT.md).
