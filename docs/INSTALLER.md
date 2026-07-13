# Installer

Zinc has two Windows distribution layers:

- an NSIS setup built by electron-builder from `app/package.json`;
- a small custom Electron wrapper in `app/installer/`.

## NSIS Setup

Run from `app/`:

```powershell
npm run dist
```

The setup targets Windows x64, installs per user by default, can create Desktop
and Start menu shortcuts, and preserves user data during uninstall.

## Custom Installer

```powershell
npm run installer:dist
```

The preparation step copies the current NSIS setup to the wrapper payload and
writes `payload-manifest.json` with version, filename, size, and SHA-256. The
wrapper must reject a missing, renamed, truncated, or hash-mismatched payload.

Supported scenarios are clean install, overwrite of the same version, upgrade
from an older version, reinstall, and uninstall. The wrapper closes a running
Zinc process when required, invokes the appropriate silent installer/uninstaller,
then re-reads the Windows uninstall registry state.

Registry uninstall commands are parsed as an absolute `.exe` plus an argument
array and launched without `cmd.exe` or another command shell. Commands with
shell operators, environment expansion, malformed quoting, or a non-absolute
executable are rejected. Payload-verification errors are intentionally generic
and do not expose local build or installation paths.

## Verification

After installing on Windows:

```powershell
pwsh ./app/scripts/verify-install.ps1 -ExpectedVersion 0.5.0
```

For the complete matrix:

```powershell
pwsh ./app/scripts/verify-installer-matrix.ps1 `
  -InstallerPath ./app/dist/custom-installer/Zinc-0.5.0-Installer.exe `
  -ExpectedVersion 0.5.0
```

Add `-PreviousSetupPath` with a reviewed older setup to exercise upgrade.

The acceptance matrix must confirm:

- clean install creates the application, uninstall entry, and expected shortcuts;
- overwrite and reinstall leave a usable 0.5.0 installation;
- upgrade replaces the older displayed version;
- every installed state launches the packaged application, starts its PowerShell
  terminal, and returns a command marker through the rendered xterm surface;
- operations against a running Zinc first request normal session-preserving
  shutdown, while older versions have a verified headless force-close fallback;
- corrupted payload bytes or manifest are rejected;
- uninstall removes application files, shortcuts, and uninstall entry while
  preserving documented user data.

The matrix first runs all custom-installer unit tests, including payload,
uninstall-command, and shutdown-policy fixtures. It then creates a unique marker
under `%APPDATA%\zinc`, verifies that the marker survives every install/uninstall
transition, and restores or removes only that marker in `finally`. Packaged-app
CDP data is isolated under the ignored `app/dist/installer-matrix-runtime/`
directory. The running-application shutdown cases use the same isolated data
root for both the first process and the installer's second-instance quit request;
all matrix runtime data is removed afterward. Run the matrix on a dedicated
Windows test account or disposable VM: it starts and stops Zinc processes and
finishes with Zinc uninstalled.

Pasted clipboard images are user data. Zinc accepts only supported image MIME
types with matching file structure, enforces a 25 MiB limit again in the main
service, and removes regular files older than 30 days only from its own
`PastedImages` directory at startup. Uninstall does not delete the rest of the
Zinc user-data directory.

## Release Safety

Do not commit generated setup executables, wrapper payloads, manifests, signing
material, or local verification logs. Release assets are generated in CI or a
clean Windows build environment and published with checksums.
