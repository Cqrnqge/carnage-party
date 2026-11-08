Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

function New-IconBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $scale = $size / 512.0
  $pad = [int](6 * $scale)
  $rect = New-Object System.Drawing.Rectangle($pad, $pad, ($size - 2 * $pad), ($size - 2 * $pad))
  $radius = [int](132 * $scale)

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
  $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()

  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 255, 61, 113),
    [System.Drawing.Color]::FromArgb(255, 124, 58, 237),
    45.0
  )
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend(3)
  $blend.Colors = @(
    [System.Drawing.Color]::FromArgb(255, 255, 61, 113),
    [System.Drawing.Color]::FromArgb(255, 217, 70, 239),
    [System.Drawing.Color]::FromArgb(255, 124, 58, 237)
  )
  $blend.Positions = @(0.0, 0.52, 1.0)
  $brush.InterpolationColors = $blend
  $g.FillPath($brush, $path)

  $gloss = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(70, 255, 255, 255),
    [System.Drawing.Color]::FromArgb(0, 255, 255, 255),
    90.0
  )
  $g.FillPath($gloss, $path)

  $points = @(
    (New-Object System.Drawing.PointF([float](310.4 * $scale), [float](68.0 * $scale))),
    (New-Object System.Drawing.PointF([float](148.0 * $scale), [float](281.6 * $scale))),
    (New-Object System.Drawing.PointF([float](148.0 * $scale), [float](302.4 * $scale))),
    (New-Object System.Drawing.PointF([float](229.6 * $scale), [float](302.4 * $scale))),
    (New-Object System.Drawing.PointF([float](197.6 * $scale), [float](431.2 * $scale))),
    (New-Object System.Drawing.PointF([float](364.0 * $scale), [float](212.8 * $scale))),
    (New-Object System.Drawing.PointF([float](290.4 * $scale), [float](212.8 * $scale))),
    (New-Object System.Drawing.PointF([float](323.2 * $scale), [float](89.6 * $scale)))
  )
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(250, 255, 255, 255))
  $g.FillPolygon($white, $points)

  $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(26, 0, 0, 0))
  $g.FillEllipse($shadow, [int](70 * $scale), [int](392 * $scale), [int](372 * $scale), [int](56 * $scale))

  $white.Dispose()
  $shadow.Dispose()
  $brush.Dispose()
  $gloss.Dispose()
  $path.Dispose()
  $g.Dispose()
  return $bmp
}

$master = New-IconBitmap 512
$master.Save((Join-Path $buildDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngBlobs = @()
foreach ($s in $sizes) {
  $bmp = New-IconBitmap $s
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBlobs += ,@($s, $ms.ToArray())
  $bmp.Dispose()
  $ms.Dispose()
}

$icoPath = Join-Path $buildDir 'icon.ico'
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$pngBlobs.Count)
$offset = 6 + 16 * $pngBlobs.Count
foreach ($entry in $pngBlobs) {
  $size = [int]$entry[0]
  $data = [byte[]]$entry[1]
  $dim = if ($size -ge 256) { 0 } else { $size }
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]0)
  $bw.Write([Byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$data.Length)
  $bw.Write([UInt32]$offset)
  $offset += $data.Length
}
foreach ($entry in $pngBlobs) {
  $bw.Write([byte[]]$entry[1])
}
$bw.Flush()
$bw.Close()
$fs.Close()
$master.Dispose()

Write-Output ('PNG: ' + (Join-Path $buildDir 'icon.png'))
Write-Output ('ICO: ' + $icoPath)
