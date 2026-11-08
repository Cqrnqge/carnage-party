@echo off
chcp 65001 >nul
title Carnage Party — запуск приложения
cd /d "%~dp0"

echo ============================================================
echo   Carnage Party — сборка клиента и запуск приложения
echo ============================================================
echo.
echo Это может занять 20–60 секунд при первом запуске.
echo.

if not exist "node_modules\electron" (
  echo [ОШИБКА] Зависимости не установлены.
  echo Сначала запустите install.bat
  goto end
)

call npm start
if errorlevel 1 (
  echo.
  echo [ОШИБКА] Приложение завершилось с ошибкой.
  echo Проверьте, что клиент собрался: build-client.bat
)

:end
echo.
pause
