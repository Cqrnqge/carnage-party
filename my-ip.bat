@echo off
chcp 65001 >nul
title Carnage Party — мой IP без VPN
cd /d "%~dp0"

if not exist "node_modules" (
  echo [ОШИБКА] Зависимости не установлены.
  echo Сначала запустите install.bat
  goto end
)

node scripts\show-my-ip.cjs

:end
echo.
pause
