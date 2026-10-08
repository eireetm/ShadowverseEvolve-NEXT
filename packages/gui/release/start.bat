@echo off
rem One block: cmd reads all of it before it runs, so an update can replace this file while it runs.
(
  title Shadowverse: Evolve NEXT
  cd /d "%~dp0"
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js was not found.
    echo Please install Node.js 20 or newer ^(24 LTS recommended^): https://nodejs.org/
    echo China mirror: https://npmmirror.com/mirrors/node/
    echo.
    pause
    exit /b 1
  )
  node server.mjs
  echo.
  pause
  exit /b
)
