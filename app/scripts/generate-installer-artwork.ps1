param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$buildDir = Join-Path $ProjectRoot 'build'
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

function New-Color([int]$r, [int]$g, [int]$b, [int]$a = 255) {
  [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
}

function New-Brush([int]$r, [int]$g, [int]$b, [int]$a = 255) {
  [System.Drawing.SolidBrush]::new((New-Color $r $g $b $a))
}

function Add-RoundedRect(
  [System.Drawing.Drawing2D.GraphicsPath]$Path,
  [System.Drawing.RectangleF]$Rect,
  [float]$Radius
) {
  $diameter = $Radius * 2
  $Path.AddArc($Rect.X, $Rect.Y, $diameter, $diameter, 180, 90)
  $Path.AddArc($Rect.Right - $diameter, $Rect.Y, $diameter, $diameter, 270, 90)
  $Path.AddArc($Rect.Right - $diameter, $Rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $Path.AddArc($Rect.X, $Rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $Path.CloseFigure()
}

function Fill-RoundedRect(
  [System.Drawing.Graphics]$Graphics,
  [System.Drawing.Brush]$Brush,
  [float]$X,
  [float]$Y,
  [float]$Width,
  [float]$Height,
  [float]$Radius
) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  Add-RoundedRect $path ([System.Drawing.RectangleF]::new($X, $Y, $Width, $Height)) $Radius
  $Graphics.FillPath($Brush, $path)
  $path.Dispose()
}

function Save-Bmp([System.Drawing.Bitmap]$Bitmap, [string]$Path) {
  $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $Bitmap.Dispose()
}

function Draw-ZincIcon(
  [System.Drawing.Graphics]$Graphics,
  [System.Drawing.Image]$Icon,
  [float]$X,
  [float]$Y,
  [float]$Size
) {
  $previousInterpolation = $Graphics.InterpolationMode
  $previousPixelOffset = $Graphics.PixelOffsetMode
  $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $destination = [System.Drawing.Rectangle]::new(
    [int]$X,
    [int]$Y,
    [int]$Size,
    [int]$Size
  )
  $Graphics.DrawImage($Icon, $destination)
  $Graphics.InterpolationMode = $previousInterpolation
  $Graphics.PixelOffsetMode = $previousPixelOffset
}

function New-Sidebar([System.Drawing.Image]$Icon) {
  $bitmap = [System.Drawing.Bitmap]::new(164, 314)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  $bg = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.Rectangle]::new(0, 0, 164, 314),
    (New-Color 23 26 32),
    (New-Color 8 9 12),
    90
  )
  $graphics.FillRectangle($bg, 0, 0, 164, 314)
  $bg.Dispose()

  $glow = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.Rectangle]::new(0, 0, 164, 314),
    (New-Color 38 64 90),
    (New-Color 12 18 26),
    35
  )
  $graphics.FillEllipse($glow, -56, -42, 220, 180)
  $glow.Dispose()

  $panel = New-Brush 255 255 255 18
  Fill-RoundedRect $graphics $panel 14 16 136 282 18
  $panel.Dispose()

  $accent = New-Brush 92 150 205
  $muted = New-Brush 136 148 162
  $text = New-Brush 232 236 242
  $linePen = [System.Drawing.Pen]::new((New-Color 64 73 86), 1)

  Draw-ZincIcon $graphics $Icon 25 25 54

  $y = 112
  for ($i = 0; $i -lt 4; $i++) {
    $brush = if ($i -eq 0) { $accent } else { $muted }
    if ($i -lt 3) {
      $graphics.DrawLine($linePen, 40, $y + 23, 40, $y + 44)
    }
    Fill-RoundedRect $graphics $brush 30 $y 20 20 10
    Fill-RoundedRect $graphics $(if ($i -eq 0) { $text } else { $muted }) 58 ($y + 6) $(82 - ($i * 9)) 8 4
    $y += 46
  }

  $linePen.Dispose()
  $accent.Dispose()
  $muted.Dispose()
  $text.Dispose()
  $graphics.Dispose()

  Save-Bmp $bitmap (Join-Path $buildDir 'installer-sidebar.bmp')
}

function New-Header([System.Drawing.Image]$Icon) {
  $bitmap = [System.Drawing.Bitmap]::new(150, 57)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  $bg = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.Rectangle]::new(0, 0, 150, 57),
    (New-Color 250 250 250),
    (New-Color 232 236 241),
    0
  )
  $graphics.FillRectangle($bg, 0, 0, 150, 57)
  $bg.Dispose()

  $dark = New-Brush 23 26 32
  $muted = New-Brush 96 105 116
  Draw-ZincIcon $graphics $Icon 12 12 32
  Fill-RoundedRect $graphics $dark 52 17 72 9 4.5
  Fill-RoundedRect $graphics $muted 52 32 48 6 3

  $dark.Dispose()
  $muted.Dispose()
  $graphics.Dispose()

  Save-Bmp $bitmap (Join-Path $buildDir 'installer-header.bmp')
}

$iconPath = Join-Path $ProjectRoot 'resources/icon.png'
if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
  throw "Canonical Zinc icon is missing: $iconPath"
}

$icon = [System.Drawing.Image]::FromFile($iconPath)
try {
  New-Sidebar $icon
  New-Header $icon
} finally {
  $icon.Dispose()
}

Write-Host "Wrote installer artwork to $buildDir"
