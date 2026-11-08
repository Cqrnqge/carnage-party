@echo off
chcp 65001 >nul
title Carnage Party — локальный сервер
cd /d "%~dp0"

echo ============================================================
echo   Carnage Party — локальный сервер
echo ============================================================
echo.
echo Сервер будет доступен по адресу: http://127.0.0.1:3001
echo База и загрузки: %~dp0data
echo Для остановки нажмите Ctrl+C.
echo.

if not exist "node_modules\express" (
  echo [ОШИБКА] Зависимости не установлены.
  echo Сначала запустите install.bat
  goto end
)

call npm run server

:end
echo.
pause
