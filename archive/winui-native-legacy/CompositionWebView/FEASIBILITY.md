# Spike: CoreWebView2CompositionController for a transparent terminal WebView2 in Zinc

Date: 2026-07-03
Scope: answer whether the historical terminal WebView2 prototype
(`Microsoft.UI.Xaml.Controls.WebView2`, windowed hosting) could get a real
transparent background—one that lets Mica show through—via
`CoreWebView2CompositionController` inside its WinUI3 XAML shell.

## Conclusion

**Not feasible inside a WinUI3 XAML tree, via any publicly supported API, as of today
(WindowsAppSDK 2.2.1 / WebView2 runtime 149.0.4022.98).** This was directly reproduced (not just
inferred from old reports): `CoreWebView2CompositionController.RootVisualTarget` throws
`System.InvalidCastException` ("不支持此接口" / E_NOINTERFACE) when handed the
`Microsoft.UI.Composition.Visual` that `ElementCompositionPreview.GetElementVisual` returns for a
WinUI3 XAML element. This is not a bug that might get fixed — it is current, dated (2026-03,
updated 2026-03-17), official Microsoft documentation naming **WebView2 by name**:

> "It's not possible to have compositor content behind external content. For example, it's not
> possible to give a **WebView2** a transparent background in order to see XAML buttons or images
> behind it. The only things that can be behind external content are *other* external content and
> the window background. Because of that, we discourage/disable transparency for external content."
> — [Visual layer overview — "External content"](https://learn.microsoft.com/en-us/windows/apps/develop/composition/visual-layer#external-content), Microsoft Learn, dated 2026-03-16

`WebView2` is explicitly listed alongside `MediaPlayerElement`, `SwapChainPanel`, and
`MicaBackdrop`/`DesktopAcrylicBackdrop` as "external content": content the WinUI3 compositor
(`Microsoft.UI.Composition`, in-process) never sees the pixels of, because it's handed off to a
different, OS-level compositor for rendering. This is also why Zinc's Mica backdrop and the
terminal WebView2 can never blend directly with each other by design — they're both external
content, and the doc says only "other external content and the window background" can be behind
external content, never ordinary XAML.

This matches (and is a newer, dated restatement of) a 2023-2024 confirmation thread from a
Microsoft WinUI engineer that the two compositor systems are intentionally not interoperable from
public API — see Evidence #2.

Real WebView2 transparency (translucent HTML content blending with whatever is behind it) **is**
achievable — but only outside WinUI3's own compositor: in a plain Win32 or WPF window, using the
*non*-composition, "windowed" `WebView2` with `DefaultBackgroundColor` set to transparent. This
spike reproduced that working case too, in a throwaway WPF app (see Evidence). That means the
blocker is specifically WinUI3's XAML hosting layer, not a general WebView2 limitation — but
"go get it via Win32/WPF" for Zinc means replacing the XAML shell (rail, tabs, settings, chrome),
not a local terminal-host patch. That is a full rewrite, out of scope for this
experiment and requiring explicit human sign-off if ever pursued.

Earlier prototype testing established that windowed `<WebView2>` does not honor
transparent `DefaultBackgroundColor` in WinUI3. This spike
checked the one remaining official escape hatch (`CoreWebView2CompositionController`) and found it
is walled off by the same root cause (WinUI3's compositor is a separate, intentionally
non-interoperable system), not a workaround.

## Evidence

### 1. Own repro: WinUI3 + CompositionController (this spike, empirically run)

`WinUI3Attempt/` is a minimal packaged WinUI3 app using
`Microsoft.WindowsAppSDK` version `2.2.0` (resolved `2.2.1`). It:

1. Creates a `CoreWebView2Environment` and a `CoreWebView2CompositionController` (this part
   works — the browser process starts fine).
2. Gets a `Microsoft.UI.Composition.ContainerVisual` for a XAML `Grid` via
   `ElementCompositionPreview.GetElementVisual` / `SetElementChildVisual` — the standard,
   textbook pattern used by every UWP-era "attach a composition visual to a XAML element" sample.
3. Assigns it to `compositionController.RootVisualTarget`.

Built and run with `dotnet build` / `dotnet run` (packaged, debug identity via
`Microsoft.Windows.SDK.BuildTools.WinApp`, the same mechanism Zinc's own project uses). Actual
output, written to `attempt-result.log` next to the exe and also shown live in the app window
(confirmed visually via a windows-mcp screenshot — the app window was foregrounded and the log
text and the still-untouched magenta placeholder `Grid` were both visible):

```
WebView2 loader runtime: 149.0.4022.98
CoreWebView2Environment created OK.
CoreWebView2CompositionController created OK (browser process spun up).
Got Microsoft.UI.Composition.ContainerVisual from HostGrid: Microsoft.UI.Composition.ContainerVisual
Attempting: compositionController.RootVisualTarget = container; ...
FAILED as expected. Exception assigning RootVisualTarget:
  System.InvalidCastException: 不支持此接口
不支持此接口
```

("不支持此接口" is the localized message for the interface-not-supported HRESULT, i.e.
`E_NOINTERFACE` / `0x80004002`, surfaced by CsWinRT as `InvalidCastException` rather than
`COMException` in this SDK's projection.) The magenta placeholder `Grid` behind the (attempted)
composition target never received any browser pixels — the bridge failed before any content could
render, not merely with a cosmetic/color issue.

This is a **direct, current-toolchain repro**, not a inference from old blog posts: same
WindowsAppSDK major version Zinc ships, same machine's installed WebView2 runtime
(149.0.4022.98 — newer than any of the runtimes referenced in the older public reports below).

A secondary, incidental finding from getting this to build: the `Microsoft.Web.WebView2.Core`
types resolved by a WinUI3/`net10.0-windows` + `UseWinUI=true` project are **not** the classic
COM/CLR-interop types documented on `learn.microsoft.com/dotnet/api/...` (those assume
`IntPtr` for the parent window and `System.Drawing.Rectangle` for `Bounds`). They come from
`Microsoft.Web.WebView2.Core.Projection.dll`, a CsWinRT projection bundled transitively via
`Microsoft.WindowsAppSDK`, where the parent window is a `CoreWebView2ControllerWindowReference`
(constructed via `.CreateFromWindowHandle(ulong hwnd)`) and `Bounds` is a `Windows.Foundation.Rect`.
This is purely a projection/calling-convention difference — confirmed via `.NET` reflection on the
actual installed package (`microsoft.web.webview2/1.0.3719.77`) — it does not change the
`RootVisualTarget` story (still typed `object`, still rejects the WinUI3 visual at the native
layer).

### 2. Authoritative secondary evidence: a full 18-month Microsoft engineering thread (2023-2024), read end to end

[`MicrosoftEdge/WebView2Feedback#3439`](https://github.com/MicrosoftEdge/WebView2Feedback/issues/3439)
("Provide an official solution to use CoreWebView2CompositionController in WinUI 3 environment") —
66 comments read in full (not just the first page), spanning 2023-04-28 through 2024-07-14, closed
2023-12-06 as "completed." Read in order, this is a thread that *tries* every angle, including
the one this spike's advisor flagged as unchecked (`ContentExternalOutputLink`), and each attempt
fails for the same underlying reason:

- **2023-05-11**, Microsoft WinUI engineer `johna-ms`, after checking with the WinUI team:

  > "there is no publicly supported way to roll your own visual-hosted webview control in WinUI3.
  > This is because the Microsoft.UI.Composition compositor (and the visuals it composes) runs in
  > the app process whereas Windows.UI.Composition compositor runs in dwm.exe process. The whole
  > point of WinUI3 was to decouple graphics from the OS. So the fact that these visuals are not
  > interoperable is by design... there is no publicly supported way to do this."

  And, separately: "Even if you were using your own control, you would likely run into the same
  issue of showing through to the OS theme colored visual background color."

- **2023-09-22**, `GetGet99` reports success using an **experimental** WindowsAppSDK 1.4 API,
  `ContentExternalOutputLink`, with a screenshot of colored text over Mica. This is the one
  potentially-open door this spike's own draft had under-weighted.
- **2023-09-28**, `GetGet99` retracts it, after a more rigorous test (delete the WebView2's HTML
  body via DevTools, set the XAML layer *behind* it to solid red, see if red shows through):

  > "yeah unfortunately it's not completely transparent. The only transparency effect it can see
  > is the effect from SystemBackdrop. I did a little test and `ContentExternalOutputLink` seems
  > to produce a visual with the background filled with the window background... Sorry for making
  > the assumptions that it is actually transparent."

  I.e. `ContentExternalOutputLink` only ever shows the window's Mica/backdrop color through —
  never actual sibling XAML content — which is exactly what Evidence #1's official "external
  content" doc describes ("only... other external content and the window background" can be
  behind it). It looked like transparency because Mica *is* usually what's directly behind it, not
  because arbitrary content compositing works.
- **2023-12-06**, `johna-ms`, closing comment (the actual resolution, not a mid-thread reply):

  > "Well I at least stand by its non-generalizability :) Yes I see ContentExternalOutputLink is
  > available as an experimental API and I realize it's been mentioned above. I'll share one more
  > thing... [the Visual layer overview doc, Evidence #1's citation]. The WinUI folks pointed me at
  > that article as public documentation for why it's not possible to compose lifted visuals and
  > eg. webview content together."
- **2024-04-26**, `johna-ms`, reconfirming after the issue was already closed:

  > "this is a closed issue. As discussed above, there is no plan to support
  > CoreWebView2CompositionController in WinUI3."
- **2024-07-14**, `softworkz` combines `CoreWebView2CompositionController` with a third-party
  transparent-window backdrop (WinUIEx) to make the *entire app window* transparent over the
  desktop. This partially "works" (WebView2 content renders with transparency, but only over the
  desktop wallpaper) — and its own author immediately flags the same wall Evidence #1 predicts:

  > "what doesn't work is rendering the WebView2 on top of other WinUI3 controls in the same
  > window... everything beneath the WebView2 control is invisible."

  For Zinc this variant is a dead end anyway even setting the compositor question aside: Zinc's
  terminal WebView2 must sit correctly *among* other XAML elements (the vertical tab rail, the
  settings page, the drag region) in normal layout, not float as the only visible thing over a
  fully transparent whole-window with everything else invisible behind it.

This thread matches our own repro's HRESULT exactly (interface not supported) and explains *why*:
`Microsoft.UI.Composition.Visual` (WinUI3's in-process compositor) and `Windows.UI.Composition
.ContainerVisual` / `IDCompositionVisual` (the dwm.exe-hosted compositor `RootVisualTarget`
actually accepts) are different, non-interoperable object systems, by design.

`RootVisualTarget`'s own docs corroborate the type mismatch is the real constraint (property is
declared `public object RootVisualTarget { get; set; }` — compiles with anything, rejected at
the native QueryInterface):

> "The RootVisualTarget property can be an IDCompositionVisual or a
> Windows::UI::Composition::ContainerVisual."
> — [`CoreWebView2CompositionController.RootVisualTarget` docs](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2compositioncontroller.rootvisualtarget)

### 3. Own verification: `ContentExternalOutputLink` is still absent from Zinc's actual restored SDK (checked firsthand, not assumed)

Since the community claim ("its metadata has been stripped from the stable WinMD," from
[`microsoft/WindowsAppSDK` discussion #4256](https://github.com/microsoft/WindowsAppSDK/discussions/4256))
is itself secondhand and from an earlier WindowsAppSDK era, it was checked directly against what
Zinc's own toolchain actually restores: every `.winmd` file across the full local NuGet package
cache (`~/.nuget/packages`, which includes `Microsoft.WindowsAppSDK` 2.2.0/2.2.1 and its
`.WinUI`/`.Foundation`/`.Base` sub-packages actually pulled in by this spike's `WinUI3Attempt`
project) was scanned for the string `ContentExternalOutputLink`. Zero matches, in any package,
including `Microsoft.UI.Xaml.winmd` (the WinUI3 metadata file itself) and the two versions of
`Microsoft.WindowsAppSDK.Foundation` present in cache. This confirms, firsthand, on the exact SDK
version Zinc ships, that the API remains unavailable through any normal (non-experimental-channel,
non-raw-ABI) reference — consistent with the community report, but no longer resting on that
report alone. Combined with Evidence #2's finding that even when someone *did* get access to it
(2023, experimental channel), it did not deliver real content compositing, `ContentExternalOutputLink`
is not a live option for Zinc today under any reading.

### 4. Real-world corroboration: a community project that tried exactly this and gave up on WinUI3

[`GetGet99/Mica-Discord`](https://github.com/GetGet99/Mica-Discord) is a real, working app that
renders Discord's web UI inside a transparent, Mica-backed window (the screenshot referenced in
Evidence #2's 2023-09-22 entry). Its repo contains a `Failed Experiments/Mica Discord WinUI 3/`
folder whose entire `README.md` reads:

> "This folder is unused because it is currently impossible to create transparent WebView2 in
> WinUI 3."

The shipped, working version is `Mica Discord WPF/`, not WinUI3 — the same author who built (and
later retracted) the `ContentExternalOutputLink` proof-of-concept in Evidence #2 ultimately shipped
on WPF, not WinUI3.

### 5. Own repro: transparency *is* real WebView2 capability — just not inside WinUI3's compositor

`spike/CompositionWebView/WpfFallback/` is a minimal WPF app (`AllowsTransparency="True"`,
`WindowStyle="None"`), using the plain **windowed** `Microsoft.Web.WebView2.Wpf.WebView2` control
(no `CompositionController` at all) with `DefaultBackgroundColor = Colors.Transparent`, navigated
to a local HTML page whose `<body>` is `rgba(0,0,0,0.25)` plus four `rgba(...)` swatch `<div>`s.

Built, run, and visually confirmed via windows-mcp screenshot: a loud magenta/cyan/yellow gradient
painted in the WPF window behind the WebView2 was clearly visible **darkened and tinted** through
the translucent HTML body, and each rgba swatch (red/green/blue at 0.5 alpha, white at 0.15 alpha)
showed as a genuinely blended color over the gradient, not a solid/opaque block. This is the same
technique (windowed WebView2 + transparent `DefaultBackgroundColor`) that fails silently in WinUI3;
here, outside WinUI3's compositor, it works exactly as expected.

This directly demonstrates the blocker is WinUI3-specific compositor plumbing, not a WebView2
engine limitation — corroborating the official documentation in Evidence #1 and the engineering thread in Evidence #2, from our own
hands, on today's runtime, rather than only trusting older secondary reports.

*Caveat, stated for honesty:* this WPF prototype does **not** wire up Mica (no
`MicaController`/`DesktopWindowTarget`/DirectComposition interop was built for it — it uses a
static gradient `Rectangle` as a stand-in "is anything behind this at all" backdrop). Getting an
actual Mica backdrop on this Win32/WPF path is not separately re-verified here; it is covered
instead by Evidence #6 (official Microsoft sample), which was not rebuilt in this environment (no
C++ toolchain available — see Time-box note below) and is therefore cited as **secondary
evidence**, not personally re-run.

### 6. Official Microsoft sample proving the full combination (Mica + transparent WebView2), Win32-only — not personally rebuilt

[`microsoft/WindowsAppSDK-Samples`, `Samples/Mica/cpp-WebView2/Mica-WebView2/`](https://github.com/microsoft/WindowsAppSDK-Samples/tree/main/Samples/Mica/cpp-WebView2/Mica-WebView2)
is an official, maintained Microsoft sample. Reading its source (`WebView2Window.cpp`,
`CompositionWindow.cpp`, `Main.cpp`):

- It is a **raw Win32 window** (`CreateWindowExW` with `WS_EX_COMPOSITED`), not WinUI3/XAML.
- Mica comes from `Microsoft::UI::Composition::SystemBackdrops::MicaController` targeting a
  `Windows::UI::Composition::Compositor` window target (the classic, dwm.exe-hosted compositor —
  the "lifted" WinAppSDK path for non-XAML Win32 apps).
- WebView2 is hosted with the plain **windowed** controller
  (`CreateCoreWebView2Controller(hwnd, ...)` — *not* `CoreWebView2CompositionController`) with
  `ICoreWebView2Controller2::put_DefaultBackgroundColor({0,0,0,0})`.

In other words: Microsoft's own working reference for "Mica + transparent WebView2" doesn't even
need `CoreWebView2CompositionController` — it gets there by using the classic
`Windows.UI.Composition` compositor directly, which is exactly the compositor `RootVisualTarget`
already natively accepts. The common thread across every working example found (this one, and
`Mica-Discord`'s shipped WPF app) is: **abandon WinUI3's in-process compositor**, not
"use `CoreWebView2CompositionController` cleverly."

This sample was **read, not compiled or run** in this spike — there is no C++ toolchain (no
Visual Studio C++ workload, no `cl.exe`/`msbuild`) available in this environment (verified: only
`dotnet` and the VS Installer stub are present). It is cited as secondary evidence on the strength
of being official, current, maintained Microsoft sample code, not as something personally
re-verified here.

### Investigated but inconclusive: "Fixed WebView2 transparency" release-note bullets

The WebView2 release notes contain three bare bullets, "Fixed WebView2 transparency," under
"Runtime-only" fixes for Runtime 145 (Jan/Feb 2026) and Runtime 146/147 (Mar 2026), with no linked
issue number. This looked promising enough to check directly (the installed runtime on this
machine, 149.0.4022.98, is newer than all three). **Our own repro above was run against that exact
runtime 149.0.4022.98 and still reproduces the WinUI3 `RootVisualTarget` rejection.** Whatever
those bullets fixed, it was not the WinUI3-compositor incompatibility (which the Microsoft
engineer described as an intentional architecture decision, not a bug) — most likely they refer to
some other transparency edge case (e.g. a title-bar-shadow-over-transparent-WebView2 bug, `Issue
#5492`, listed right next to two of the three bullets). Flagged here so the ambiguity is visible,
but our own empirical repro is the tie-breaker over a vague, unlinked changelog line.

## What migrating Zinc to get real terminal transparency would require

None of this is a small terminal-host patch. Ranked by what the evidence above implies:

1. **Composition-controller path inside WinUI3: dead end.** Nothing to build — the type bridge
   does not exist in public API. Not a time/effort question, a capability question.
2. **Experimental `ContentExternalOutputLink`: not viable for a shipping app, and doesn't actually
   solve the problem even where it's reachable.** Requires the WindowsAppSDK experimental channel
   and/or raw ABI/stripped-metadata reflection tricks — confirmed absent from Zinc's actual restored
   SDK metadata firsthand (Evidence #3), on top of unsupported-API/MSIX-policy risk. And per
   Evidence #2's 2023-09-28 retraction, even the one person who got it running found it only ever
   shows the window's Mica/backdrop color through, never real sibling-XAML content — so it would not
   solve Zinc's actual requirement (terminal WebView2 correctly layered among the rail/tabs/settings)
   even if the access problem were solved. Not recommended to prototype further.
3. **Abandon WinUI3's compositor for the whole window (Win32 or WPF host, per Evidence #5/#6):**
   this is the only proven-working route to true Mica + transparent WebView2. For Zinc this means:
   - Re-host the *entire* window (not just the terminal surface) on Win32/WPF, since Mica and the
     WebView2 need to share one compositor (`Windows.UI.Composition`, dwm.exe-hosted) — you can't
     mix a WinUI3 XAML tree with a raw-Win32-composited WebView2 region inside the same window.
   - Rebuild the whole prototype shell in the new framework: vertical tab rail, settings page,
     chrome-less title bar + drag region
     (`ExtendsContentIntoTitleBar`, `SetTitleBar`), Mica backdrop wiring
     (`MicaController`/`SystemBackdropConfiguration` — different call shape off XAML), and
     re-implement every XAML control currently used (`Grid`, `StackPanel`, `NavigationView`-style
     rail, etc.) in the new framework's idioms.
   - Re-plumb window lifecycle glue that currently rides on WinUI3's `Window`/`AppWindow` APIs
     (`AppWindow.Changed` for minimize detection, `AppWindow.Resize`, `AppWindow.SetIcon`) — Win32/
     WPF equivalents exist but are different APIs, not drop-in.
   - This is a **framework-swap-scale rewrite**, not a terminal-host change.
     Given `AGENTS.md`'s version policy and "keep the first implementation small" scope rule, this
     would need explicit human approval before any code is written, and is far outside what a spike
     should decide unilaterally.
4. **If (3) is ever pursued, extra work specifically from moving off the WinUI3 `WebView2` XAML
   control to a windowed or composition-hosted `CoreWebView2Controller`/`CoreWebView2Composition
   Controller` directly (not currently needed by Zinc, since the XAML `WebView2` control handles
   all of this today):**
   - **Input forwarding.** The XAML `WebView2` control automatically routes mouse/keyboard/touch
     through XAML's input system. A raw `CoreWebView2Controller`/`CompositionController` needs
     manual `SendMouseInput`/`SendPointerInput`, and (composition mode specifically) manual
     `GetNonClientRegionAtPoint` hit-testing for `WM_NCHITTEST`. Non-trivial, but well documented.
   - **Focus/IME.** `MoveFocus`/`GotFocus`/`LostFocus` need manual wiring; there's no guarantee IME
     composition windows (for CJK input — relevant since Zinc ships `zh-CN` strings) behave
     identically off the XAML control without testing; not verified either way here.
   - **DPI/scale.** `RasterizationScale` and `ShouldDetectMonitorScaleChanges` exist on both
     windowed and composition controllers, so per-monitor-DPI is not new work, but it's no longer
     "free" via XAML's automatic layout/scale system — needs explicit handling on monitor-change
     events, same idea as `TerminalHost`'s current PTY resize path but for the visual, not just PTY
     rows/cols.
   - None of this changes the headline conclusion — it is the *additional* tax on top of (3), only
     relevant if Zinc ever leaves WinUI3's own `WebView2` XAML control behind entirely.

## Time-box note (what was and wasn't attempted)

- **Attempted and run:** the WinUI3 `RootVisualTarget` repro (Evidence #1), the firsthand
  `ContentExternalOutputLink` metadata scan (Evidence #3), and the WPF windowed transparency repro
  (Evidence #5). All built/ran successfully with `dotnet build`/`dotnet run` in this environment.
- **Not attempted:** rebuilding the official C++ Mica-WebView2 sample (Evidence #6) or wiring
  Mica via `MicaController`/`DesktopWindowTarget` into the WPF prototype. Reason: no C++ toolchain
  in this environment (verified — only `dotnet` CLI and the bare VS Installer are present, no
  `cl.exe`/`msbuild`/C++ workload), and the C# equivalent (raw `ICompositorDesktopInterop`/
  `DesktopWindowTarget` COM interop) has no official Microsoft C# sample to adapt from; hand-rolling
  that WinRT interop from scratch was judged lower-value than the evidence already gathered, since
  it would only re-confirm a combination (Mica + windowed WebView2, off WinUI3) that Microsoft's
  own sample already demonstrates and that isn't in question — the open question was specifically
  about `CoreWebView2CompositionController` inside WinUI3, which Evidence #1 already answers
  directly and conclusively.
- This is a deliberate "stop when the wall is confirmed, don't re-confirm it a third way" choice,
  per this task's time-box guidance — not a stall or an unexplained gap.

## Files in this spike

- `WinUI3Attempt/` — packaged WinUI3 app reproducing the `RootVisualTarget` failure.
  `MainWindow.xaml.cs` has the attempt + logging logic; run output lands in
  `bin/x64/Debug/net10.0-windows10.0.26100.0/win-x64/AppX/attempt-result.log` after `dotnet run`.
- `WpfFallback/` — plain WPF app proving windowed WebView2 transparency works outside WinUI3.
  Run with `dotnet run` from that folder; verify visually (gradient bleeding through the
  translucent HTML swatches).

Neither project touches the active Electron application; both are isolated
`dotnet` experiments within this directory.
