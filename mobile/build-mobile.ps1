param(
    [string]$ServerUrl = "",
    [string]$Version = ""
)

$ErrorActionPreference = 'Stop'
$mobileDir = $PSScriptRoot
$root = Split-Path -Parent $mobileDir
Set-Location $root

function Write-Step([string]$text) {
    Write-Host ""
    Write-Host "== $text ==" -ForegroundColor Magenta
}

function Fail([string]$text) {
    Write-Host ""
    Write-Host $text -ForegroundColor Red
    exit 1
}

Write-Step "Проверка Java"
$javaCandidates = @()
if ($env:CARNAGE_JAVA_HOME) { $javaCandidates += $env:CARNAGE_JAVA_HOME }
$javaCandidates += 'H:\l2j\classic 1.0\ClassicServer\java'
if ($env:JAVA_HOME) { $javaCandidates += $env:JAVA_HOME }

$javaHome = $null
foreach ($candidate in $javaCandidates) {
    if ($candidate -and (Test-Path (Join-Path $candidate 'bin\javac.exe'))) {
        $javaHome = (Resolve-Path $candidate).Path
        break
    }
}
if (-not $javaHome) {
    $javacCmd = Get-Command javac.exe -ErrorAction SilentlyContinue
    if ($javacCmd) {
        $javaHome = Split-Path -Parent (Split-Path -Parent $javacCmd.Source)
    }
}
if (-not $javaHome) {
    Fail "JDK не найден. Установите Java 17+ или задайте CARNAGE_JAVA_HOME."
}
$env:JAVA_HOME = $javaHome
$env:Path = (Join-Path $javaHome 'bin') + ';' + $env:Path
Write-Host "Java: $javaHome"

Write-Step "Версия и адрес сервера"
if (-not $Version) {
    $package = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
    $Version = $package.version
}
$versionParts = $Version.Split('.')
$versionCode = [int]$versionParts[0] * 10000 + [int]$versionParts[1] * 100 + [int]$versionParts[2]

if (-not $ServerUrl) {
    $defaultServerFile = Join-Path $root 'electron\default-server.txt'
    if (Test-Path $defaultServerFile) {
        $ServerUrl = (Get-Content $defaultServerFile -Raw).Trim()
    }
}
if (-not $ServerUrl) {
    $ServerUrl = 'http://188.234.161.207:3001'
}
$ServerUrl = $ServerUrl.Trim().TrimEnd('/')
if (-not $ServerUrl.StartsWith('http://') -and -not $ServerUrl.StartsWith('https://')) {
    $ServerUrl = 'http://' + $ServerUrl
}
Write-Host "Версия: $Version ($versionCode)"
Write-Host "Сервер: $ServerUrl"

$sdk = Join-Path $mobileDir '.sdk'
$buildToolsVersion = '35.0.0'
$buildTools = Join-Path $sdk "build-tools\$buildToolsVersion"
$platform = Join-Path $sdk 'platforms\android-35'
$androidJar = Join-Path $platform 'android.jar'
$downloads = Join-Path $sdk 'downloads'
New-Item -ItemType Directory -Force $downloads | Out-Null

function Download([string]$url, [string]$dest) {
    if (Test-Path $dest) { return }
    Write-Host "Скачивание: $url"
    & curl.exe -L --retry 4 --retry-delay 2 --fail -o $dest $url
    if ($LASTEXITCODE -ne 0) {
        Fail "Не удалось скачать $url"
    }
}

if (-not (Test-Path (Join-Path $buildTools 'aapt2.exe'))) {
    Write-Step "Загрузка Android Build-Tools 35"
    $zip = Join-Path $downloads 'build-tools_r35.zip'
    Download 'https://dl.google.com/android/repository/build-tools_r35_windows.zip' $zip
    $tmp = Join-Path $sdk 'tmp-build-tools'
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force $tmp | Out-Null
    & tar.exe -xf $zip -C $tmp
    if ($LASTEXITCODE -ne 0) { Fail "Не удалось распаковать Build-Tools" }
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    if (-not $inner) { Fail "Build-Tools архив пуст" }
    New-Item -ItemType Directory -Force (Split-Path -Parent $buildTools) | Out-Null
    Move-Item $inner.FullName $buildTools
    Remove-Item -Recurse -Force $tmp
}

