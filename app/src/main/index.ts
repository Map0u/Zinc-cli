import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
} from "electron";
import type {
  BrowserWindowConstructorOptions,
  IpcMainEvent,
  IpcMainInvokeEvent,
  Input,
} from "electron";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyWindowMaterial } from "./windowMaterial";
import { PtyManager } from "./pty/PtyManager";
import { SettingsService } from "./services/SettingsService";
import { SessionStateService } from "./services/SessionStateService";
import { UpdaterService } from "./services/UpdaterService";
import {
  detectActiveToolMatch,
  snapshotProcesses,
} from "./services/ToolDetector";
import { PasteImageService, toWslPath } from "./services/PasteImageService";
import { resolveShellId, ShellDiscoveryService } from "./services/ShellDiscovery";
import { getProcessCwd } from "./processCwd";
import { getSystemAccentLight2 } from "./accentColor";
import type {
  PtyCreateOptions,
  TerminalOptionsPush,
} from "../shared/ptyProtocol";
import type { SettingsPatch, ZincSettings } from "../shared/settingsTypes";
import { SessionTool } from "../shared/sessionState";
import type { RendererSessionSnapshot } from "../shared/sessionState";
import {
  MAIN_FALLBACK_ACCELERATORS,
  SHORTCUT_ACTIONS,
} from "../shared/keybindings";
import { acceleratorFromCodeAndModifiers } from "../shared/shortcutAccelerator";

// True only for `npm run dev` (electron-vite sets this to the dev server URL).
// Requires BOTH conditions: `!app.isPackaged` alone is also true for
// `npm run start` (preview of a built app), and `ELECTRON_RENDERER_URL` alone
// could in principle be set as an env var ahead of launching a *packaged*
// binary — neither must be sufficient by itself to open the CDP port on a
// real build.
const isDev = !app.isPackaged && Boolean(process.env["ELECTRON_RENDERER_URL"]);
const APP_ID = "space.457workshop.zinc";

// CDP regression tests must never read or mutate the developer's real
// settings/session-state files. An explicit override is honored only by an
// unpackaged app; a packaged Zinc build ignores the environment variable.
const testUserDataOverride = !app.isPackaged
  ? process.env["ZINC_TEST_USER_DATA"]?.trim()
  : "";
if (testUserDataOverride) {
  const isolatedUserData = resolve(testUserDataOverride);
  mkdirSync(isolatedUserData, { recursive: true });
  app.setPath("userData", isolatedUserData);
}

// CDP debug port — dev only, never enabled in a packaged build or preview.
if (isDev) {
  app.commandLine.appendSwitch("remote-debugging-port", "9336");
}

// Dev-only test flag: keep the window fully non-intrusive during CDP-driven
// verification (never steals foreground focus from whoever is at the
// keyboard). No effect on normal user runs — this env var is never set then.
const isTestSilent = isDev && process.env["ZINC_TEST_SILENT"] === "1";
// Same dark base as renderer/src/colorSchemes.ts's monochrome surfaceBase
// ([12, 12, 12]) and Campbell black fallback.
const LINUX_WINDOW_BACKGROUND = "#0C0C0C";

