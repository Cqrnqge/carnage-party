@echo off
chcp 65001 >nul
title Carnage Party — сборка Android APK
cd /d "%~dp0"

echo ============================================================
echo   Carnage Party — сборка Android APK
echo ============================================================
echo.
echo Результат: release\Carnage-Party-Mobile-1.1.0.apk
echo.
echo Первый запуск скачает Android Build-Tools и Platform (около 120 МБ).
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mobile\build-mobile.ps1" %*
if errorlevel 1 (
  echo.
  echo [Ошибка] Сборка APK не удалась. Проверьте сообщения выше.
  goto end
)

echo.
echo [Готово] APK находится в папке release.
explorer "%~dp0release"

:end
echo.
pause
