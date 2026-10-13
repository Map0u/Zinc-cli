# Zinc

[**Official Website: zincli.org**](https://zincli.org)

[![简体中文](https://img.shields.io/badge/Language-简体中文-blue.svg?style=flat-square)](./README.zh-CN.md)

> A modern, native-like terminal for Windows, crafted with a focus on simplicity and design.

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/Map0u/Zinc-cli?style=flat-square)](https://github.com/Map0u/Zinc-cli/releases/latest)
[![GitHub Downloads (latest)](https://img.shields.io/github/downloads/Map0u/Zinc-cli/latest/total?style=flat-square)](https://github.com/Map0u/Zinc-cli/releases/latest)
[![License: AGPL-3.0-only](https://img.shields.io/github/license/Map0u/Zinc-cli?style=flat-square)](./LICENSE)
[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/Map0u/Zinc-cli/ci.yml?branch=main&style=flat-square)](https://github.com/Map0u/Zinc-cli/actions)

Zinc is a terminal for Windows 10/11, designed for developers who want a clean, efficient, and highly integrated command-line workspace. It pairs a deliberate vertical-tab layout with a focused feature set—powerful where it matters, quiet where it does not.

**[Download from the official website](https://zincli.org)** · **[GitHub Releases](https://github.com/Map0u/Zinc-cli/releases/latest)**

---

## Design Philosophy

Zinc is built on a clear set of principles:

*   **Simplicity by Design:** A terminal should be powerful yet uncluttered. Zinc ships the essentials and refuses the rest.
*   **Aesthetic Integration:** A frameless Acrylic-style window and a vertical tab rail that feels at home on a modern Windows desktop.
*   **Local-First Privacy:** Zero analytics telemetry. Settings and session metadata stay on your machine, and so do any pasted images Zinc has to save. Optional update checks contact GitHub Releases only.

## Key Features

*   **Vertical Tab Bar:** Manage many sessions with full names visible—no guessing behind ellipses.
*   **Tab Groups:** Sessions working in the same project folder group themselves, with a status icon per session and a summary on the collapsed group. Drag tabs or whole groups, name or collapse them; anything you place yourself is never moved again (switch it off in Settings).
*   **Automatic Shell Detection:** PowerShell 7, Windows PowerShell, CMD, Git Bash, and installed WSL distributions.
*   **Modern Aesthetics:** Frameless Acrylic-style chrome, themes, and opacity controls.
*   **Deep Customization:** Fonts, colors, shortcuts, zoom, scrollback, and more.
*   **Session Persistence:** Restore tab order and working directories after a restart.
*   **Intelligent Interaction:**
    *   **Clickable Links:** Open URLs in your system browser.
    *   **Image Paste:** Ctrl+V sends a clipboard image straight to Claude Code, Codex, Kimi, or Grok (the CLI reads the clipboard itself, no file is saved); in a plain shell, in WSL, or with the "Always save as a file" setting it pastes a local file path instead.
    *   **Continuation Assistance:** A local-only helper that can type `claude --continue` or `grok --continue` for you—no AI core, no upload of terminal content.
*   **Optional Updates:** Quiet checks against GitHub Releases when enabled.
*   **Multilingual UI:** English and Simplified Chinese.

## What Zinc Will Not Do

To maintain its focus on being a lean and fast terminal, Zinc deliberately avoids certain features:

*   Cloud Sync & User Accounts
*   Plugin Marketplace or Extension APIs
*   Split Panes (focus is on tab/window management)
*   Built-in SSH Profile Management

## Installation

1.  Navigate to the [**official website**](https://zincli.org) or the [**Releases**](https://github.com/Map0u/Zinc-cli/releases/latest) page.
2.  Download the `Zinc-0.6.8-Setup.exe` installer.
3.  Run the installer.

> **Note on Windows SmartScreen:**
> The application is not code-signed. As a result, Windows SmartScreen will likely display a warning. To proceed, click "More info" and then "Run anyway".
>
> To verify the integrity of the installer, you can compare its SHA256 hash with the one provided in `SHA256SUMS` on the release page. Open PowerShell and run the following command:
>
> ```powershell
> Get-FileHash .\Zinc-0.6.8-Setup.exe -Algorithm SHA256
> ```

## Privacy and Security

Zinc is designed with your privacy as a top priority.

*   **Zero Telemetry:** The application collects no analytics or usage data.
*   **Local Data Storage:** All settings, session metadata, and any pasted image files (only written when an image is not handed straight to an AI CLI) are stored exclusively on your local machine.
*   **Network Activity:**
    *   Zinc itself only connects to the internet to check for updates from the GitHub Releases API, an optional feature.
    *   The terminal subprocesses (e.g., PowerShell, WSL, curl) can access the network as they normally would.
*   **No AI, No Uploads:** The session continuation feature is a simple command-typing macro and does not involve any AI models or upload your terminal contents.

For more details, see [Privacy](./PRIVACY.md) and [Security](./SECURITY.md).

## For Developers

### Prerequisites

*   Node.js ≥22.12
*   Windows 10/11 x64

### Getting Started

The active application lives in [`app/`](./app/). The `archive/` directory keeps isolated historical experiments only—not a second product tree.

```powershell
# Clone the repository
git clone https://github.com/Map0u/Zinc-cli.git
cd Zinc/app

# Install dependencies
npm ci

# Run type-checking
npm run typecheck

# Start the development server
npm run dev

# Build the application
npm run build

# Package the application for distribution
npm run dist
```

Contributions are welcome. Read [Contributing](./CONTRIBUTING.md), [Architecture](./docs/ARCHITECTURE.md), and [Troubleshooting](./docs/TROUBLESHOOTING.md) before larger changes.

## License

This project is licensed under the [AGPL-3.0-only](./LICENSE).

---

[Official Website](https://zincli.org) | [GitHub Repository](https://github.com/Map0u/Zinc-cli)