// Single-instance lock: settings.json/session-state.json are plain
// writeFileSync'd files with no locking of their own (see SettingsService /
// SessionStateService's atomic-rename comments) — two instances racing to
// persist concurrently could still interleave a torn write across process
// boundaries even with atomic renames, and would definitely stomp each
// other's in-memory state silently. A second launch attempt quits immediately
// instead of spawning a second app.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", (_event, commandLine) => {
  // The custom installer launches this exact second instance request before
  // replacing or uninstalling Zinc. app.quit() keeps the normal before-quit
  // persistence path intact instead of terminating Zinc's PTY tree directly.
  if (commandLine.includes("--installer-request-quit")) {
    skipCloseConfirm = true;
    app.quit();
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Strip Electron's default application menu. It binds its own accelerators for
// several of our shortcut actions (View role: CmdOrCtrl+0/Plus/- for zoom,
// Window role: CmdOrCtrl+W for close) which would otherwise swallow the
// keydown before our renderer-side shortcut manager ever sees it (M4).
Menu.setApplicationMenu(null);

const settingsService = new SettingsService(
  join(app.getPath("userData"), "settings.json"),
);
const sessionStateService = new SessionStateService(
  join(app.getPath("userData"), "session-state.json"),
);
// This cache is populated once after Electron is ready. The probe itself is
// asynchronous and its registry/WSL failures are intentionally non-fatal.
const shellDiscoveryService = new ShellDiscoveryService();
const pasteImageService = new PasteImageService(app.getPath("userData"));

/** Projects the persisted settings fields the terminal bridge understands (parity §2.3 `options`). */
function terminalOptionsFrom(settings: ZincSettings): TerminalOptionsPush {
  return {
    fontFamily: settings.FontFamily,
    fontSize: settings.FontSize,
    cursorBlink: settings.CursorBlink,
    cursorStyle: settings.CursorStyle,
    scrollback: settings.Scrollback,
    colorScheme: settings.ColorScheme,
    themeMode: settings.ThemePreference,
    terminalOpacity: settings.TerminalOpacity,
  };
}

function applyUiZoom(win: BrowserWindow, zoom: number): void {
  if (win.webContents.isDestroyed()) return;
  win.webContents.setZoomFactor(zoom);
}

function windowState(win: BrowserWindow): {
  platform: string;
  fullScreen: boolean;
} {
  return { platform: process.platform, fullScreen: win.isFullScreen() };
}

function pushWindowState(win: BrowserWindow): void {
  if (win.webContents.isDestroyed()) return;
  win.webContents.send("window:stateChanged", windowState(win));
}

// Empirically confirmed (screenshot + live repro): win32's `titleBarOverlay`
// caption buttons can leave a stale ghost paint — a second, slightly offset
// copy of the minimize/maximize/close glyphs — after a fullscreen enter/leave
// transition. A real resize forces Chromium to fully repaint the overlay
// region and the ghost disappears; growing-then-shrinking by 1px is
// imperceptible to the user but has the same effect. win32 only — this
// overlay doesn't exist on Linux/macOS.
function nudgeTitleBarOverlayRepaint(win: BrowserWindow): void {
  if (process.platform !== "win32" || win.isDestroyed()) return;
  const [w, h] = win.getSize();
  win.setSize(w + 1, h);
  setTimeout(() => {
    if (!win.isDestroyed()) win.setSize(w, h);
  }, 50);
}

let mainWindow: BrowserWindow | null = null;

function isTrustedIpcSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents,
  );
}

function activeRendererId(): number {
  return mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.webContents.id
    : -1;
}
let lastUiZoom = settingsService.get().UiZoom;

// Set at the top of `before-quit`, before any cleanup runs. Guards the
// window-close handler below: without it, an OS window-close (title-bar X /
// Alt+F4) would destroy this window's webContents *before* `before-quit`
// ever fires (Electron's window-all-closed → app.quit() → before-quit
// ordering runs after the window is already gone), and PtyManager kills
// every pty tied to a destroyed WebContents (see PtyManager.attachWebContents)
// — so persistSessionState() would find no live ptyManager session for any
// tab and silently fall back every cwd to homedir instead of the real one.
let isQuitting = false;
let skipCloseConfirm = false;
let closeConfirmationInProgress = false;

// Set by the renderer's ShortcutManager while the settings page's "record a
// new binding" UI is capturing raw keydowns (see `shortcuts:setRecordingActive`
// below). While true, the before-input-event fallback stands down so a combo
// that happens to match an *existing* binding (e.g. re-recording over
// Ctrl+Tab) reaches the recording handler instead of being actioned here first.
let shortcutRecordingActive = false;

