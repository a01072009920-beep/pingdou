@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
node "%CD%\scripts\tunnel.mjs"
if errorlevel 1 pause
