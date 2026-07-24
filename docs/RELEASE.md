# Release Process

Zinc releases are built from `main`. The release tag is `v<semver>` and must
match `app/package.json` exactly.

## Version Sources

For 0.6.1, both files must report `0.6.1`:

- `app/package.json`
- `app/package-lock.json` (root package entry)

Update `CHANGELOG.md` in the same release unit. The root `VERSION` file belongs
to the retired implementation and is not release authority.

## Preflight

From the repository root and `app/` respectively:

```powershell
node --test app/tests/release/release-gates.test.mjs
node scripts/verify-public-tree.mjs
cd app
npm ci
npm run test:unit
npm run legal:check
npm run typecheck
npm run build
pwsh -NoProfile -File ./scripts/run-cdp-smoke.ps1
```

Review the complete diff and dependency changes. Confirm that documentation,
examples, screenshots, generated files, and archives contain no personal data or
secrets. Verify relative Markdown links and JSON parsing.

Normal pull-request and `main` CI runs the release-governance fixtures, the full
JavaScript unit suite, and `npm run legal:check`; these are review gates, not
tag-only checks.

Immediately before tagging, run `npm run legal:release`. Unlike the normal
consistency check, this release mode rejects every `BLOCKED` asset and any
blocked source-provenance status recorded in the generated notice. The tag
workflow repeats this strict gate.

## Build on Windows

```powershell
cd app
npm run dist
```

Expected artifacts:

- `Zinc-0.6.1-Setup.exe`
- `Zinc-0.6.1-Setup.exe.blockmap`
- `latest.yml`
- a release `SHA256SUMS.txt`
- `LICENSE`
- `THIRD_PARTY_NOTICES-0.6.1.md`
- `ASSET_PROVENANCE.md`
- `zinc-0.6.1.cdx.json` (CycloneDX 1.5 SBOM)

Run the NSIS acceptance matrix in [`INSTALLER.md`](INSTALLER.md). Test the
packaged application, not only the development server. The matrix must launch
every installed state and verify a PowerShell command through the rendered
terminal.

## Rehearse before tagging

A published release is not recoverable: users and the auto-updater can download it
the moment it exists, and a published tag must never be moved. Rehearse first.

1. Push `main` and wait for CI to pass on the exact release commit. The tag
   workflow rejects any tagged commit that is not the current `origin/main` tip,
   so `git push origin main` must happen before the tag, not with it.
2. Run the release workflow manually from `main` (`workflow_dispatch`). It builds
   Windows artifacts, verifies the packaged legal materials, runs the full NSIS
   acceptance matrix against the pinned previous-setup baseline (when configured),
   stages the eight assets and verifies the exact asset set and checksums — and
   then stops. The `publish` job runs only for a tag push, so a rehearsal cannot
   create, modify or publish a GitHub Release.
3. Download the rehearsal artifact and inspect the eight files by hand.

## Tag and Workflow

After all checks pass and the release commit is approved, create `v0.6.1` from
the exact `main` commit, as an annotated tag whose message is exactly
`chore(release): v0.6.1`. Pushing a `v*` tag runs
`.github/workflows/release.yml`. The workflow uses full checkout history and
rejects a lightweight tag, an unexpected tag message, a tag/version mismatch,
or any tagged commit other than the exact `origin/main` tip. This prevents
publishing directly from any non-release feature branch. It then builds Windows
x64 NSIS artifacts with read-only repository permission, verifies the legal files
inside the unpacked application, runs clean/overwrite/reinstall/final-uninstall
acceptance on the temporary runner, generates SHA-256 checksums, and transfers
one exact eight-file release set to a separate publication job, which rechecks
both the filename set and checksum manifest. Pin the previous public setup in
the workflow `env` block and supply it to
`verify-installer-matrix.ps1 -PreviousSetupPath` so the upgrade path is not
silently skipped. Update the pinned baseline deliberately for each later release.

The release body is the reviewed file `docs/RELEASE_NOTES/v<semver>.md`, not
auto-generated commit history: the internal history between releases includes
features that were removed again before shipping, and that page is what a
first-time user reads before deciding to trust an unsigned binary. The workflow
fails if the notes file for the tag is missing.

For 0.6.1, pin the previous public release (`v0.6.0`) in the workflow `env` block
when running the upgrade leg of the installer matrix. Clean install, overwrite,
reinstall, and uninstall remain required regardless.

**Always pin the previous release** in the workflow `env` block: tag,
setup filename, version, and the SHA-256 you reviewed at that release. The
baseline is then verified twice — against its own release `SHA256SUMS.txt` and
against `ZINC_PREVIOUS_SETUP_SHA256` in the workflow — because a release manifest
and the setup it vouches for live in the same mutable place, so one cannot be the
trust root for the other. The matrix also takes `-PreviousExpectedVersion`, so the
upgrade leg must prove *which* baseline it upgraded from rather than merely that
some older build was installed.

Only the final publication job receives `contents: write`. It refuses to run if
the tag already has either a draft or published GitHub Release, creates a new
draft with the complete reviewed asset set, and publishes that draft only after
all uploads succeed. It never uses asset replacement. If a failed run leaves a
draft, inspect it and resolve it deliberately; rerunning the workflow will not
mutate it.

Do not reuse or move a published tag. Fix a bad release with a higher version.

## Signing

The repository does not contain signing keys or certificates. An unsigned build
may trigger SmartScreen. If maintainers later configure code signing, secrets
must live only in the repository's protected secret store and release logs must
be checked for accidental disclosure.

## Auto-Update Acceptance

Install the previous public version, then test:

1. no-update behavior before publication;
2. update available detection after publication;
3. download progress and failure handling;
4. install/restart;
5. Settings > About and the Windows uninstall entry both show `0.6.1`.

## Repository Publication Checklist

Before changing a private repository to public:

- pass the current-tree privacy/secret gate;
- inspect Git history, tags, branches, old release assets, issue attachments,
  Actions artifacts, and caches separately (the current-tree script cannot
  sanitize history or remote objects);
- configure branch protection, required CI, private vulnerability reporting,
  issue templates, Dependabot, and least-privilege Actions permissions;
- confirm `README`, license, security, privacy, contribution, support, conduct,
  notices, and changelog pages render correctly on GitHub;
- publish only reviewed 0.6.1 artifacts and checksums.

### Copyright and asset gate

Run `npm run legal:generate` only when lockfiles or legal inputs intentionally
change, commit the generated notice/SBOM, then require `npm run legal:check` in
review and CI. [`../ASSET_PROVENANCE.md`](../ASSET_PROVENANCE.md) is a release
gate: every committed active **and archived** visual/font asset must have a
current hash and an explicit `APPROVED` redistribution decision. A `BLOCKED`
row means the repository is not ready to become public.

The current audit also records an upstream defect for `lazy-val@1.0.5`: its
official npm artifact and pinned upstream commit declare MIT but contain no
license-text file or copyright notice. Do not invent attribution. Keep the
generated notice intact and obtain upstream/counsel guidance or replace the
dependency if a reproduced copyright notice is required.

The retired prototype source was removed from the publication tree during the
source-provenance review. Do not restore archived source or copy code from local
experiments unless its authorship and license can be proven with durable
evidence.

The current-tree gate rejects every publication candidate under
`archive/winui-native-legacy/src/`. It also rejects removed-feature runtime
paths or markers under `app/src/` and `app/dev/`; the only narrow line-level
allowlist is the one-time legacy credential scrub in `SettingsService.ts`.

Do not rewrite public history casually. If historical secrets exist, revoke them
first and use a separately approved history-cleaning plan.
