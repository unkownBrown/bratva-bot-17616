@echo off
cd /d "%~dp0"
title Nyalakan bot otomatis saat Windows login
echo.
echo  Ini membuat bot menyala sendiri setiap kali kamu login ke Windows.
echo  Untuk membatalkan: buka Command Prompt, ketik
echo     schtasks /delete /tn "BRV Panel Bot" /f
echo.
schtasks /create /tn "BRV Panel Bot" /tr "\"%~dp0start.bat\"" /sc onlogon /f
if errorlevel 1 goto fail
echo.
echo  Berhasil. Bot akan menyala sendiri saat login. PC tetap harus menyala.
pause
exit /b
:fail
echo.
echo  Gagal membuat tugas otomatis. Coba klik kanan file ini, pilih Run as administrator.
pause
exit /b
