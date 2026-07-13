# Zinc

[简体中文](README.zh-CN.md) | English

Zinc is a focused Windows terminal built with Electron, React, xterm.js, and
`node-pty`. It puts PowerShell 7 first and keeps the interface compact: a
vertical tab rail, an Acrylic-style window, practical terminal settings, and
session restore that attempts to resume the most recent AI conversation.

The active application is in [`app/`](app/). The archive retains only isolated
historical feasibility experiments; it is not a second product implementation.

## Highlights

- Vertical terminal tabs with create, rename, duplicate, and close flows.
- Auto-detected shells — PowerShell 7, Windows PowerShell, Command Prompt,
  Git Bash, and installed WSL distributions — backed by ConPTY through
  `node-pty` and xterm.js, with a per-tab shell picker and a configurable
  default.
- Acrylic-style frameless Windows UI with light/dark and accent-aware settings.
- Configurable fonts, colors, opacity, shortcuts, status bar, zoom, scrollback,
  and session restore.
- Clipboard image paste, clickable web links, and new or duplicated tabs that
  try to inherit the current working directory; later shell directory changes
  may not be reflected.
- Per-user Windows NSIS setup, a verified portable custom installer wrapper,
  and an optional GitHub Releases update flow.
- English and Simplified Chinese interface resources.

Zinc intentionally does not provide cloud sync, accounts, a plugin platform,
pane splitting, or built-in SSH profile management.

## Requirements

- Zinc 0.5.0 supports Windows only: Windows 10 or Windows 11, x64. No other
  platform is planned.
- [PowerShell 7](https://github.com/PowerShell/PowerShell) is the recommended
  default shell. When it is not installed, Zinc automatically falls back to
  Windows PowerShell or Command Prompt.
- Git Bash and WSL are optional shells: they appear only when you have already
  installed them yourself.
- A normal per-user installation does not require Zinc to run as administrator,
  and does not require a separate Node.js installation.

## Install

Download `Zinc-<version>-Setup.exe` (the NSIS installer) from the repository's
GitHub Releases page — that is the one to use for a first install. The
`Zinc-<version>-Installer.exe` in the same release is a repair tool for
overwrite installs, reinstalls, and uninstalls; it embeds the same Setup, which
is why it is roughly twice the size. It is not a portable build of Zinc.

Zinc is not code-signed, so Microsoft Defender SmartScreen will block the first
run. Download `SHA256SUMS.txt` from the same release, run
`Get-FileHash .\Zinc-<version>-Setup.exe -Algorithm SHA256` in your download
folder, and compare it against the line for that exact filename. Run the file
only if the values match; delete it if they do not.

## Development

Install Node.js 22.12 or newer, then run the following commands in PowerShell:

```powershell
cd app
npm ci
npm run typecheck
npm run build
npm run dev
```

Windows packaging commands are also run from `app/`:

```powershell
npm run dist
npm run installer:dist
```

See [Contributing](CONTRIBUTING.md), [Architecture](docs/ARCHITECTURE.md), and
[Troubleshooting](docs/TROUBLESHOOTING.md) before making larger changes.

## Privacy and Security

Zinc has no built-in analytics or advertising telemetry. Settings, restored
session metadata, and pasted clipboard images are stored locally. Terminal
commands and child processes can still access the network, and checking for
updates contacts GitHub Releases. Read [Privacy](PRIVACY.md) for the complete
data boundary and [Security](SECURITY.md) before reporting a vulnerability.

Never attach unredacted terminal screenshots, logs, configuration files, or
session state to a public issue. They can contain usernames, paths, commands,
tokens, hostnames, and working directories.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Installer behavior](docs/INSTALLER.md)
- [Release process](docs/RELEASE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Support](SUPPORT.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Changelog](CHANGELOG.md)

## License

Zinc is distributed under the [GNU Affero General Public License v3.0 only](LICENSE).
Third-party components remain under their respective licenses; see
[Third-party notices](THIRD_PARTY_NOTICES.md).
