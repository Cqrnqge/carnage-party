@echo off
chcp 65001 >nul
title Carnage Party — сборка клиента
cd /d "%~dp0"

echo ============================================================
echo   Carnage Party — сборка интерфейса
echo ============================================================
echo.

call npm run build:client
if errorlevel 1 (
  echo.
  echo [ОШИБКА] Сборка клиента не удалась. Смотрите сообщения выше.
  goto end
)

echo.
echo [ГОТОВО] Интерфейс собран в client\dist

:end
echo.
pause
