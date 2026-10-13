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

## Tab Activity

`PtyManager` also derives a per-tab AI-CLI activity state
(`shell | idle | working | waiting | done | error | exited`, see
`app/src/shared/tabActivity.ts`) and pushes it to the renderer on
`pty:activity`, at most once per ~100 ms per tab and only on change. The pure
parser and state machine live in `app/src/main/pty/activityTracker.ts`:

- Claude Code reports exact turn state over OSC 7501. It only does so after a
  capability handshake (`OSC 7501;?`), which Zinc answers with a fixed string,
  and only if the pty runs on node-pty's bundled ConPTY host (the system one
  answers Claude's device-attribute query itself, so Claude gives up before
  Zinc's reply arrives). The `PreciseAiStatus` setting switches new tabs to the
  bundled host and enables the reply.
- Without 7501, the title's first glyph is used: a four-point star is idle, a
  spinner frame is working, and the star returning is a finished turn (`done`).
- A pty exit is `exited` (code 0) or `error`; a working/waiting tab whose AI
  tool has been gone for more than 5 s falls back to `shell`.
- `done` stays until the renderer calls `window.zinc.pty.markActivitySeen(id)`.

## Tab Groups and Automatic Grouping

The rail keeps one flat `tabs` array (the visual order, `app/src/renderer/src/tabs/`)
and a small `groups` array; a tab joins a group through `groupId`. Every change goes
through the pure `normalizeRail` (`tabGroups.ts`), which enforces the invariants:
members of a group are contiguous, every `groupId` names a group and an empty group
is gone, a group with one tab survives only if the user touched it (it has a `name`,
or is no longer `auto`), groups are ordered by their first member, and normalizing
is idempotent and never reorders what it does not have to move. A tab the user placed
(drag, "New group with this tab", Add/Remove from group, Alt+Up/Down) carries
`manual`.

Automatic grouping is the pure `autoGroupRail(state, contexts, options)` in the same
file. Its key is the tab's `TabContext.projectRoot` (main's `ProjectRoot`: the git
work tree, else the folder itself, never home / a drive root / Desktop / Downloads /
Documents), folded the same way main folds it (case-insensitive, one separator, no
trailing separator). Rules:

- Eligible tabs are not `manual` and are ungrouped or in an `auto` group; a tab with
  no context yet or no project root is never touched.
- A bucket of tabs with one key joins the group that already carries that key (id,
  collapsed state and name are kept), otherwise two or more tabs create exactly one
  `auto` group with that `key` and a `title` (the project folder name, kept apart
  from the user's `name` so an auto-titled group is not "touched"). A tab whose key
  changed leaves its old group; the normalizer dissolves a group left with one
  untouched tab.
- A user-named group is never dissolved, renamed or emptied. Renaming an auto group
  makes it permanent (`auto: false`) but keeps its `key`, and a keyed user-named
  group still takes same-key tabs while it holds a tab the user did not place.
- Automation never sets `manual`. The tab menu's "Group automatically" clears it.

The driver is in `App.tsx`: any change in the per-tab context store pokes a
scheduler (`autoGroupSchedule.ts`) that evaluates after 1.5 s of quiet, at most 4 s
into a continuous stream of changes, once more after the restored session settles,
and whenever the `AutoGroupTabs` setting (default on) is switched on. A run is
postponed (retried every 300 ms) while a drag is up or a rename input or a context
menu is open. Rows that automation moves glide with a transform-only FLIP (`railFlip.ts`,
Web Animations, 160 ms, the rail's existing curve; a new group header fades in over
220 ms); it is skipped under `prefers-reduced-motion` and never runs for a drag.

Group names, titles, keys, membership, collapsed state and the `manual` flag live in
`session-state.json` (`Groups[]`, `Tabs[].GroupId`, `Tabs[].Pinned`); all of it is
optional, so files written before tab groups still load and older releases ignore
the extra fields. Tabs are still restored by index.

## Local Persistence

`SettingsService` stores normalized settings in Electron's per-user `userData`
directory. `SessionStateService` stores tab order, active tab, working
directories, tab group names, membership and collapsed state, and last-seen AI CLI
metadata for optional restore. The snapshot
is rewritten on a short running-app interval, after tab-list changes, and on
quit, so a crash or power loss does not depend on a clean `before-quit`.
Clipboard images are pasted straight to a native AI CLI by default (main types
the CLI's image-paste key and the CLI reads the clipboard itself); only the
fallback (plain shell, WSL, or the `ImagePaste: 'file'` setting) saves them
under a local `PastedImages` directory. See
[`../PRIVACY.md`](../PRIVACY.md).

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
