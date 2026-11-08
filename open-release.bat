@echo off
chcp 65001 >nul
title Carnage Party — папка сборки
cd /d "%~dp0"

if not exist "release" (
  echo Папка release ещё не создана.
  echo Сначала выполните build-all.bat
  echo.
  pause
  exit /b 0
)

explorer "%~dp0release"
