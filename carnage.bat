@echo off
chcp 65001 >nul
setlocal EnableExtensions
title Carnage Party — единое меню
cd /d "%~dp0"

:menu
cls
set "VERSION=?"
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version" 2^>nul`) do set "VERSION=%%v"

echo ============================================================
echo                    CARNAGE PARTY
echo                 версия проекта: %VERSION%
echo ============================================================
echo.
echo   ОСНОВНОЕ
echo    1. Установить зависимости
echo    2. Запустить приложение (сборка клиента + Electron)
echo    3. Режим разработки (Vite + Electron)
echo    4. Запустить сервер (127.0.0.1:3001)
echo    5. Запустить сервер для локальной сети
echo    6. Подключиться к внешнему серверу
echo.
echo   СБОРКА
echo    7. Собрать веб-клиент
echo    8. Собрать установщик Windows (Setup)
echo    9. Собрать portable для Windows
echo   10. Собрать Windows: Setup + Portable
echo   11. Собрать Android APK
echo   12. Собрать всё: Windows + Android
echo   13. Разложить обновления и посчитать SHA256
echo.
echo   СЕРВИС
echo   14. Открыть папку release
echo   15. Открыть папку updates
echo   16. Очистить артефакты сборки
echo   17. Проверка окружения (doctor)
echo   18. Показать IP без VPN
echo   19. Остановить запущенные серверы
echo.
echo    0. Выход
echo.
set "CHOICE="
set /p "CHOICE=Выберите пункт: "
if not defined CHOICE goto menu

if "%CHOICE%"=="1" goto install
if "%CHOICE%"=="2" goto start
if "%CHOICE%"=="3" goto dev
if "%CHOICE%"=="4" goto server
if "%CHOICE%"=="5" goto server_lan
if "%CHOICE%"=="6" goto remote
if "%CHOICE%"=="7" goto client
if "%CHOICE%"=="8" goto installer
if "%CHOICE%"=="9" goto portable
if "%CHOICE%"=="10" goto windows
if "%CHOICE%"=="11" goto android
if "%CHOICE%"=="12" goto build_all
if "%CHOICE%"=="13" goto updates
if "%CHOICE%"=="14" goto open_release
if "%CHOICE%"=="15" goto open_updates
if "%CHOICE%"=="16" goto clean
if "%CHOICE%"=="17" goto doctor
if "%CHOICE%"=="18" goto my_ip
if "%CHOICE%"=="19" goto stop_servers
if "%CHOICE%"=="0" goto quit
if /i "%CHOICE%"=="Q" goto quit

echo.
echo Неизвестный пункт: %CHOICE%
timeout /t 2 >nul
goto menu

REM ------------------------------------------------------------------
REM 1. Зависимости
REM ------------------------------------------------------------------
:install
cls
echo [1] Установка зависимостей
echo.
call npm install
if errorlevel 1 goto failed
echo.
call npm --prefix client install
if errorlevel 1 goto failed
echo.
echo [Готово] Зависимости установлены.
goto done

REM ------------------------------------------------------------------
REM 2. Запуск приложения
REM ------------------------------------------------------------------
:start
cls
echo [2] Запуск приложения
echo.
if not exist "node_modules\electron" (
  echo [Ошибка] Зависимости не установлены. Выполните пункт 1.
  goto failed
)
call npm start
if errorlevel 1 goto failed
goto done

REM ------------------------------------------------------------------
REM 3. Режим разработки
REM ------------------------------------------------------------------
:dev
cls
echo [3] Режим разработки
echo.
if not exist "node_modules\electron" (
  echo [Ошибка] Зависимости не установлены. Выполните пункт 1.
  goto failed
)
call npm run dev
if errorlevel 1 goto failed
goto done

REM ------------------------------------------------------------------
REM 4. Локальный сервер
REM ------------------------------------------------------------------
:server
cls
echo [4] Локальный сервер: http://127.0.0.1:3001
echo Остановка — Ctrl+C.
echo.
if not exist "node_modules\express" (
  echo [Ошибка] Зависимости не установлены. Выполните пункт 1.
  goto failed
)
call npm run server
goto done

REM ------------------------------------------------------------------
REM 5. Сервер для локальной сети
REM ------------------------------------------------------------------
:server_lan
cls
echo [5] Сервер для локальной сети
echo.
echo Адрес для других ПК: http://^<IP-хоста^>:3001
echo IP без VPN можно посмотреть в пункте 17 или через my-ip.bat.
echo.
if not exist "node_modules\express" (
  echo [Ошибка] Зависимости не установлены. Выполните пункт 1.
  goto failed
)
set "CARNAGE_HOST=0.0.0.0"
call npm run server
set "CARNAGE_HOST="
goto done

REM ------------------------------------------------------------------
REM 6. Подключение к внешнему серверу
REM ------------------------------------------------------------------
:remote
cls
echo [6] Подключение к внешнему серверу
echo.
echo Пример: http://188.234.161.207:3001
echo.
set "SERVER_URL="
set /p "SERVER_URL=Адрес сервера: "
if not defined SERVER_URL goto menu
if not exist "node_modules\electron" (
  echo [Ошибка] Зависимости не установлены. Выполните пункт 1.
  goto failed
)
set "CARNAGE_SERVER_URL=%SERVER_URL%"
echo.
echo Подключаемся к %CARNAGE_SERVER_URL% ...
call npx electron .
set "CARNAGE_SERVER_URL="
goto done

REM ------------------------------------------------------------------
REM 7. Клиент
REM ------------------------------------------------------------------
:client
cls
echo [7] Сборка веб-клиента
echo.
call npm run build:client
if errorlevel 1 goto failed
echo.
echo [Готово] Клиент собран в client\dist
goto done

