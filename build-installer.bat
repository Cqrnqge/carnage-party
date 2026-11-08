@echo off
chcp 65001 >nul
title Carnage Party — установщик NSIS
cd /d "%~dp0"

echo ============================================================
echo   Carnage Party — сборка установщика NSIS
echo ============================================================
echo.
echo Результат: release\Carnage-Party-Setup-1.1.0.exe
echo.

call npm run dist:nsis
if errorlevel 1 (
  echo.
  echo [ОШИБКА] Установщик не собран. Смотрите сообщения выше.
  goto end
)

echo.
echo [ГОТОВО] Установщик находится в папке release
explorer "%~dp0release"

:end
echo.
pause
