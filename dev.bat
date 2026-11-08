@echo off
chcp 65001 >nul
title Carnage Party — режим разработки
cd /d "%~dp0"

echo ============================================================
echo   Carnage Party — режим разработки
echo ============================================================
echo.
echo Запускаются: сервер :3001, Vite :5173 и Electron.
echo Vite обновляет интерфейс на лету. Закройте окно Electron для выхода.
echo.

if not exist "node_modules\electron" (
  echo [ОШИБКА] Зависимости не установлены.
  echo Сначала запустите install.bat
  goto end
)

call npm run dev
if errorlevel 1 (
  echo.
  echo [ОШИБКА] Режим разработки завершился с ошибкой.
)

:end
echo.
pause
