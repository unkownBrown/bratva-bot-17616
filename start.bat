@echo off
cd /d "%~dp0"
title BRV Panel Bot
if not exist .env goto setup
if not exist node_modules goto setup
call npm install --no-audit --no-fund >nul 2>nul

:run
node index.js
rem Kode 42 = restart yang disengaja (setelah update). Bot dinyalakan lagi otomatis.
if %errorlevel%==42 goto run
echo.
echo  Bot berhenti. Kalau ada pesan error di atas, kirim ke yang bikin.
pause
exit /b

:setup
call install.bat
