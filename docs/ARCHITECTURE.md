# Architecture

Zinc's active implementation is the Electron application in `app/`.

## Runtime Boundaries

- **Main process** (`app/src/main/`) owns windows, PTY processes, settings and
  session persistence, safe external opening, shell discovery, native
  integrations, and update operations.
- **Preload** (`app/src/preload/`) exposes a narrow typed `window.zinc` API under
  context isolation. Renderer code must not access Node or Electron directly.
- **Renderer** (`app/src/renderer/`) owns the React interface, vertical tab rail,
  settings, and xterm terminal hosts.
- **Shared contracts** (`app/src/shared/`) contain dependency-free types used on
  both sides of IPC.

## Terminal Lifecycle

`PtyManager` owns `node-pty` sessions. The renderer requests PTY creation and
resize through validated preload APIs, receives output through message ports,
and writes user input back to the main process. Closing a tab terminates its PTY.

xterm instances are managed outside React's render lifecycle so normal React
updates do not recreate terminals or lose scrollback. PowerShell 7 is the
first-class shell; alternative executables can be configured by the user.

## Local Persistence

`SettingsService` stores normalized settings in Electron's per-user `userData`
directory. `SessionStateService` stores tab order, active tab, and working
directories for optional restore. Clipboard images are saved under a local
`PastedImages` directory. See [`../PRIVACY.md`](../PRIVACY.md).

Zinc keeps a single-instance lock because settings and session state are not
multi-writer stores.

## Security Model

- Context isolation remains enabled and renderer privileges remain narrow.
- External navigation is rejected unless it passes the main-process scheme policy.
- Update operations stay in the main process.
- Settings and IPC payloads are normalized before use.
- Release installers and update metadata are produced from a tagged source tree
  as a single NSIS setup (`Zinc-<version>-Setup.exe`).

## Updater

`UpdaterService` wraps `electron-updater`. Updates are disabled in unpackaged
development builds. Packaged Windows builds consume GitHub Releases metadata:
`autoDownload` is on, `autoInstallOnAppQuit` stays off, and a single quiet
check runs after the window is ready so the rail update badge can appear.
The renderer subscribes to update state, shows a badge + centered dialog, and
exposes About as a single check / restart path. Install still requires an
explicit user action (`quitAndInstall`).

## Historical Code

`archive/winui-native-legacy/` and `electron-spike/` are not production entry
points. They must not be used to decide current behavior or release version.
