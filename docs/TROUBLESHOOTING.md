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
dev renderer URL is active. Prefer project-scoped Playwright/CDP checks and a
silent test mode so automation does not steal focus. Packaged builds must not
expose this debugging endpoint.

For help after these checks, follow [`../SUPPORT.md`](../SUPPORT.md).
