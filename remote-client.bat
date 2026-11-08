@echo off
chcp 65001 >nul
title Carnage Party — подключение к серверу
cd /d "%~dp0"

echo ============================================================
echo   Carnage Party — подключение к внешнему серверу
echo ============================================================
echo.
echo Укажите адрес сервера, например:
echo   http://192.168.1.10:3001
echo   https://chat.example.com
echo.

if not exist "node_modules\electron" (
  echo [ОШИБКА] Зависимости не установлены.
  echo Сначала запустите install.bat
  goto end
)

set "SERVER_URL="
set /p "SERVER_URL=Адрес сервера: "
if not defined SERVER_URL (
  echo.
  echo [ОШИБКА] Адрес не указан.
  goto end
)

set "CARNAGE_SERVER_URL=%SERVER_URL%"
echo.
echo Подключаюсь к %CARNAGE_SERVER_URL% ...
echo.
call npx electron .

:end
echo.
pause
