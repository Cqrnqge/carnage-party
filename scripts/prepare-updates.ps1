param(
    [string]$Version = ""
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $Version) {
    $package = Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $Version = $package.version
}

$release = Join-Path $root 'release'
$updates = Join-Path $root 'updates'
New-Item -ItemType Directory -Force $updates | Out-Null

$setup = Join-Path $release "Carnage-Party-Setup-$Version.exe"
$portableExe = Join-Path $release "Carnage-Party-Portable-$Version.exe"
$portableZip = Join-Path $release "Carnage-Party-Portable-$Version.zip"
$apk = Join-Path $release "Carnage-Party-Mobile-$Version.apk"

$missing = @()
foreach ($file in @($setup, $portableExe, $apk)) {
    if (-not (Test-Path $file)) { $missing += (Split-Path -Leaf $file) }
}
if ($missing.Count -gt 0) {
    Write-Host "Не найдены файлы сборки:" -ForegroundColor Red
    foreach ($name in $missing) { Write-Host "  $name" -ForegroundColor Red }
    Write-Host "Сначала соберите Windows и Android (пункты 10 и 11)." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $portableZip)) {
    Write-Host "Создаём $([IO.Path]::GetFileName($portableZip))..."
    Compress-Archive -Path $portableExe -DestinationPath $portableZip -CompressionLevel NoCompression -Force
}

Copy-Item $setup $updates -Force
Copy-Item $portableZip $updates -Force
Copy-Item $apk $updates -Force

$assets = @(
    (Get-Item $setup),
    (Get-Item $portableZip),
    (Get-Item $apk)
)
$lines = foreach ($asset in $assets) {
    $hash = (Get-FileHash -Path $asset.FullName -Algorithm SHA256).Hash.ToLower()
    "$hash  $($asset.Name)"
}
$sumFile = Join-Path $release "SHA256SUMS-$Version.txt"
[IO.File]::WriteAllLines($sumFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
Copy-Item $sumFile (Join-Path $updates "SHA256SUMS-$Version.txt") -Force

Write-Host ""
Write-Host "Обновления разложены в updates:" -ForegroundColor Green
foreach ($asset in $assets) {
    $sizeMb = [Math]::Round($asset.Length / 1MB, 2)
    Write-Host ("  {0}  ({1} МБ)" -f $asset.Name, $sizeMb)
}
Write-Host "  SHA256SUMS-$Version.txt"
Write-Host ""
Write-Host "Перезапуск сервера не нужен: файлы читаются при запросе /api/version." -ForegroundColor DarkGray
exit 0
