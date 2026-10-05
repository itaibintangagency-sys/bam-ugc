@echo off
cd /d "%~dp0"
echo Pemeriksaan sebelum produksi (hanya membaca, tidak menekan generate)...
node src/index.js doctor
echo.
pause
