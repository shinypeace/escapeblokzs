@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Please install Node.js 18 or newer from https://nodejs.org
  pause
  exit /b 1
)
start "" "http://localhost:4173"
node server.mjs
pause