/** Wires the before-input-event fallback for `win` (M4 fix: Ctrl+Tab / Ctrl+Shift+Tab). */
function attachShortcutFallback(win: BrowserWindow): void {
  win.webContents.on("before-input-event", (event, input: Input) => {
    if (shortcutRecordingActive) return;
    if (input.type !== "keyDown") return;
    // Windows treats Alt as a "system" modifier (WM_SYSKEYDOWN) and Chromium's
    // views::FocusManager intercepts Alt+<letter> for its own accelerator/
    // mnemonic processing before the keydown ever reaches the page — the same
    // class of Chromium-swallowed-before-the-renderer-sees-it problem as
    // Ctrl+Tab above, just OS-specific to win32 instead of universal. The
    // renderer's own attachCustomKeyEventHandler (TerminalHostRegistry.ts)
    // still owns this on Linux/macOS, where it isn't swallowed.
    if (
      process.platform === "win32" &&
      input.alt &&
      !input.control &&
      !input.meta &&
      (input.code === "KeyM" || input.code === "KeyV")
    ) {
      const tabId = resolveActiveTabId();
      if (!tabId) return;
      event.preventDefault();
      win.webContents.send(
        "terminal:altSequence",
        tabId,
        input.code === "KeyM" ? "\x1bm" : "\x1bv",
      );
      return;
    }
    const accelerator = acceleratorFromCodeAndModifiers(input.code, {
      ctrl: input.control,
      shift: input.shift,
      alt: input.alt,
      meta: input.meta,
    });
    if (accelerator === null) return;
    // Only the accelerators Chromium may swallow before the renderer sees them
    // need this main-side fallback — every other combo the renderer's own
    // capture-phase ShortcutManager handles. See MAIN_FALLBACK_ACCELERATORS in
    // the single arbitration table (shared/keybindings.ts).
    if (!MAIN_FALLBACK_ACCELERATORS.has(accelerator)) return;
    // Bindings are re-read on every event, so whichever action the user has
    // *currently* bound to this accelerator is the one that gets forwarded —
    // a full reverse lookup across every action, not just nextTab/prevTab.
    const bindings = settingsService.get().Keybindings;
    const action = SHORTCUT_ACTIONS.find(
      (candidate) => bindings[candidate] === accelerator,
    );
    if (!action) return;
    event.preventDefault();
    win.webContents.send("shortcuts:trigger", action);
  });
}

/** Pushes the current appearance options (parity §2.3) to `win`. */
function pushTerminalOptions(win: BrowserWindow): void {
  if (win.webContents.isDestroyed()) return;
  win.webContents.send(
    "terminal:options",
    terminalOptionsFrom(settingsService.get()),
  );
}

function createWindow(): BrowserWindow {
  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1220,
    height: 760,
    // Taskbar/alt-tab icon. `app.getAppPath()` is the project root in dev and
    // the app.asar root in packaged builds; `resources/icon.*` is included by
    // electron-builder's `files` list.
    icon: join(
      app.getAppPath(),
      "resources",
      process.platform === "win32" ? "icon.ico" : "icon.png",
    ),
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  if (process.platform === "win32") {
    // No `backgroundColor` / `transparent` here — both paint an opaque
    // surface over the Acrylic material (MATERIAL-RESULT.md conclusion A).
    // `backgroundMaterial` must be set right here, at construction time;
    // calling `setBackgroundMaterial()` afterwards for the *first*
    // application never renders (same doc).
    windowOptions.backgroundMaterial = "acrylic";
    // Old app: `ExtendsContentIntoTitleBar = true` + `SetTitleBar(DragRegion)`
    // (MainWindow.xaml.cs) — content fills the title bar area, but the
    // *system* min/max/close caption buttons stay put at the top-right,
    // drawn by the OS, not hidden. `titleBarOverlay` is Electron's equivalent:
    // a custom draggable region with native-styled caption buttons overlaid.
    // Height matches the 48px top strip; transparent color lets the overlay
    // blend into our own drag-region background instead of painting its own.
    windowOptions.titleBarStyle = "hidden";
    windowOptions.titleBarOverlay = {
      color: "rgba(0,0,0,0)",
      symbolColor: "#cccccc",
      height: 48,
    };
  } else {
    windowOptions.backgroundColor = LINUX_WINDOW_BACKGROUND;
  }

  const win = new BrowserWindow(windowOptions);
  // Zinc renders a local application document. All external browsing goes
  // through the validated shell:openExternal IPC route; renderer-controlled
  // navigation, popups and webviews are rejected at the WebContents boundary.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  if (process.platform === "linux") {
    win.maximize();
  }

  applyWindowMaterial(win);

  attachShortcutFallback(win);

  win.once("ready-to-show", () => {
    // Defensive re-apply (same rationale as windowMaterial.ts's restore/focus
    // handlers, MATERIAL-RESULT.md): the `showInactive()` path under
    // ZINC_TEST_SILENT never fires a `focus` event, so without this the
    // Acrylic material's first-paint state on that path would be unverified.
    // Harmless no-op if Acrylic already rendered correctly.
    if (process.platform === "win32" && !win.isDestroyed()) {
      win.setBackgroundMaterial("acrylic");
    }
    if (isTestSilent) {
      win.setPosition(-3000, 0);
      win.showInactive();
    } else {
      win.show();
    }
  });

  // Renderer's terminal bridge subscribes to `terminal:options` at module-eval
  // time (before React even mounts), so this fires well before any tab is
  // created — first tabs pick up persisted appearance settings, not the
  // registry's hardcoded fallback defaults.
  win.webContents.on("did-finish-load", () => {
    pushTerminalOptions(win);
  });

  if (isDev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  win.on("enter-full-screen", () => pushWindowState(win));
  win.on("leave-full-screen", () => {
    pushWindowState(win);
    // The overlay is hidden during real exclusive fullscreen, so there's
    // nothing to repaint on the way in — only on the way back to windowed,
    // where the ghost from before entering fullscreen can linger.
    nudgeTitleBarOverlayRepaint(win);
  });

  // OS window-close path (title-bar X / Alt+F4): defer to the unified
  // `before-quit` shutdown instead of letting Electron destroy this window
  // (and, via PtyManager, every pty attached to it) immediately. Re-routing
  // through `app.quit()` guarantees `before-quit`'s persistSessionState()
  // runs first, while ptys are still alive — see `isQuitting`'s doc comment.
  // No-op on the renderer-initiated quit path (app:requestQuit → app.quit()):
  // `before-quit` already fires — and sets `isQuitting` — before Electron
  // gets around to closing this window.
  win.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (skipCloseConfirm || latestSessionSnapshot.tabs.length <= 1) {
      skipCloseConfirm = true;
      app.quit();
      return;
    }
    if (closeConfirmationInProgress) return;
    closeConfirmationInProgress = true;
    const language = settingsService.get().Language;
    const useChinese =
      language === "zh" ||
      (language === "auto" && app.getLocale().toLowerCase().startsWith("zh"));
    const tabCount = latestSessionSnapshot.tabs.length;
    void dialog
      .showMessageBox(win, {
        type: "warning",
        buttons: useChinese ? ["关闭", "取消"] : ["Close", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        title: useChinese ? "关闭 Zinc？" : "Close Zinc?",
        message: useChinese
          ? `仍有 ${tabCount} 个标签页打开。确定关闭 Zinc 吗？`
          : `${tabCount} tabs are still open. Close Zinc?`,
      })
      .then(({ response }) => {
        if (response === 0) {
          skipCloseConfirm = true;
          app.quit();
        }
      })
      .finally(() => {
        closeConfirmationInProgress = false;
      });
  });

  return win;
}

