# Security Policy

[简体中文](SECURITY.zh-CN.md) | English

## Supported Versions

Security fixes are prepared for the current `0.5.x` release line. Older
development snapshots are not supported. Upgrade to the newest available
release before reporting a problem that may already be fixed.

## Report a Vulnerability Privately

Use GitHub's **Private vulnerability reporting** for this repository when it is
available. Do not disclose the issue in a public Issue, Pull Request,
Discussion, screenshot, or log attachment.

Include only the information needed to reproduce and assess the problem:

- affected Zinc version and Windows version;
- attack prerequisites and expected impact;
- minimal reproduction steps or a proof of concept;
- whether installer, updater, preload/IPC, PTY, external-link, or local-file
  boundaries are involved;
- any suggested mitigation.

Remove unrelated terminal history, usernames, paths, tokens, hostnames, and
personal data. If private vulnerability reporting is unavailable, open a public
issue containing no vulnerability details and ask the maintainers for a private
contact channel.

The maintainers will acknowledge reports as capacity permits, validate the
impact, coordinate a fix and disclosure, and credit reporters who want public
credit. Please do not test against systems or data you do not own or have
permission to use.

## High-Risk Areas

- release metadata, checksums, auto-update, and installer payload integrity;
- preload APIs, IPC validation, context isolation, and navigation controls;
- PTY input/output and command argument handling;
- clipboard image persistence and local session/settings files;
- external URL opening and dependency supply chain.

Never commit secrets, signing material, private keys, real user configuration,
or unredacted diagnostic artifacts.
