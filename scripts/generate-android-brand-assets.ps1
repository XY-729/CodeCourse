param(
    [string]$Source = "resources/icon.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root $Source
$resRoot = Join-Path $root "android/app/src/main/res"

if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Brand source not found: $sourcePath"
}

function New-BrandBitmap {
    param(
        [System.Drawing.Image]$Image,
        [int]$Width,
        [int]$Height,
        [string]$OutputPath,
        [System.Drawing.Color]$Background,
        [double]$LogoScale
    )

    New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force | Out-Null
    $bitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear($Background)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

        $size = [int]([Math]::Round([Math]::Min($Width, $Height) * $LogoScale))
        $x = [int](($Width - $size) / 2)
        $y = [int](($Height - $size) / 2)
        $graphics.DrawImage($Image, $x, $y, $size, $size)
        $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$brand = [System.Drawing.Image]::FromFile($sourcePath)
$transparent = [System.Drawing.Color]::Transparent
$warmWhite = [System.Drawing.ColorTranslator]::FromHtml("#F5F5F2")

try {
    $launcherSizes = @{ mdpi = 48; hdpi = 72; xhdpi = 96; xxhdpi = 144; xxxhdpi = 192 }
    $foregroundSizes = @{ mdpi = 108; hdpi = 162; xhdpi = 216; xxhdpi = 324; xxxhdpi = 432 }

    foreach ($density in $launcherSizes.Keys) {
        $directory = Join-Path $resRoot "mipmap-$density"
        $size = $launcherSizes[$density]
        New-BrandBitmap $brand $size $size (Join-Path $directory "ic_launcher.png") $transparent 1.0
        New-BrandBitmap $brand $size $size (Join-Path $directory "ic_launcher_round.png") $transparent 1.0

        $foregroundSize = $foregroundSizes[$density]
        New-BrandBitmap $brand $foregroundSize $foregroundSize (Join-Path $directory "ic_launcher_foreground.png") $transparent 0.72
    }

    $splashTargets = @(
        @{ Path = "drawable/splash.png"; Width = 480; Height = 320 },
        @{ Path = "drawable-land-mdpi/splash.png"; Width = 480; Height = 320 },
        @{ Path = "drawable-land-hdpi/splash.png"; Width = 800; Height = 480 },
        @{ Path = "drawable-land-xhdpi/splash.png"; Width = 1280; Height = 720 },
        @{ Path = "drawable-land-xxhdpi/splash.png"; Width = 1600; Height = 960 },
        @{ Path = "drawable-land-xxxhdpi/splash.png"; Width = 1920; Height = 1280 },
        @{ Path = "drawable-port-mdpi/splash.png"; Width = 320; Height = 480 },
        @{ Path = "drawable-port-hdpi/splash.png"; Width = 480; Height = 800 },
        @{ Path = "drawable-port-xhdpi/splash.png"; Width = 720; Height = 1280 },
        @{ Path = "drawable-port-xxhdpi/splash.png"; Width = 960; Height = 1600 },
        @{ Path = "drawable-port-xxxhdpi/splash.png"; Width = 1280; Height = 1920 }
    )

    foreach ($target in $splashTargets) {
        New-BrandBitmap $brand ([int]$target.Width) ([int]$target.Height) (Join-Path $resRoot $target.Path) $warmWhite 0.34
    }
}
finally {
    $brand.Dispose()
}

Write-Host "Android brand assets generated from $sourcePath"
