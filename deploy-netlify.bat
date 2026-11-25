@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Upload bot ke Netlify
set "NL=npx --yes netlify-cli@latest"
echo.
echo  ==== UPLOAD BOT KE NETLIFY ====
echo.

where git >nul 2>nul
if errorlevel 1 goto nogit
if exist ".netlify\brv-siap" goto push

rem ================= SETUP (cuma sekali) =================
where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "process.exit(parseInt(process.versions.node)>=24?0:1)" >nul 2>nul
if errorlevel 1 goto oldnode
if not exist .env goto notoken
set "DTOKEN="
for /f "tokens=1,* delims==" %%A in ('findstr /b "DISCORD_TOKEN=" .env') do set "DTOKEN=%%B"
if "%DTOKEN%"=="" goto notoken

echo  Setup pertama. Ikuti langkahnya, cuma sekali ini.
echo.
echo  [1/4] Akun dashboard (dipakai login di web, huruf dan angka saja).
:askuser
set "DUSER="
set /p "DUSER=  Username: "
echo %DUSER%| findstr /r "^[A-Za-z0-9][A-Za-z0-9]*$" >nul || goto askuser
:askpass
set "DPASS="
set /p "DPASS=  Password (minimal 8 karakter): "
echo %DPASS%| findstr /r "^[A-Za-z0-9][A-Za-z0-9]*$" >nul || goto askpass
if "%DPASS:~7,1%"=="" goto askpass
set "DSECRET="
for /f "delims=" %%S in ('powershell -NoProfile -Command "$b=New-Object byte[] 32;[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b);[Convert]::ToBase64String($b).Replace('+','a').Replace('/','b').Replace('=','')"') do set "DSECRET=%%S"
if "%DSECRET%"=="" goto fail

echo.
echo  [2/4] Menyiapkan git...
if not exist .git git init -b main >nul
for %%E in (node_modules .env data .netlify) do findstr /x /c:"%%E" /c:"%%E/" .gitignore >nul 2>nul || >> .gitignore echo %%E
git config user.email >nul 2>nul || git config user.email "bot@brv.local"
git config user.name >nul 2>nul || git config user.name "BRV Bot"
echo.
echo  Membuat repo GitHub privat otomatis...
git remote get-url origin >nul 2>nul
if not errorlevel 1 goto haverepo
set "GH=gh"
where gh >nul 2>nul
if not errorlevel 1 goto ghok
if exist "%ProgramFiles%\GitHub CLI\gh.exe" set "GH=%ProgramFiles%\GitHub CLI\gh.exe" & goto ghok
echo  Memasang GitHub CLI otomatis, tunggu sebentar...
winget install -e --id GitHub.cli --accept-source-agreements --accept-package-agreements
if exist "%ProgramFiles%\GitHub CLI\gh.exe" set "GH=%ProgramFiles%\GitHub CLI\gh.exe" & goto ghok
goto nogh
:ghok
"%GH%" auth status >nul 2>nul && goto loggedin
echo  Login GitHub: tekan Enter, salin kode yang muncul, lalu login di browser.
"%GH%" auth login --hostname github.com --git-protocol https --web
:loggedin
"%GH%" auth status >nul 2>nul
if errorlevel 1 goto fail
"%GH%" auth setup-git
git add -A
git commit -m "bot" >nul 2>nul
git branch -M main
set "RNAME=bratva-bot-%RANDOM%"
"%GH%" repo create %RNAME% --private --source=. --remote=origin --push
if errorlevel 1 goto pushfail
goto netlify
:haverepo
git add -A
git commit -m "bot" >nul 2>nul
git push -u origin main
if errorlevel 1 goto pushfail
:netlify

if exist ".netlify\state.json" goto envs
echo.
echo  [3/4] Hubungkan ke Netlify. Login di browser, lalu kalau ditanya pilih "Create and configure a new site",
echo  pilih team kamu, nama situs bebas, dan sisanya tekan Enter saja. Pengaturan build sudah ada di netlify.toml.
call %NL% login
if errorlevel 1 goto fail
call %NL% init
if errorlevel 1 goto fail
:envs

echo.
echo  [4/4] Mengirim token dan akun dashboard ke Netlify...
call %NL% env:set DISCORD_TOKEN "%DTOKEN%"
call %NL% env:set DASH_USER "%DUSER%"
call %NL% env:set DASH_PASS "%DPASS%"
call %NL% env:set DASH_SECRET "%DSECRET%"
if errorlevel 1 goto fail
if not exist .netlify mkdir .netlify
type nul > ".netlify\brv-siap"
git commit --allow-empty -m "pakai pengaturan baru" >nul 2>nul
git push
echo.
echo  Selesai. Netlify sedang membangun bot (1 sampai 3 menit).
echo  Dashboard: alamat situsmu + /dash   contoh https://nama-situs.netlify.app/dash
echo  Alamat situs ada di https://app.netlify.com
pause
exit /b

rem ================= UPLOAD BIASA (tiap kali ada perubahan) =================
:push
echo  Mengunggah perubahan...
git add -A
git commit -m "update %date% %time%" >nul 2>nul
git push
if errorlevel 1 goto pushfail
echo.
echo  Terkirim. Netlify membangun otomatis (1 sampai 3 menit), bot menyala lagi sendiri.
pause
exit /b

:nogit
echo  Git belum terpasang. Pasang dulu dari https://git-scm.com lalu jalankan file ini lagi.
start "" https://git-scm.com/download/win
pause
exit /b
:nonode
echo  Node.js belum terpasang. Pasang versi 24 dari https://nodejs.org lalu jalankan file ini lagi.
start "" https://nodejs.org
pause
exit /b
:oldnode
echo  Node.js kamu masih lama. Netlify Server butuh versi 24 ke atas. Pasang dari https://nodejs.org lalu jalankan file ini lagi.
start "" https://nodejs.org
pause
exit /b
:nogh
echo.
echo  GitHub CLI gagal dipasang otomatis. Pasang manual dari https://cli.github.com lalu jalankan file ini lagi.
start "" https://cli.github.com
pause
exit /b
:notoken
echo  Token bot belum ada di file .env. Jalankan install.bat dulu sampai bot pernah menyala.
pause
exit /b
:pushfail
echo.
echo  Gagal mengunggah ke GitHub. Cek alamat repo dan koneksi internet, lalu jalankan file ini lagi.
pause
exit /b
:fail
echo.
echo  Ada langkah yang gagal. Baca pesan di atas, lalu jalankan file ini lagi (langkah yang sudah jadi aman diulang).
pause
exit /b