app.whenReady().then(() => {
  // Windows toast notifications (renderer's `new Notification()`) need an
  // AUMID to surface at all in an unpackaged dev build — without one,
  // Chromium's notification silently no-ops instead of showing anything.
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);
  shellDiscoveryService.start();
  mainWindow = createWindow();
  applyUiZoom(mainWindow, settingsService.get().UiZoom);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

// Pushes both the terminal-relevant subset and the full settings object
// (for the settings page's own state) on every applied change.
settingsService.onChange((settings) => {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
  if (settings.UiZoom !== lastUiZoom) {
    lastUiZoom = settings.UiZoom;
    applyUiZoom(mainWindow, settings.UiZoom);
  }
  pushTerminalOptions(mainWindow);
  mainWindow.webContents.send("settings:changed", settings);
});

const ptyManager = new PtyManager();

ipcMain.handle(
  "pty:create",
  async (event: IpcMainInvokeEvent, id: string, options: PtyCreateOptions) => {
    if (!isTrustedIpcSender(event)) throw new Error("Untrusted PTY sender");
    const shells = await shellDiscoveryService.getShells();
    const requestedId = typeof options?.shellId === "string" && options.shellId.trim()
      ? options.shellId
      : settingsService.get().DefaultShellId;
    const resolution = resolveShellId(shells, requestedId);
    ptyManager.create(id, options, event.sender, resolution.shell);
  },
);

ipcMain.handle("shells:getProfiles", async (event: IpcMainInvokeEvent) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted shell sender");
  const profiles = await shellDiscoveryService.getShells();
  const resolution = resolveShellId(profiles, settingsService.get().DefaultShellId);
  return {
    profiles: profiles.map(({ id, label }) => ({ id, label })),
    fallbackNotice: resolution.fellBack
      ? { requestedId: settingsService.get().DefaultShellId, resolvedId: resolution.shell.id }
      : null
  };
});

ipcMain.on("pty:input", (event: IpcMainEvent, id: string, data: Uint8Array) => {
  if (!isTrustedIpcSender(event) || !(data instanceof Uint8Array)) return;
  ptyManager.write(id, data, event.sender.id);
});

