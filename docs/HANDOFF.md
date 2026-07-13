# Zinc Maintainer Handoff

Zinc 0.5.0 uses the Electron application in [`app/`](../app/) as its only
implementation. [`archive/`](../archive/) contains isolated historical
feasibility experiments only.

Start with:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) for runtime boundaries.
- [`INSTALLER.md`](INSTALLER.md) for setup, wrapper, and Windows verification.
- [`RELEASE.md`](RELEASE.md) for version, checks, tag, and publication gates.
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) for common development and user failures.
- [`DOCS-MAINTENANCE.md`](DOCS-MAINTENANCE.md) before reorganizing documentation.

Routine source verification:

```powershell
cd app
npm ci
npm run typecheck
npm run build
node ../scripts/verify-public-tree.mjs
```

Do not publish a release until the Windows installer matrix, checksums, current
tree privacy scan, and manual release checklist all pass.
