@echo off
chcp 65001 >nul
title Carnage Party — сервер для локальной сети
cd /d "%~dp0"

echo ============================================================
echo   Carnage Party — сервер для локальной сети
echo ============================================================
echo.
echo Сервер будет доступен другим ПК по адресу http://ВАШ-IP:3001
echo Сервер покажет ваш IP без VPN после запуска.
echo Этот адрес вводится в клиенте: Настройки -^> Сервер -^> Адрес сервера.
echo.
echo [ВАЖНО] Если включён AmneziaVPN, выключите его перед запуском.
echo Иначе Windows отправит ответы через VPN и внешний IP будет недоступен.
echo.
echo [ВАЖНО] При первом запуске Windows спросит доступ в сеть —
echo разрешите Node.js для частных сетей.
echo.

if not exist "node_modules\express" (
  echo [ОШИБКА] Зависимости не установлены.
  echo Сначала запустите install.bat
  goto end
)

set CARNAGE_HOST=0.0.0.0
call npm run server

:end
echo.
pause
