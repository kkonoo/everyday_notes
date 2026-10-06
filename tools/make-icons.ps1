# Draws the app icons (icons/app-*.png): memo pad with brown top band, rings, sage checklist.
# Same palette as the planner icon. Maskable = light sage background (Android / iPhone).
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-icons.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\icons'

function RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}
function Brush($hex) { return New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml($hex)) }

function DrawIcon {
  $bmp = New-Object Drawing.Bitmap 512, 512
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([Drawing.Color]::Transparent)

  # page shadow, page, brown band (top of page, clipped to the rounded page)
  $g.FillPath((Brush '#E5D8C2'), (RoundRect 96 126 320 346 46))
  $page = RoundRect 96 112 320 346 46
  $g.FillPath((Brush '#FFF8F0'), $page)
  $g.SetClip($page)
  $g.FillRectangle((Brush '#8B6A4E'), 96, 112, 320, 84)
  $g.ResetClip()

  # rings
  foreach ($cx in 176, 256, 336) { $g.FillPath((Brush '#3E2A1F'), (RoundRect ($cx - 16) 70 32 84 16)) }

  # checklist: two checked rows + one empty box
  $pen = New-Object Drawing.Pen ([Drawing.ColorTranslator]::FromHtml('#87A06B')), 20
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
  $line = Brush '#E2D5C1'
  foreach ($y in 262, 336) {
    $pts = [Drawing.PointF[]]@((New-Object Drawing.PointF 146, $y), (New-Object Drawing.PointF 168, ($y + 20)), (New-Object Drawing.PointF 206, ($y - 20)))
    $g.DrawLines($pen, $pts)
    $g.FillPath($line, (RoundRect 236 ($y - 12) 136 24 12))
  }
  $box = New-Object Drawing.Pen ([Drawing.ColorTranslator]::FromHtml('#87A06B')), 12
  $g.DrawPath($box, (RoundRect 150 388 50 50 12))
  $g.FillPath($line, (RoundRect 236 401 100 24 12))
  $g.Dispose()
  return $bmp
}

function Save($bmp, [int]$size, $name) {
  $dst = New-Object Drawing.Bitmap $size, $size
  $g = [Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.SmoothingMode = 'AntiAlias'
  $g.DrawImage($bmp, 0, 0, $size, $size)
  $g.Dispose()
  $dst.Save((Join-Path $out $name), [Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose()
}

$icon = DrawIcon
Save $icon 512 'app-512.png'
Save $icon 192 'app-192.png'

# maskable: keep the drawing inside the safe zone (center 80%)
$mask = New-Object Drawing.Bitmap 512, 512
$g = [Drawing.Graphics]::FromImage($mask)
$g.InterpolationMode = 'HighQualityBicubic'
$g.Clear([Drawing.ColorTranslator]::FromHtml('#E6EEDC'))
$g.DrawImage($icon, 64, 64, 384, 384)
$g.Dispose()
Save $mask 512 'app-maskable-512.png'
Save $mask 192 'app-maskable-192.png'
Write-Host 'icons written'
