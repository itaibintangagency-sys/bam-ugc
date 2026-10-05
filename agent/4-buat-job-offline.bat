@echo off
cd /d "%~dp0"
set SOURCE=local
set /p PROJECT=Tempel alamat project Flow lalu Enter: 
set /p SB=Alamat file storyboard (contoh C:\aset\storyboard.png): 
set /p JS=Alamat file JSON prompt (contoh C:\aset\prompt.json): 
set RES=720p
set /p RES=Resolusi 360p atau 720p [720p]: 
set EXTRA=
set /p EXTRA=Foto wajah karakter (disarankan; Enter untuk melewati): 
set PROJECT=%PROJECT:"=%
set SB=%SB:"=%
set JS=%JS:"=%
set EXTRA=%EXTRA:"=%
echo.
echo ===== PERIKSA DULU =====
echo Project   : %PROJECT%
echo Storyboard: %SB%
echo JSON      : %JS%
echo Resolusi  : %RES%
if defined EXTRA (echo Foto wajah: %EXTRA%) else (echo Foto wajah: ^(tanpa^))
echo.
set /p OK=Sudah benar? Ketik Y lalu Enter untuk membuat job (selain itu dibatalkan): 
if /i not "%OK%"=="Y" (
  echo Dibatalkan. Tidak ada job yang dibuat.
  pause
  exit /b 1
)
if defined EXTRA (
  node src/index.js enqueue-local --project "%PROJECT%" --storyboard "%SB%" --json "%JS%" --res %RES% --extra "%EXTRA%"
) else (
  node src/index.js enqueue-local --project "%PROJECT%" --storyboard "%SB%" --json "%JS%" --res %RES%
)
echo.
pause
