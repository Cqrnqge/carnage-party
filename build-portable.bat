@echo off
chcp 65001 >nul
title Carnage Party — portable-версия
cd /d "%~dp0"

echo ============================================================
echo   Carnage Party — сборка переносной версии
echo ============================================================
echo.
echo Результат: release\Carnage-Party-Portable-1.1.0.exe
echo.

call npm run dist:portable
if errorlevel 1 (
  echo.
  echo [ОШИБКА] Portable-версия не собрана. Смотрите сообщения выше.
  goto end
)

echo.
echo [ГОТОВО] Portable-версия находится в папке release
explorer "%~dp0release"

:end
echo.
pause