if (-not (Test-Path $androidJar)) {
    Write-Step "Загрузка Android Platform 35"
    $zip = Join-Path $downloads 'platform-35.zip'
    Download 'https://dl.google.com/android/repository/platform-35_r02.zip' $zip
    $tmp = Join-Path $sdk 'tmp-platform'
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force $tmp | Out-Null
    & tar.exe -xf $zip -C $tmp
    if ($LASTEXITCODE -ne 0) { Fail "Не удалось распаковать Android Platform" }
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    if (-not $inner) { Fail "Platform архив пуст" }
    New-Item -ItemType Directory -Force (Split-Path -Parent $platform) | Out-Null
    Move-Item $inner.FullName $platform
    Remove-Item -Recurse -Force $tmp
}

Write-Step "Подготовка исходников"
$buildDir = Join-Path $mobileDir 'build'
Remove-Item -Recurse -Force $buildDir -ErrorAction SilentlyContinue
$genDir = Join-Path $buildDir 'gen'
$classesDir = Join-Path $buildDir 'classes'
$dexDir = Join-Path $buildDir 'dex'
New-Item -ItemType Directory -Force $genDir, $classesDir, $dexDir | Out-Null

$configPath = Join-Path $mobileDir 'src\com\carnage\party\Config.java'
$configSource = @"
package com.carnage.party;

public final class Config {
    public static final String DEFAULT_SERVER = "$ServerUrl";
    public static final String VERSION_NAME = "$Version";

    private Config() {
    }
}
"@
[IO.File]::WriteAllText($configPath, $configSource, (New-Object System.Text.UTF8Encoding($false)))

Write-Step "Сборка веб-клиента"
$clientDir = Join-Path $root 'client'
$wwwDir = Join-Path $mobileDir 'www'
$env:CARNAGE_DEFAULT_SERVER = $ServerUrl
Push-Location $clientDir
& npm.cmd run build:mobile
$webCode = $LASTEXITCODE
Pop-Location
if ($webCode -ne 0) { Fail "Сборка веб-клиента завершилась с ошибкой" }
if (-not (Test-Path (Join-Path $wwwDir 'index.html'))) {
    Fail "Не найден собранный клиент: $wwwDir\index.html"
}
Write-Host "Клиент: $wwwDir"

Write-Step "Компиляция ресурсов"
$aapt2 = Join-Path $buildTools 'aapt2.exe'
$resZip = Join-Path $buildDir 'res.zip'
$unsignedApk = Join-Path $buildDir 'app-unsigned.apk'
& $aapt2 compile --dir (Join-Path $mobileDir 'res') -o $resZip
if ($LASTEXITCODE -ne 0) { Fail "aapt2 compile завершился с ошибкой" }

& $aapt2 link -o $unsignedApk -I $androidJar --manifest (Join-Path $mobileDir 'AndroidManifest.xml') --java $genDir --min-sdk-version 23 --target-sdk-version 35 --version-code $versionCode --version-name $Version $resZip
if ($LASTEXITCODE -ne 0) { Fail "aapt2 link завершился с ошибкой" }

Write-Step "Компиляция Java"
$sources = @(Get-ChildItem (Join-Path $mobileDir 'src') -Recurse -Filter *.java | ForEach-Object { $_.FullName })
$rJava = @(Get-ChildItem $genDir -Recurse -Filter R.java | ForEach-Object { $_.FullName })
$javacArgs = @('-encoding', 'UTF-8', '--release', '8', '-classpath', $androidJar, '-d', $classesDir) + $sources + $rJava
& (Join-Path $javaHome 'bin\javac.exe') @javacArgs
if ($LASTEXITCODE -ne 0) { Fail "javac завершился с ошибкой" }

