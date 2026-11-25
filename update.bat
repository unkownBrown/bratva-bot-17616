@echo off
setlocal
cd /d "%~dp0"
title Update BRV Panel Bot
echo.
echo  ==== UPDATE BOT ====
echo  Data kamu (teks panel, pengaturan, gambar, token) tidak ditimpa.
echo  Tidak perlu install ulang.
echo.
echo  Seret file zip update ke jendela ini, lalu tekan Enter.
set "ZIP="
set /p "ZIP=  File zip: "
set "ZIP=%ZIP:"=%"
if "%ZIP%"=="" goto nozip
if not exist "%ZIP%" goto nozip

set "TMPD=%TEMP%\brv_update_%RANDOM%"
echo.
echo  Mengekstrak...
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%TMPD%' -Force"
if errorlevel 1 goto fail
set "SRC=%TMPD%\bratva-bot"
if not exist "%SRC%\index.js" goto badzip

echo  Menyalin file baru...
robocopy "%SRC%" "%~dp0." /E /XD data node_modules /XF .env /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto fail
rmdir /s /q "%TMPD%"

echo  Memasang kebutuhan baru kalau ada...
call npm install --no-audit --no-fund >nul 2>nul
echo.
echo  Update selesai. Klik start.bat buat menyalakan bot.
pause
exit /b

:nozip
echo.
echo  File zip tidak ketemu. Jalankan update.bat lagi, lalu seret file zip-nya ke jendela ini.
pause
exit /b

:badzip
echo.
echo  Isi zip tidak cocok (bukan file update bot ini).
rmdir /s /q "%TMPD%"
pause
exit /b

:fail
echo.
echo  Update gagal. Data kamu aman dan tidak berubah. Kirim pesan di atas ke yang bikin.
pause
exit /b
