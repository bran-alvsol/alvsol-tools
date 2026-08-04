Add-Type -AssemblyName System.Drawing

$size = 256
$bitmap = [System.Drawing.Bitmap]::new($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::FromArgb(23, 32, 39))

$tealBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(8, 127, 115))
$graphics.FillRectangle($tealBrush, 0, 216, $size, 40)

$font = [System.Drawing.Font]::new("Segoe UI", 104, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString("AT", $font, $whiteBrush, [System.Drawing.RectangleF]::new(0, -4, $size, 220), $format)

$resources = Join-Path $PSScriptRoot "..\resources"
$pngPath = Join-Path $resources "icon.png"
$icoPath = Join-Path $resources "icon.ico"
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$stream = [System.IO.File]::Create($icoPath)
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]1)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([uint16]1)
$writer.Write([uint16]32)
$writer.Write([uint32]$pngBytes.Length)
$writer.Write([uint32]22)
$writer.Write($pngBytes)
$writer.Dispose()

$format.Dispose()
$whiteBrush.Dispose()
$font.Dispose()
$tealBrush.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
