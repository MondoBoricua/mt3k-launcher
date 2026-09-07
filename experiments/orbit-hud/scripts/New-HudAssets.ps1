param([Parameter(Mandatory = $true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
foreach ($hudAsset in @(@('StoreLogo.png',50,50), @('Square44x44Logo.png',44,44), @('Square150x150Logo.png',150,150), @('SplashScreen.png',620,300))) {
    $bitmap = New-Object System.Drawing.Bitmap([int]$hudAsset[1], [int]$hudAsset[2])
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $pen = $null
    $brush = $null
    try {
        $graphics.Clear([Drawing.ColorTranslator]::FromHtml('#101316'))
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $unit = [Math]::Min($bitmap.Width, $bitmap.Height) * 0.62
        $graphics.TranslateTransform($bitmap.Width / 2, $bitmap.Height / 2)
        $graphics.RotateTransform(-32)
        $color = [Drawing.ColorTranslator]::FromHtml('#83E4CA')
        $pen = New-Object Drawing.Pen($color, [single]($unit * 0.065))
        $brush = New-Object Drawing.SolidBrush($color)
        $graphics.DrawEllipse($pen, [single](-$unit / 2), [single](-$unit / 3), [single]$unit, [single]($unit * 2 / 3))
        $graphics.FillEllipse($brush, [single](-$unit * 0.12), [single](-$unit * 0.12), [single]($unit * 0.24), [single]($unit * 0.24))
        $bitmap.Save((Join-Path $OutputDirectory $hudAsset[0]), [Drawing.Imaging.ImageFormat]::Png)
    } finally {
        if ($pen) { $pen.Dispose() }
        if ($brush) { $brush.Dispose() }
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}
