@echo off
cd /d "%~dp0"
set SOURCE=local
echo Menjalankan SATU job dari antrean offline (folder local\inbox)...
node src/index.js once
echo.
echo Hasil ada di folder local\outbox.
pause
