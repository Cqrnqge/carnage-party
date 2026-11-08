@echo off
chcp 65001 >nul
title Carnage Party — полная сборка
cd /d "%~dp0"

echo ============================================================
echo   Carnage Party — полная сборка
echo ============================================================
echo.
echo Будут собраны:
echo   • установщик NSIS
echo   • переносная portable-версия
echo.
echo Это может занять несколько минут.
echo.

echo [1/3] Очистка старых артефактов...
call npm run clean
if errorlevel 1 goto failed

echo.
echo [2/3] Сборка клиента и обоих установщиков...
call npm run dist
if errorlevel 1 goto failed

echo.
echo [3/3] Проверка результата...
if not exist "release" goto failed

echo.
echo ============================================================
echo   ГОТОВО! Артефакты в папке release:
echo ============================================================
dir /b "release\*.exe"
echo.
explorer "%~dp0release"
goto end

:failed
echo.
echo [ОШИБКА] Полная сборка не завершена. Смотрите сообщения выше.

:end
echo.
pause
