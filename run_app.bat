@echo off
title WealthTrack Personal Finance Launcher
echo Starting WealthTrack Backend API Server...
set PATH=C:\Program Files\nodejs;%PATH%
cd /d "%~dp0backend"
start "WealthTrack Backend Server" cmd /k "node server.js"
timeout /t 2 >nul
echo Opening WealthTrack Web Application in Browser...
start "" "%~dp0frontend\index.html"
echo.
echo WealthTrack is running!