Write-Step "Сборка classes.dex"
$classFiles = @(Get-ChildItem $classesDir -Recurse -Filter *.class | ForEach-Object { $_.FullName })
if ($classFiles.Count -eq 0) { Fail "Не найдены скомпилированные классы" }
$d8 = Join-Path $buildTools 'd8.bat'
$d8Args = @('--lib', $androidJar, '--min-api', '23', '--output', $dexDir) + $classFiles
& $d8 @d8Args
if ($LASTEXITCODE -ne 0) { Fail "d8 завершился с ошибкой" }

Write-Step "Упаковка APK"
# aapt2 link с -A на Windows пишет пути assets с обратными слэшами,
# а последующая перепаковка zip сжимает resources.arsc. Поэтому assets
# и classes.dex добавляются штатным jar: он сохраняет способ сжатия
# существующих записей и пишет имена с прямыми слэшами.
$assetsStage = Join-Path $buildDir 'apk-assets'
Remove-Item -Recurse -Force $assetsStage -ErrorAction SilentlyContinue
# MainActivity открывает file:///android_asset/www/index.html,
# поэтому клиент кладём в assets/www, а не в корень assets.
$assetsDir = Join-Path $assetsStage 'assets\www'
New-Item -ItemType Directory -Force $assetsDir | Out-Null
Copy-Item (Join-Path $wwwDir '*') $assetsDir -Recurse -Force
Copy-Item (Join-Path $dexDir 'classes.dex') (Join-Path $assetsStage 'classes.dex') -Force

Push-Location $assetsStage
& (Join-Path $javaHome 'bin\jar.exe') uf $unsignedApk .
$jarCode = $LASTEXITCODE
Pop-Location
if ($jarCode -ne 0) { Fail "Не удалось добавить assets и classes.dex в APK" }

$alignedApk = Join-Path $buildDir 'app-aligned.apk'
& (Join-Path $buildTools 'zipalign.exe') -f 4 $unsignedApk $alignedApk
if ($LASTEXITCODE -ne 0) { Fail "zipalign завершился с ошибкой" }

Write-Step "Подпись APK"
$keystoreDir = Join-Path $mobileDir 'keystore'
$keystore = Join-Path $keystoreDir 'carnage-release.jks'
if (-not (Test-Path $keystore)) {
    New-Item -ItemType Directory -Force $keystoreDir | Out-Null
    & (Join-Path $javaHome 'bin\keytool.exe') -genkeypair -v -keystore $keystore -storetype JKS -storepass carnageparty -keypass carnageparty -alias carnage -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Carnage Party, OU=Mobile, O=Carnage Party, L=Moscow, C=RU"
    if ($LASTEXITCODE -ne 0) { Fail "keytool завершился с ошибкой" }
}

$releaseDir = Join-Path $root 'release'
New-Item -ItemType Directory -Force $releaseDir | Out-Null
$apkOut = Join-Path $releaseDir "Carnage-Party-Mobile-$Version.apk"
Remove-Item $apkOut -Force -ErrorAction SilentlyContinue

& (Join-Path $buildTools 'apksigner.bat') sign --ks $keystore --ks-key-alias carnage --ks-pass pass:carnageparty --key-pass pass:carnageparty --out $apkOut $alignedApk
if ($LASTEXITCODE -ne 0) { Fail "apksigner завершился с ошибкой" }

& (Join-Path $buildTools 'apksigner.bat') verify --verbose $apkOut | Select-Object -First 12
if ($LASTEXITCODE -ne 0) { Fail "Проверка подписи APK не прошла" }

$sizeMb = [Math]::Round((Get-Item $apkOut).Length / 1MB, 2)
Write-Step "Готово"
Write-Host "APK: $apkOut" -ForegroundColor Green
Write-Host "Размер: $sizeMb МБ"
Write-Host "Сервер по умолчанию: $ServerUrl"
exit 0
