@echo off
chcp 65001 >nul
title Carnage Party — меню
cd /d "%~dp0"

:menu
cls
echo ============================================================
echo                    CARNAGE PARTY
echo              твоя стая, твой голос, твоя вечеринка
echo ============================================================
echo.
echo   1. Установить зависимости
echo   2. Запустить приложение (сборка + Electron)
echo   3. Режим разработки (Vite + Electron)
echo   4. Запустить локальный сервер отдельно
echo   5. Собрать интерфейс клиента
echo   6. Собрать установщик (NSIS)
echo   7. Собрать portable-версию
echo   8. Собрать всё (установщик + portable)
echo   9. Открыть папку release
echo   L. Сервер для локальной сети
echo   R. Подключиться к внешнему серверу
echo   D. Проверка окружения (doctor)
echo   0. Очистить артефакты сборки
echo   Q. Выход
echo.
choice /c 1234567890LRDQ /n /m "Выберите действие: "

if errorlevel 14 goto quit
if errorlevel 13 goto doctor
if errorlevel 12 goto remote
if errorlevel 11 goto lan
if errorlevel 10 goto clean
if errorlevel 9 goto open
if errorlevel 8 goto all
if errorlevel 7 goto portable
if errorlevel 6 goto installer
if errorlevel 5 goto client
if errorlevel 4 goto server
if errorlevel 3 goto dev
if errorlevel 2 goto start
if errorlevel 1 goto install

:install
call "%~dp0install.bat"
goto menu

:start
call "%~dp0start.bat"
goto menu

:dev
call "%~dp0dev.bat"
goto menu

:server
call "%~dp0server.bat"
goto menu

:lan
call "%~dp0server-lan.bat"
goto menu

:remote
call "%~dp0remote-client.bat"
goto menu

:client
call "%~dp0build-client.bat"
goto menu

:installer
call "%~dp0build-installer.bat"
goto menu

:portable
call "%~dp0build-portable.bat"
goto menu

:all
call "%~dp0build-all.bat"
goto menu

:open
call "%~dp0open-release.bat"
goto menu

:clean
call "%~dp0clean.bat"
goto menu

:doctor
call "%~dp0doctor.bat"
goto menu

:quit
exit /b 0
