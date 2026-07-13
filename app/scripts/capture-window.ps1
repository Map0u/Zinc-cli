param(
  [Parameter(Mandatory = $true)]
  [string] $ProcessName,

  [Parameter(Mandatory = $true)]
  [string] $OutputPath
)

Add-Type -AssemblyName System.Drawing

$signature = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class Win32Capture {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);
}
'@

Add-Type -TypeDefinition $signature

$processes = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)

if ($processes.Count -eq 0) {
  throw "No process found for '$ProcessName'."
}

$processIds = @{}
foreach ($candidate in $processes) {
  $processIds[[uint32]$candidate.Id] = $true
}

$windowHandle = [IntPtr]::Zero
foreach ($candidate in $processes) {
  if ($candidate.MainWindowHandle -ne [IntPtr]::Zero) {
    $windowHandle = $candidate.MainWindowHandle
    break
  }
}

if ($windowHandle -eq [IntPtr]::Zero) {
  $callback = [Win32Capture+EnumWindowsProc]{
    param([IntPtr] $hWnd, [IntPtr] $lParam)

    if (-not [Win32Capture]::IsWindowVisible($hWnd)) {
      return $true
    }

    $pid = [uint32]0
    [void][Win32Capture]::GetWindowThreadProcessId($hWnd, [ref]$pid)
    if (-not $processIds.ContainsKey($pid)) {
      return $true
    }

    $title = New-Object System.Text.StringBuilder 512
    [void][Win32Capture]::GetWindowText($hWnd, $title, $title.Capacity)
    if ($title.Length -eq 0) {
      return $true
    }

    $script:windowHandle = $hWnd
    return $false
  }

  [void][Win32Capture]::EnumWindows($callback, [IntPtr]::Zero)
}

if ($windowHandle -eq [IntPtr]::Zero) {
  throw "No visible main window found for process '$ProcessName'."
}

$rect = New-Object Win32Capture+RECT
[void][Win32Capture]::GetWindowRect($windowHandle, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

if ($width -le 0 -or $height -le 0) {
  throw "Window has invalid bounds: ${width}x${height}."
}

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()

try {
  [void][Win32Capture]::PrintWindow($windowHandle, $hdc, 2)
} finally {
  $graphics.ReleaseHdc($hdc)
  $graphics.Dispose()
}

$directory = Split-Path -Parent $OutputPath
if ($directory -and -not (Test-Path $directory)) {
  New-Item -ItemType Directory -Path $directory | Out-Null
}

$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
Write-Output $OutputPath