ipcMain.on(
  "pty:resize",
  (event: IpcMainEvent, id: string, cols: number, rows: number) => {
    if (!isTrustedIpcSender(event)) return;
    ptyManager.resize(id, cols, rows, event.sender.id);
  },
);

ipcMain.on("pty:kill", (event: IpcMainEvent, id: string) => {
  if (!isTrustedIpcSender(event)) return;
  ptyManager.kill(id, event.sender.id);
});

ipcMain.handle("pty:getCwd", (event: IpcMainInvokeEvent, id: string) =>
  isTrustedIpcSender(event) ? ptyManager.getCwd(id, event.sender.id) : null,
);

// Clipboard image paste (parity §1.5): saves the bytes, decides Windows vs.
// WSL path form by checking whether this tab's shell has a codex/claude
// child (M5's detector, reused here), then types the bare path string into
// the pty — no trailing newline, matching the WinUI behavior. Silent on any
// failure per spec (a null save just does nothing).
ipcMain.on(
  "pty:pasteImage",
  (event: IpcMainEvent, id: string, data: Uint8Array, mime: string) => {
    if (!isTrustedIpcSender(event) || !(data instanceof Uint8Array)) return;
    try {
      const filePath = pasteImageService.save(data, mime);
      if (!filePath) return;
      let pathText = filePath;
      try {
        const match = detectActiveToolMatch(
          ptyManager.getPid(id, event.sender.id),
        );
        if (match?.runtime === "wsl") pathText = toWslPath(filePath);
      } catch {
        // Detection failed (process tree query error, etc.) — degrade to the
        // plain Windows path form silently, per spec.
      }
      ptyManager.write(id, new TextEncoder().encode(pathText), event.sender.id);
    } catch {
      // Any failure (save error, pty exit/close race, native call error) is
      // silent per spec — the paste simply has no visible effect.
    }
  },
);

// Terminal text copy/paste go through the main-process clipboard API rather
// than the renderer's navigator.clipboard, which is permission-gated and
// document-focus-dependent in a sandboxed renderer. `writeText` returns
// whether the write succeeded and `readText` returns null on failure (vs. ''
// for a genuinely empty clipboard) so the terminal can surface a visible
// notice. Image paste keeps its own dedicated `pty:pasteImage` path.
ipcMain.handle(
  "clipboard:writeText",
  (_event: IpcMainInvokeEvent, text: string): boolean => {
    if (typeof text !== "string") return false;
    try {
      clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },
);

ipcMain.handle("clipboard:readText", (): string | null => {
  try {
    return clipboard.readText();
  } catch {
    return null;
  }
});

ipcMain.handle(
  "shell:openExternal",
  async (_event: IpcMainInvokeEvent, url: string) => {
    if (typeof url !== "string") return false;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        return false;
      await shell.openExternal(parsed.toString());
      return true;
    } catch {
      return false;
    }
  },
);

// Session restore (parity §1.4): renderer pulls this once at startup instead
// of always creating a single default tab.
ipcMain.handle("session:getRestorePayload", () => {
  const settings = settingsService.get();
  return sessionStateService.loadRestorePayload(
    settings.RestoreSessionsOnStartup,
    settings.ResumeAiConversations,
  );
});

// Live cache of "what tabs does the renderer currently have open, in what
// order, with which one active" — pushed on every tab open/close/switch.
// `before-quit` reads this synchronously rather than asking the renderer at
// quit time: on an OS window-close (title-bar X / Alt+F4), webContents is
// already destroyed by the time `before-quit` fires, so a live round trip
// would be impossible and would silently persist an empty session over a
// good one. Keeping this warm continuously sidesteps that entirely.
let latestSessionSnapshot: RendererSessionSnapshot = {
  tabs: [],
  activeIndex: -1,
};

/** Active terminal id for main-side Alt-sequence forwarding (from the live session cache). */
function resolveActiveTabId(): string | null {
  const { tabs, activeIndex } = latestSessionSnapshot;
  if (activeIndex < 0 || activeIndex >= tabs.length) return null;
  return tabs[activeIndex]?.id ?? null;
}
// Flips true the first time the renderer actually pushes a snapshot (which it
// only ever does once its own `sessionReady` gate opens, post-restore/
// default-tab hydration — see App.tsx). Guards `before-quit`: if the app is
// closed before that first push ever arrives (crash-fast-quit, restore still
// in flight), `latestSessionSnapshot` is still the module-init empty default,
// and persisting it would stomp a perfectly good existing session-state.json
// with an empty one. persistSessionState() below no-ops until this flips.
let sessionSnapshotReady = false;
ipcMain.on(
  "session:tabsChanged",
  (_event: IpcMainEvent, snapshot: RendererSessionSnapshot) => {
    latestSessionSnapshot = snapshot;
    sessionSnapshotReady = true;
  },
);

