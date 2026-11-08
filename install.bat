@echo off
chcp 65001 >nul
title Carnage Party — установка зависимостей
cd /d "%~dp0"

echo ============================================================
echo   Carnage Party — установка зависимостей
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] Node.js не найден. Установите Node.js 20+ с https://nodejs.org
  goto end
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] npm не найден. Переустановите Node.js.
  goto end
)

echo [1/2] Устанавливаю зависимости сервера и Electron...
call npm install
if errorlevel 1 goto failed

echo.
echo [2/2] Устанавливаю зависимости клиента...
call npm --prefix client install
if errorlevel 1 goto failed

echo.
echo [ГОТОВО] Зависимости установлены.
echo Теперь можно запускать start.bat или dev.bat.
goto end

:failed
echo.
echo [ОШИБКА] Установка не завершена. Проверьте интернет и права доступа к папке.

:end
echo.
pause
