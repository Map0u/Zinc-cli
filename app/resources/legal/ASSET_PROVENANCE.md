# Asset Provenance and Publication Status

This inventory covers every committed visual or font asset in the active and
archived Zinc trees for 0.5.0. SHA-256 identifies the exact reviewed bytes.

## Publication decision

All listed Zinc icon artifacts are **APPROVED** for redistribution with this
repository. The four active artifacts are the project-owned Zinc 3D Z brand
artwork, restored byte-for-byte from both the `v0.3.7` tag and `main`. The
canonical `app/resources/icon.png` is also the image input for the generated
NSIS header and sidebar artwork.

`app/scripts/generate-icons.mjs` is limited to the archived WinUI feasibility
shell. It creates a clean-room compatibility prompt from primitive geometry and
project-defined colors and cannot write any active application icon path. The
archived compatibility assets use no external image, font, glyph, logo,
trademark artwork, model output, or other creative source asset.

Verify the archived generated artifacts from the repository root:

```text
node app/scripts/generate-icons.mjs --check
```

The command compares all nine archived outputs byte-for-byte and fails if an
artifact is missing or stale. Active artwork is verified against the hashes
below rather than regenerated.

## Committed asset inventory

| Scope | Path | SHA-256 | Status |
| --- | --- | --- | --- |
| active | `app/resources/icon.ico` | `8003c79e421413d642090bdc7506a871bcfb75730cbd52739b4956a66ed87a48` | APPROVED: project-owned 3D Z; byte-for-byte v0.3.7/main restoration |
| active | `app/resources/icon.png` | `c7b77c8f49163d2d8c54eb1fbd461196b47d6994d8d2616b38f7a82e4ab77b14` | APPROVED: canonical project-owned 3D Z; byte-for-byte v0.3.7/main restoration |
| active | `app/src/renderer/public/icon.png` | `2047276c66d93177f464df18dd27299f3295359902a4585a299c64eeac6e7456` | APPROVED: project-owned 3D Z; byte-for-byte v0.3.7/main restoration |
| active | `app/src/renderer/src/assets/zinc-icon.png` | `ff7a794dfb2837cba7d0ee5f6a31adca67620455195b27156c1118b4544d3dee` | APPROVED: project-owned 3D Z; byte-for-byte v0.3.7/main restoration |
| archived | `archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/AppIcon.ico` | `2204f8ce52049e1210900adb52811e7416fedbad227853c978356f9b909930ff` | APPROVED: generated compatibility copy |
| archived | `archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/LockScreenLogo.scale-200.png` | `8528f7fa22fb985ed666debfc01bbab9f0c3cf8bc4d36c0e8e46c2d475ed9bdc` | APPROVED: deterministic clean-room generation |
| archived | `archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/SplashScreen.scale-200.png` | `49399d42d2de713b9a81b65d6ab8c7c097229219cf1d60e7264c963071befa53` | APPROVED: deterministic clean-room generation |
| archived | `archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/Square150x150Logo.scale-200.png` | `16b381b8eddcf86f9a7c44438041b703ae284ab57dc0c28b005e1abf5ee4409e` | APPROVED: deterministic clean-room generation |
| archived | `archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/Square44x44Logo.scale-200.png` | `e43c524fe5f0833e25069ed3e384e82167fbf6a38536f9eb312b0aba93baf7a8` | APPROVED: deterministic clean-room generation |
| archived | `archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/Square44x44Logo.targetsize-24_altform-unplated.png` | `c996159140df0fbbbf0e05dc91821b75f1657aa4774dafbec682297165b9f7ff` | APPROVED: deterministic clean-room generation |
| archived | `archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/Square44x44Logo.targetsize-48_altform-lightunplated.png` | `58d27803ca85639e3c4005ae8b9340e4b6a5a1cb0c863da35dcc9d239026e1c5` | APPROVED: deterministic clean-room generation |
| archived | `archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/StoreLogo.png` | `04aa06c547b07ddc5d4d3c55a30a2d5156831bce5632b6528c88a0edc279ab3f` | APPROVED: deterministic clean-room generation |
| archived | `archive/winui-native-legacy/CompositionWebView/WinUI3Attempt/Assets/Wide310x150Logo.scale-200.png` | `2042fd91760a5bf7478e9c853e83355009125b9ed4c5f403b6b21bbebd462aef` | APPROVED: deterministic clean-room generation |

## Installer artwork and font review

`app/scripts/generate-installer-artwork.ps1` creates the NSIS header and sidebar
BMPs during a Windows build. It loads the canonical project-owned
`app/resources/icon.png` and draws that 3D Z over layouts made from
`System.Drawing` primitives and project-defined colors. It does not load or
rasterize a font, and the generated BMP files are not committed.

The application and custom installer CSS name Windows system-font families
with generic fallbacks. A family name is a runtime preference, not a bundled
font. The tracked-file scan below returns no `.ttf`, `.otf`, `.woff`, or `.woff2`
files, so Zinc redistributes no font program:

```text
git ls-files | rg -i '\.(ttf|otf|woff2?)$'
# no matches
```

## Updating this inventory

Run the archive generator after any intentional compatibility-design change,
update every affected hash, and review the byte comparison before approval.
The active 3D Z artwork is not generator output. For any new third-party asset,
record its durable source, author or copyright holder, exact license,
modification history, and SHA-256. Similar appearance or a commit timestamp is
not provenance evidence.
