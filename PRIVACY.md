# Privacy

[简体中文](PRIVACY.zh-CN.md) | English

This document describes the data boundary of the official Zinc source tree and
builds made from it. Modified distributions may behave differently.

## Data Zinc Stores Locally

Zinc uses Electron's per-user `userData` directory to store:

- application settings;
- session-restore metadata, including tab order and working directories;
- clipboard images pasted into a terminal, under a `PastedImages` directory.

Pasted images are given an absolute local path that Zinc types into the active
terminal. On startup, Zinc attempts to remove only regular files in its own
`PastedImages` directory that are more than 30 days old. Cleanup can be delayed
if Zinc is not started or a file cannot be accessed. Uninstalling Zinc may
preserve the whole user-data directory so a reinstall can retain settings.

These files can reveal private paths, shell choices, images, and work context.
They are not intended for source control or public bug reports.

## Local process inspection for session restore

When session restore and optional AI conversation resume are enabled, Zinc may
briefly inspect the process tree of a terminal tab at quit time to record
whether Claude or Codex was running and which working directory to restore.
That inspection is local, does not upload results, and is not continuous
polling. Turning off session restore or AI conversation resume reduces what is
recorded.

## Network Activity

Zinc does not include analytics, advertising telemetry, or a user account
service. A packaged build contacts GitHub Releases only when the user checks for
or downloads an update. Web links are opened in the system browser after scheme
validation.

Terminal commands, shells, developer tools, and child processes run by the user
are separate programs and may access the network according to their own
configuration and privacy policies. A path or value typed into such a program
is then handled by that program, not by Zinc's network code.

## Diagnostic Information

Zinc does not automatically upload terminal output, command history, settings,
session state, screenshots, or crash dumps. If a user voluntarily posts these
items to GitHub, GitHub's privacy terms apply and the content may become public.

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
- Disable AI conversation resume if quit-time process-tree inspection for
  Claude/Codex resume commands is unwanted.
- Delete pasted images and Zinc's local user-data directory when they are no
  longer needed; do not rely on startup cleanup for urgent deletion.
- Do not check for updates if you do not want Zinc to contact GitHub Releases.
- Review child-process privacy settings independently of Zinc.

Privacy-sensitive defects should be reported privately using
[`SECURITY.md`](SECURITY.md).
