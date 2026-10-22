@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 or newer from https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  call npm.cmd install --no-fund --no-audit
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node "%CD%\src\cli.mjs" --open
if errorlevel 1 pause
