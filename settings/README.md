# Windows Terminal Settings Development Fixture

[`windows-terminal-settings.example.json`](windows-terminal-settings.example.json)
is synthetic and safe to publish. It demonstrates the small subset of Windows
Terminal-style settings useful during Zinc development.

To copy the current user's real Windows Terminal settings for local testing, run
the repository script from PowerShell. It writes
`settings/windows-terminal-settings.snapshot.json`, which is ignored by Git:

```powershell
pwsh ./scripts/copy-windows-terminal-settings.ps1
```

Never commit the generated snapshot. It can contain profile names, distributions,
user directories, network paths, custom commands, and identifiers. Zinc must not
edit the live Windows Terminal settings file.
