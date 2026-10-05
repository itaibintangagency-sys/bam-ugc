@echo off
cd /d "%~dp0"
set SOURCE=local
echo Menjalankan SEMUA job di antrean offline (folder local\inbox), satu per satu...
echo Jangan menyentuh mouse dan keyboard di jendela Chrome. Jangan menekan Ctrl+C.
echo.
node src/index.js all
echo.
echo Video ada di folder local\outbox.
pause
