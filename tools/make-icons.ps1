# YX Bridge
# Copyright 2026 MRsuperkosmos. Created 12 September 2026.
# Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
#
# Rebuilds extension/icon16|32|48|128.png (and icon.png) from docs/icon-source.jpg.
# - rounds the corners (20% radius) and produces every size with high-quality downscaling
# - if the source contains a baked-in green status dot, it is painted over with the background
#   colour: the extension draws the live status dot itself (see paintIcon in extension/background.js)
# Windows only (System.Drawing). Run:  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$srcPath = Join-Path $root 'docs\icon-source.jpg'
$ext = Join-Path $root 'extension'
if (-not (Test-Path $srcPath)) { throw "source image not found: $srcPath" }

$src = [System.Drawing.Bitmap]::FromFile($srcPath)
"source: $($src.Width)x$($src.Height)"
$bmp = New-Object System.Drawing.Bitmap $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g0 = [System.Drawing.Graphics]::FromImage($bmp); $g0.DrawImage($src, 0, 0, $src.Width, $src.Height); $g0.Dispose(); $src.Dispose()
$bg = $bmp.GetPixel(30, 30); "background: #{0:X2}{1:X2}{2:X2}" -f $bg.R, $bg.G, $bg.B

# paint over a baked-in green dot, if any (bounding box of clearly-green pixels)
$minX = $bmp.Width; $minY = $bmp.Height; $maxX = -1; $maxY = -1
for ($y = 0; $y -lt $bmp.Height; $y += 2) { for ($x = 0; $x -lt $bmp.Width; $x += 2) { $c = $bmp.GetPixel($x, $y); if ($c.G -gt ($c.R + 50) -and $c.G -gt ($c.B + 30)) { if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }; if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y } } } }
if ($maxX -ge 0) {
  $cx = ($minX + $maxX) / 2; $cy = ($minY + $maxY) / 2; $r = [Math]::Max($maxX - $minX, $maxY - $minY) / 2
  "green dot found at ($cx,$cy) r=$r -> painting over"
  $cover = $r * 1.45
  $g1 = [System.Drawing.Graphics]::FromImage($bmp); $g1.SmoothingMode = 'AntiAlias'
  $g1.FillEllipse((New-Object System.Drawing.SolidBrush $bg), $cx - $cover, $cy - $cover, 2 * $cover, 2 * $cover)
  $g1.Dispose()
} else { "no baked-in dot (good)" }

function Save-Size($S, $path) {
  $out = New-Object System.Drawing.Bitmap $S, $S, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $og = [System.Drawing.Graphics]::FromImage($out)
  $og.SmoothingMode = 'AntiAlias'; $og.InterpolationMode = 'HighQualityBicubic'; $og.PixelOffsetMode = 'HighQuality'; $og.CompositingQuality = 'HighQuality'
  $og.Clear([System.Drawing.Color]::Transparent)
  $rad = [Math]::Round($S * 0.2); $d = 2 * $rad
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc(0, 0, $d, $d, 180, 90); $p.AddArc($S - $d, 0, $d, $d, 270, 90); $p.AddArc($S - $d, $S - $d, $d, $d, 0, 90); $p.AddArc(0, $S - $d, $d, $d, 90, 90); $p.CloseFigure()
  $og.SetClip($p); $og.DrawImage($bmp, 0, 0, $S, $S); $og.ResetClip(); $og.Dispose()
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $out.Dispose()
  "wrote $path"
}
foreach ($S in 16, 32, 48, 128) { Save-Size $S (Join-Path $ext "icon$S.png") }
Save-Size 128 (Join-Path $ext 'icon.png')
$bmp.Dispose()
"done"