REM ------------------------------------------------------------------
REM 8. Установщик Windows
REM ------------------------------------------------------------------
:installer
cls
echo [8] Сборка установщика Windows (NSIS)
echo.
call :build_windows_target nsis
if errorlevel 1 goto failed
echo.
echo [Готово] Установщик в папке release.
goto done

REM ------------------------------------------------------------------
REM 9. Portable
REM ------------------------------------------------------------------
:portable
cls
echo [9] Сборка portable для Windows
echo.
call :build_windows_target portable
if errorlevel 1 goto failed
echo.
echo [Готово] Portable в папке release.
goto done

REM ------------------------------------------------------------------
REM 10. Windows: Setup + Portable
REM ------------------------------------------------------------------
:windows
cls
echo [10] Сборка Windows: Setup + Portable
echo.
call :build_windows_target nsis portable
if errorlevel 1 goto failed
echo.
echo [Готово] Setup и Portable в папке release.
goto done

REM ------------------------------------------------------------------
REM 11. Android
REM ------------------------------------------------------------------
:android
cls
echo [11] Сборка Android APK
echo.
call :build_android
if errorlevel 1 goto failed
echo.
echo [Готово] APK в папке release.
goto done

REM ------------------------------------------------------------------
REM 12. Всё: Windows + Android
REM ------------------------------------------------------------------
:build_all
cls
echo [12] Сборка всего: Windows + Android
echo.
call :build_windows_target nsis portable
if errorlevel 1 goto failed
echo.
call :build_android
if errorlevel 1 goto failed
echo.
echo [Готово] Все сборки в папке release.
goto done

REM ------------------------------------------------------------------
REM 13. Обновления и хеши
REM ------------------------------------------------------------------
:updates
cls
echo [13] Подготовка папки updates
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\prepare-updates.ps1"
if errorlevel 1 goto failed
goto done

REM ------------------------------------------------------------------
REM 14-15. Открыть папки
REM ------------------------------------------------------------------
:open_release
if not exist "%~dp0release" (
  echo Папка release ещё не создана. Сначала выполните сборку.
  goto done
)
explorer "%~dp0release"
goto menu

:open_updates
if not exist "%~dp0updates" mkdir "%~dp0updates"
explorer "%~dp0updates"
goto menu

REM ------------------------------------------------------------------
REM 16. Очистка
REM ------------------------------------------------------------------
:clean
cls
echo [16] Очистка артефактов сборки
echo.
echo Будут удалены release, client\dist и dist.
echo Данные data и data-dev не затрагиваются.
echo.
choice /c YN /n /m "Удалить? [Y/N]: "
if errorlevel 2 goto menu
echo.
call npm run clean
if errorlevel 1 goto failed
echo.
echo [Готово] Артефакты удалены.
goto done

REM ------------------------------------------------------------------
REM 17. Проверка окружения
REM ------------------------------------------------------------------
:doctor
cls
echo [17] Проверка окружения
echo.
echo Папка: %~dp0
echo.
echo [Node.js]
where node 2>nul
if errorlevel 1 (echo   Node.js не найден — установите Node.js 20+) else (node --version)
echo.
echo [npm]
where npm 2>nul
if errorlevel 1 (echo   npm не найден) else (call npm --version)
echo.
echo [Зависимости]
if exist "node_modules\electron" (echo   electron: есть) else (echo   electron: нет — выполните пункт 1)
if exist "node_modules\express" (echo   express: есть) else (echo   express: нет — выполните пункт 1)
if exist "client\node_modules\vite" (echo   vite: есть) else (echo   vite: нет — выполните пункт 1)
echo.
echo [Сборки]
if exist "client\dist\index.html" (echo   client\dist: есть) else (echo   client\dist: нет)
if exist "release" (echo   release: есть) else (echo   release: нет)
echo.
echo [Порты]
netstat -ano | findstr ":3001 " >nul && echo   :3001  занят || echo   :3001  свободен
netstat -ano | findstr ":5173 " >nul && echo   :5173  занят || echo   :5173  свободен
netstat -ano | findstr ":32456 " >nul && echo   :32456 занят || echo   :32456 свободен
echo.
echo [IP без VPN]
call node scripts\show-my-ip.cjs 2>nul
goto done

REM ------------------------------------------------------------------
REM 18. IP без VPN
REM ------------------------------------------------------------------
:my_ip
cls
echo [18] IP без VPN
echo.
if not exist "node_modules" (
  echo [Ошибка] Зависимости не установлены. Выполните пункт 1.
  goto failed
)
call node scripts\show-my-ip.cjs
if errorlevel 1 goto failed
goto done

REM ------------------------------------------------------------------
REM 19. Остановка серверов
REM ------------------------------------------------------------------
:stop_servers
cls
echo [19] Остановка запущенных серверов
echo.
echo Будут остановлены только node-процессы этого проекта:
echo сервер 3001/3101, Vite 5173 и локальные порты 32456-32463.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-servers.ps1"
if errorlevel 1 goto failed
goto done

REM ------------------------------------------------------------------
REM Служебные подпрограммы
REM ------------------------------------------------------------------
:build_windows_target
call node scripts\write-default-server.cjs
if errorlevel 1 exit /b 1
call npm run build:client
if errorlevel 1 exit /b 1
call node node_modules\electron-builder\cli.js --win %* --config.electronDist=node_modules/electron/dist
exit /b %errorlevel%

:build_android
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0mobile\build-mobile.ps1"
exit /b %errorlevel%

REM ------------------------------------------------------------------
REM Завершение
REM ------------------------------------------------------------------
:failed
echo.
echo [Ошибка] Действие завершилось с ошибкой. Смотрите сообщения выше.

:done
echo.
pause
goto menu

:quit
endlocal
exit /b 0