const updaterService = new UpdaterService((state) => {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send("update:state", state);
});

// Renderer's `window.matchMedia('(prefers-color-scheme: dark)')` measurably
// disagreed with the OS's actual dark-mode registry value on this machine
// (confirmed: AppsUseLightTheme=0 in the registry, matchMedia still reported
// light). `nativeTheme.shouldUseDarkColors` is Electron's own dedicated,
// natively-implemented reader of the same OS setting — authoritative
// independent of however Blink derives its own CSS media feature — so the
// renderer now takes light/dark from this over IPC instead of trusting its
// own `matchMedia` (see themeMode.ts). `theme:get-sync` is the same read
// exposed synchronously so the renderer can seed its initial value before
// first paint instead of a `matchMedia`-derived placeholder that's proven
// unreliable on this machine and would otherwise cause a flash on cold start.
ipcMain.handle("theme:get", () =>
  nativeTheme.shouldUseDarkColors ? "dark" : "light",
);
ipcMain.on("theme:get-sync", (event) => {
  event.returnValue = nativeTheme.shouldUseDarkColors ? "dark" : "light";
});
nativeTheme.on("updated", () => {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(
    "theme:changed",
    nativeTheme.shouldUseDarkColors ? "dark" : "light",
  );
});

ipcMain.handle("settings:get", () => settingsService.get());

// `process.env['npm_package_version']` is only set by npm at dev-server time —
// a packaged build has no such env var, so the About card was permanently
// stuck on preload's hardcoded fallback string regardless of the real
// installed version. `app.getVersion()` reads package.json directly and is
// correct in both dev and packaged contexts.
ipcMain.on("app:get-version-sync", (event) => {
  event.returnValue = app.getVersion();
});

ipcMain.on(
  "settings:updateImmediate",
  (_event: IpcMainEvent, patch: SettingsPatch) => {
    settingsService.updateImmediate(patch);
  },
);

ipcMain.on(
  "settings:updateDebounced",
  (_event: IpcMainEvent, patch: SettingsPatch) => {
    settingsService.updateDebounced(patch);
  },
);

ipcMain.handle("update:get-state", () => updaterService.getState());
ipcMain.handle("update:check", () => updaterService.check());
ipcMain.handle("update:download", () => updaterService.download());
ipcMain.handle("update:install", () => updaterService.install(mainWindow));

// See `shortcutRecordingActive`'s doc comment above.
ipcMain.on(
  "shortcuts:setRecordingActive",
  (_event: IpcMainEvent, active: boolean) => {
    shortcutRecordingActive = active;
  },
);

// Renderer's single "close tab" path funnels here once the last tab goes
// away, so quitting always goes through `before-quit` — never a bare
// `app.exit()`/window.close() bypass (parity §3 #9's bug, fixed here).
ipcMain.on("app:requestQuit", () => {
  skipCloseConfirm = true;
  app.quit();
});

// Same accent the old WinUI3 app rendered (its `AccentFillColorDefaultBrush`
// ThemeResource) — falls back to the fixed steel-blue chosen during the
// Electron migration if the registry read ever fails (non-Windows, locked
// down account, etc.), rather than leaving the chrome accent-less.
ipcMain.handle(
  "window:getAccentColor",
  () => getSystemAccentLight2() ?? "#3f7fbf",
);
ipcMain.handle("window:getPlatform", () => process.platform);
ipcMain.on("window:get-state-sync", (event) => {
  event.returnValue = mainWindow
    ? windowState(mainWindow)
    : { platform: process.platform, fullScreen: false };
});
ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});
ipcMain.handle("window:close", () => {
  mainWindow?.close();
});

const SESSION_SAVE_BUDGET_MS = 2000;

function toSessionTool(tool: "codex" | "claude" | "grok" | null): SessionTool {
  if (tool === "codex") return SessionTool.Codex;
  if (tool === "claude") return SessionTool.Claude;
  if (tool === "grok") return SessionTool.Grok;
  return SessionTool.None;
}

