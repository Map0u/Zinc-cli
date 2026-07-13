# Historical Migration Parity

This sanitized note records why Zinc moved from WinUI/WebView2 to Electron. It
does not define current behavior.

The migration retained the product's essential terminal experience: a vertical
tab rail, PowerShell-first PTY sessions, Acrylic-style window material, settings,
shortcuts, status information, clipboard paste behavior, and optional session
restore. Electron became the active implementation because it provided a simpler
and more testable xterm.js integration while preserving native Windows PTY use.

The retired prototype source is not part of the public tree. The archive keeps
only isolated feasibility experiments that have their own build inputs.
Machine-specific setup notes, user paths, terminal captures, and private
development diagnostics were deliberately removed from the public migration
record.

Current architecture and acceptance requirements are maintained in
[`ARCHITECTURE.md`](ARCHITECTURE.md), [`RELEASE.md`](RELEASE.md), and
[`INSTALLER.md`](INSTALLER.md).
