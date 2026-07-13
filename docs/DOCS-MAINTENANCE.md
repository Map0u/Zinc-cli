# Documentation Maintenance

## Current Public Documents

- `README.md` and `README.zh-CN.md`: user entry points.
- `CONTRIBUTING*.md`, `CODE_OF_CONDUCT.md`: collaboration and governance.
- `SECURITY*.md`, `PRIVACY*.md`, `SUPPORT*.md`: reporting and data boundaries.
- `docs/ARCHITECTURE.md`: current runtime design.
- `docs/RELEASE.md` and `docs/INSTALLER.md`: release authority.
- `docs/TROUBLESHOOTING*.md`: operational help.
- `THIRD_PARTY_NOTICES.md`: direct dependency notice and review rule.

## Historical Material

`archive/`, `docs/MIGRATION-PARITY.md`, and `docs/ACCEPTANCE-0.2.0.md` are
historical evidence, not current behavior. Historical text must still be safe to
publish: remove private paths, machine facts, credentials, and terminal content.

## Rules

- Update user-facing docs and changelog with behavior changes.
- Keep English and Chinese entry points mutually linked and materially aligned.
- Use relative links for repository files and verify them before review.
- Use synthetic examples, not copied local configuration.
- Do not commit screenshots unless they are necessary, deliberately captured for
  publication, and reviewed at full resolution for personal information.
- Archive superseded long-form notes instead of leaving rolling handoffs on the
  current documentation path.
