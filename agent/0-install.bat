@echo off
cd /d "%~dp0"
echo Memasang library agent (sekali saja)...
call npm install
echo.
echo Selesai. Salin .env.example menjadi .env lalu isi nilainya sendiri.
pause
