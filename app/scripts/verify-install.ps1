param(
  [string]$ExpectedVersion = "",
  [string]$ProductName = "Zinc",
  [switch]$ExpectedAbsent,
  [string]$ExpectedExePath = "",
  [string]$ExpectedDesktopShortcutPath = "",
  [string]$ExpectedStartMenuShortcutPath = "",
  [string]$UserDataMarkerPath = "",
  [switch]$ExpectedUserDataMarker
)

$ErrorActionPreference = "Stop"

function Get-ZincUninstallEntries {
  $roots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
  )

  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    foreach ($key in Get-ChildItem $root) {
      $item = Get-ItemProperty $key.PSPath
      if ($item.DisplayName -match "^$([regex]::Escape($ProductName))(\s|$)") {
        [pscustomobject]@{
          Key = $key.Name
          Values = $item
        }
      }
    }
  }
}

function Test-Shortcut {
  param(
    [string]$Path,
    [string]$ExpectedTarget
  )

  if (-not (Test-Path $Path -PathType Leaf)) {
    return [pscustomobject]@{ Path = $Path; Exists = $false; TargetPath = ""; IconLocation = ""; TargetOk = $false; IconOk = $false }
  }

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  return [pscustomobject]@{
    Path = $Path
    Exists = $true
    TargetPath = $shortcut.TargetPath
    IconLocation = $shortcut.IconLocation
    TargetOk = ($shortcut.TargetPath -eq $ExpectedTarget)
    IconOk = ($shortcut.IconLocation -match "Zinc\.exe|icon\.ico")
  }
}

$entries = @(Get-ZincUninstallEntries)
$defaultDesktopShortcut = Join-Path ([Environment]::GetFolderPath("DesktopDirectory")) "$ProductName.lnk"
$defaultStartMenuShortcut = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\$ProductName.lnk"
$desktopShortcut = if ($ExpectedDesktopShortcutPath) { $ExpectedDesktopShortcutPath } else { $defaultDesktopShortcut }
$startMenuShortcut = if ($ExpectedStartMenuShortcutPath) { $ExpectedStartMenuShortcutPath } else { $defaultStartMenuShortcut }

if ($ExpectedAbsent) {
  $result = [pscustomobject]@{
    Installed = ($entries.Count -gt 0)
    EntryCount = $entries.Count
    ExpectedAbsent = $true
    ExePath = $ExpectedExePath
    ExeExists = [bool]($ExpectedExePath -and (Test-Path $ExpectedExePath -PathType Leaf))
    DesktopShortcutPath = $desktopShortcut
    DesktopShortcutExists = [bool](Test-Path $desktopShortcut -PathType Leaf)
    StartMenuShortcutPath = $startMenuShortcut
    StartMenuShortcutExists = [bool](Test-Path $startMenuShortcut -PathType Leaf)
    UserDataMarkerPath = $UserDataMarkerPath
    UserDataMarkerExists = [bool]($UserDataMarkerPath -and (Test-Path $UserDataMarkerPath -PathType Leaf))
  }
  $result | ConvertTo-Json

  if ($entries.Count -gt 0) {
    throw "Zinc is still present in the uninstall registry."
  }
  if ($result.ExeExists) { throw "Zinc.exe still exists after uninstall." }
  if ($result.DesktopShortcutExists) { throw "The Desktop shortcut still exists after uninstall." }
  if ($result.StartMenuShortcutExists) { throw "The Start menu shortcut still exists after uninstall." }
  if ($ExpectedUserDataMarker -and -not $result.UserDataMarkerExists) {
    throw "The Zinc user-data marker was removed during uninstall."
  }
  return
}

if ($entries.Count -eq 0) {
  throw "Zinc uninstall registry entry was not found."
}
if ($entries.Count -gt 1) {
  throw "Multiple Zinc uninstall registry entries were found ($($entries.Count))."
}

$entry = $entries[0]

$values = $entry.Values
$installLocation = [string]$values.InstallLocation
if (-not $installLocation) {
  $match = [regex]::Match([string]$values.UninstallString, '^"([^"]+)"')
  if ($match.Success) {
    $installLocation = Split-Path $match.Groups[1].Value -Parent
  }
}

$exePath = if ($installLocation) { Join-Path $installLocation "Zinc.exe" } else { "" }
$displayVersion = [string]$values.DisplayVersion
$installLocationExists = [bool]($installLocation -and (Test-Path $installLocation -PathType Container))
$exeExists = [bool]($exePath -and (Test-Path $exePath -PathType Leaf))

$result = [pscustomobject]@{
  Installed = $true
  EntryCount = $entries.Count
  RegistryKey = $entry.Key
  DisplayName = $values.DisplayName
  DisplayVersion = $displayVersion
  DisplayVersionPresent = [bool]$displayVersion
  InstallLocation = $installLocation
  InstallLocationExists = $installLocationExists
  ExePath = $exePath
  ExeExists = $exeExists
  VersionOk = (-not $ExpectedVersion -or $displayVersion -ceq $ExpectedVersion)
  DesktopShortcut = Test-Shortcut -Path $desktopShortcut -ExpectedTarget $exePath
  StartMenuShortcut = Test-Shortcut -Path $startMenuShortcut -ExpectedTarget $exePath
  UserDataMarkerPath = $UserDataMarkerPath
  UserDataMarkerExists = [bool]($UserDataMarkerPath -and (Test-Path $UserDataMarkerPath -PathType Leaf))
}

$result | ConvertTo-Json -Depth 4

if (-not $result.DisplayVersionPresent) { throw "DisplayVersion is missing from the Zinc uninstall entry." }
if (-not $result.InstallLocationExists) { throw "The Zinc install location is missing or invalid." }
if (-not $result.ExeExists) { throw "Zinc.exe was not found in the registered install location." }
if (-not $result.VersionOk) { throw "DisplayVersion '$displayVersion' did not match '$ExpectedVersion'." }
if (-not $result.DesktopShortcut.TargetOk) { throw "Desktop shortcut target is invalid." }
if (-not $result.DesktopShortcut.IconOk) { throw "Desktop shortcut icon is invalid." }
if (-not $result.StartMenuShortcut.TargetOk) { throw "Start menu shortcut target is invalid." }
if (-not $result.StartMenuShortcut.IconOk) { throw "Start menu shortcut icon is invalid." }
if ($ExpectedUserDataMarker -and -not $result.UserDataMarkerExists) {
  throw "The Zinc user-data marker is missing."
}
