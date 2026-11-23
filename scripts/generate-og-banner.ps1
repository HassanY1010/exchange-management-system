Add-Type -AssemblyName System.Drawing

$logoPath = "e:\project_AC\public\brand\logo.png"
$outputPath = "e:\project_AC\public\brand\og-banner.png"

$logo = [System.Drawing.Image]::FromFile($logoPath)
Write-Output "Logo dimensions: $($logo.Width) x $($logo.Height)"

$width = 1200
$height = 630

$bmp = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)

$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# 1. Fill background with deep sleek dark slate (#0B1120)
$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 11, 17, 32))
$g.FillRectangle($bgBrush, 0, 0, $width, $height)

# 2. Add subtle ambient glow in center
$centerPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$centerPath.AddEllipse(200, 50, 800, 530)
$pbg = New-Object System.Drawing.Drawing2D.PathGradientBrush($centerPath)
$pbg.CenterColor = [System.Drawing.Color]::FromArgb(40, 217, 119, 6) # amber-500 subtle glow
$pbg.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 11, 17, 32))
$g.FillPath($pbg, $centerPath)

# 3. Add top and bottom border accent line in golden amber
$accentPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 217, 119, 6), 4)
$g.DrawLine($accentPen, 0, 0, $width, 0)
$g.DrawLine($accentPen, 0, $height - 4, $width, $height - 4)

# 4. Draw Logo in white container with rounded corners and gold border
# Container size: 420x420, centered vertically on left or center
# Let's create a balanced layout:
# Centered logo container: X = 100, Y = 105, W = 420, H = 420
$cardX = 90
$cardY = 95
$cardW = 440
$cardH = 440

$cardBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillRectangle($cardBrush, $cardX, $cardY, $cardW, $cardH)

$cardPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 217, 119, 6), 3)
$g.DrawRectangle($cardPen, $cardX, $cardY, $cardW, $cardH)

# Draw Logo inside card
$pad = 20
$g.DrawImage($logo, ($cardX + $pad), ($cardY + $pad), ($cardW - 2 * $pad), ($cardH - 2 * $pad))

# 5. Right side typography:
# Title in Arabic: أبو جواد للتجارة
# English: ABU JAWAD FOR TRADEING
# Subtitle: المنظومة المالية المركزية لإدارة الصرافة والتحويلات
$textX = 580

# Font definitions
$fontArTitle = New-Object System.Drawing.Font("Cairo", 42, [System.Drawing.FontStyle]::Bold)
if ($fontArTitle.Name -ne "Cairo") {
    $fontArTitle = New-Object System.Drawing.Font("Segoe UI", 42, [System.Drawing.FontStyle]::Bold)
}
$fontEnTitle = New-Object System.Drawing.Font("Arial", 28, [System.Drawing.FontStyle]::Bold)
$fontDesc = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Regular)
$fontBadge = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)

$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$goldBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 245, 158, 11))
$grayBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 148, 163, 184))
$badgeBgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(50, 245, 158, 11))
$badgePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(150, 245, 158, 11), 1.5)

# Badge: نظام صرافة ومحاسبة معتمد
$g.FillRectangle($badgeBgBrush, $textX, 125, 340, 42)
$g.DrawRectangle($badgePen, $textX, 125, 340, 42)
$g.DrawString("نظام معتمد لإدارة الصرافة والعملات", $fontBadge, $goldBrush, ($textX + 20), 133)

# Arabic Title
$g.DrawString("أبو جواد للتجارة", $fontArTitle, $whiteBrush, $textX, 190)

# English Title
$g.DrawString("ABU JAWAD FOR TRADEING", $fontEnTitle, $goldBrush, $textX, 280)

# Separator line
$sepPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(80, 255, 255, 255), 1.5)
$g.DrawLine($sepPen, $textX, 345, ($width - 80), 345)

# Description text
$g.DrawString("المنظومة المالية والمحاسبية المتكاملة", $fontDesc, $whiteBrush, $textX, 365)
$g.DrawString("إدارة الخزائن، الحسابات اليومية، وإيصالات بنكك والتحويلات", $fontDesc, $grayBrush, $textX, 405)

# Feature tags
$tagFont = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$tagBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 59, 130, 246))

$g.DrawString("• تدقيق OCR آلي    • ربط الحسابات    • إغلاق يومي فوري", $tagFont, $goldBrush, $textX, 465)

# Save image
$bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

Write-Output "Successfully saved $outputPath"
$fileInfo = Get-Item $outputPath
Write-Output "File size: $($fileInfo.Length) bytes"

$logo.Dispose()
$bmp.Dispose()
$g.Dispose()
