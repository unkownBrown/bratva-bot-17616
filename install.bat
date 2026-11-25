@echo off
setlocal
cd /d "%~dp0"
title BRV Panel Bot
echo.
echo  ==== BRV PANEL BOT ====
echo.

rem --- 1. Cek Node.js (butuh versi 18 ke atas) ---
where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "process.exit(parseInt(process.versions.node)>=18?0:1)" >nul 2>nul
if errorlevel 1 goto nonode
goto hasnode

:nonode
echo  Node.js belum ada atau versinya terlalu lama. Mencoba pasang otomatis...
where winget >nul 2>nul
if errorlevel 1 goto manual
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
echo.
echo  Node.js sudah terpasang.
echo  TUTUP jendela ini, lalu klik dua kali install.bat sekali lagi.
pause
exit /b

:manual
echo  Pasang manual dulu: https://nodejs.org  (pilih yang LTS)
echo  Setelah selesai, klik dua kali install.bat lagi.
start "" https://nodejs.org
pause
exit /b

:hasnode
rem --- 2. Token bot ---
if not exist .env goto asktoken
findstr /r /c:"^DISCORD_TOKEN=..*" .env >nul 2>nul
if not errorlevel 1 goto hastoken

:asktoken
echo.
echo  Tempel token bot lalu tekan Enter. Klik kanan di jendela ini = paste.
echo  Token ada di Discord Developer Portal: Bot, lalu Reset Token.
echo  Sekalian nyalakan SERVER MEMBERS INTENT di halaman Bot yang sama.
echo.
set "TOKEN="
set /p "TOKEN=  Token: "
if "%TOKEN%"=="" goto asktoken
> .env echo DISCORD_TOKEN=%TOKEN%
echo  Token tersimpan di file .env

:hastoken
rem --- 3. Dependensi ---
if exist node_modules goto run
echo.
echo  Memasang kebutuhan bot, tunggu sebentar...
call npm install --no-audit --no-fund
if errorlevel 1 goto npmfail

:run
call "%~dp0start.bat"
exit /b

:npmfail
echo.
echo  Gagal memasang kebutuhan bot. Cek koneksi internet lalu coba lagi.
pause
exit /b
