# Maintainer utility (Windows): preserve official artwork; only fit and resize.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'extension/icons'
New-Item -ItemType Directory -Path $assetRoot -Force | Out-Null
$response = Invoke-WebRequest -Uri 'https://www.slai.edu.cn/sites/default/files/LOGO-05.png' -UseBasicParsing
$response.RawContentStream.Position = 0
$source = [System.Drawing.Bitmap]::new($response.RawContentStream)
try {
  foreach ($size in @(16, 32, 48, 64, 128, 256)) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $scale = $size * 0.94 / [Math]::Max($source.Width, $source.Height)
      $width = [float]($source.Width * $scale)
      $height = [float]($source.Height * $scale)
      $rectangle = [System.Drawing.RectangleF]::new(($size - $width) / 2, ($size - $height) / 2, $width, $height)
      $graphics.DrawImage($source, $rectangle)
      $bitmap.Save((Join-Path $assetRoot "slai-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
} finally { $source.Dispose() }
foreach ($name in @('external-link', 'refresh')) {
  & curl.exe --fail --location --retry 2 "https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/$name.svg" -o (Join-Path $assetRoot "$name.svg")
  if ($LASTEXITCODE -ne 0) { throw "Failed to download Tabler $name" }
}
& curl.exe --fail --location --retry 2 'https://raw.githubusercontent.com/tabler/tabler-icons/main/LICENSE' -o (Join-Path $assetRoot 'TABLER-LICENSE.txt')
if ($LASTEXITCODE -ne 0) { throw 'Failed to download Tabler license' }
