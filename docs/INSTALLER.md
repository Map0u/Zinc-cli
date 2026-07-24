# Installer

Zinc ships a single Windows distribution: an **NSIS** setup built by
electron-builder from `app/package.json`.

## Build

Run from `app/`:

```powershell
npm run dist
```

That produces `app/dist/Zinc-<version>-Setup.exe` (plus the auto-updater
blockmap and `latest.yml`).

The setup targets Windows x64, installs per user by default, can create Desktop
and Start menu shortcuts, and preserves user data during uninstall.

## Silent install and uninstall

NSIS silent flags:

```powershell
# Install or overwrite the same version
.\Zinc-<version>-Setup.exe /S

# Uninstall via the registry QuietUninstallString (electron-builder writes one),
# typically:
#   "…\Uninstall Zinc.exe" /currentuser /S
```

## Verification

After installing on Windows:

```powershell
pwsh ./app/scripts/verify-install.ps1 -ExpectedVersion 0.6.0
```

For the complete acceptance matrix (clean install, overwrite, reinstall,
optional upgrade, final uninstall, and a packaged PowerShell terminal smoke):

```powershell
pwsh ./app/scripts/verify-installer-matrix.ps1 `
  -SetupPath ./app/dist/Zinc-0.6.0-Setup.exe `
  -ExpectedVersion 0.6.0
```

Add `-PreviousSetupPath` with a reviewed older setup (and
`-PreviousExpectedVersion`) to exercise upgrade.

The matrix must confirm:

- clean install creates the application, uninstall entry, and expected shortcuts;
- overwrite and reinstall leave a usable installation of the expected version;
- upgrade replaces the older displayed version when a baseline is supplied;
- every installed state launches the packaged application, starts its PowerShell
  terminal, and returns a command marker through the rendered xterm surface;
- operations against a running Zinc force-close it first (NSIS does not host a
  second-instance quit UI);
- uninstall removes application files, shortcuts, and uninstall entry while
  preserving documented user data.

The matrix creates a unique marker under `%APPDATA%\zinc`, verifies that the
marker survives every install/uninstall transition, and restores or removes only
that marker in `finally`. Packaged-app CDP data is isolated under the ignored
`app/dist/installer-matrix-runtime/` directory. Run the matrix on a dedicated
Windows test account or disposable VM: it starts and stops Zinc processes and
finishes with Zinc uninstalled.

Pasted clipboard images are user data. Zinc accepts only supported image MIME
types with matching file structure, enforces a 25 MiB limit again in the main
service, and removes regular files older than 30 days only from its own
`PastedImages` directory at startup. Uninstall does not delete the rest of the
Zinc user-data directory.

## Release Safety

Do not commit generated setup executables, signing material, or local
verification logs. Release assets are generated in CI or a clean Windows build
environment and published with checksums.
