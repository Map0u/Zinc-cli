# Privacy

[简体中文](PRIVACY.zh-CN.md) | English

This document describes the data boundary of the official Zinc source tree and
builds made from it. Modified distributions may behave differently.

## Data Zinc Stores Locally

Zinc uses Electron's per-user `userData` directory to store:

- application settings, including configured Codex session roots;
- session-restore metadata, including tab order and working directories;
- clipboard images pasted into a terminal, under a `PastedImages` directory.

Pasted images are given an absolute local path that Zinc types into the active
terminal. On startup, Zinc attempts to remove only regular files in its own
`PastedImages` directory that are more than 30 days old. Cleanup can be delayed
if Zinc is not started or a file cannot be accessed. Uninstalling Zinc may
preserve the whole user-data directory so a reinstall can retain settings.

These files can reveal private paths, shell choices, images, and work context.
They are not intended for source control or public bug reports.

## Optional AI Usage Status

When the AI usage status bar is enabled, Zinc performs local inspection for the
active terminal tab. It may:

- enumerate descendant process IDs, parent IDs, executable names, and transiently
  read descendant process command lines until it can identify Codex or Claude;
- read the tail (up to 256 KiB) of recent Codex session `.jsonl` files under
  configured native or WSL Codex roots, plus `config.toml`;
- read Claude status-line files named `cc_status.json`, `cc_daily.txt`, and
  `cc_weekly.txt` from the operating-system temporary directory.

For Codex, Zinc extracts only the model, reasoning effort, token count, usage
percentages, and reset times needed by the status bar. It does not display or
persist prompts, responses, or other raw JSONL content. For Claude, it extracts
the model, effort, context-token count, usage percentages, and reset times from
the JSON file and displays the daily and weekly cost text. The Claude files are
optional local outputs created by the user's Claude/status-line setup; they are
not Zinc data and Zinc does not create or manage them.

Raw command lines and source-file content are not sent to the renderer, saved by
Zinc, or uploaded. Parsed status values may be kept in bounded worker memory
while Zinc is running. Status errors emit only a generic classification to
standard error; Zinc does not write an AI-status error file. Command lines,
JSONL files, and third-party status files can nevertheless contain sensitive
information, so other local software that can read the terminal or process
memory remains part of the user's local security boundary.

At startup Zinc may query installed WSL distribution names and each
distribution's default `$HOME` to discover its default user's `.codex` root.
This discovery does not enumerate every `/home` directory. Turning off **Show
AI usage status bar** stops recurring process inspection and usage-file reads;
the startup WSL-root discovery may still run. Unchecking an individual tool
prevents Zinc from reading that tool's usage files after detection.

## Network Activity

Zinc does not include analytics, advertising telemetry, or a user account
service. A packaged build contacts GitHub Releases only when the user checks for
or downloads an update. Web links are opened in the system browser after scheme
validation. AI status inspection is local and Zinc does not upload its results.

Terminal commands, shells, developer tools, and child processes run by the user
are separate programs and may access the network according to their own
configuration and privacy policies. A path or value typed into such a program
is then handled by that program, not by Zinc's network code.

## Diagnostic Information

Zinc does not automatically upload terminal output, command history, settings,
session state, screenshots, status-source content, or crash dumps. If a user
voluntarily posts these items to GitHub, GitHub's privacy terms apply and the
content may become public.

Before sharing diagnostics, remove usernames, local and network paths, command
history, process command lines, environment variables, tokens, cookies,
hostnames, IP addresses, repository names, images, and document contents. A
minimal textual reproduction is preferred over a full screenshot or settings
file.

## Windows Terminal Settings Examples

The repository contains only a synthetic example. A developer may create a
local Windows Terminal settings snapshot for testing, but the real snapshot is
ignored by Git and must never be committed.

## Your Choices

- Disable session restore if working-directory persistence is unwanted.
- Disable the AI usage status bar if local process and usage-file inspection is
  unwanted; separately protect or remove third-party status files.
- Delete pasted images and Zinc's local user-data directory when they are no
  longer needed; do not rely on startup cleanup for urgent deletion.
- Do not check for updates if you do not want Zinc to contact GitHub Releases.
- Review child-process privacy settings independently of Zinc.

Privacy-sensitive defects should be reported privately using
[`SECURITY.md`](SECURITY.md).
