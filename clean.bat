@echo off
chcp 65001 >nul
title Carnage Party — очистка сборки
cd /d "%~dp0"

echo ============================================================
echo   Carnage Party — очистка артефактов сборки
echo ============================================================
echo.
echo Будут удалены: release, client\dist, dist
echo Данные приложения (data, data-dev) НЕ удаляются.
echo.
choice /c YN /n /m "Продолжить? [Y/N]: "
if errorlevel 2 goto cancel

call npm run clean
echo.
echo [ГОТОВО] Очистка завершена.
goto end

:cancel
echo Отменено.

:end
echo.
pause
