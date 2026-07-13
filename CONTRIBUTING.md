# Contributing to Zinc

[简体中文](CONTRIBUTING.zh-CN.md) | English

Thank you for helping improve Zinc. The active application is the Electron app
in `app/`; the WinUI tree under `archive/` is historical reference only.

## Before You Start

- Search existing issues and pull requests before opening a duplicate.
- Use an issue for behavior changes that need design agreement.
- Keep Zinc focused. Large platform, account, synchronization, or plugin-system
  proposals require maintainer agreement before implementation.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md) and privacy rules below.

## Development Setup

Use Windows, PowerShell 7, and Node.js 22.12 or newer:

```powershell
cd app
npm ci
npm run typecheck
npm run build
npm run dev
```

Do not commit generated `node_modules/`, `out/`, `dist/`, installer payloads,
local settings snapshots, logs, or debug screenshots.

## Branches and Commits

- `main` is the release branch. Work in a focused feature or fix branch.
- Keep each pull request to one logical change when practical.
- Use Conventional Commit subjects such as `feat:`, `fix:`, `docs:`, or `chore:`.
- Do not rewrite published history or change release tags.
- Application version changes require an explicit release decision.

## Pull Requests

Describe the problem, the chosen behavior, and the verification performed. Add
or update tests when feasible. For UI work, include a redacted description or a
sanitized screenshot only when it materially helps review.

Minimum checks:

```powershell
cd app
npm run typecheck
npm run build
node ../scripts/verify-public-tree.mjs
```

Packaging, updater, and installer changes also require the checks documented in
[`docs/RELEASE.md`](docs/RELEASE.md) and
[`docs/INSTALLER.md`](docs/INSTALLER.md).

## Privacy and Secret Hygiene

Before committing, inspect the complete diff. Never add:

- passwords, API tokens, cookies, private keys, signing certificates, or recovery codes;
- personal email addresses, phone numbers, home directories, device names, hostnames,
  IP addresses, or private repository URLs;
- real terminal history, session state, Windows Terminal snapshots, crash dumps, or
  screenshots containing private paths or commands.

Use neutral placeholders such as `C:\Users\Example`, `example.invalid`, and
documentation-only IP ranges. Run `node scripts/verify-public-tree.mjs` from the
repository root before submitting.

## Licensing

By submitting a contribution, you agree that it may be distributed under this
repository's [AGPL-3.0-only license](LICENSE). Do not copy code or assets whose
license is incompatible or unknown. Record newly introduced third-party material
in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
