@echo off
chcp 65001 >nul
title Carnage Party — проверка окружения
cd /d "%~dp0"

echo ============================================================
echo   Carnage Party — проверка окружения
echo ============================================================
echo.
echo Папка проекта: %~dp0
echo.

echo [Node.js]
where node
node --version
echo.

echo [npm]
where npm
call npm --version
echo.

echo [Зависимости]
if exist "node_modules\electron" (echo   electron: есть) else (echo   electron: НЕТ — запустите install.bat)
if exist "node_modules\express" (echo   express: есть) else (echo   express: НЕТ — запустите install.bat)
if exist "client\node_modules\vite" (echo   vite: есть) else (echo   vite: НЕТ — запустите install.bat)
echo.

echo [Сборка]
if exist "client\dist\index.html" (echo   client\dist: есть) else (echo   client\dist: нет)
if exist "release" (echo   release: есть) else (echo   release: нет)
echo.

echo [Данные]
if exist "data" (echo   data: есть) else (echo   data: нет — создастся при запуске сервера)
if exist "data-dev" (echo   data-dev: есть) else (echo   data-dev: нет — создастся в режиме разработки)
echo.

echo [Порты]
netstat -ano | findstr ":3001 " >nul && echo   :3001 занят || echo   :3001 свободен
netstat -ano | findstr ":5173 " >nul && echo   :5173 занят || echo   :5173 свободен
netstat -ano | findstr ":32456 " >nul && echo   :32456 занят || echo   :32456 свободен
echo.

pause