/**
 * Best-effort session snapshot + write, budgeted to `SESSION_SAVE_BUDGET_MS`
 * (parity §1.4). Reads `latestSessionSnapshot` (kept warm by the renderer's
 * `session:tabsChanged` pushes) rather than asking the renderer live — see
 * that variable's doc comment for why.
 */
function persistSessionState(): void {
  // Disabling restore is also a persistence/privacy decision: do not write a
  // fresh list of working directories at shutdown, and remove any snapshot
  // left by an earlier run. This only touches the on-disk restore file; live
  // tabs and PTYs remain intact until the normal shutdown cleanup below.
  if (!settingsService.get().RestoreSessionsOnStartup) {
    sessionStateService.clear();
    return;
  }
  // Nothing valid to persist yet (see `sessionSnapshotReady`'s doc comment) —
  // leave any existing session-state.json exactly as-is rather than
  // overwriting it with the empty startup default.
  if (!sessionSnapshotReady) return;
  // Deadline recorded up front, covering snapshotProcesses() too (final-review
  // fix): it used to run *outside* SessionStateService.persist()'s own
  // internal budget tracking, so a slow/throwing snapshot could blow past
  // SESSION_SAVE_BUDGET_MS entirely before the per-tab degrade-to-shell-cwd
  // logic ever got a chance to kick in. The remaining time (which may be ~0)
  // is what gets handed to persist() below, instead of always handing it a
  // fresh SESSION_SAVE_BUDGET_MS regardless of how long the snapshot took.
  const deadline = Date.now() + SESSION_SAVE_BUDGET_MS;
  // One Toolhelp32Snapshot + full process-table walk, reused for every tab's
  // detectActiveToolMatch() call below instead of paying that cost per tab
  // (codex review of m6-session-restore: N tabs previously meant N full
  // snapshots stacked inside the same 2s budget, the dominant way a single
  // slow persist() could blow past SESSION_SAVE_BUDGET_MS). Per-descendant
  // PEB command-line reads still happen lazily per tab as before; only the
  // system-wide enumeration itself is shared. Guarded on its own: a throw here
  // (native call error, etc.) degrades to "no tool detected for any tab" —
  // exactly like a per-tab detection failure would — rather than aborting the
  // whole persist and losing even the shell cwd fallback.
  let processSnapshot: ReturnType<typeof snapshotProcesses>;
  try {
    processSnapshot = snapshotProcesses();
  } catch (err) {
    console.error("[persistSessionState] snapshotProcesses failed", err);
    processSnapshot = [];
  }
  sessionStateService.persist(
    latestSessionSnapshot.tabs,
    latestSessionSnapshot.activeIndex,
    (id) => ptyManager.getCwd(id, activeRendererId()),
    (id) => {
      const match = detectActiveToolMatch(
        ptyManager.getPid(id, activeRendererId()),
        processSnapshot,
      );
      return match ? { tool: toSessionTool(match.tool), pid: match.pid } : null;
    },
    (pid) => getProcessCwd(pid),
    Math.max(0, deadline - Date.now()),
  );
}

// Unified shutdown path. Both a normal last-window close and the renderer's
// "closed the last tab" request end up here via app.quit(). Each step is
// independently guarded: persistSessionState() reaches into native process
// inspection (koffi/PEB reads via detectActiveToolMatch) that can throw for
// reasons having nothing to do with settings/pty/poller cleanup, and a crash
// in any one step must never skip the remaining ones (a skipped
// settingsService.flush() drops the last debounced edit; a skipped
// ptyManager.killAll() leaks every still-running shell as a zombie process).
app.on("before-quit", () => {
  // `before-quit` can fire more than once for a single quit sequence (e.g.
  // our window-close guard's `app.quit()` plus `window-all-closed`'s own
  // `app.quit()` once the window actually finishes closing) — this whole
  // handler must run exactly once, or a second pass would persist a
  // degraded snapshot (ptys/webContents already torn down by then, so every
  // cwd would fall back to homedir) right over the first, good one.
  if (isQuitting) return;
  isQuitting = true;
  try {
    persistSessionState();
  } catch (err) {
    console.error("[before-quit] persistSessionState failed", err);
  }
  try {
    settingsService.flush();
  } catch (err) {
    console.error("[before-quit] settingsService.flush failed", err);
  }
  try {
    ptyManager.killAll();
  } catch (err) {
    console.error("[before-quit] ptyManager.killAll failed", err);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
